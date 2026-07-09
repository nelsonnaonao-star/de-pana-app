import { supabase } from "../lib/supabase";

let cachedIceServers: RTCConfiguration["iceServers"] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchTurnCredentials(): Promise<RTCConfiguration["iceServers"]> {
  const now = Date.now();
  if (cachedIceServers && now - cacheTimestamp < CACHE_TTL) {
    return cachedIceServers;
  }

  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL;
    if (!serverUrl) throw new Error("VITE_SERVER_URL not set");

    const response = await fetch(`${serverUrl}/api/turn/credentials`, {
      method: "POST",
    });

    if (!response.ok) throw new Error(`TURN fetch failed: ${response.status}`);

    const data = await response.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      cachedIceServers = data.iceServers;
      cacheTimestamp = now;
      return cachedIceServers;
    }
  } catch (err) {
    console.warn("[WebRTC] Failed to fetch TURN credentials, using STUN fallback:", err);
  }

  // Fallback to public STUN servers
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
}

export class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private callId: string;
  private userId: string;
  private iceServers: RTCConfiguration["iceServers"] | null = null;
  private subscribedPromise: Promise<void> | null = null;

  onRemoteStream: ((stream: MediaStream) => void) | null = null;
  onCallEnded: (() => void) | null = null;
  onConnectionStateChange: ((state: string) => void) | null = null;

  constructor(callId: string, userId: string) {
    this.callId = callId;
    this.userId = userId;
  }

  async setIceServers(servers: RTCConfiguration["iceServers"]) {
    this.iceServers = servers;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  async startLocalStream(audio: boolean, video: boolean): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
    return this.localStream;
  }

  async createPeerConnection(): Promise<RTCPeerConnection> {
    const servers = this.iceServers || (await fetchTurnCredentials());
    this.pc = new RTCPeerConnection({ iceServers: servers });

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream);
      }
    }

    this.remoteStream = new MediaStream();
    this.pc.ontrack = (event) => {
      for (const track of event.streams[0].getTracks()) {
        this.remoteStream!.addTrack(track);
      }
      this.onRemoteStream?.(this.remoteStream);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.channel) {
        this.channel.send({
          type: "broadcast",
          event: "signal",
          payload: {
            type: "ice-candidate",
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            from: this.userId,
          } satisfies SignalPayload,
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState || "";
      this.onConnectionStateChange?.(state);
      if (state === "disconnected" || state === "failed") {
        this.onCallEnded?.();
      }
    };

    return this.pc;
  }

  private async sendSignal(signal: SignalPayload) {
    if (!this.channel) return;
    await this.channel.send({
      type: "broadcast",
      event: "signal",
      payload: signal,
    });
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PeerConnection not created. Call createPeerConnection() first.");
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.sendSignal({
      type: "offer",
      sdp: JSON.stringify(offer),
      from: this.userId,
    });
    return offer;
  }

  async handleOffer(offerSdp: string): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PeerConnection not created.");
    const offer = JSON.parse(offerSdp) as RTCSessionDescriptionInit;
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.sendSignal({
      type: "answer",
      sdp: JSON.stringify(answer),
      from: this.userId,
    });
    return answer;
  }

  async handleAnswer(answerSdp: string) {
    if (!this.pc) return;
    const answer = JSON.parse(answerSdp) as RTCSessionDescriptionInit;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addIceCandidate(candidate: string, sdpMid: string | null, sdpMLineIndex: number | null) {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate({ candidate, sdpMid, sdpMLineIndex }));
    } catch (err) {
      console.error("[WebRTC] addIceCandidate error:", err);
    }
  }

  async subscribeToSignals(): Promise<void> {
    if (this.subscribedPromise) {
      return this.subscribedPromise;
    }

    this.subscribedPromise = new Promise((resolve) => {
      this.channel = supabase.channel(`call-signal:${this.callId}`, {
        config: { broadcast: { ack: false, selfEligible: false } },
      });

      this.channel.on("broadcast", { event: "signal" }, async (payload) => {
        const signal = payload.payload as SignalPayload;
        if (signal.from === this.userId) return;

        switch (signal.type) {
          case "offer":
            await this.handleOffer(signal.sdp!);
            break;
          case "answer":
            await this.handleAnswer(signal.sdp!);
            break;
          case "ice-candidate":
            await this.addIceCandidate(
              signal.candidate!,
              signal.sdpMid ?? null,
              signal.sdpMLineIndex ?? null
            );
            break;
          case "call-ended":
            this.onCallEnded?.();
            break;
        }
      });

      this.channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          resolve();
        }
      });
    });

    return this.subscribedPromise;
  }

  async endCall() {
    await this.sendSignal({ type: "call-ended", from: this.userId });
    this.cleanup();
  }

  cleanup() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.channel?.unsubscribe();
    this.localStream = null;
    this.remoteStream = null;
    this.pc = null;
    this.channel = null;
    this.subscribedPromise = null;
  }

  async waitForSubscribed(): Promise<void> {
    if (this.subscribedPromise) {
      return this.subscribedPromise;
    }
    return Promise.resolve();
  }
}

export async function getTurnIceServers(): Promise<RTCConfiguration["iceServers"]> {
  return fetchTurnCredentials();
}

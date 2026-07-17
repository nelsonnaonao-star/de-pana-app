import { supabase } from "../lib/supabase";

type SignalPayload = {
  type: "offer" | "answer" | "ice-candidate" | "call-ended" | "callee-ready";
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  from: string;
};

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

  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
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
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private remoteDescSet = false;
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartCount = 0;
  private MAX_ICE_RESTARTS = 3;

  onRemoteStream: ((stream: MediaStream) => void) | null = null;
  onCallEnded: (() => void) | null = null;
  onConnectionStateChange: ((state: string) => void) | null = null;
  onCalleeReady: (() => void) | null = null;

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
    const constraints: MediaStreamConstraints = {
      audio,
      video: video ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } : false,
    };
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
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
    this.remoteDescSet = false;
    this.pendingCandidates = [];

    this.pc.ontrack = (event) => {
      console.log(`[WebRTC] ontrack: kind=${event.track.kind}, enabled=${event.track.enabled}, readyState=${event.track.readyState}, streams=${event.streams.length}`);

      const addTrackToRemote = (track: MediaStreamTrack) => {
        const existing = this.remoteStream!.getTracks();
        if (!existing.some((t) => t.id === track.id)) {
          track.onmute = () => console.warn("[WebRTC] Remote track muted:", track.kind);
          track.onunmute = () => console.log("[WebRTC] Remote track unmuted:", track.kind);
          track.onended = () => console.warn("[WebRTC] Remote track ended:", track.kind);
          this.remoteStream!.addTrack(track);
          console.log("[WebRTC] Added remote track:", track.kind, "— total tracks:", this.remoteStream!.getTracks().length);
        }
      };

      if (!event.streams || !event.streams[0]) {
        console.warn("[WebRTC] ontrack event with no streams, track kind:", event.track.kind);
        if (event.track && this.remoteStream) {
          addTrackToRemote(event.track);
          this.onRemoteStream?.(this.remoteStream);
        }
        return;
      }

      for (const track of event.streams[0].getTracks()) {
        addTrackToRemote(track);
      }
      this.onRemoteStream?.(this.remoteStream!);
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
      const iceState = this.pc?.iceConnectionState || "";
      const sigState = this.pc?.signalingState || "";
      const trackCount = this.remoteStream?.getTracks().length ?? 0;
      console.log(`[WebRTC] ICE: ${iceState} | Signaling: ${sigState} | Remote tracks: ${trackCount}`);
      this.onConnectionStateChange?.(iceState);

      if (iceState === "failed") {
        this.clearDisconnectedTimer();
        this.onCallEnded?.();
      } else if (iceState === "disconnected") {
        this.startDisconnectedTimer();
      } else if (iceState === "connected" || iceState === "completed") {
        this.clearDisconnectedTimer();
        this.iceRestartCount = 0;
      }
    };

    // Process any offer that arrived before PeerConnection was ready
    if (this.pendingOffer) {
      console.log("[WebRTC] Processing buffered offer after PC creation");
      const bufferedOffer = this.pendingOffer;
      this.pendingOffer = null;
      this.handleOffer(JSON.stringify(bufferedOffer)).catch((e) =>
        console.error("[WebRTC] Error processing buffered offer:", e)
      );
    }

    return this.pc;
  }

  private startDisconnectedTimer() {
    this.clearDisconnectedTimer();
    this.disconnectedTimer = setTimeout(async () => {
      if (this.pc && this.pc.iceConnectionState === "disconnected") {
        if (this.iceRestartCount < this.MAX_ICE_RESTARTS) {
          this.iceRestartCount++;
          console.warn(`[WebRTC] ICE disconnected for 10s — attempting restart #${this.iceRestartCount}`);
          try {
            await this.performIceRestart();
          } catch (e) {
            console.error("[WebRTC] ICE restart failed:", e);
            this.onCallEnded?.();
          }
        } else {
          console.warn("[WebRTC] Max ICE restarts reached — ending call");
          this.onCallEnded?.();
        }
      }
    }, 10000);
  }

  private clearDisconnectedTimer() {
    if (this.disconnectedTimer) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
  }

  private async performIceRestart() {
    if (!this.pc) return;
    this.pc.restartIce();
    const offer = await this.pc.createOffer({ iceRestart: true });
    await this.pc.setLocalDescription(offer);
    await this.sendSignal({
      type: "offer",
      sdp: JSON.stringify(offer),
      from: this.userId,
    });
    console.log("[WebRTC] ICE restart offer sent");
  }

  private async flushPendingCandidates() {
    if (!this.pc || !this.remoteDescSet) return;
    while (this.pendingCandidates.length > 0) {
      const c = this.pendingCandidates.shift()!;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("[WebRTC] Error adding buffered candidate:", err);
      }
    }
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

  async handleOffer(offerSdp: string): Promise<RTCSessionDescriptionInit | null> {
    if (!this.pc) {
      console.warn("[WebRTC] handleOffer: PC not ready, buffering offer");
      this.pendingOffer = JSON.parse(offerSdp) as RTCSessionDescriptionInit;
      return null;
    }
    try {
      const offer = JSON.parse(offerSdp) as RTCSessionDescriptionInit;
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.remoteDescSet = true;
      await this.flushPendingCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.sendSignal({
        type: "answer",
        sdp: JSON.stringify(answer),
        from: this.userId,
      });
      return answer;
    } catch (err) {
      console.error("[WebRTC] Error in handleOffer:", err);
      throw err;
    }
  }

  async handleAnswer(answerSdp: string) {
    if (!this.pc) {
      console.error("[WebRTC] handleAnswer: NO PeerConnection exists!");
      return;
    }
    try {
      const answer = JSON.parse(answerSdp) as RTCSessionDescriptionInit;
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.remoteDescSet = true;
      await this.flushPendingCandidates();
    } catch (err) {
      console.error("[WebRTC] Error in handleAnswer:", err);
    }
  }

  async addIceCandidate(candidate: string, sdpMid: string | null, sdpMLineIndex: number | null) {
    if (!this.pc) return;

    if (!this.remoteDescSet) {
      this.pendingCandidates.push({ candidate, sdpMid: sdpMid ?? undefined, sdpMLineIndex: sdpMLineIndex ?? undefined });
      return;
    }

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

    this.subscribedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Signal channel subscribe timeout (15s)"));
      }, 15000);

      this.channel = supabase.channel(`call-signal:${this.callId}`, {
        config: { broadcast: { ack: false, self: false } },
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
          case "callee-ready":
            this.onCalleeReady?.();
            break;
        }
      });

      this.channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    return this.subscribedPromise;
  }

  async resendOffer(): Promise<void> {
    if (!this.pc) {
      await this.createPeerConnection();
    }

    if (!this.channel) {
      await this.subscribeToSignals();
    }

    if (this.pc!.signalingState === "have-local-offer") {
      await this.pc!.setLocalDescription({ type: "rollback" });
    }

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    await this.sendSignal({
      type: "offer",
      sdp: JSON.stringify(offer),
      from: this.userId,
    });
  }

  async signalCalleeReady(): Promise<void> {
    await this.sendSignal({
      type: "callee-ready",
      from: this.userId,
    });
  }

  private currentFacingMode: "user" | "environment" = "user";

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  setVideoEnabled(enabled: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = enabled;
    }
  }

  async switchCamera(): Promise<MediaStream | null> {
    if (!this.localStream || !this.pc) return null;
    const newFacing = this.currentFacingMode === "user" ? "environment" : "user";

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return null;

      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        this.localStream.removeTrack(oldVideoTrack);
        this.localStream.addTrack(newVideoTrack);

        const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }

      this.currentFacingMode = newFacing;
      return this.localStream;
    } catch (err) {
      console.error("[WebRTC] switchCamera error:", err);
      return null;
    }
  }

  async endCall() {
    await this.sendSignal({ type: "call-ended", from: this.userId });
    this.cleanup();
  }

  cleanup() {
    this.clearDisconnectedTimer();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.channel?.unsubscribe();
    this.localStream = null;
    this.remoteStream = null;
    this.pc = null;
    this.channel = null;
    this.subscribedPromise = null;
    this.pendingCandidates = [];
    this.remoteDescSet = false;
    this.iceRestartCount = 0;
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

import { supabase } from "../lib/supabase";

type SignalPayload = {
  type: "offer" | "answer" | "ice-candidate" | "call-ended" | "callee-ready" | "reaction";
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  from: string;
  emoji?: string;
};

let cachedIceServers: RTCConfiguration["iceServers"] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const SIGNAL_MAX_RECONNECT_ATTEMPTS = 10;
const SIGNAL_BASE_RECONNECT_DELAY = 1000;
const SIGNAL_MAX_RECONNECT_DELAY = 30000;

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
  private signalReconnectAttempt = 0;
  private signalReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isCleanedUp = false;
  private qualityTimer: ReturnType<typeof setInterval> | null = null;
  private poorStreak = 0;

  onRemoteStream: ((stream: MediaStream) => void) | null = null;
  onCallEnded: (() => void) | null = null;
  onConnectionStateChange: ((state: string) => void) | null = null;
  onCalleeReady: (() => void) | null = null;
  onReaction: ((emoji: string) => void) | null = null;
  onNetworkQuality: ((poor: boolean) => void) | null = null;

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

    this.startQualityMonitor();

    return this.pc;
  }

  private startQualityMonitor() {
    this.stopQualityMonitor();
    this.poorStreak = 0;
    this.qualityTimer = setInterval(async () => {
      const pc = this.pc;
      if (!pc || pc.connectionState === "closed") return;
      try {
        const iceState = pc.iceConnectionState;
        if (iceState !== "connected" && iceState !== "completed" && iceState !== "disconnected" && iceState !== "failed") return;

        let poor = false;
        if (iceState === "disconnected" || iceState === "failed") {
          poor = true;
        } else {
          const stats = await pc.getStats();
          stats.forEach((report: any) => {
            if (
              report.type === "candidate-pair" &&
              report.state === "succeeded" &&
              report.currentRoundTripTime != null &&
              report.currentRoundTripTime > 0.4
            ) {
              poor = true;
            }
            if (
              report.type === "inbound-rtp" &&
              (report.packetsReceived + report.packetsLost) > 50 &&
              report.packetsLost / (report.packetsReceived + report.packetsLost) > 0.06
            ) {
              poor = true;
            }
          });
        }

        if (poor) {
          this.poorStreak++;
          if (this.poorStreak === 2) {
            console.warn("[WebRTC] Network quality degraded — unstable signal");
            this.onNetworkQuality?.(true);
          }
        } else {
          if (this.poorStreak >= 2) {
            console.log("[WebRTC] Network quality recovered");
            this.onNetworkQuality?.(false);
          }
          this.poorStreak = 0;
        }
      } catch {
      }
    }, 4000);
  }

  private stopQualityMonitor() {
    if (this.qualityTimer) {
      clearInterval(this.qualityTimer);
      this.qualityTimer = null;
    }
    this.poorStreak = 0;
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

    this.isCleanedUp = false;
    this.signalReconnectAttempt = 0;

    this.subscribedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Signal channel subscribe timeout (15s)"));
      }, 15000);

      const createChannel = () => {
        if (this.isCleanedUp) return;

        if (this.channel) {
          supabase.removeChannel(this.channel);
          this.channel = null;
        }

        const channel = supabase.channel(`call-signal:${this.callId}`, {
          config: { broadcast: { ack: false, self: false } },
        });
        this.channel = channel;

        channel.on("broadcast", { event: "signal" }, async (payload) => {
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
            case "reaction":
              this.onReaction?.(signal.emoji || "");
              break;
          }
        });

        channel.subscribe((status) => {
          if (channel !== this.channel) return;
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout);
            this.signalReconnectAttempt = 0;
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            scheduleReconnect(status);
          }
        });
      };

      const scheduleReconnect = (status: string) => {
        if (this.isCleanedUp || this.signalReconnectAttempt >= SIGNAL_MAX_RECONNECT_ATTEMPTS) {
          if (this.signalReconnectAttempt >= SIGNAL_MAX_RECONNECT_ATTEMPTS) {
            console.error("[WebRTC] Signal channel max reconnect attempts reached");
          }
          return;
        }

        this.signalReconnectAttempt++;
        const delay = Math.min(
          SIGNAL_BASE_RECONNECT_DELAY * Math.pow(2, this.signalReconnectAttempt - 1),
          SIGNAL_MAX_RECONNECT_DELAY
        );
        const jitter = Math.random() * 1000;
        console.warn(`[WebRTC] Signal channel ${status} — reconnect #${this.signalReconnectAttempt} in ${Math.round(delay + jitter)}ms`);

        if (this.signalReconnectTimer) clearTimeout(this.signalReconnectTimer);
        this.signalReconnectTimer = setTimeout(() => {
          this.signalReconnectTimer = null;
          if (!this.isCleanedUp) createChannel();
        }, delay + jitter);
      };

      createChannel();
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

  // Reacción en vivo: viaja por el canal de señalización (Supabase broadcast)
  // y el receptor la muestra animándola en su overlay. `self:false` evita eco.
  async sendReaction(emoji: string) {
    await this.sendSignal({ type: "reaction", from: this.userId, emoji });
  }

  // Filtros de video aplicados AL OUTGOING: se pinta la cámara en un <canvas>
  // con ctx.filter y se envía ese stream (canvas.captureStream) por
  // replaceTrack, para que el OTRO usuario vea el filtro (los filtros solo del
  // lado local no modificarían lo que se envía).
  private activeFilterCss = "";
  private rawVideoTrack: MediaStreamTrack | null = null;
  private filterVideoEl: HTMLVideoElement | null = null;
  private filterCanvas: HTMLCanvasElement | null = null;
  private filterCtx: CanvasRenderingContext2D | null = null;
  private filterStream: MediaStream | null = null;
  private filterRaf: number | null = null;
  private filterWidth = 640;
  private filterHeight = 480;

  async setVideoFilter(filterId: string) {
    if (!this.pc || !this.localStream) return;
    const css = VIDEO_FILTERS[filterId] || "";
    if (css === this.activeFilterCss) return;

    const wasFiltering = !!this.activeFilterCss;
    this.activeFilterCss = css;

    const rawTrack = this.localStream.getVideoTracks()[0];
    if (!rawTrack) return;

    // Si ya había un pipeline de filtro corriendo, detener el anterior.
    this.stopFilterPipeline();

    if (!wasFiltering) {
      // Primera vez que se activa un filtro: guardar la pista cruda.
      this.rawVideoTrack = rawTrack;
    }

    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!css) {
      // Volver a Normal: reenviar la cámara cruda.
      if (sender && this.rawVideoTrack) await sender.replaceTrack(this.rawVideoTrack);
      return;
    }

    const settings = rawTrack.getSettings();
    this.filterWidth = settings.width || 640;
    this.filterHeight = settings.height || 480;

    const videoEl = document.createElement("video");
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.srcObject = new MediaStream([rawTrack]);
    videoEl.play().catch(() => {});

    const canvas = document.createElement("canvas");
    canvas.width = this.filterWidth;
    canvas.height = this.filterHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    this.filterVideoEl = videoEl;
    this.filterCanvas = canvas;
    this.filterCtx = ctx;
    this.filterStream = canvas.captureStream(30);

    const draw = () => {
      if (this.filterCtx && this.filterVideoEl && this.filterVideoEl.readyState >= 2) {
        this.filterCtx.filter = this.activeFilterCss;
        this.filterCtx.drawImage(this.filterVideoEl, 0, 0, this.filterWidth, this.filterHeight);
      }
      this.filterRaf = requestAnimationFrame(draw);
    };
    this.filterRaf = requestAnimationFrame(draw);

    if (sender) {
      try {
        await sender.replaceTrack(this.filterStream.getVideoTracks()[0]);
      } catch (err) {
        console.error("[WebRTC] replaceTrack with filtered track failed", err);
      }
    }
  }

  private stopFilterPipeline() {
    if (this.filterRaf != null) cancelAnimationFrame(this.filterRaf);
    this.filterRaf = null;
    this.filterStream?.getTracks().forEach((t) => t.stop());
    this.filterStream = null;
    if (this.filterVideoEl) {
      try { this.filterVideoEl.srcObject = null; } catch {}
      this.filterVideoEl = null;
    }
    this.filterCanvas = null;
    this.filterCtx = null;
  }

  // Al cambiar de cámara se reemplaza la pista cruda: si hay un filtro activo,
  // re-apuntar la fuente del pipeline al track nuevo sin tocar lo que se envía.
  rebindFilterSource() {
    if (!this.activeFilterCss || !this.filterVideoEl) return;
    const rawTrack = this.localStream?.getVideoTracks()[0];
    if (!rawTrack) return;
    try {
      this.filterVideoEl.srcObject = new MediaStream([rawTrack]);
      this.filterVideoEl.play().catch(() => {});
    } catch {}
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
    const oldVideoTrack = this.localStream.getVideoTracks()[0];
    if (!oldVideoTrack) return null;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const currentDeviceId = oldVideoTrack.getSettings().deviceId;
      const nextCamera = devices
        .filter((d) => d.kind === "videoinput")
        .find((d) => d.deviceId && currentDeviceId && d.deviceId !== currentDeviceId);

      // Liberar la cámara actual ANTES de adquirir la otra: muchos WebViews de
      // Android fallan (NotReadableError) si "environment" se pide mientras
      // "user" sigue activa. Esperar un instante permite al sistema liberarla.
      oldVideoTrack.stop();
      await new Promise((r) => setTimeout(r, 350));

      let acquired: MediaStream;
      if (nextCamera && nextCamera.deviceId) {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: nextCamera.deviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
          audio: false,
        });
      } else {
        const newFacing: "user" | "environment" = this.currentFacingMode === "user" ? "environment" : "user";
        acquired = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
          audio: false,
        });
      }

      const newVideoTrack = acquired.getVideoTracks()[0];
      if (!newVideoTrack) {
        acquired.getTracks().forEach((t) => t.stop());
        return null;
      }

      // MediaStream NUEVO (audio actual vivo + cámara nueva) para que React
      // re-remonte el <video> local con el nuevo srcObject.
      const rebuilt = new MediaStream();
      for (const t of this.localStream.getAudioTracks()) rebuilt.addTrack(t);
      rebuilt.addTrack(newVideoTrack);
      this.localStream = rebuilt;
      this.rawVideoTrack = newVideoTrack;

      const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        if (this.activeFilterCss) {
          // Un filtro está activo: el sender lleva el track del canvas; solo
          // re-apuntamos la fuente del pipeline a la cámara nueva.
          this.rebindFilterSource();
        } else {
          await sender.replaceTrack(newVideoTrack);
        }
      }

      this.currentFacingMode = this.currentFacingMode === "user" ? "environment" : "user";
      return this.localStream;
    } catch (err) {
      console.error("[WebRTC] switchCamera error:", err);
      // Restaurar la cámara frontal para no dejar la llamada sin video cuando
      // la adquisición de la cámara opuesta falla.
      try {
        const restore = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        const restored = restore.getVideoTracks()[0];
        if (restored) {
          const rebuilt = new MediaStream();
          for (const t of this.localStream.getAudioTracks()) rebuilt.addTrack(t);
          rebuilt.addTrack(restored);
          this.localStream = rebuilt;
          this.rawVideoTrack = restored;
          const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            if (this.activeFilterCss) {
              this.rebindFilterSource();
            } else {
              await sender.replaceTrack(restored);
            }
          }
          this.currentFacingMode = "user";
        }
      } catch {
        // Ignorar: nada que podamos hacer aquí.
      }
      return null;
    }
  }

  async endCall() {
    await this.sendSignal({ type: "call-ended", from: this.userId });
    this.cleanup();
  }

  cleanup() {
    this.clearDisconnectedTimer();
    this.stopQualityMonitor();
    this.stopFilterPipeline();
    this.rawVideoTrack = null;
    this.activeFilterCss = "";
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    if (this.signalReconnectTimer) {
      clearTimeout(this.signalReconnectTimer);
      this.signalReconnectTimer = null;
    }
    this.isCleanedUp = true;
    if (this.channel) {
      supabase.removeChannel(this.channel);
    } else {
      this.channel?.unsubscribe();
    }
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

// Filtros de video en formato CSS (canvas ctx.filter). El mismo id que usa
// CallOverlay; se aplica sobre el video que se ENVÍA al otro participante.
export const VIDEO_FILTERS: Record<string, string> = {
  atardecer: "sepia(0.45) saturate(1.9) hue-rotate(-12deg) brightness(1.05) contrast(1.1)",
  cielo: "saturate(1.7) brightness(1.05) contrast(1.1) hue-rotate(6deg)",
  bosque: "hue-rotate(85deg) saturate(1.5) brightness(1.0) contrast(1.1)",
  noche: "hue-rotate(205deg) saturate(1.4) brightness(1.0) contrast(1.25)",
  retro: "sepia(0.85) saturate(1.25) contrast(0.9) brightness(1.05) hue-rotate(-5deg)",
};

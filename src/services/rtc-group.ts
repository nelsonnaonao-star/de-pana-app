import { supabase } from "../lib/supabase";
import { VIDEO_FILTERS } from "./webrtc";

type GroupSignal = {
  type: "join" | "leave" | "offer" | "answer" | "ice-candidate" | "call-ended" | "mute" | "video" | "reaction";
  from: string;
  to?: string;
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  muted?: boolean;
  videoEnabled?: boolean;
  participants?: string[];
  emoji?: string;
};

const GROUP_CALL_LIMIT = 4;

function logger(...args: unknown[]) {
  console.log("[RTCGroup]", ...args);
}

export class WebRTCGroupService {
  private roomId: string;
  private userId: string;
  private peerConns: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private remoteStreams: Map<string, MediaStream> = new Map();
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private iceServers: RTCConfiguration["iceServers"] | null = null;
  private subscribed = false;
  private currentFacingMode: "user" | "environment" = "user";
  // Presencia periódica: el announceJoin es un broadcast EFIMERO (ack:false,
  // sin replay). Un solo envío se pierde si el otro lado no está suscrito en
  // ese instante. Por eso TODOS los participantes (el que llega y los que ya
  // están) re-anuncian su presencia cada announceIntervalMs MIENTRAS la sala
  // esté activa: la ventana de oportunidad deja de ser ~8s y pasa a ser toda
  // la duración de la llamada. Se detiene en cleanup().
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly announceIntervalMs = 3500;
  private pendingIce: Map<string, { candidates: RTCIceCandidateInit[]; expiresAt: number }> = new Map();
  // Creación en vuelo por peerId: garantiza UNA sola PeerConnection por
  // (roomId + peerId). Solo el primer llamador inicia fetchIceServers()/new PC;
  // los llamadores concurrentes esperan exactamente esta misma Promise.
  private pendingPeerCreations: Map<string, Promise<RTCPeerConnection | null>> = new Map();

  onRemoteStream: ((userId: string, stream: MediaStream) => void) | null = null;
  onParticipantJoined: ((userId: string) => void) | null = null;
  onParticipantLeft: ((userId: string) => void) | null = null;
  onCallEnded: (() => void) | null = null;
  onMute: ((userId: string, muted: boolean) => void) | null = null;
  onVideo: ((userId: string, enabled: boolean) => void) | null = null;
  onReaction: ((userId: string, emoji: string) => void) | null = null;
  onReady: (() => void) | null = null;

  constructor(roomId: string, userId: string) {
    this.roomId = roomId;
    this.userId = userId;
  }

  setIceServers(servers: RTCConfiguration["iceServers"]) {
    this.iceServers = servers;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStreams(): Map<string, MediaStream> {
    return this.remoteStreams;
  }

  isAtLimit(): boolean {
    return this.peerConns.size >= GROUP_CALL_LIMIT;
  }

  getParticipantsCount(): number {
    return this.peerConns.size;
  }

  async startLocalStream(audio: boolean, video: boolean): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio,
      video: video
        ? { facingMode: "user", width: { ideal: 360 }, height: { ideal: 270 }, frameRate: { ideal: 15 } }
        : false,
    };
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.localStream;
  }

  async subscribeToRoom(): Promise<void> {
    if (this.subscribed) return;
    this.channel = supabase.channel(`group-call:${this.roomId}`, {
      config: { broadcast: { ack: false, self: false } },
    });

    this.channel.on("broadcast", { event: "group_signal" }, async (payload) => {
      const signal = payload.payload as GroupSignal;
      if (signal.from === this.userId) return;
      console.log(`[GJOIN] rx signal type=${signal.type} from=${signal.from.slice(0, 8)} to=${signal.to ? signal.to.slice(0, 8) : "-"} peers=${this.peerConns.size}`);

      switch (signal.type) {
        case "join": {
          // Anti-glare determinista por par: el uid lexicográficamente MENOR
          // genera el offer; el mayor espera y responde. Evita ofertas cruzadas
          // (crítico en la transición A-B y con C).
          const iAmOfferer = this.userId < signal.from;
          console.log(`[GJOIN] JOIN handler from=${signal.from.slice(0, 8)} existingPC=${this.peerConns.has(signal.from)} iAmOfferer=${iAmOfferer}`);
          await this.createPeerConnection(signal.from, iAmOfferer);
          break;
        }
        case "offer":
          if (signal.to && signal.to !== this.userId) return;
          await this.receiveOffer(signal.from, signal.sdp!);
          break;
        case "answer":
          if (signal.to && signal.to !== this.userId) return;
          await this.receiveAnswer(signal.from, signal.sdp!);
          break;
        case "ice-candidate":
          if (signal.to && signal.to !== this.userId) return;
          await this.addIceCandidate(signal.from, signal.candidate!, signal.sdpMid ?? null, signal.sdpMLineIndex ?? null);
          break;
        case "leave":
          logger("participant left:", signal.from);
          this.closePeer(signal.from);
          this.removeRemoteStream(signal.from);
          this.onParticipantLeft?.(signal.from);
          break;
        case "call-ended":
          logger("call ended by", signal.from);
          this.onCallEnded?.();
          break;
        case "mute":
          this.onMute?.(signal.from, signal.muted ?? false);
          break;
        case "video":
          this.onVideo?.(signal.from, signal.videoEnabled ?? true);
          break;
        case "reaction":
          this.onReaction?.(signal.from, signal.emoji || "");
          break;
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Group room subscribe timeout")), 15000);
      this.channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          this.subscribed = true;
          console.log(`[GJOIN] SUBSCRIBED user=${this.userId.slice(0, 8)} topic=group-call:${this.roomId}`);
          resolve();
        }
      });
    });
  }

  private async fetchIceServers(): Promise<RTCConfiguration["iceServers"]> {
    if (this.iceServers) return this.iceServers;
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL;
      if (!serverUrl) throw new Error("VITE_SERVER_URL not set");
      const response = await fetch(`${serverUrl}/api/turn/credentials`, { method: "POST" });
      if (!response.ok) throw new Error(`TURN fetch failed: ${response.status}`);
      const data = await response.json();
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        this.iceServers = data.iceServers;
        return data.iceServers;
      }
    } catch (err) {
      console.warn("[RTCGroup] TURN fallback to STUN:", err);
    }
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
  }

  async announceJoin(): Promise<void> {
    console.log(`[GJOIN] announceJoin user=${this.userId.slice(0, 8)} room=group-call:${this.roomId} subscribed=${this.subscribed}`);
    await this.sendSignal({ type: "join", from: this.userId });
    const peers: string[] = [];
    this.peerConns.forEach((_, peerId) => peers.push(peerId));
    await this.sendSignal({ type: "join", from: this.userId, participants: peers });
    console.log(`[GJOIN] announceJoin sent (2x join)`);
    this.onReady?.();
  }

  // El join broadcast es efímero (el oyente puede no estar suscrito aún, p.ej.
  // C aceptando antes de que A/B hayan entrado al canal). En vez de rendirse
  // tras N intentos en ~8s, Lanza un bucle PERIODICO de presencia que sigue
  // re-anunciando el join durante TODA la llamada: el que se une lo anuncia,
  // pero los que YA están también re-anuncian que siguen ahí. Así, aunque el
  // anuncio inicial del recién llegado se pierda, uno de los ya conectados lo
  // alcanza en su siguiente tick (y viceversa).
  async announceJoinUntilConnected(opts?: { intervalMs?: number }): Promise<void> {
    this.startAnnounceLoop(opts?.intervalMs);
  }

  startAnnounceLoop(intervalMs?: number): void {
    const interval = intervalMs ?? this.announceIntervalMs;
    if (this.announceTimer || !this.subscribed || !this.channel) return;
    const tick = async () => {
      if (!this.subscribed || !this.channel) return;
      try {
        await this.announceJoin();
      } catch (err) {
        console.warn("[RTCGroup] periodic announce failed:", err);
      }
    };
    void tick();
    this.announceTimer = setInterval(tick, interval);
  }

  hasParticipant(userId: string): boolean {
    return this.peerConns.has(userId);
  }

  // Única puerta de creación de PC por peer. Usa pendingPeerCreations para
  // que varios JOIN/OFFER concurrentes NO creen PCs duplicadas: la primera
  // llamada lanza la creación, el resto espera esa misma Promise.
  private async createPeerConnection(peerId: string, sendOffer = true): Promise<RTCPeerConnection | null> {
    // 1) Ya creada y guardada → devolver la existente.
    const existing = this.peerConns.get(peerId);
    if (existing) {
      console.log(`[MESH-PC] existing reused peer=${peerId.slice(0, 8)} sendOffer=${sendOffer}`);
      return existing;
    }

    // 2) Creación en curso para ese peer → esperar exactamente esa misma Promise.
    const pending = this.pendingPeerCreations.get(peerId);
    if (pending) {
      console.log(`[MESH-PC] pending creation reused peer=${peerId.slice(0, 8)} sendOffer=${sendOffer}`);
      try {
        return await pending;
      } catch (err) {
        console.error(`[MESH-PC] creation failed (pending wait) peer=${peerId.slice(0, 8)}:`, err);
        return null;
      }
    }

    // 3) Solo la primera llamada inicia fetchIceServers() y crea la PC.
    console.log(`[MESH-PC] create requested peer=${peerId.slice(0, 8)} sendOffer=${sendOffer}`);
    const creation = this.buildPeerConnection(peerId, sendOffer);
    this.pendingPeerCreations.set(peerId, creation);

    try {
      const pc = await creation;
      if (pc) console.log(`[MESH-PC] creation completed peer=${peerId.slice(0, 8)}`);
      return pc;
    } catch (err) {
      // 6) Falla: limpiar el pending entry y permitir un nuevo intento posterior.
      console.error(`[MESH-PC] creation failed peer=${peerId.slice(0, 8)}:`, err);
      return null;
    } finally {
      // 5) Al terminar (bien o mal), eliminar el registro de creación pendiente.
      this.pendingPeerCreations.delete(peerId);
    }
  }

  // Construcción real de la PC (solo la ejecuta el primer llamador).
  // La PC se guarda en peerConns SOLO aquí, una única vez por peer.
  private async buildPeerConnection(peerId: string, sendOffer: boolean): Promise<RTCPeerConnection> {
    if (!sendOffer) console.log(`[GJOIN] PC create for ${peerId.slice(0, 8)} (answerer, no offer)`);

    const servers = await this.fetchIceServers();
    console.log(`[GJOIN] PC ${peerId.slice(0, 8)} iceServers=${servers.length} cached=${!!this.iceServers} localTracks=${this.localStream?.getTracks().length ?? 0}`);
    const pc = new RTCPeerConnection({ iceServers: servers });

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    const remoteStream = new MediaStream();
    this.remoteStreams.set(peerId, remoteStream);

    pc.ontrack = (event) => {
      logger("ontrack from", peerId, "kind=", event.track.kind);
      if (event.streams && event.streams[0]) {
        for (const track of event.streams[0].getTracks()) {
          if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
            remoteStream.addTrack(track);
          }
        }
      } else if (event.track) {
        if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
      }
      this.onRemoteStream?.(peerId, remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.channel) {
        this.channel.send({
          type: "broadcast",
          event: "group_signal",
          payload: {
            type: "ice-candidate",
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            from: this.userId,
            to: peerId,
          } satisfies GroupSignal,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`[GJOIN] ICE ${peerId.slice(0, 8)} -> ${state} (pcCount=${this.peerConns.size})`);
      if (state === "failed" || state === "disconnected") {
        this.closePeer(peerId);
        this.removeRemoteStream(peerId);
        this.onParticipantLeft?.(peerId);
      }
    };

    pc.onnegotiationneeded = async () => {
      logger("onnegotiationneeded for", peerId);
    };

    this.peerConns.set(peerId, pc);

    // When we're the side that responds to an incoming offer for a brand-new
    // peer, don't push a counter-offer (WebRTC glare) — just answer below.
    if (!sendOffer) return pc;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.sendSignal({
        type: "offer",
        from: this.userId,
        to: peerId,
        sdp: JSON.stringify(offer),
      });
      console.log(`[GJOIN] OFFER sent to ${peerId.slice(0, 8)}`);
    } catch (err) {
      console.error("[RTCGroup] createOffer error:", err);
    }

    return pc;
  }

  private async receiveOffer(from: string, sdp: string): Promise<void> {
    console.log(`[GJOIN] offer RX from=${from.slice(0, 8)} existingPC=${this.peerConns.has(from)}`);
    let pc = await this.createPeerConnection(from, false);
    if (!pc) return;

    // Idempotencia: si la PC ya aplicó un remote description (offer anterior),
    // es un offer duplicado (broadcast re-entregado / PCs duplicadas del orígen).
    if (pc.currentRemoteDescription) {
      console.log(`[MESH-PC] duplicate offer ignored peer=${from.slice(0, 8)}`);
      return;
    }

    try {
      const offer = JSON.parse(sdp) as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingIceCandidates(from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.sendSignal({
        type: "answer",
        from: this.userId,
        to: from,
        sdp: JSON.stringify(answer),
      });
      console.log(`[GJOIN] ANSWER sent to ${from.slice(0, 8)}`);
    } catch (err) {
      console.error("[RTCGroup] receiveOffer error:", err);
    }
  }

  private async receiveAnswer(from: string, sdp: string): Promise<void> {
    console.log(`[GJOIN] answer RX from=${from.slice(0, 8)} existingPC=${this.peerConns.has(from)}`);
    const pc = this.peerConns.get(from);
    if (!pc) {
      console.warn("[RTCGroup] receiveAnswer: no PC for", from);
      return;
    }
    // Idempotencia: la PC ya tiene remote description (answer aplicado antes).
    if (pc.currentRemoteDescription) {
      console.log(`[MESH-PC] duplicate answer ignored peer=${from.slice(0, 8)}`);
      return;
    }
    try {
      const answer = JSON.parse(sdp) as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingIceCandidates(from);
    } catch (err) {
      console.error("[RTCGroup] receiveAnswer error:", err);
    }
  }

  // Los ICE candidates pueden llegar antes de que exista la PC (o antes del
  // remote description). Se guardan por `from` y se aplican apenas la PC esté
  // en condiciones — no se descartan silenciosamente por timing.
  private bufferIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const now = Date.now();
    const entry = this.pendingIce.get(peerId);
    if (entry && entry.expiresAt > now) {
      if (entry.candidates.length >= 60) return;
      entry.candidates.push(candidate);
    } else {
      this.pendingIce.set(peerId, { candidates: [candidate], expiresAt: now + 45000 });
    }
  }

  private async flushPendingIceCandidates(peerId: string) {
    const entry = this.pendingIce.get(peerId);
    if (!entry) return;
    const pc = this.peerConns.get(peerId);
    if (!pc || !pc.currentRemoteDescription) return;
    for (const c of entry.candidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (err) {
        console.warn("[RTCGroup] buffered ICE apply failed:", err);
      }
    }
    this.pendingIce.delete(peerId);
  }

  private async addIceCandidate(from: string, candidate: string, sdpMid: string | null, sdpMLineIndex: number | null) {
    const init: RTCIceCandidateInit = { candidate, sdpMid, sdpMLineIndex };
    const pc = this.peerConns.get(from);
    if (!pc || !pc.currentRemoteDescription) {
      console.warn(`[GJOIN] ICE RX buffered from=${from.slice(0, 8)} pc=${!!pc} hasRemote=${!!pc?.currentRemoteDescription} (peers=${[...this.peerConns.keys()].map(k => k.slice(0, 8)).join(",")})`);
      this.bufferIceCandidate(from, init);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(init));
    } catch (err) {
      console.error("[RTCGroup] addIceCandidate error:", err);
    }
  }

  private closePeer(peerId: string) {
    const pc = this.peerConns.get(peerId);
    if (pc) {
      pc.close();
      this.peerConns.delete(peerId);
    }
    this.pendingIce.delete(peerId);
    this.pendingPeerCreations.delete(peerId);
  }

  private removeRemoteStream(peerId: string) {
    const stream = this.remoteStreams.get(peerId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      this.remoteStreams.delete(peerId);
    }
  }

  private async sendSignal(signal: GroupSignal) {
    if (!this.channel) return;
    await this.channel.send({
      type: "broadcast",
      event: "group_signal",
      payload: signal,
    });
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
    void this.sendSignal({ type: "mute", from: this.userId, muted });
  }

  setVideoEnabled(enabled: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = enabled;
    }
    void this.sendSignal({ type: "video", from: this.userId, videoEnabled: enabled });
  }

  // Reacción en vivo: se difunde a todo el grupo por el canal broadcast.
  async sendReaction(emoji: string) {
    await this.sendSignal({ type: "reaction", from: this.userId, emoji });
  }

  // Filtros de video al outgoing para TODOS los peers del mesh (igual que 1:1).
  private activeFilterCss = "";
  private rawVideoTrack: MediaStreamTrack | null = null;
  private filterVideoEl: HTMLVideoElement | null = null;
  private filterCanvas: HTMLCanvasElement | null = null;
  private filterCtx: CanvasRenderingContext2D | null = null;
  private filterStream: MediaStream | null = null;
  private filterRaf: number | null = null;

  async setVideoFilter(filterId: string) {
    if (this.peerConns.size === 0 || !this.localStream) return;
    const css = VIDEO_FILTERS[filterId] || "";
    if (css === this.activeFilterCss) return;
    const wasFiltering = !!this.activeFilterCss;
    this.activeFilterCss = css;

    const rawTrack = this.localStream.getVideoTracks()[0];
    if (!rawTrack) return;
    this.stopFilterPipeline();
    if (!wasFiltering) this.rawVideoTrack = rawTrack;

    const senders = Array.from(this.peerConns.values())
      .map((pc) => pc.getSenders().find((s) => s.track?.kind === "video"))
      .filter(Boolean);

    if (!css) {
      for (const sender of senders) await sender!.replaceTrack(this.rawVideoTrack!);
      return;
    }

    const settings = rawTrack.getSettings();
    const w = settings.width || 360;
    const h = settings.height || 270;

    const videoEl = document.createElement("video");
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.srcObject = new MediaStream([rawTrack]);
    videoEl.play().catch(() => {});

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    this.filterVideoEl = videoEl;
    this.filterCanvas = canvas;
    this.filterCtx = ctx;
    this.filterStream = canvas.captureStream(15);

    const draw = () => {
      if (this.filterCtx && this.filterVideoEl && this.filterVideoEl.readyState >= 2) {
        this.filterCtx.filter = this.activeFilterCss;
        this.filterCtx.drawImage(this.filterVideoEl, 0, 0, w, h);
      }
      this.filterRaf = requestAnimationFrame(draw);
    };
    this.filterRaf = requestAnimationFrame(draw);

    for (const sender of senders) {
      try {
        await sender!.replaceTrack(this.filterStream!.getVideoTracks()[0]);
      } catch (err) {
        console.error("[RTCGroup] replaceTrack filtered failed", err);
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

  rebindFilterSource() {
    if (!this.activeFilterCss || !this.filterVideoEl) return;
    const rawTrack = this.localStream?.getVideoTracks()[0];
    if (!rawTrack) return;
    try {
      this.filterVideoEl.srcObject = new MediaStream([rawTrack]);
      this.filterVideoEl.play().catch(() => {});
    } catch {}
  }

  async switchCamera(): Promise<MediaStream | null> {
    if (!this.localStream) return null;
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (!oldTrack) return null;
    const next: "user" | "environment" = this.currentFacingMode === "environment" ? "user" : "environment";

    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 360 }, height: { ideal: 270 }, frameRate: { ideal: 15 } },
        audio: false,
      });
      const newTrack = acquired.getVideoTracks()[0];
      if (!newTrack) {
        acquired.getTracks().forEach((t) => t.stop());
        return null;
      }

      // Construir un MediaStream NUEVO con el audio actual + la cámara nueva.
      // Devolver la misma referencia haría que React haga bail-out y el <video>
      // local no re-asigne srcObject, dejando la pista anterior (muda/terminada).
      const rebuilt = new MediaStream();
      for (const t of this.localStream.getAudioTracks()) rebuilt.addTrack(t);
      rebuilt.addTrack(newTrack);

      this.localStream.getTracks().forEach((t) => { if (t !== newTrack) t.stop(); });
      this.localStream = rebuilt;
      this.rawVideoTrack = newTrack;

      if (this.activeFilterCss) {
        this.rebindFilterSource();
      } else {
        await Promise.all(
          Array.from(this.peerConns.values()).map((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            return sender ? sender.replaceTrack(newTrack) : Promise.resolve();
          })
        );
      }
      this.currentFacingMode = next;
      return this.localStream;
    } catch (err) {
      console.error("[RTCGroup] switchCamera error:", err);
      return null;
    }
  }

  async endCall() {
    await this.sendSignal({ type: "call-ended", from: this.userId });
    this.cleanup();
  }

  async leave() {
    await this.sendSignal({ type: "leave", from: this.userId });
    this.cleanup();
  }

  cleanup() {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    this.stopFilterPipeline();
    this.rawVideoTrack = null;
    this.activeFilterCss = "";
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.peerConns.forEach((pc, peerId) => {
      pc.close();
      this.removeRemoteStream(peerId);
    });
    this.peerConns.clear();
    this.remoteStreams.clear();
    this.pendingIce.clear();
    this.pendingPeerCreations.clear();
    this.subscribed = false;
    this.channel?.unsubscribe();
    this.channel = null;
    this.localStream = null;
    this.iceServers = null;
  }
}

export function isGroupCallAtLimit(count: number): boolean {
  return count >= GROUP_CALL_LIMIT;
}

export { GROUP_CALL_LIMIT };

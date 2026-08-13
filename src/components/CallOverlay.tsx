import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  PhoneOff, Phone, Mic, MicOff, Video, VideoOff, RotateCw,
  Sparkles, Smile, Image, ShieldAlert, Users, Layers, MonitorPlay
} from "lucide-react";
import { ActiveCall } from "../types";

interface CallOverlayProps {
  call: ActiveCall;
  localStream?: MediaStream | null;
  remoteStream?: MediaStream | null;
  remoteStreamsMap?: Map<string, MediaStream>;
  participantCount?: number;
  onAccept: () => void;
  onDecline: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onSwitchCamera: () => void;
  onEndCall: () => void;
  onAddMember: () => void;
}

const EMOJIS = ["👍", "❤️", "🔥", "😮", "😂", "🎉"];

export default function CallOverlay({
  call,
  localStream,
  remoteStream,
  remoteStreamsMap,
  participantCount = 0,
  onAccept,
  onDecline,
  onToggleMute,
  onToggleVideo,
  onSwitchCamera,
  onEndCall,
  onAddMember
}: CallOverlayProps) {
  const [activeFilter, setActiveFilter] = useState<string>("none");
  const [showEffects, setShowEffects] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRemotePlaying, setIsRemotePlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (call.status === "connected") {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          setElapsedSeconds(s => s + 1);
        }, 1000);
      }
    } else if (call.status === "outgoing" || call.status === "connecting") {
      setElapsedSeconds(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [call.status]);

  const formatTime = (totalSeconds: number) => {
    const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const emojiContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const attachRemoteStream = useCallback((videoEl: HTMLVideoElement, stream: MediaStream) => {
    if (videoEl.srcObject === stream) return;
    videoEl.srcObject = stream;

    // El WebView de Android SIEMPRE permite autoplay en mute; arranca el video
    // al instante sin mostrar el placeholder gris de play. Después desmentamos
    // de forma fiable (evento 'playing' + timeout + primer toque) para que el
    // audio llegue igual. Unir 'playing' ANTES de play() evita la carrera que
    // dejaba la llamada muda permanentemente.
    const unmute = () => { videoEl.muted = false; };
    videoEl.addEventListener('playing', unmute, { once: true });
    videoEl.muted = true;

    const tryPlay = (attempts = 0) => {
      videoEl.play().catch(() => {
        if (attempts > 10) {
          // El WebView sigue bloqueando: sin mute el placeholder no se pinta;
          // el audio se recupera con playing/timeout.
          videoEl.muted = false;
          document.addEventListener('touchstart', () => videoEl.play().catch(() => {}), { once: true });
          return;
        }
        setTimeout(() => tryPlay(attempts + 1), 250);
      });
    };
    tryPlay();

    setTimeout(() => { if (!videoEl.paused) unmute(); }, 1500);
    document.addEventListener('touchstart', () => setTimeout(unmute, 50), { once: true });
  }, []);

  const remoteVideoCallback = useCallback((node: HTMLVideoElement | null) => {
    remoteVideoRef.current = node;
    if (node && remoteStream) {
      attachRemoteStream(node, remoteStream);
    }
  }, [remoteStream, attachRemoteStream]);

  useEffect(() => {
    setIsRemotePlaying(false);
    if (remoteVideoRef.current && remoteStream) {
      attachRemoteStream(remoteVideoRef.current, remoteStream);
    }
  }, [remoteStream, attachRemoteStream]);

  const localVideoCallback = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node && localStream) {
      node.srcObject = localStream;
    }
  }, [localStream]);

  const getFilterClass = () => {
    switch (activeFilter) {
      case "atardecer": return "sepia-[.45] saturate-[1.9] hue-rotate-[-12deg] brightness-105 contrast-110";
      case "cielo": return "saturate-[1.7] brightness-110 contrast-105 hue-rotate-[6deg]";
      case "bosque": return "hue-rotate-[85deg] saturate-[1.5] brightness-100 contrast-110";
      case "noche": return "hue-rotate-[205deg] saturate-[1.4] brightness-90 contrast-125";
      case "retro": return "sepia-[.85] saturate-[1.25] contrast-90 brightness-105 hue-rotate-[-5deg]";
      default: return "";
    }
  };

  const triggerReaction = (emoji: string) => {
    const container = emojiContainerRef.current;
    if (!container) return;
    const el = document.createElement("span");
    el.className = "absolute text-3xl pointer-events-none z-40 drop-shadow-md animate-float-emoji";
    el.style.left = `${Math.random() * 80 + 10}%`;
    el.style.bottom = "80px";
    el.textContent = emoji;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  };

  if (call.status === "incoming") {
    return (
      <div className="absolute top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white shadow-xl border-b border-teal-500/30 animate-slide-down select-none">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping"></div>
            <img
              src={call.contactAvatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230a4d52'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M12 14c-4 0-6 2-6 4v2h12v-2c0-2-2-4-6-4z'/%3E%3C/svg%3E"}
              alt={call.contactName}
              className="w-10 h-10 rounded-full object-cover border-2 border-teal-400 relative z-10"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate">{call.contactName}</p>
            <p className="text-[9px] text-teal-200/70 font-medium">
              {call.type === "video" ? "Videollamada entrante..." : "Llamada entrante..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onDecline}
              className="w-9 h-9 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center shadow-lg active:scale-90 transition-all cursor-pointer"
              title="Rechazar"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
            <button
              onClick={onAccept}
              className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center shadow-lg active:scale-90 transition-all cursor-pointer relative"
              title="Responder"
            >
              <span className="absolute inset-[-3px] rounded-full border-2 border-emerald-400/50 animate-ping"></span>
              {call.type === "video" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
  );
}

  // GROUP CALL video grid (max 4 participants: 1 local + up to 3 remotes)
  const remoteList = remoteStreamsMap ? Array.from(remoteStreamsMap.entries()) : [];
  const isGroupVideo = ((call.isGroup || remoteList.length >= 2) && call.type === "video" && !call.isVideoOff && call.status === "connected");

  const GroupVideoContent = () => {
    const total = 1 + remoteList.length; // local + remotes
    const cols = total <= 1 ? 1 : total <= 2 ? 2 : total <= 4 ? 2 : 3;
    const rows = Math.ceil(total / cols);
    return (
      <div className="absolute inset-0 w-full h-full z-0 bg-black grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {/* Local (self) */}
        <div className="relative">
          {localStream ? (
            <video
              ref={(node) => { if (node && localStream) { node.srcObject = null; node.srcObject = localStream; } }}
              autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-teal-800/10 flex items-center justify-center text-xs text-teal-300">Sin cámara</div>
          )}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded-full text-[9px] font-semibold text-teal-300">Tú</div>
        </div>
        {/* Remotos */}
        {remoteList.map(([peerId, stream], i) => (
          <div key={peerId || i} className="relative">
            <video
              ref={(node) => { if (node && stream) attachRemoteStream(node, stream); }}
              autoPlay playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded-full text-[9px] font-semibold text-teal-300">#{i + 1}</div>
          </div>
        ))}
        <div className="absolute top-3 left-3 bg-black/50 text-[10px] px-2 py-1 rounded">
          {participantCount} conectados
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 bg-black text-white z-[9999] flex flex-col justify-between overflow-hidden select-none">

      <div ref={emojiContainerRef} className="absolute inset-0 pointer-events-none z-30 overflow-hidden" />

      {isGroupVideo ? (
        <GroupVideoContent />
      ) : (call.type === "video" && !call.isVideoOff && call.status === "connected" ? (
        <div className="absolute inset-0 w-full h-full z-0 bg-black">
          <div className="absolute inset-0 flex items-center justify-center">
            <video
              ref={remoteVideoCallback}
              autoPlay playsInline muted
              onLoadedData={() => setIsRemotePlaying(true)}
              onPlaying={() => setIsRemotePlaying(true)}
              className={`absolute inset-0 w-full h-full object-cover bg-black transition-opacity duration-300 ${isRemotePlaying ? "opacity-100" : "opacity-0"} ${getFilterClass()}`}
            />
            {!isRemotePlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <span className="w-8 h-8 border-2 border-slate-600 border-t-teal-400 rounded-full animate-spin" />
              </div>
            )}
            <div className="absolute bottom-28 left-4 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-xl border border-white/10 text-[10px] font-bold">
              📷 Cámara de {call.contactName}
            </div>
          </div>

          <div className="absolute top-6 right-3 w-32 h-48 rounded-[28px] border-[3px] border-teal-700/60 shadow-2xl bg-black z-20 overflow-hidden shadow-teal-500/20">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-4 bg-black rounded-b-xl z-10 flex items-center justify-center gap-1">
              <div className="w-1 h-1 rounded-full bg-slate-600"></div>
              <div className="w-4 h-1.5 rounded-full bg-gray-700"></div>
            </div>
            {localStream ? (
              <video
                ref={localVideoCallback}
                autoPlay playsInline muted
                className={`w-full h-full object-cover bg-black ${getFilterClass()}`}
              />
            ) : (
              <div className="absolute inset-0 bg-teal-800/10 flex items-center justify-center text-[10px] text-teal-300">
                Sin cámara
              </div>
            )}
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full text-[8px] font-semibold text-teal-300">
              Tú
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 bg-black z-0 flex flex-col items-center justify-center p-6">
          {remoteStream && (
            <video
              ref={remoteVideoCallback}
              autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover opacity-30"
            />
          )}
          <div className="relative z-10">
            <span className="absolute inset-[-15px] rounded-full border border-teal-500/20 animate-pulse"></span>
            <span className="absolute inset-[-30px] rounded-full border border-teal-500/10 animate-ping"></span>
            <img
              src={call.contactAvatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230a4d52'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M12 14c-4 0-6 2-6 4v2h12v-2c0-2-2-4-6-4z'/%3E%3C/svg%3E"}
              alt={call.contactName}
              className="w-28 h-28 rounded-full object-cover border-4 border-teal-400 relative z-10 shadow-lg"
            />
          </div>
          <div className="text-center mt-6 space-y-1 relative z-10">
            <h3 className="text-lg font-bold">{call.contactName}</h3>
            <p className="text-xs text-slate-400">
              {call.status === "outgoing" ? "Llamando..." : call.status === "connecting" ? "Conectando..." : "Llamada de voz cifrada"}
            </p>
          </div>
        </div>
      ))}

      <div className="relative z-10 p-4 pt-10 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-mono tracking-wider">
            {call.status === "outgoing" ? "CONECTANDO..." : call.status === "connecting" ? "CONECTANDO..." : formatTime(elapsedSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full text-[9px] font-bold border border-white/10 text-teal-200">
          <ShieldAlert className="w-3.5 h-3.5 text-teal-300" /> Cifrado Completo
        </div>
      </div>

      <div className="relative z-10 p-4 bg-gradient-to-t from-black/90 via-black/75 to-transparent pb-8 space-y-4">

        {call.type === "video" && (
          <div className="flex justify-center gap-3">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => triggerReaction(emoji)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 transition-all flex items-center justify-center text-base cursor-pointer"
                title={`Reacción en tiempo real ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {call.type === "video" && !call.isVideoOff && (
          <div className="space-y-3">
            <button
              onClick={() => setShowEffects(!showEffects)}
              className="mx-auto w-fit flex items-center gap-1 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 hover:text-white px-3 py-1.5 rounded-full border border-teal-500/30 text-[10px] font-bold transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {showEffects ? "Ocultar Filtros" : "Ajustar Filtros"}
            </button>

            {showEffects && (
              <div className="bg-black/80 rounded-2xl p-3 border border-slate-800 space-y-3.5 animate-fade-in">
<div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-400 block uppercase">Filtros de Video</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {[
                      { id: "none", name: "Normal" },
                      { id: "atardecer", name: "Atardecer" },
                      { id: "cielo", name: "Cielo" },
                      { id: "bosque", name: "Bosque" },
                      { id: "noche", name: "Noche" },
                      { id: "retro", name: "Retro" }
                    ].map((filt) => (
                      <button
                        key={filt.id}
                        onClick={() => setActiveFilter(filt.id)}
                        className={`text-[9px] px-2.5 py-1 rounded-full whitespace-nowrap border font-medium cursor-pointer transition-all ${activeFilter === filt.id
                            ? "bg-teal-500 border-teal-400 text-white shadow-md shadow-teal-500/20"
                            : "border-slate-800 text-slate-300 bg-slate-900/50 hover:bg-slate-900"
                          }`}
                      >
                        {filt.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-center items-center gap-6">
          <button
            onClick={onToggleMute}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${call.isMuted ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-white/10 hover:bg-white/15 text-white"
              }`}
            title={call.isMuted ? "Activar micrófono" : "Silenciar micrófono"}
          >
            {call.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            onClick={onEndCall}
            className="w-14 h-14 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-500/30 active:scale-95 transition-all cursor-pointer"
            title="Finalizar llamada"
          >
            <PhoneOff className="w-6 h-6" />
          </button>

          <button
            onClick={onToggleVideo}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${call.isVideoOff ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-white/10 hover:bg-white/15 text-white"
              }`}
            title={call.isVideoOff ? "Activar cámara" : "Desactivar cámara"}
          >
            {call.isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>

          {call.type === "video" && (call.status === "connected" || call.status === "connecting") && (
            <>
              <button
                onClick={onAddMember}
                className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-all cursor-pointer"
                title="Agregar miembro a la llamada"
              >
                <Users className="w-5 h-5" />
              </button>
              <button
                onClick={onSwitchCamera}
                className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-all cursor-pointer"
                title="Cambiar cámara"
              >
                <RotateCw className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

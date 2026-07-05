import React, { useState, useEffect } from "react";
import { 
  PhoneOff, Phone, Mic, MicOff, Video, VideoOff, 
  Sparkles, Smile, Image, ShieldAlert, Users, Layers, MonitorPlay 
} from "lucide-react";
import { ActiveCall } from "../types";

interface CallOverlayProps {
  call: ActiveCall;
  onAccept: () => void;
  onDecline: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}

interface FloatingEmoji {
  id: number;
  emoji: string;
  left: number;
}

export default function CallOverlay({
  call,
  onAccept,
  onDecline,
  onToggleMute,
  onToggleVideo,
  onEndCall
}: CallOverlayProps) {
  const [activeFilter, setActiveFilter] = useState<string>("none");
  const [activeBg, setActiveBg] = useState<string>("none");
  const [showEffects, setShowEffects] = useState(false);
  const [flyingEmojis, setFlyingEmojis] = useState<FloatingEmoji[]>([]);
  const [emojiCounter, setEmojiCounter] = useState(0);

  // Filter styles generator
  const getFilterClass = () => {
    switch (activeFilter) {
      case "noir": return "grayscale contrast-125";
      case "warm": return "sepia saturate-150 hue-rotate-[10deg]";
      case "cool": return "saturate-125 hue-rotate-[200deg] brightness-95";
      case "vintage": return "sepia contrast-85 brightness-110";
      case "neon": return "brightness-110 contrast-125 saturate-200 hue-rotate-[320deg]";
      default: return "";
    }
  };

  // Background style generator
  const getBackgroundUrl = () => {
    switch (activeBg) {
      case "office": return "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=400&q=80";
      case "beach": return "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80";
      case "cyber": return "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=400&q=80";
      case "abstract": return "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=400&q=80";
      default: return "";
    }
  };

  const triggerReaction = (emoji: string) => {
    const id = emojiCounter;
    setEmojiCounter((prev) => prev + 1);
    setFlyingEmojis((prev) => [...prev, { id, emoji, left: Math.random() * 80 + 10 }]);
  };

  // Clean up floating emojis after animation ends
  useEffect(() => {
    if (flyingEmojis.length > 0) {
      const timer = setTimeout(() => {
        setFlyingEmojis((prev) => prev.slice(1));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [flyingEmojis]);

  if (call.status === "incoming") {
    // 1. FULL SCREEN INCOMING CALL INTERFACE
    return (
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a4d52] via-[#041a1c] to-[#010809] text-white z-50 flex flex-col justify-between p-8 select-none">
        {/* Soft background glow */}
        <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-64 h-64 rounded-full bg-teal-500/10 blur-3xl pointer-events-none"></div>

        {/* Header Call Information */}
        <div className="text-center mt-12 space-y-3 relative z-10">
          <span className="text-[10px] bg-teal-400/20 text-teal-300 border border-teal-500/30 px-3 py-1 rounded-full font-bold uppercase tracking-wider animate-pulse inline-flex items-center gap-1">
            {call.isGroup ? <Users className="w-3 h-3" /> : null}
            {call.type === "video" ? "Videollamada Entrante" : "Llamada de Voz Entrante"}
          </span>
          <div className="relative inline-block mt-4">
            <div className="absolute inset-0 rounded-full bg-teal-500/20 animate-ping"></div>
            <img 
              src={call.contactAvatar} 
              alt={call.contactName} 
              className="w-24 h-24 rounded-full object-cover border-4 border-teal-400 relative z-10 shadow-2xl" 
            />
          </div>
          <h2 className="text-2xl font-black tracking-tight">{call.contactName}</h2>
          <p className="text-xs text-slate-300 font-medium">Red On Cifrado Extremo</p>
        </div>

        {/* Group Calling Extra Detail */}
        {call.isGroup && (
          <div className="bg-white/5 border border-white/10 px-4 py-2.5 rounded-2xl mx-auto text-center max-w-[200px] z-10">
            <p className="text-[10px] text-teal-300 font-semibold mb-0.5">Grupo Activo</p>
            <p className="text-[9px] text-slate-400">Integrantes: Nelson, Sofía, Andrés, me</p>
          </div>
        )}

        {/* Action Controls */}
        <div className="mb-12 flex justify-around items-center px-4 relative z-10">
          {/* Decline Button */}
          <button 
            onClick={onDecline}
            className="w-14 h-14 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-xl shadow-rose-500/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            <PhoneOff className="w-6 h-6" />
          </button>

          {/* Accept Button */}
          <button 
            onClick={onAccept}
            className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-xl shadow-emerald-500/30 hover:scale-110 active:scale-90 transition-all cursor-pointer relative"
          >
            <span className="absolute inset-[-4px] rounded-full border-2 border-emerald-400/50 animate-ping"></span>
            {call.type === "video" ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
          </button>
        </div>
      </div>
    );
  }

  // 2. ACTIVE CALL VIEW (CONNECTED OR OUTGOING)
  return (
    <div className="absolute inset-0 bg-slate-950 text-white z-50 flex flex-col justify-between overflow-hidden select-none">
      
      {/* Animated Floating Emojis */}
      {flyingEmojis.map((item) => (
        <span 
          key={item.id}
          className="absolute text-3xl pointer-events-none animate-float-emoji z-40 drop-shadow-md"
          style={{ 
            left: `${item.left}%`,
            bottom: "80px",
          }}
        >
          {item.emoji}
        </span>
      ))}

      {/* CALL SCREEN BODY */}
      {call.type === "video" && !call.isVideoOff ? (
        // VIDEO CALL INTERFACE
        <div className="absolute inset-0 w-full h-full z-0 bg-slate-900">
          
          {/* Virtual background or standard webcam representation */}
          {activeBg !== "none" ? (
            <img 
              src={getBackgroundUrl()} 
              alt="Virtual Background" 
              className={`absolute inset-0 w-full h-full object-cover opacity-80 ${getFilterClass()}`}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-tr from-teal-900/30 via-[#10646a]/20 to-slate-950"></div>
          )}

          {/* Simulated Peer/Friend Webcam stream */}
          <div className="absolute inset-0 flex items-center justify-center">
            <img 
              src={call.contactAvatar} 
              alt={call.contactName} 
              className={`w-full h-full object-cover transition-all ${getFilterClass()}`}
            />
            {/* Visual Label overlay */}
            <div className="absolute bottom-28 left-4 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-xl border border-white/10 text-[10px] font-bold">
              📷 Cámara de {call.contactName}
            </div>
          </div>

          {/* User Preview Window (Small PiP) */}
          <div className="absolute top-10 right-4 w-24 h-36 rounded-2xl overflow-hidden border-2 border-teal-400 shadow-2xl bg-slate-950 z-20">
            <div className="absolute inset-0 bg-teal-800/10"></div>
            <img 
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80" 
              alt="Self preview" 
              className={`w-full h-full object-cover ${getFilterClass()}`}
            />
            <div className="absolute bottom-1.5 left-1.5 bg-black/55 px-1.5 py-0.5 rounded text-[8px] font-semibold text-teal-300">
              Tú (Mi cámara)
            </div>
          </div>
        </div>
      ) : (
        // AUDIO CALL OR VIDEO CALL WITH VIDEO PAUSED
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a4d52] via-slate-950 to-slate-950 z-0 flex flex-col items-center justify-center p-6">
          <div className="relative">
            {/* Pulsing circular visualizer waves */}
            <span className="absolute inset-[-15px] rounded-full border border-teal-500/20 animate-pulse"></span>
            <span className="absolute inset-[-30px] rounded-full border border-teal-500/10 animate-ping"></span>
            <img 
              src={call.contactAvatar} 
              alt={call.contactName} 
              className="w-28 h-28 rounded-full object-cover border-4 border-[#14b8a6] relative z-10 shadow-2xl" 
            />
          </div>
          <div className="text-center mt-6 space-y-1 relative z-10">
            <h3 className="text-lg font-bold">{call.contactName}</h3>
            <p className="text-xs text-slate-400">
              {call.status === "outgoing" ? "Llamando..." : "Llamada de voz cifrada"}
            </p>
          </div>
        </div>
      )}

      {/* TOP CALL BAR (Status & Time) */}
      <div className="relative z-10 p-4 pt-10 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-mono tracking-wider">
            {call.status === "outgoing" ? "CONECTANDO..." : "00:24"}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full text-[9px] font-bold border border-white/10 text-teal-200">
          <ShieldAlert className="w-3.5 h-3.5 text-teal-300" /> Cifrado Completo
        </div>
      </div>

      {/* BOTTOM CONTROLS & EFFECTS DRAWER */}
      <div className="relative z-10 p-4 bg-gradient-to-t from-black/90 via-black/75 to-transparent pb-8 space-y-4">
        
        {/* Live flying reactions floating buttons */}
        <div className="flex justify-center gap-3">
          {["👍", "❤️", "🔥", "😮", "😂", "🎉"].map((emoji) => (
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

        {/* Video effects drawer toggle */}
        {call.type === "video" && !call.isVideoOff && (
          <div className="space-y-3">
            <button 
              onClick={() => setShowEffects(!showEffects)}
              className="mx-auto w-fit flex items-center gap-1 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 hover:text-white px-3 py-1.5 rounded-full border border-teal-500/30 text-[10px] font-bold transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> 
              {showEffects ? "Ocultar Filtros y Fondos" : "Ajustar Filtros y Fondos"}
            </button>

            {showEffects && (
              <div className="bg-black/80 rounded-2xl p-3 border border-slate-800 space-y-3.5 animate-fade-in">
                {/* FILTERS LIST */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-400 block uppercase">Filtros de Video</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {[
                      { id: "none", name: "Normal" },
                      { id: "noir", name: "Blanco/Negro" },
                      { id: "warm", name: "Cálido" },
                      { id: "cool", name: "Frío" },
                      { id: "vintage", name: "Vintage" },
                      { id: "neon", name: "Neón" }
                    ].map((filt) => (
                      <button
                        key={filt.id}
                        onClick={() => setActiveFilter(filt.id)}
                        className={`text-[9px] px-2.5 py-1 rounded-full whitespace-nowrap border font-medium cursor-pointer transition-all ${
                          activeFilter === filt.id 
                            ? "bg-teal-500 border-teal-400 text-white shadow-md shadow-teal-500/20" 
                            : "border-slate-800 text-slate-300 bg-slate-900/50 hover:bg-slate-900"
                        }`}
                      >
                        {filt.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* VIRTUAL BACKGROUNDS */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-400 block uppercase">Fondo Virtual</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {[
                      { id: "none", name: "Sin fondo" },
                      { id: "office", name: "Oficina" },
                      { id: "beach", name: "Playa" },
                      { id: "cyber", name: "Ciberespacio" },
                      { id: "abstract", name: "Abstracto" }
                    ].map((bg) => (
                      <button
                        key={bg.id}
                        onClick={() => setActiveBg(bg.id)}
                        className={`text-[9px] px-2.5 py-1 rounded-full whitespace-nowrap border font-medium cursor-pointer transition-all ${
                          activeBg === bg.id 
                            ? "bg-teal-500 border-teal-400 text-white" 
                            : "border-slate-800 text-slate-300 bg-slate-900/50 hover:bg-slate-900"
                        }`}
                      >
                        {bg.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Controls */}
        <div className="flex justify-center items-center gap-6">
          {/* Audio toggle button */}
          <button 
            onClick={onToggleMute}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              call.isMuted ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-white/10 hover:bg-white/15 text-white"
            }`}
            title={call.isMuted ? "Activar micrófono" : "Silenciar micrófono"}
          >
            {call.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* End Call Button */}
          <button 
            onClick={onEndCall}
            className="w-14 h-14 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-500/30 active:scale-95 transition-all cursor-pointer"
            title="Finalizar llamada"
          >
            <PhoneOff className="w-6 h-6" />
          </button>

          {/* Video toggle button */}
          <button 
            onClick={onToggleVideo}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              call.isVideoOff ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-white/10 hover:bg-white/15 text-white"
            }`}
            title={call.isVideoOff ? "Activar cámara" : "Desactivar cámara"}
          >
            {call.isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { ArrowLeft, Phone, Video, Search, MoreVertical, Palette, Clock } from "lucide-react";
import CachedImage from "../CachedImage";
import { Chat } from "../../types";

interface ChatHeaderProps {
  chat: Chat;
  onBack: () => void;
  partnerTyping: boolean;
  onTriggerCall: (type: "audio" | "video") => void;
  callInProgress?: boolean;
  showSearch: boolean;
  onToggleSearch: () => void;
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
  onClearChat: () => void;
  onOpenCustomizer: () => void;
  onOpenGroupInfo: () => void;
  onOpenDeleteConfirm: () => void;
  onOpenProfile?: () => void;
  onBlockUser?: () => void;
  ephemeralTimer?: number | null;
  onSetEphemeralTimer?: (timer: number) => void;
}

const EPHEMERAL_OPTIONS = [
  { value: 0, label: "Desactivado" },
  { value: 86400, label: "24 horas" },
  { value: 604800, label: "7 días" },
  { value: 7776000, label: "90 días" },
];

export default function ChatHeader({
  chat, onBack, partnerTyping, onTriggerCall, callInProgress,
  showSearch, onToggleSearch, showDropdown, setShowDropdown,
  onClearChat, onOpenCustomizer, onOpenGroupInfo, onOpenDeleteConfirm,
  onOpenProfile, ephemeralTimer, onSetEphemeralTimer, onBlockUser,
}: ChatHeaderProps) {
  const isGroup = chat.isGroup ?? false;
  const [showEphemeral, setShowEphemeral] = useState(false);
  const activeTimer = ephemeralTimer ?? 0;
  return (
    <div className="relative text-white px-4 pt-5 pb-9 shrink-0 z-40 bg-[#0a4d52]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <svg
        viewBox="0 0 320 120"
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chatHeaderGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="50%" stopColor="#197a82" />
            <stop offset="100%" stopColor="#3ab3b8" />
          </linearGradient>
          <linearGradient id="chatHeaderGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0a4c51" />
            <stop offset="50%" stopColor="#10646a" />
            <stop offset="100%" stopColor="#188c94" />
          </linearGradient>
          <linearGradient id="chatHeaderGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#073337" />
            <stop offset="50%" stopColor="#0a4d52" />
            <stop offset="100%" stopColor="#116b72" />
          </linearGradient>
        </defs>
        <path d="M0,0 L0,110 C80,150 200,70 320,120 L320,0 Z" fill="url(#chatHeaderGrad1)" opacity="0.3" />
        <path d="M0,0 L0,100 C100,140 220,80 320,108 L320,0 Z" fill="url(#chatHeaderGrad2)" opacity="0.55" />
        <path d="M0,0 L0,88 C80,122 180,60 320,92 L320,0 Z" fill="url(#chatHeaderGrad3)" />
      </svg>
      </div>

      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-teal-100" />
          </button>
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => { if (!isGroup && onOpenProfile) onOpenProfile(); }}
          >
            <div className="relative">
              {chat.avatar ? (
                <CachedImage src={chat.avatar} alt={chat.name} className="w-9 h-9 rounded-full object-cover border border-white/20" />
              ) : isGroup ? (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center border border-white/20">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center border border-white/20">
                  <span className="text-white font-bold text-xs">
                    {chat.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                  </span>
                </div>
              )}
              {!isGroup && chat.status === "online" && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#0a4d52]"></span>
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold leading-tight truncate max-w-[120px]">{chat.name}</h3>
              <span className="text-[10px] text-teal-200 block">
                {partnerTyping ? "Escribiendo..." : isGroup ? "Grupo" : chat.status === "online" ? "En línea" : "Desconectado"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onTriggerCall("audio")}
            disabled={callInProgress}
            className={`p-2 rounded-full transition-all duration-150 active:scale-90 active:bg-green-700 cursor-pointer ${
              callInProgress
                ? "text-teal-600 bg-white/5"
                : "text-teal-100 hover:bg-white/10 hover:text-white"
            }`}
            title={callInProgress ? "Iniciando llamada..." : "Llamada de voz"}
          >
            <Phone className="w-5 h-5" />
          </button>
          <button
            onClick={() => onTriggerCall("video")}
            disabled={callInProgress}
            className={`p-2 rounded-full transition-all duration-150 active:scale-90 active:bg-green-700 cursor-pointer ${
              callInProgress
                ? "text-teal-600 bg-white/5"
                : "text-teal-100 hover:bg-white/10 hover:text-white"
            }`}
            title={callInProgress ? "Iniciando llamada..." : "Video llamada"}
          >
            <Video className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleSearch}
            className={`p-1.5 rounded-full transition-all cursor-pointer ${
              showSearch ? "bg-white/20 text-white" : "text-teal-100 hover:bg-white/10 hover:text-white"
            }`}
            title="Buscar mensajes"
          >
            <Search className="w-4 h-4" />
          </button>
          <div className="relative">
            <button 
              onClick={() => setShowDropdown(!showDropdown)}
              className={`p-1.5 rounded-full transition-all cursor-pointer ${
                showDropdown ? "bg-white/20 text-white" : "text-teal-100 hover:bg-white/10 hover:text-white"
              }`}
              title="Más opciones"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            
            {showDropdown && (
              <>
                <div className="fixed inset-0 z-[100]" onClick={() => setShowDropdown(false)} />
                <div className="fixed right-4 top-[72px] bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-[110] min-w-[190px] animate-fade-in">
                  {onSetEphemeralTimer && (
                    <div className="px-2 py-1.5 border-b border-slate-100">
                      <button
                        onClick={() => setShowEphemeral(v => !v)}
                        className="w-full flex items-center gap-2 px-1 py-1.5 rounded-lg text-[11px] font-semibold text-teal-700 hover:bg-teal-50 transition-colors cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5 text-teal-600" />
                        <span className="flex-1 text-left">Mensajes temporales</span>
                        <span className="text-[9px] text-slate-400 font-medium">
                          {EPHEMERAL_OPTIONS.find(o => o.value === activeTimer)?.label || "Desactivado"}
                        </span>
                      </button>
                      {showEphemeral && (
                        <div className="space-y-0.5 pt-1">
                          {EPHEMERAL_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => { onSetEphemeralTimer(opt.value); setShowEphemeral(false); }}
                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors cursor-pointer ${
                                activeTimer === opt.value
                                  ? "bg-teal-50 text-teal-700 font-bold"
                                  : "text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {opt.label}
                              {activeTimer === opt.value && (
                                <span className="text-teal-600 text-[9px]">✓</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={onClearChat}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <rect x="4" y="6" width="16" height="14" rx="1" />
                    </svg>
                    Borrar mensajes
                  </button>
                  <button
                    onClick={onOpenCustomizer}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <Palette className="w-3.5 h-3.5 text-teal-600" />
                    Personalizar chat
                  </button>
                  {isGroup && (
                    <button
                      onClick={onOpenGroupInfo}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-purple-600 hover:bg-purple-50 transition-colors cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      Info del grupo
                    </button>
                  )}
                  {!isGroup && onBlockUser && (
                    <button
                      onClick={onBlockUser}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      Bloquear usuario
                    </button>
                  )}
                  <div className="border-t border-slate-100 my-1"></div>
                  <button
                    onClick={onOpenDeleteConfirm}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Eliminar chat
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

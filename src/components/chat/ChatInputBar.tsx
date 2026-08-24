import React from "react";
import { Smile, Paperclip, Mic, VideoIcon, Send, X, Check, Loader2 } from "lucide-react";
import { Message } from "../../types";
import CachedImage from "../CachedImage";

interface ChatInputBarProps {
  inputText: string;
  setInputText: (text: string) => void;
  showAttachments: boolean;
  setShowAttachments: (v: boolean) => void;
  replyTo: Message | null;
  setReplyTo: (v: Message | null) => void;
  recordingType: "voice" | "video" | null;
  setRecordingType: (v: "voice" | "video" | null) => void;
  recordingSeconds: number;
  isCameraReady: boolean;
  setIsCameraReady: (v: boolean) => void;
  showGifPicker: boolean;
  setShowGifPicker: (v: boolean) => void;
  onSendText: () => void;
  onFinishVoiceNote: () => void;
  triggerFilePick: (accept: string, type: Message["type"]) => void;
  emitTyping: (isTyping: boolean) => void;
  chatName: string;
  videoPreviewRef: React.RefObject<HTMLVideoElement | null>;
  typingTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export default function ChatInputBar({
  inputText, setInputText, showAttachments, setShowAttachments,
  replyTo, setReplyTo, recordingType, setRecordingType,
  recordingSeconds, isCameraReady, setIsCameraReady,
  showGifPicker, setShowGifPicker,
  onSendText, onFinishVoiceNote, triggerFilePick,
  emitTyping, chatName, videoPreviewRef, typingTimerRef,
}: ChatInputBarProps) {
  return (
    <>
      {/* REPLY PREVIEW BAR */}
      {replyTo && (
        <div className="px-3 pb-1 bg-transparent relative z-10 shrink-0">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl px-3 py-2 border border-slate-200 shadow-sm flex items-center gap-2">
            <div className="w-0.5 h-8 bg-teal-500 rounded-full shrink-0"></div>
            {(replyTo.type === "image" || replyTo.type === "sticker" || replyTo.type === "video") && replyTo.mediaUrl && (
              <CachedImage src={replyTo.mediaUrl} className="w-8 h-8 rounded-lg object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-teal-700 truncate">
                {replyTo.sender === "me" ? "Tú" : chatName}
              </p>
              <p className="text-[9px] text-slate-500 truncate">
                {replyTo.text || (replyTo.type === "image" ? "Imagen" : replyTo.type === "video" ? "Video" : "Multimedia")}
              </p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="p-1 hover:bg-slate-100 rounded-full transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      )}

      {/* FLOATING CHAT INPUT AREA */}
      <div className="px-3 pb-4 pt-2 bg-transparent relative z-10 shrink-0 flex items-center gap-1.5 overflow-hidden">
        {recordingType ? (
          <div className="flex-1 bg-teal-900/95 backdrop-blur-md rounded-2xl border border-teal-800/80 shadow-[0_8px_30px_rgba(0,0,0,0.25)] text-white animate-fade-in overflow-hidden">
            {recordingType === "video" && (
              <div className="w-[200px] h-[200px] mx-auto my-3 bg-black rounded-full flex items-center justify-center relative overflow-hidden">
                {!isCameraReady && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 rounded-full">
                    <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
                  </div>
                )}
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full"
                  style={{ transform: "scaleX(-1)", objectFit: "cover" }}
                  onLoadedMetadata={() => setIsCameraReady(true)}
                  onPlaying={() => setIsCameraReady(true)}
                />
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping"></span>
                <span className="text-xs font-bold tracking-wide">
                  {recordingType === "voice" ? "Grabando voz" : "Grabando video"} • <span className="text-teal-300 font-mono">{recordingSeconds}s</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setRecordingType(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  onClick={onFinishVoiceNote}
                  className="px-4 py-1.5 text-xs font-bold text-teal-950 bg-teal-300 hover:bg-teal-200 rounded-full flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" /> Enviar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 bg-white rounded-full pl-3 pr-1.5 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-100/50 flex items-center gap-1 transition-all duration-300 overflow-hidden">
              <button 
                onClick={() => { setShowGifPicker(true); }}
                className="p-1.5 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer shrink-0"
                title="GIFs y Stickers"
              >
                <Smile className="w-6 h-6" />
              </button>

              <input 
                type="text" 
                placeholder="Escribe un mensaje..."
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  emitTyping(true);
                  if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                  typingTimerRef.current = setTimeout(() => {
                    emitTyping(false);
                  }, 1500);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSendText();
                }}
                className="flex-1 min-w-0 bg-transparent text-xs py-1.5 outline-none border-none text-slate-800 placeholder-slate-400 font-medium"
              />

              <button 
                onClick={() => setShowAttachments(!showAttachments)}
                className={`p-1.5 rounded-full transition-all cursor-pointer shrink-0 ${
                  showAttachments 
                    ? "bg-[#0a4d52] text-white rotate-45 shadow-inner scale-105" 
                    : "text-slate-400 hover:text-[#0a4d52]"
                }`}
                title="Adjuntar multimedia o encuestas"
              >
                <Paperclip className="w-6 h-6" />
              </button>

              {!inputText.trim() && (
                <button 
                  onClick={() => setRecordingType("video")}
                  className="p-1.5 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer shrink-0"
                  title="Grabar Nota de video circular"
                >
                  <VideoIcon className="w-6 h-6" />
                </button>
              )}
            </div>

            {inputText.trim() ? (
              <button 
                onClick={() => onSendText()}
                className="w-12 h-12 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.2)] active:scale-95 transition-all cursor-pointer shrink-0"
                title="Enviar mensaje"
              >
                <Send className="w-5 h-5 ml-0.5 text-white" />
              </button>
            ) : (
              <button 
                onClick={() => setRecordingType("voice")}
                className="w-12 h-12 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.2)] active:scale-95 transition-all cursor-pointer shrink-0"
                title="Grabar Nota de voz"
              >
                <Mic className="w-5 h-5 text-white" />
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

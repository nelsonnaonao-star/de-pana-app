import React from "react";
import { Mic, Play, Pause, VideoIcon, BarChart2 } from "lucide-react";
import { Message } from "../../types";
import { BUBBLE_PRESETS_ME, BUBBLE_PRESETS_THEM } from "./chatConstants";

interface MessageBubbleProps {
  msg: Message;
  isMe: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
  isPlayingAudio: string | null;
  setIsPlayingAudio: (id: string | null) => void;
  handleVote: (messageId: string, optionId: string) => void;
  handleAddReaction: (messageId: string, emoji: string) => void;
  handleDeleteMessage: (messageId: string) => void;
  bubbleColorMeId: string;
  bubbleColorThemId: string;
}

export default React.memo(function MessageBubble({
  msg, isMe, activeReactionMenu, setActiveReactionMenu,
  isPlayingAudio, setIsPlayingAudio,
  handleVote, handleAddReaction, handleDeleteMessage,
  bubbleColorMeId, bubbleColorThemId,
}: MessageBubbleProps) {
  const activeMeBubble = BUBBLE_PRESETS_ME.find(b => b.id === bubbleColorMeId) || BUBBLE_PRESETS_ME[0];
  const activeThemBubble = BUBBLE_PRESETS_THEM.find(b => b.id === bubbleColorThemId) || BUBBLE_PRESETS_THEM[0];

  const isMediaType = msg.type === "sticker" || msg.type === "image";
  if (isMediaType) {
    const isSticker = msg.type === "sticker";
    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} relative group`}>
        <div className="relative max-w-[85%] cursor-pointer" onClick={() => setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id)}>
          <img
            src={msg.mediaUrl}
            alt={isSticker ? "Sticker" : "Image"}
            className={isSticker
              ? "max-w-[160px] max-h-[160px] object-contain filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)] select-none"
              : "max-w-[280px] max-h-[300px] object-contain rounded-xl select-none"
            }
          />
          <div className="absolute bottom-1 right-1 bg-black/50 text-white/90 text-[10px] px-1.5 py-0.5 rounded-full backdrop-blur-xs font-medium pointer-events-none flex items-center gap-1">
            <span>{msg.timestamp}</span>
            {isMe && (
              <span className={`leading-none ${msg.status === "read" ? "text-teal-400" : "text-slate-400"}`}>
                {msg.status === "sent" && "✓"}
                {msg.status === "delivered" && "✓✓"}
                {msg.status === "read" && "✓✓"}
                {!msg.status && "✓"}
              </span>
            )}
          </div>
        </div>
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className={`flex gap-1 mt-[-6px] z-10 ${isMe ? "mr-2" : "ml-2"}`}>
            {Object.entries(msg.reactions).map(([emo, count]) => (
              <span key={emo} className="bg-white px-1.5 py-0.5 rounded-full text-[9px] border border-slate-100 shadow-sm flex items-center gap-0.5 font-bold text-slate-600">
                {emo} <span className="text-[8px] text-slate-400">{count}</span>
              </span>
            ))}
          </div>
        )}
        {activeReactionMenu === msg.id && (
          <div className={`absolute z-30 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-200/80 shadow-xl flex gap-2 items-center -top-8 ${isMe ? "right-2" : "left-2"}`}>
            {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
              <button key={emo} onClick={() => handleAddReaction(msg.id, emo)} className="text-sm hover:scale-125 transition-transform">{emo}</button>
            ))}
            <div className="w-[1px] h-3 bg-slate-200"></div>
            <button onClick={() => setActiveReactionMenu(null)} className="text-[9px] font-bold text-teal-600 hover:underline px-1">Reenviar</button>
            {isMe && <button onClick={() => handleDeleteMessage(msg.id)} className="text-[9px] font-bold text-rose-500 hover:underline px-1">Eliminar</button>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} relative group`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2.5 shadow-sm text-xs relative cursor-pointer select-none transition-all duration-200 ${
          isMe ? activeMeBubble.css : activeThemBubble.css
        }`}
        onClick={() => setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id)}
      >
        {msg.type === "text" && <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>}

        {msg.type === "video" && (
          <div className="space-y-1.5 w-44">
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center border border-white/10">
              <video src={msg.mediaUrl} controls className="w-full h-full object-cover" />
            </div>
            <span className="text-[9px] font-mono opacity-85 block truncate">🎬 {msg.fileName} ({msg.fileSize})</span>
          </div>
        )}

        {msg.type === "audio" && (
          <div className="flex items-center gap-2.5 p-1 bg-black/5 dark:bg-white/5 rounded-xl min-w-[180px]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsPlayingAudio(isPlayingAudio === msg.id ? null : msg.id);
              }}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white shrink-0 hover:bg-white/30"
            >
              {isPlayingAudio === msg.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold truncate text-slate-100">{msg.fileName}</p>
              <span className="text-[9px] opacity-70 block font-mono">{msg.fileSize} • {msg.duration}</span>
            </div>
          </div>
        )}

        {msg.type === "voice_note" && (
          <div
            className="flex items-center gap-2 w-44 cursor-pointer active:scale-95 transition-transform"
            onClick={() => {
              if (msg.mediaUrl) {
                const audio = new Audio(msg.mediaUrl);
                audio.play();
              }
            }}
          >
            <Mic className="w-4 h-4 shrink-0" />
            <div className="flex-1 flex items-center gap-1.5">
              <div className="flex-1 h-3 flex items-center gap-0.5">
                <span className="h-2 w-1 bg-white/40 rounded-full animate-pulse"></span>
                <span className="h-3 w-1 bg-white/60 rounded-full"></span>
                <span className="h-1.5 w-1 bg-white/40 rounded-full"></span>
                <span className="h-2.5 w-1 bg-white/60 rounded-full"></span>
                <span className="h-3 w-1 bg-white/65 rounded-full"></span>
              </div>
              <span className="text-[9px] font-mono whitespace-nowrap">{msg.duration || "0:12"}</span>
            </div>
          </div>
        )}

        {msg.type === "video_note" && (
          <div
            className="space-y-1.5 flex flex-col items-center cursor-pointer active:scale-95 transition-transform"
            onClick={() => {
              if (msg.mediaUrl) {
                const video = document.createElement("video");
                video.src = msg.mediaUrl;
                video.controls = true;
                video.className = "fixed inset-0 z-50 w-full h-full object-contain bg-black";
                video.onclick = () => video.remove();
                document.body.appendChild(video);
                video.play();
              }
            }}
          >
            <div className="w-24 h-24 rounded-full border-4 border-[#14b8a6] overflow-hidden bg-teal-950 flex items-center justify-center relative shadow-inner">
              <div className="absolute inset-0 bg-gradient-to-tr from-teal-500/20 to-transparent"></div>
              <VideoIcon className="w-8 h-8 text-white/85 animate-pulse" />
            </div>
            <span className="text-[9px] font-bold tracking-tight opacity-90">📹 Nota de Video ({msg.duration || "0:08"})</span>
          </div>
        )}

        {msg.type === "poll" && (
          <div className="space-y-3 min-w-[200px] text-slate-800 p-1 bg-white rounded-xl">
            <div className="flex items-start gap-1.5 border-b border-slate-100 pb-1.5">
              <BarChart2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <h4 className="text-[11px] font-bold text-slate-900 leading-snug">{msg.pollQuestion}</h4>
            </div>
            <div className="space-y-1.5">
              {msg.pollOptions?.map((opt) => {
                const hasVoted = opt.votedUsers.includes("me");
                return (
                  <button
                    key={opt.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVote(msg.id, opt.id);
                    }}
                    className={`w-full text-left p-2 rounded-lg border text-[10px] transition-all relative overflow-hidden flex items-center justify-between ${
                      hasVoted
                        ? "border-[#14b8a6] bg-teal-50/50"
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-50"
                    }`}
                  >
                    <span className="relative z-10 font-semibold">{opt.text}</span>
                    <span className="relative z-10 font-mono font-bold bg-[#10646a]/10 text-[#10646a] px-1.5 py-0.5 rounded-full">
                      {opt.votes} v
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="text-[9px] text-slate-400 block text-right">Encuesta interactiva</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-1 mt-1 text-[8px] opacity-70">
          <span>{msg.timestamp}</span>
          {isMe && (
            <span className={`text-[10px] leading-none ${
              msg.status === "read" ? "text-teal-400" : msg.status === "delivered" ? "text-slate-400" : "text-slate-400"
            }`}>
              {msg.status === "sent" && "✓"}
              {msg.status === "delivered" && "✓✓"}
              {msg.status === "read" && "✓✓"}
              {!msg.status && "✓"}
            </span>
          )}
        </div>
      </div>

      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
        <div className={`flex gap-1 mt-[-6px] z-10 ${isMe ? "mr-2" : "ml-2"}`}>
          {Object.entries(msg.reactions).map(([emo, count]) => (
            <span
              key={emo}
              className="bg-white px-1.5 py-0.5 rounded-full text-[9px] border border-slate-100 shadow-sm flex items-center gap-0.5 font-bold text-slate-600"
            >
              {emo} <span className="text-[8px] text-slate-400">{count}</span>
            </span>
          ))}
        </div>
      )}

      {activeReactionMenu === msg.id && (
        <div className={`absolute z-30 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-200/80 shadow-xl flex gap-2 items-center -top-8 ${
          isMe ? "right-2" : "left-2"
        }`}>
          {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
            <button
              key={emo}
              onClick={() => handleAddReaction(msg.id, emo)}
              className="text-sm hover:scale-125 transition-transform"
            >
              {emo}
            </button>
          ))}
          <div className="w-[1px] h-3 bg-slate-200"></div>
          <button
            onClick={() => {
              setActiveReactionMenu(null);
            }}
            className="text-[9px] font-bold text-teal-600 hover:underline px-1"
          >
            Reenviar
          </button>
          {isMe && (
            <button
              onClick={() => handleDeleteMessage(msg.id)}
              className="text-[9px] font-bold text-rose-500 hover:underline px-1"
            >
              Eliminar
            </button>
          )}
        </div>
      )}
    </div>
  );
});

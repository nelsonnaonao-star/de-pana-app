import { X, Send, Eye, ChevronLeft, Download, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import CachedImage from "../CachedImage";
import { GRADIENTS, UserState } from "../../hooks/useStatesManagement";
import { saveMediaToGalleryDirect } from "../../services/mediaUtils";

interface StoryViewerProps {
  activeUserStates: UserState;
  activeStoryIdx: number;
  storyProgress: number;
  reactionFeedback: string | null;
  myCurrentReaction: string | null;
  replyFeedback?: string | null;
  viewersData: { viewers: Array<{ viewer_id: string; name: string; avatar: string; viewed_at: string; reactions: string[] }>; total: number } | null;
  showViewersSheet: boolean;
  storyReplyText: string;
  isPaused: boolean;
  onSetPaused: (paused: boolean) => void;
  onClose: () => void;
  onTap: (direction: "prev" | "next") => void;
  onSendReply: (e: FormEvent) => void;
  onToggleReaction: (storyId: string, emoji: string) => void;
  onSetStoryReplyText: (v: string) => void;
  onShowViewersSheet: (v: boolean) => void;
  onDeleteStory: (storyId: string, e: React.MouseEvent) => void;
}

export default function StoryViewer({
  activeUserStates, activeStoryIdx, storyProgress,
  reactionFeedback, myCurrentReaction, replyFeedback, viewersData, storyReplyText,
  isPaused, onSetPaused,
  onClose, onTap, onSendReply, onToggleReaction,
  onSetStoryReplyText, onShowViewersSheet,
  onDeleteStory,
}: StoryViewerProps) {
  const currentStory = activeUserStates.stories[activeStoryIdx];
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef(false);
  const longPressReleaseRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoMuted, setVideoMuted] = useState(true);

  // Descargar el estado actual (imagen o video) a la galería del dispositivo
  const downloadCurrentStory = async () => {
    const mediaUrl = currentStory?.content;
    if (!mediaUrl) return;
    const isVideo = currentStory.type === "video";
    const ext = isVideo ? "mp4" : "jpg";
    const fileName = `red_on_estado_${Date.now()}.${ext}`;
    try {
      await saveMediaToGalleryDirect(mediaUrl, fileName);
      toast.success("Descargado con éxito ✅");
    } catch (error) {
      console.error("Error al descargar el estado:", error);
      toast.error("Error al descargar el estado ❌");
    }
  };

  useEffect(() => {
    setVideoReady(false);
  }, [activeStoryIdx]);

  const handlePointerDown = () => {
    longPressRef.current = false;
    longPressReleaseRef.current = false;
    onSetPaused(true);
    if (pressTimerRef.current !== null) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      longPressRef.current = true;
    }, 300);
  };

  const handlePointerUp = () => {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    onSetPaused(false);
    if (longPressRef.current) {
      longPressReleaseRef.current = true;
      longPressRef.current = false;
      onTap("next");
    }
  };

  const handlePointerCancel = () => {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    onSetPaused(false);
    longPressRef.current = false;
  };

  const handleTapZone = (direction: "prev" | "next") => {
    if (longPressReleaseRef.current) {
      longPressReleaseRef.current = false;
      return;
    }
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    onTap(direction);
  };

  if (!currentStory) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center" onClick={onClose}>
        <p className="text-slate-400 text-xs">Historia no disponible</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col text-white animate-fade-in">
      <div className="px-3.5 pt-3.5 flex gap-1 shrink-0 z-20">
        {activeUserStates.stories.map((story, idx) => (
          <div key={story.id} className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-400 rounded-full transition-all duration-100 ease-linear"
              style={{
                width: idx < activeStoryIdx ? "100%" : idx === activeStoryIdx ? `${storyProgress}%` : "0%"
              }}
            />
          </div>
        ))}
      </div>

      <div className="px-3.5 pt-2 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-2">
          <CachedImage
            src={activeUserStates.userAvatar}
            alt={activeUserStates.userName}
            className="w-8 h-8 rounded-[8px_8px_8px_0px/8px_8px_8px_10px] object-cover border border-white/25"
          />
          <div>
            <h4 className="text-[10px] font-black leading-none">{activeUserStates.userName}</h4>
            <span className="text-[7.5px] text-slate-300 font-mono mt-0.5 block">
              {currentStory.time}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeUserStates.isMe && (
            <button
              onClick={(e) => { onDeleteStory(currentStory.id, e); onClose(); }}
              className="p-1.5 rounded-full bg-white/10 hover:bg-red-500/40 text-white transition-all cursor-pointer"
              title="Eliminar estado"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {currentStory?.type !== "text" && (
            <button
              onClick={downloadCurrentStory}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition-all cursor-pointer"
              title="Descargar estado"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 relative flex items-center justify-center w-full min-h-0 overflow-hidden select-none"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
      >
        <div
          onClick={() => handleTapZone("prev")}
          className="absolute left-0 inset-y-0 w-1/4 z-20 cursor-pointer active:bg-white/5 transition-colors"
        />
        <div
          onClick={() => handleTapZone("next")}
          className="absolute right-0 inset-y-0 w-1/4 z-20 cursor-pointer active:bg-white/5 transition-colors"
        />

        {currentStory.type === "text" ? (
          <div className={`absolute inset-0 bg-gradient-to-br ${
            currentStory.background || GRADIENTS[activeStoryIdx % GRADIENTS.length]
          } flex items-center justify-center p-8 text-center`}>
            <p className="text-sm font-black tracking-wide leading-relaxed drop-shadow max-w-[240px]">
              {currentStory.content}
            </p>
          </div>
        ) : currentStory.type === "video" ? (
          <>
            <video
              src={currentStory.content}
              ref={videoRef}
              muted={videoMuted}
              autoPlay loop playsInline
              onLoadedData={() => setVideoReady(true)}
              onCanPlay={() => setVideoReady(true)}
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-150 ${
                videoReady ? "opacity-100" : "opacity-0"
              }`}
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setVideoMuted(!videoMuted); }}
              className="absolute bottom-4 right-4 z-30 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white cursor-pointer"
              title={videoMuted ? "Activar sonido" : "Silenciar"}
            >
              {videoMuted ? "🔇" : "🔊"}
            </button>
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45 pointer-events-none z-10" />
            {currentStory.caption && (
              <div className="absolute bottom-16 inset-x-4 bg-black/50 backdrop-blur-md rounded-2xl p-3 border border-white/10 text-center text-[10px] font-semibold leading-relaxed z-30">
                {currentStory.caption}
              </div>
            )}
          </>
        ) : (
          <>
            <CachedImage
              src={currentStory.content}
              alt="Story Content"
              className="absolute inset-0 w-full h-full object-contain"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45 pointer-events-none z-10" />
            {currentStory.caption && (
              <div className="absolute bottom-16 inset-x-4 bg-black/50 backdrop-blur-md rounded-2xl p-3 border border-white/10 text-center text-[10px] font-semibold leading-relaxed z-30">
                {currentStory.caption}
              </div>
            )}
          </>
        )}
      </div>

      {reactionFeedback && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-fade-in">
          <div className="bg-black/60 backdrop-blur-md rounded-3xl px-6 py-3 flex items-center gap-3 border border-white/15 shadow-2xl">
            <span className="text-3xl">{reactionFeedback}</span>
            <span className="text-white text-sm font-bold tracking-tight">Reaccionaste</span>
          </div>
        </div>
      )}

      {replyFeedback && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-fade-in">
          <div className="bg-teal-500/90 backdrop-blur-md rounded-3xl px-6 py-3 border border-white/20 shadow-2xl">
            <span className="text-white text-sm font-bold tracking-tight">✅ Has respondido a esta historia</span>
          </div>
        </div>
      )}

      {!activeUserStates.isMe ? (
        <div className="p-3 bg-black/85 border-t border-white/10 z-20 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-center gap-2.5">
            {["❤️", "😂", "😮", "🔥", "👍"].map(emoji => (
              <button
                key={emoji}
                onClick={() => onToggleReaction(currentStory.id, emoji)}
                className={`text-2xl w-11 h-11 flex items-center justify-center rounded-full transition-all cursor-pointer ${
                  myCurrentReaction === emoji ? "bg-teal-500/30 scale-110 ring-1 ring-teal-400" : "hover:bg-white/10"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <form onSubmit={onSendReply} className="flex gap-2 items-center">
            <input
              type="text" required
              placeholder="Responder al estado de manera privada..."
              value={storyReplyText}
              onFocus={() => onSetPaused(true)}
              onBlur={() => onSetPaused(false)}
              onChange={(e) => {
                onSetPaused(true);
                onSetStoryReplyText(e.target.value);
              }}
              className="flex-1 bg-white/10 text-white placeholder-slate-400 text-[10px] px-3.5 py-2.5 rounded-xl border border-white/10 outline-none focus:border-teal-400"
            />
            <button
              type="submit"
              className="w-9 h-9 bg-teal-400 hover:bg-teal-500 text-white rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div
          onClick={() => onShowViewersSheet(true)}
          className="p-3.5 bg-black/85 border-t border-white/10 z-20 flex items-center justify-center gap-1.5 font-mono text-[9px] text-slate-300 cursor-pointer hover:bg-black/70 transition-colors"
        >
          <Eye className="w-3.5 h-3.5 text-teal-400" />
          <span>{viewersData?.total ?? 0} visualización{(viewersData?.total ?? 0) !== 1 ? "es" : ""}</span>
          {(viewersData?.total ?? 0) > 0 && (
            <ChevronLeft className="w-3 h-3 text-slate-500 rotate-180" />
          )}
        </div>
      )}
    </div>
  );
}

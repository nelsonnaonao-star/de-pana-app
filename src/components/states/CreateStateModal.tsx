import { X, Award, Check, Video, Send, Play, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { generateVideoThumbnailFromElement } from "../../utils/videoThumbnail";

interface CreateStateModalProps {
  uploadedMedia: { url: string; type: "image" | "video"; name: string };
  showPublishDecisionModal: boolean;
  publishStep: "choice" | "comment";
  publishComment: string;
  isEditingProState: boolean;
  isPublishing: boolean;
  publishStatus: "idle" | "publishing" | "success" | "error";
  onPublishOriginal: () => void;
  onPublishNow: () => void;
  onGoToProEditor: () => void;
  onBackToChoice: () => void;
  onSetPublishComment: (v: string) => void;
}

// Preview de video con el patrón del resto de la app: miniatura del primer
// frame como preview (sin el rectángulo gris), botón Play/Pause de control y
// botón de sonido. El video queda oculto hasta que el usuario reproduce.
function SoundVideo({
  src,
  loop,
  playsInline,
  className,
}: {
  src: string;
  loop?: boolean;
  playsInline?: boolean;
  className?: string;
}) {
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.defaultMuted = false;
    v.volume = 1;
  }, [src]);

  useEffect(() => {
    if (src.startsWith("data:")) return;
    let cancelled = false;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.src = src;
    const onSeeked = async () => {
      try {
        const dataUrl = await generateVideoThumbnailFromElement(video);
        if (!cancelled) setPoster(dataUrl);
      } catch {
        /* sin poster: se muestra fondo oscuro + botón Play */
      }
    };
    const onLoaded = () => {
      try {
        video.currentTime = Math.min(0.05, (video.duration || 0) > 0 ? 0.05 : 0);
      } catch {
        /* noop */
      }
    };
    video.onloadeddata = onLoaded;
    video.onseeked = onSeeked;
    video.onerror = () => {};
    return () => {
      cancelled = true;
      video.src = "";
    };
  }, [src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
    } else {
      v.play().catch(() => {});
    }
  };

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        src={src}
        muted={muted}
        loop={loop}
        playsInline={playsInline}
        preload="auto"
        onPlay={() => { setIsPlaying(true); setHasPlayed(true); }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onCanPlay={() => setVideoReady(true)}
        onLoadedData={() => setVideoReady(true)}
        onPlaying={() => setVideoReady(true)}
        className={`${className} transition-opacity duration-150 ${videoReady && (isPlaying || hasPlayed) ? "opacity-100" : "opacity-0"}`}
      />
      {poster && (!videoReady || (!isPlaying && !hasPlayed)) && (
        <img src={poster} alt="Vista previa" className={`${className} absolute inset-0`} />
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-14 h-14 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white cursor-pointer"
        title={isPlaying ? "Pausar" : "Reproducir"}
      >
        {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 text-white ml-0.5 fill-white" />}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMuted(!muted); }}
        className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white cursor-pointer"
        title={muted ? "Activar sonido" : "Silenciar"}
      >
        {muted ? <Video className="w-3.5 h-3.5" /> : <span className="text-sm">🔊</span>}
      </button>
    </div>
  );
}

export default function CreateStateModal({
  uploadedMedia, showPublishDecisionModal, publishStep, publishComment,
  isEditingProState, isPublishing, publishStatus, onPublishOriginal, onPublishNow, onGoToProEditor,
  onBackToChoice, onSetPublishComment,
}: CreateStateModalProps) {
  if (!showPublishDecisionModal) return null;

  return (
    <>
      {publishStep === "choice" && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black animate-fade-in">
          {/* Full screen preview */}
          <div className="absolute inset-0">
            {uploadedMedia.type === "video" ? (
              <SoundVideo src={uploadedMedia.url} loop playsInline className="w-full h-full object-cover" />
            ) : (
              <img src={uploadedMedia.url} alt="Preview" className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20"></div>
          </div>

          {/* Content overlay */}
          <div className="relative z-10 flex flex-col h-full p-5 justify-end pb-8">
            <div className="space-y-2.5">
              <button
                onClick={onGoToProEditor}
                className="w-full py-3 px-4 bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white font-black text-[10px] rounded-2xl shadow-lg hover:shadow-teal-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Award className="w-4 h-4 text-amber-300 fill-amber-300" />
                Editar con Editor PRO (Recomendado)
              </button>
              <button
                onClick={onPublishOriginal}
                className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 text-white font-bold text-[10px] rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4 text-teal-400" />
                Publicar Original
              </button>
            </div>

          </div>
        </div>
      )}

      {publishStep === "comment" && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
          <button
            onClick={onBackToChoice}
            className="absolute top-4 left-4 z-10 text-white/80 hover:text-white p-2 cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex-1 flex items-center justify-center min-h-0">
            {uploadedMedia.type === "video" ? (
              <SoundVideo src={uploadedMedia.url} loop playsInline className="w-full h-full object-contain" />
            ) : (
              <img src={uploadedMedia.url} alt="Preview" className="w-full h-full object-contain" />
            )}
          </div>

          <div className="w-full p-4 bg-black/50 backdrop-blur-md flex items-center gap-3">
            <input
              type="text"
              placeholder="Añade un comentario..."
              value={publishComment}
              onChange={(e) => onSetPublishComment(e.target.value)}
              className="flex-1 bg-gray-800 text-white text-sm rounded-full px-5 py-3 outline-none placeholder-gray-400 border border-white/10 focus:border-teal-400 transition-colors"
            />
            <button
              onClick={onPublishNow}
              disabled={isPublishing || publishStatus === "publishing"}
              className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all shadow-lg ${
                isPublishing || publishStatus === "publishing"
                  ? "bg-teal-700 opacity-60"
                  : "bg-teal-500 hover:bg-teal-400 cursor-pointer"
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {(isPublishing || publishStatus === "publishing") && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="w-10 h-10 border-[3px] border-teal-400 border-t-transparent rounded-full animate-spin" />
              <p className="mt-3 text-white text-xs font-bold tracking-wide">Publicando estado…</p>
            </div>
          )}
          {publishStatus === "success" && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/75">
              <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center shadow-lg">
                <Check className="w-5 h-5 text-white" />
              </div>
              <p className="mt-3 text-white text-xs font-black tracking-wide">¡Estado publicado!</p>
            </div>
          )}
          {publishStatus === "error" && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70">
              <p className="text-white text-xs font-bold">No se pudo publicar. Intenta de nuevo.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
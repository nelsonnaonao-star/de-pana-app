import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, ImageIcon, Video, Music, Volume2, VolumeX,
  Check, Play, Pause, X, Award, ArrowLeft, Loader2, Scissors,
  Compass, Sliders, Type, Upload, Download
} from "lucide-react";
import { BusinessFlyer } from "./BusinessPanel";
import { STATIC_PRESET_IMAGES, PRESET_FILTERS_EXPANDED, ANIMATION_PRESETS, STICKER_TEMPLATES_PRO } from "./editor/editorConstants";
import EditorTabPanels from "./editor/EditorTabPanels";
import FilterRail from "./editor/FilterRail";
import AdjustmentsRail from "./editor/AdjustmentsRail";
import TextRail from "./editor/TextRail";
import { renderEditedMedia, EditedMediaBadgeOverlay } from "./editor/renderEditedMedia";
import { supabase } from "../lib/supabase";
import { apiUrl, authUpload } from "../lib/api";
import { saveMediaToGalleryDirect } from "../services/mediaUtils";
import { uploadChatMedia } from "../services/storage";
import { Capacitor } from "@capacitor/core";
import { getMusicLibrary, MusicTrack } from "../services/stickerService";

interface MediaEditorProps {
  onPublishFlyer: (flyer: BusinessFlyer) => void;
  onGoToFeed: () => void;
  isStateMode?: boolean;
  onPublishState?: (mediaUrl: string, mediaType: "image" | "video", caption: string) => void;
  initialMediaUrl?: string;
  initialMediaType?: "image" | "video";
}

// Convierte un data URL raster a Blob sin depender de red (compatible con WebView).
// Sólo se usa para data:image/...;base64,... — nunca para el SVG placeholder.
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) throw new Error("data URL inválida");
  const header = dataUrl.slice(0, commaIdx);
  const idx = header.indexOf(";");
  const mime = (idx === -1 ? header.slice(5) : header.slice(5, idx)) || "application/octet-stream";
  const binary = atob(dataUrl.slice(commaIdx + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Colores equivalentes a las clases Tailwind de STICKER_TEMPLATES_PRO.
// Se usan para rasterizar el sticker con fidelidad en el canvas.
const STICKER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  oferta: { bg: "#dc2626", text: "#ffffff", border: "#ffffff" },
  nuevo: { bg: "#14b8a6", text: "#ffffff", border: "#ffffff" },
  top: { bg: "#fbbf24", text: "#020617", border: "#020617" },
  delivery: { bg: "#4f46e5", text: "#ffffff", border: "#ffffff" },
  vip: { bg: "#9333ea", text: "#ffffff", border: "#ffffff" },
  last: { bg: "#f97316", text: "#ffffff", border: "#ffffff" },
  quality: { bg: "#2563eb", text: "#ffffff", border: "#ffffff" },
  promo: { bg: "#ec4899", text: "#ffffff", border: "#ffffff" },
};

const VIDEO_EXT_RE = /\.(mp4|m4v|mov|qt|webm|3gp|mkv|avi)$/i;

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || VIDEO_EXT_RE.test(file.name || "");
}

const PLAYBACK_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

// Android a veces entrega el video con MIME vacío o genérico. Para la subida
// normalizamos el tipo a uno admitido por el servidor (MP4/MOV/WebM); FFmpeg
// detecta el formato real por el contenido.
function normalizeVideoForUpload(file: File): File {
  const allowed = ["video/mp4", "video/quicktime", "video/webm"];
  const type = (file.type || "").trim().toLowerCase();
  if (allowed.includes(type)) return file;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime =
    ext === "mov" || ext === "qt" ? "video/quicktime" :
    ext === "webm" ? "video/webm" :
    "video/mp4";
  return new File([file], file.name || `video.${ext || "mp4"}`, { type: mime });
}

// El MIME que se usa para REPRODUCIR no debe mentir: si Android entrega
// `application/octet-stream` o vacío, el <video> se queda en negro. Aquí
// deducimos el contenedor real por la extensión, conservando el MIME original
// cuando ya es un `video/*` válido.
function videoFileForPlayback(file: File): File {
  const type = (file.type || "").trim().toLowerCase();
  if (type.startsWith("video/") && type !== "video/unknown") return file;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = PLAYBACK_MIME_BY_EXT[ext] || "video/mp4";
  return new File([file], file.name || `video.${ext || "mp4"}`, { type: mime });
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
  timeoutMs = 2500,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener(eventName, onOk);
      video.removeEventListener("error", onError);
      clearTimeout(timer);
    };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve();
      else reject(new Error(`video ${eventName} failed`));
    };
    const onOk = () => finish(true);
    const onError = () => finish(false);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    video.addEventListener(eventName, onOk, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

// Genera una tira de miniaturas (data URLs) repartidas a lo largo del video.
// Usa un <video> oculto para no interrumpir la reproducción del editor.
async function generateVideoThumbnails(src: string, count = 8): Promise<string[]> {
  const video = document.createElement("video");
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  try {
    if (video.readyState < 1) {
      await waitForVideoEvent(video, "loadedmetadata", 4000);
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) return [];

    const width = 96;
    const height = 54;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];

    const thumbnails: string[] = [];
    for (let i = 0; i < count; i++) {
      const time = count === 1 ? 0 : (duration * i) / (count - 1);
      try {
        video.currentTime = Math.min(Math.max(0, time), Math.max(0, duration - 0.05));
        await waitForVideoEvent(video, "seeked", 2000);
      } catch {
        // Si un frame falla, se omite y se conserva el resto.
      }
      if (video.readyState < 2) continue;
      const vw = video.videoWidth || width;
      const vh = video.videoHeight || height;
      const scale = Math.max(width / vw, height / vh);
      const drawW = vw * scale;
      const drawH = vh * scale;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
      try {
        thumbnails.push(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        return thumbnails;
      }
    }
    return thumbnails;
  } catch {
    return [];
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export default function MediaEditor({ 
  onPublishFlyer, 
  onGoToFeed,
  isStateMode = false,
  onPublishState,
  initialMediaUrl,
  initialMediaType
}: MediaEditorProps) {
  // Mode selection
  const [editorMode, setEditorMode] = useState<"image" | "video">(initialMediaType || "image");
  const [editorTab, setEditorTab] = useState<"presets" | "sliders" | "text" | "stickers" | "premium">("presets");
  const [activeTool, setActiveTool] = useState<string | null>(null);

  // Custom image source state (Soporta carga de imágenes del celular del usuario)
  const [uploadedImage, setUploadedImage] = useState<string | null>(initialMediaUrl || null);
  const [activePresetIdx, setActivePresetIdx] = useState(0);

  // 1. FINE-GRAINED CONFIGURABLE SLIDERS (COLOR, DESENFOQUE, CONTRASTE, BRILLO, NITIDEZ, SATURACION)
  const [adjustments, setAdjustments] = useState({
    brightness: 100, // 50% to 200%
    contrast: 100,   // 50% to 200%
    saturation: 100, // 0% to 200%
    blur: 0,         // 0px to 10px
    hue: 0,          // 0deg to 360deg
    sharpness: 0     // 0% to 100% (Maps to contrast sharpening)
  });

  // Selected preset filter
  const [selectedFilterId, setSelectedFilterId] = useState("normal");

  // Custom Texts & Typography state
  const [bannerTitle, setBannerTitle] = useState("");
  const [bannerProduct, setBannerProduct] = useState("");
  const [bannerPrice, setBannerPrice] = useState("");
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [textAnimation, setTextAnimation] = useState("none");
  const [textSizePercent, setTextSizePercent] = useState<number>(100);
  const [textPos, setTextPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 }); // free draggable position (px)
  const dragRef = useRef({ startX: 0, startY: 0, startPos: { x: 0, y: 0 }, dragging: false });

  // Pro Stickers state
  const [selectedStickerIdx, setSelectedStickerIdx] = useState<number>(-1);

  // Watermark removal Monthly Subscription VIP Codes
  const [isPremiumUnlocked, setIsPremiumUnlocked] = useState(() => {
    return localStorage.getItem("redon_premium_unlocked") === "true";
  });
  const [activationCodeInput, setActivationCodeInput] = useState("");
  const [codeFeedback, setCodeFeedback] = useState<{ status: "idle" | "success" | "error"; message: string }>({
    status: "idle",
    message: ""
  });
  const [isValidating, setIsValidating] = useState(false);

  // Video playback simulation (Fluid for low-end devices)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [selectedMusicId, setSelectedMusicId] = useState("none");
  const [transitionStyle, setTransitionStyle] = useState<"fade" | "zoom" | "slide">("fade");
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimThumbs, setTrimThumbs] = useState<string[]>([]);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [activeTrimHandle, setActiveTrimHandle] = useState<"start" | "end" | null>(null);
  const trimThumbsSourceRef = useRef<string | null>(null);
  const [tapFeedback, setTapFeedback] = useState<"play" | "pause" | null>(null);
  const tapFeedbackTimerRef = useRef<number | null>(null);
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null);
  const [isPreviewMuted, setIsPreviewMuted] = useState(true);
  const [musicLibrary, setMusicLibrary] = useState<MusicTrack[]>([]);

  // Ref holders
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trimBarRef = useRef<HTMLDivElement | null>(null);
  const selectedVideoFileRef = useRef<File | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSrcRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) {
        URL.revokeObjectURL(videoObjectUrlRef.current);
        videoObjectUrlRef.current = null;
      }
      if (tapFeedbackTimerRef.current) {
        window.clearTimeout(tapFeedbackTimerRef.current);
        tapFeedbackTimerRef.current = null;
      }
    };
  }, []);

  // Sound and simulation loop for videos
  const activeMusic = musicLibrary.find(m => m.id === selectedMusicId);

  useEffect(() => {
    getMusicLibrary().then(setMusicLibrary).catch(() => setMusicLibrary([]));
  }, []);

  // La música de fondo sigue el estado real del <video> (play/pausa). El
  // progreso del video ya NO se simula: llega de `onTimeUpdate`.
  useEffect(() => {
    if (isVideoPlaying) {
      if (activeMusic?.file_url) {
        if (!audioRef.current || audioSrcRef.current !== activeMusic.file_url) {
          audioRef.current?.pause();
          audioRef.current = new Audio(activeMusic.file_url);
          audioRef.current.loop = true;
          audioSrcRef.current = activeMusic.file_url;
        }
        audioRef.current.play().catch(e => console.log("Audio play error", e));
      }
    } else {
      audioRef.current?.pause();
    }

    return () => {
      audioRef.current?.pause();
    };
  }, [isVideoPlaying, selectedMusicId, activeMusic?.file_url]);

  // Sync editorTab when activeTool changes
  useEffect(() => {
    if (activeTool === "presets" || activeTool === "sliders" || activeTool === "text" || activeTool === "stickers" || activeTool === "premium") {
      setEditorTab(activeTool);
    }
  }, [activeTool]);

  // Clean-up on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Handle custom image/video upload from device
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Cuando el usuario está en modo Video, cualquier archivo elegido se trata
    // como video aunque Android no informe el MIME o el nombre no traiga
    // extensión (caso frecuente en la galería).
    const treatAsVideo =
      isVideoFile(file) || (editorMode === "video" && !file.type.startsWith("image/"));

    if (treatAsVideo) {
      // Guardamos el archivo ya normalizado para subirlo/recortarlo al publicar.
      selectedVideoFileRef.current = normalizeVideoForUpload(file);
      setEditorMode("video");
      setVideoPreviewError(null);
      // Para la vista previa usamos el MIME REAL del contenedor. Reetiquetar
      // un MOV/3GP/MKV como `video/mp4` deja el <video> en negro en Android.
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      const objectUrl = URL.createObjectURL(videoFileForPlayback(file));
      videoObjectUrlRef.current = objectUrl;
      setUploadedImage(objectUrl);
      // Permite volver a elegir el mismo archivo más adelante.
      e.target.value = "";
      return;
    }

    selectedVideoFileRef.current = null;
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    if (file.type.startsWith("image/")) setEditorMode("image");
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setUploadedImage(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleResetMedia = () => {
    selectedVideoFileRef.current = null;
    setVideoPreviewError(null);
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    setUploadedImage(null);
  };

  // Toggle playback
  const formatClock = (value: number) => {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const effectiveTrimEnd = () => (trimEnd > 0 ? trimEnd : videoDuration);

  const handleTogglePlay = () => {
    const video = videoRef.current;
    if (!video) {
      setIsVideoPlaying(prev => !prev);
      return;
    }
    if (video.paused) {
      const end = effectiveTrimEnd();
      if (end > 0 && video.currentTime >= end - 0.05) {
        video.currentTime = trimStart;
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const flashTapFeedback = (kind: "play" | "pause") => {
    setTapFeedback(kind);
    if (tapFeedbackTimerRef.current) window.clearTimeout(tapFeedbackTimerRef.current);
    tapFeedbackTimerRef.current = window.setTimeout(() => setTapFeedback(null), 650);
  };

  const handleVideoTap = () => {
    const video = videoRef.current;
    if (!video) return;
    // El primer toque activa el audio original (WebView exige gesto del
    // usuario para reproducir con sonido). Después alterna play/pausa.
    if (video.muted) {
      video.muted = false;
      setIsPreviewMuted(false);
      flashTapFeedback("play");
      video.play().catch(() => {});
      return;
    }
    flashTapFeedback(video.paused ? "play" : "pause");
    handleTogglePlay();
  };

  const togglePreviewMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsPreviewMuted(nextMuted);
    if (!nextMuted) {
      video.play().catch(() => {});
      flashTapFeedback("play");
    }
  };

  const handleVideoLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    setVideoDuration(duration);
    setTrimStart(0);
    setTrimEnd(duration);
    video.currentTime = 0;
    setCurrentTime(0);
  };

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    setCurrentTime(time);

    const end = effectiveTrimEnd();
    if (end > 0 && time >= end) {
      video.currentTime = trimStart;
      setCurrentTime(trimStart);
      if (audioRef.current) audioRef.current.currentTime = 0;
    }
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart;
    setCurrentTime(trimStart);
    if (audioRef.current) audioRef.current.currentTime = 0;
    video.play().catch(() => {});
  };

  const applyTrimStart = (value: number) => {
    const max = videoDuration > 0 ? videoDuration : value;
    const end = trimEnd > 0 ? trimEnd : max;
    const next = Math.min(Math.max(0, value), Math.max(0, end - 0.1));
    setTrimStart(next);
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (Math.abs(video.currentTime - next) > 0.05) video.currentTime = next;
    }
    setCurrentTime(next);
  };

  const applyTrimEnd = (value: number) => {
    const max = videoDuration > 0 ? videoDuration : value;
    const next = Math.max(Math.min(value, max), trimStart + 0.1);
    setTrimEnd(next);
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (Math.abs(video.currentTime - next) > 0.05) video.currentTime = next;
    }
    setCurrentTime(next);
  };

  // Arrastre tipo WhatsApp: se toca una manija y se desliza sobre la barra.
  const startTrimDrag = (handle: "start" | "end", e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const bar = trimBarRef.current;
    if (!bar || videoDuration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const timeFromClientX = (clientX: number) => {
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * videoDuration;
    };

    setActiveTrimHandle(handle);

    const video = videoRef.current;
    if (video) {
      video.pause();
      const initial = handle === "start" ? trimStart : effectiveTrimEnd();
      video.currentTime = initial;
      setCurrentTime(initial);
    }

    const onMove = (ev: PointerEvent) => {
      const time = timeFromClientX(ev.clientX);
      if (handle === "start") applyTrimStart(time);
      else applyTrimEnd(time);
    };
    const onUp = () => {
      setActiveTrimHandle(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleResetTrim = () => {
    setTrimStart(0);
    setTrimEnd(videoDuration);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      setCurrentTime(0);
    }
  };

  // Reset Adjustments sliders back to normal
  const handleResetAdjustments = () => {
    setAdjustments({
      brightness: 100,
      contrast: 100,
      saturation: 100,
      blur: 0,
      hue: 0,
      sharpness: 0
    });
    setSelectedFilterId("normal");
  };

  // Premium Code Validation via Supabase RPC
  const handleValidatePremiumCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = activationCodeInput.trim().toUpperCase();
    if (!cleanCode) return;

    setIsValidating(true);
    setCodeFeedback({ status: "idle", message: "" });

    try {
      const { data, error } = await supabase.rpc('validate_promo_code', { p_code: cleanCode });

      if (error) {
        console.error("[MediaEditor] RPC error:", error);
        setCodeFeedback({
          status: "error",
          message: "Error al validar el código. Intenta de nuevo más tarde."
        });
        return;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (result?.is_valid) {
        setIsPremiumUnlocked(true);
        localStorage.setItem("redon_premium_unlocked", "true");
        setCodeFeedback({
          status: "success",
          message: "¡Código de Suscripción Activado! Marca de agua eliminada de por vida 👑🚀"
        });
        setActivationCodeInput("");
      } else {
        setCodeFeedback({
          status: "error",
          message: "Código incorrecto o vencido. Contacta al soporte de Red On para adquirir tu membresía mensual."
        });
      }
    } catch (err) {
      console.error("[MediaEditor] Network error validating code:", err);
      setCodeFeedback({
        status: "error",
        message: "Sin conexión. Verifica tu internet e intenta de nuevo."
      });
    } finally {
      setIsValidating(false);
    }
  };

  // Compile CSS filter string combined dynamically
  const buildCombinedFilterCss = () => {
    let filterString = "";

    // Base preset mapped to native CSS filter() syntax
    if (selectedFilterId === "caribe") filterString += "saturate(1.5) contrast(1.1) brightness(1.05) ";
    else if (selectedFilterId === "retro") filterString += "sepia(0.4) saturate(1.15) contrast(0.9) hue-rotate(15deg) ";
    else if (selectedFilterId === "cine") filterString += "contrast(1.3) brightness(0.95) saturate(1.2) ";
    else if (selectedFilterId === "polar") filterString += "hue-rotate(180deg) saturate(1.2) contrast(1.05) ";
    else if (selectedFilterId === "bw") filterString += "grayscale(1) contrast(1.3) ";
    else if (selectedFilterId === "sunset") filterString += "sepia(0.3) saturate(1.35) hue-rotate(340deg) brightness(1.05) ";
    else if (selectedFilterId === "cyber") filterString += "hue-rotate(290deg) saturate(2) brightness(1.1) contrast(1.25) ";
    else if (selectedFilterId === "dream") filterString += "brightness(1.1) contrast(0.95) saturate(1.25) blur(0.5px) ";
    else if (selectedFilterId === "drama") filterString += "contrast(1.6) brightness(0.9) saturate(0.75) ";
    else if (selectedFilterId === "forest") filterString += "hue-rotate(90deg) saturate(1.1) brightness(0.95) ";

    // Sliders overlay values (multiplied or added to preset style safely)
    filterString += `brightness(${adjustments.brightness}%) `;
    filterString += `contrast(${adjustments.contrast}%) `;
    filterString += `saturate(${adjustments.saturation}%) `;
    if (adjustments.blur > 0) filterString += `blur(${adjustments.blur}px) `;
    if (adjustments.hue > 0) filterString += `hue-rotate(${adjustments.hue}deg) `;
    if (adjustments.sharpness > 0) {
      // simulate sharpening via additional overlay contrast boosts
      filterString += `contrast(${100 + (adjustments.sharpness * 0.4)}%) saturate(${100 + (adjustments.sharpness * 0.15)}%) `;
    }

    return filterString;
  };

  // Simulated transition styling during video loop
  const getVideoTransitionCss = () => {
    if (editorMode !== "video" || !isVideoPlaying) return {};
    const cycle = currentTime % 4; // changes cycle animation every 4s

    if (transitionStyle === "zoom") {
      if (cycle < 0.6) return { transform: `scale(${1 + (cycle * 0.3)})`, transition: "transform 150ms ease-out" };
      if (cycle > 3.4) return { transform: `scale(${1.18 - ((cycle - 3.4) * 0.3)})`, transition: "transform 150ms ease-out" };
      return { transform: "scale(1.18)" };
    }

    if (transitionStyle === "slide") {
      if (cycle < 0.6) return { transform: `translateX(${(0.6 - cycle) * 70}px)`, transition: "transform 150ms ease-out" };
      if (cycle > 3.4) return { transform: `translateX(${-((cycle - 3.4) * 70)}px)`, transition: "transform 150ms ease-out" };
      return { transform: "translateX(0)" };
    }

    // Default Soft Fade
    if (cycle < 0.6) return { opacity: cycle * 1.6, transition: "opacity 150ms ease-out" };
    if (cycle > 3.4) return { opacity: 1 - ((cycle - 3.4) * 1.6), transition: "opacity 150ms ease-out" };
    return { opacity: 1 };
  };

  // Dynamic animation classes for title overlay
  const getSelectedAnimClass = () => {
    const found = ANIMATION_PRESETS.find(a => a.id === textAnimation);
    return found ? found.class : "";
  };

  // Compile base images
  const defaultImageSource = STATIC_PRESET_IMAGES[activePresetIdx].url;
  const currentImageSource = uploadedImage || defaultImageSource;
  // Determina si la fuente actual es un video (archivo local o URL remota).
  // Se usa para renderizar <video>, mostrar la barra de reproducción y el
  // recorte. En modo video con una imagen cargada NO se considera video.
  const isVideoMedia =
    currentImageSource.startsWith("data:video") ||
    currentImageSource.startsWith("blob:") ||
    (!!uploadedImage &&
      editorMode === "video" &&
      !currentImageSource.startsWith("data:image"));

  // Android WebView sólo permite autoplay si el video está silenciado. El audio
  // del clip se conserva al procesar en el servidor; aquí se silencia para que
  // la vista previa siempre arranque (y no quede en negro).
  useEffect(() => {
    if (!isVideoMedia) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    setIsPreviewMuted(true);
    const tryPlay = () => {
      video.play().catch(() => {
        // Autoplay bloqueado: la reproducción arranca al tocar el video.
      });
    };
    if (video.readyState >= 2) tryPlay();
    else video.addEventListener("loadeddata", tryPlay, { once: true });
    return () => video.removeEventListener("loadeddata", tryPlay);
  }, [isVideoMedia, currentImageSource]);

  // Si se cambia a una imagen, cerrar la herramienta de recorte.
  useEffect(() => {
    if (activeTool === "trim" && !isVideoMedia) setActiveTool(null);
  }, [activeTool, isVideoMedia]);

  // Genera el filmstrip de miniaturas una vez por video, al abrir Recorte.
  useEffect(() => {
    if (activeTool !== "trim" || !isVideoMedia || videoDuration <= 0) return;
    if (!currentImageSource) return;
    if (trimThumbsSourceRef.current === currentImageSource && trimThumbs.length > 0) return;

    let cancelled = false;
    setThumbsLoading(true);
    generateVideoThumbnails(currentImageSource, 8)
      .then((urls) => {
        if (cancelled) return;
        setTrimThumbs(urls);
        if (urls.length > 0) trimThumbsSourceRef.current = currentImageSource;
      })
      .catch(() => {
        if (!cancelled) setTrimThumbs([]);
      })
      .finally(() => {
        if (!cancelled) setThumbsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTool, isVideoMedia, currentImageSource, videoDuration, trimThumbs.length]);

  // Publicación de flyer: evita doble submit / doble upload y muestra error reintentable
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Handle Export and submit flyer
  // Rasteriza la imagen final con filtros, textos y stickers. Sin marca de agua.
  // Devuelve null (y se conserva el comportamiento anterior) para video o si falla.
  const bakeEditedImage = async (): Promise<string | null> => {
    if (editorMode === "video" || currentImageSource.startsWith("data:video")) return null;
    const area = canvasAreaRef.current;
    if (!area) return null;
    const rect = area.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;

    const badges: EditedMediaBadgeOverlay[] = [];

    if (selectedStickerIdx >= 0 && STICKER_TEMPLATES_PRO[selectedStickerIdx]) {
      const sticker = STICKER_TEMPLATES_PRO[selectedStickerIdx];
      const colors = STICKER_COLORS[sticker.id] || { bg: "#14b8a6", text: "#ffffff", border: "#ffffff" };
      badges.push({
        text: sticker.text,
        fontSizePx: 7,
        fontWeight: 900,
        textColor: colors.text,
        background: colors.bg,
        borderWidthPx: 2,
        borderColor: colors.border,
        radiusPx: 4,
        padXPx: 8,
        padYPx: 4,
        rotationDeg: 12,
        anchor: "top-right",
        offsetXPx: 14,
        offsetYPx: 56,
      });
    }

    try {
      return await renderEditedMedia({
        source: currentImageSource,
        filterCss: buildCombinedFilterCss(),
        containerWidth: rect.width,
        containerHeight: rect.height,
        text: bannerTitle.trim()
          ? {
              text: bannerTitle,
              offsetX: textPos.x,
              offsetY: textPos.y,
              scale: textSizePercent / 100,
              fontSizePx: 14,
              maxWidthRatio: 0.92,
            }
          : null,
        badges,
        bottomGradient: true,
      });
    } catch (err) {
      console.error("[MediaEditor] No se pudo renderizar el diseño del flyer:", err);
      return null;
    }
  };

  // Sube el video al servidor para recortarlo con FFmpeg y obtener una URL
  // remota. Solo aplica cuando el usuario eligió un archivo de video local.
  const getCurrentVideoFile = async (): Promise<File | null> => {
    if (selectedVideoFileRef.current) return selectedVideoFileRef.current;
    if (!currentImageSource || currentImageSource.startsWith("data:image")) return null;
    try {
      const res = await fetch(currentImageSource);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.size) return null;
      return new File([blob], `video-${Date.now()}.mp4`, {
        type: blob.type || "video/mp4",
      });
    } catch {
      return null;
    }
  };

  const prepareVideoForPublish = async (fileOverride?: File): Promise<string | null> => {
    const file = fileOverride ?? selectedVideoFileRef.current;
    if (!file) return null;

    const end = trimEnd > 0 ? trimEnd : videoDuration;
    const start = Math.min(Math.max(0, trimStart), Math.max(0, end - 0.1));
    if (!(end > start)) {
      throw new Error("El rango de recorte no es válido.");
    }
    if (end - start > 180) {
      throw new Error("El recorte máximo es de 3 minutos.");
    }

    const uploadFile = normalizeVideoForUpload(file);
    const form = new FormData();
    form.append("video", uploadFile, uploadFile.name || "video.mp4");
    form.append("start", String(start));
    form.append("end", String(end));

    const res = await authUpload(apiUrl("/api/media/trim-video"), form);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = data?.error || `No se pudo procesar el video (${res.status}).`;
      throw new Error(data?.detail ? `${message}: ${data.detail}` : message);
    }
    const data = await res.json().catch(() => ({}));
    if (!data?.url) throw new Error("El servidor no devolvió el video recortado.");
    return data.url as string;
  };

  const handleExportAndPublishFlyer = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    setPublishError(null);

    try {
      const baked = await bakeEditedImage();

      // En modo video, sube el archivo real (recortado si aplica) y usa su URL.
      let videoUrl: string | null = null;
      if (editorMode === "video" && selectedVideoFileRef.current) {
        videoUrl = await prepareVideoForPublish();
      }

      if (isStateMode && onPublishState) {
        onPublishState(baked || videoUrl || currentImageSource, editorMode, bannerTitle);
        return;
      }

      // El diseño rasterizado siempre es un data URL PNG base64; el video o los
      // fallos conservan el flujo anterior (subir sólo si es raster base64).
      const isBase64Raster =
        currentImageSource.startsWith("data:image/") &&
        currentImageSource.includes(";base64,");

      let flyerUrl: string;
      if (baked) {
        flyerUrl = await uploadChatMedia(dataUrlToBlob(baked), "flyers");
      } else if (isBase64Raster) {
        flyerUrl = await uploadChatMedia(dataUrlToBlob(currentImageSource), "flyers");
      } else if (videoUrl) {
        flyerUrl = videoUrl;
      } else {
        flyerUrl = currentImageSource;
      }

      const finalFlyer: BusinessFlyer = {
        id: "flyer_pro_" + Date.now(),
        businessName: bannerTitle || "Mi Marca Pro",
        description: bannerProduct || "Promoción exclusiva",
        location: "Caracas, Distrito Capital",
        flyerUrl,
        isGenerated: false,
        productName: bannerProduct,
        price: bannerPrice,
        musicUrl: activeMusic?.file_url || undefined,
        musicName: activeMusic?.title || undefined,
        views: 1,
        clicks: 0,
        ownerName: "Nelson Castro (Socio Premium)",
        ownerAvatar: "",
        ownerPhone: "+58 412 1234567"
      };

      onPublishFlyer(finalFlyer);
    } catch (err) {
      console.error("[MediaEditor] Error al publicar el flyer:", err);
      setPublishError(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo publicar tu flyer. Revisa tu conexión e intenta de nuevo.",
      );
    } finally {
      setIsPublishing(false);
    }
  };

  // Guardar el flyer como imagen en la galería del dispositivo
  const [isSavingToDevice, setIsSavingToDevice] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const handleSaveToDevice = async () => {
    try {
      setIsSavingToDevice(true);
      setSaveMessage(null);

      if (isVideoMedia) {
        const trimmed =
          trimStart > 0.05 || effectiveTrimEnd() < videoDuration - 0.05;
        let videoUrl = currentImageSource;

        if (trimmed) {
          const file = await getCurrentVideoFile();
          if (!file) throw new Error("No se pudo acceder al video para recortarlo.");
          const uploaded = await prepareVideoForPublish(file);
          if (!uploaded) throw new Error("No se pudo preparar el video recortado.");
          videoUrl = uploaded;
        }

        await saveMediaToGalleryDirect(videoUrl, `wepa-video-${Date.now()}.mp4`);
        setSaveMessage("Video guardado en tu galería (álbum RED ON) ✅");
        return;
      }

      const baked = await bakeEditedImage();
      const fileName = `redon-flyer-${Date.now()}.png`;
      await saveMediaToGalleryDirect(baked || currentImageSource, fileName);
      setSaveMessage("Guardada en tu galería (álbum RED ON) ✅");
    } catch (err) {
      console.error("[MediaEditor] Error al guardar en galería:", err);
      setSaveMessage(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo guardar en la galería. Intenta de nuevo.",
      );
    } finally {
      setIsSavingToDevice(false);
      setTimeout(() => setSaveMessage(null), 4000);
    }
  };

  const TOOLS = [
    { id: "presets", icon: ImageIcon, label: "Imagen" },
    { id: "sliders", icon: Sliders, label: "Ajustes" },
    { id: "text", icon: Type, label: "Texto" },
    ...(isVideoMedia ? [{ id: "trim", icon: Scissors, label: "Recorte" }] : []),
    { id: "premium", icon: Award, label: "VIP" },
  ];

  return (
    <div className="relative flex flex-col h-full bg-slate-900 text-white overflow-hidden select-none">
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes typing {
          from { width: 0 }
          to { width: 100% }
        }
        @keyframes zoomInOut {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes vibrate {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          20% { transform: translate(-2px, 1px) rotate(-1deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          60% { transform: translate(-1px, 2px) rotate(0deg); }
          80% { transform: translate(2px, 1px) rotate(1deg); }
        }
        @keyframes slideRight {
          0% { transform: translateX(-40px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        .animate-typing {
          overflow: hidden;
          white-space: nowrap;
          animation: typing 2.5s steps(30, end) infinite;
        }
        .animate-zoom-in-out {
          animation: zoomInOut 2s ease-in-out infinite;
        }
        .animate-vibrate {
          animation: vibrate 0.35s linear infinite;
        }
        .animate-slide-right {
          animation: slideRight 1s ease-out forwards;
        }
      `}} />

      {/* IMAGE CANVAS (ocupa toda la pantalla; las herramientas van encima) */}
      <div ref={canvasAreaRef} className="absolute inset-0 z-0 w-full h-full overflow-hidden">
        {/* Image with filters */}
        <div 
          style={{ 
            ...getVideoTransitionCss(), 
            filter: buildCombinedFilterCss() 
          }}
          className="absolute inset-0 w-full h-full transition-all duration-150"
        >
          {isVideoMedia ? (
            <video
              key={currentImageSource}
              ref={videoRef}
              src={currentImageSource}
              autoPlay
              muted={isPreviewMuted}
              playsInline
              preload="auto"
              onClick={handleVideoTap}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onLoadedData={() => {
                setVideoPreviewError(null);
                videoRef.current?.play().catch(() => {});
              }}
              onError={() =>
                setVideoPreviewError(
                  "No se pudo reproducir este video. Usa MP4 (H.264) o WebM.",
                )
              }
              onTimeUpdate={handleVideoTimeUpdate}
              onPlay={() => setIsVideoPlaying(true)}
              onPause={() => setIsVideoPlaying(false)}
              onEnded={handleVideoEnded}
              className="w-full h-full object-cover select-none"
            />
          ) : (
            <img 
              src={currentImageSource} 
              alt="Active Creative" 
              className="w-full h-full object-cover select-none"
              draggable="false"
            />
          )}
        </div>

        {/* Feedback visual al tocar el video (play/pausa) */}
        {tapFeedback && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <span className="w-16 h-16 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center shadow-2xl">
              {tapFeedback === "play" ? (
                <Play className="w-8 h-8 fill-white text-white ml-1" />
              ) : (
                <Pause className="w-8 h-8 fill-white text-white" />
              )}
            </span>
          </div>
        )}

        {videoPreviewError && (
          <div className="absolute inset-x-4 top-1/2 z-20 -translate-y-1/2 rounded-xl bg-red-600/90 px-3 py-2 text-center text-[10px] font-bold text-white shadow-lg">
            {videoPreviewError}
          </div>
        )}

        {/* Upload prompt overlay when no image is selected */}
        {!uploadedImage && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <input
              type="file"
              accept={editorMode === "video" ? "video/*" : "image/*"}
              onChange={handleImageFileChange}
              className="hidden"
              id="media-editor-upload"
            />
            <button
              type="button"
              onClick={() => document.getElementById("media-editor-upload")?.click()}
              className="w-full h-full flex flex-col items-center justify-center gap-2 text-white cursor-pointer"
            >
              <span className="w-12 h-12 rounded-full bg-teal-400/90 shadow-lg flex items-center justify-center animate-pulse">
                <Upload className="w-5 h-5 text-white" />
              </span>
              <span className="text-xs font-black uppercase tracking-widest drop-shadow-lg">
                {editorMode === "video" ? "Sube tu video" : "Sube tu imagen"}
              </span>
              <span className="text-[8px] text-slate-300 font-medium drop-shadow">Toca para abrir tu galería</span>
            </button>
          </div>
        )}

        {/* Gradient shadow at bottom for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none"></div>

        {/* Video retro overlay */}
        {editorMode === "video" && selectedFilterId === "retro" && (
          <div className="absolute inset-0 pointer-events-none bg-indigo-900/10 mix-blend-overlay">
            <div className="absolute top-14 left-2 text-[6px] font-mono text-emerald-400">PLAY ▶ 00:{currentTime.toFixed(1)}s</div>
            <div className="absolute bottom-20 right-2 text-[6px] font-mono text-red-500 font-bold">REC • VHS</div>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-1.5 animate-pulse" style={{ animationDuration: "0.8s" }}></div>
          </div>
        )}

        {/* Text overlays */}
        <div
          className="absolute left-1/2 top-1/2 z-10 space-y-1 text-left cursor-grab active:cursor-grabbing select-none"
          style={{
            transform: `translate(-50%, -50%) translate(${textPos.x}px, ${textPos.y}px) scale(${textSizePercent / 100})`,
            transformOrigin: "center",
            maxWidth: "92%",
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            dragRef.current = { startX: e.clientX, startY: e.clientY, startPos: textPos, dragging: true };
            const onMove = (ev: MouseEvent) => {
              if (!dragRef.current.dragging) return;
              setTextPos({
                x: Math.max(-200, Math.min(200, dragRef.current.startPos.x + (ev.clientX - dragRef.current.startX))),
                y: Math.max(-300, Math.min(300, dragRef.current.startPos.y + (ev.clientY - dragRef.current.startY))),
              });
            };
            const onUp = () => { dragRef.current.dragging = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            const touch = e.touches[0];
            dragRef.current = { startX: touch.clientX, startY: touch.clientY, startPos: textPos, dragging: true };
            const onMove = (ev: TouchEvent) => {
              if (!dragRef.current.dragging) return;
              setTextPos({
                x: Math.max(-200, Math.min(200, dragRef.current.startPos.x + (ev.touches[0].clientX - dragRef.current.startX))),
                y: Math.max(-300, Math.min(300, dragRef.current.startPos.y + (ev.touches[0].clientY - dragRef.current.startY))),
              });
            };
            const onUp = () => { dragRef.current.dragging = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
            window.addEventListener("touchmove", onMove, { passive: true });
            window.addEventListener("touchend", onUp);
          }}
        >
          {isStateMode ? (
            bannerTitle && (
              <span className={`inline-block text-[14px] font-black text-white tracking-tight leading-tight uppercase drop-shadow-lg text-left ${getSelectedAnimClass()}`}>
                {bannerTitle}
              </span>
            )
          ) : (
            <>
          {bannerTitle && (
            <span className={`inline-block text-[14px] font-black text-white tracking-tight leading-tight uppercase drop-shadow-lg text-left ${getSelectedAnimClass()}`}>
              {bannerTitle}
            </span>
          )}
            </>
          )}
        </div>

        {/* Sticker overlay */}
        {selectedStickerIdx >= 0 && (
          <div className={`absolute top-14 right-3.5 z-10 px-2 py-1 rounded text-[7px] font-black rotate-12 shadow-lg ${STICKER_TEMPLATES_PRO[selectedStickerIdx].bg}`}>
            {STICKER_TEMPLATES_PRO[selectedStickerIdx].text}
          </div>
        )}

        {/* Music badge */}
        {editorMode === "video" && selectedMusicId !== "none" && (
          <div className="absolute top-2.5 right-2.5 z-10 bg-teal-400 px-2 py-0.5 rounded-full text-[6px] font-bold flex items-center gap-1 text-white shadow animate-pulse">
            <Music className="w-2.5 h-2.5 text-white animate-spin" />
            <span>{activeMusic?.title.split(" ")[0]}...</span>
          </div>
        )}

        {/* Sonido del video original */}
        {isVideoMedia && !videoPreviewError && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePreviewMute();
            }}
            aria-label={isPreviewMuted ? "Activar sonido" : "Silenciar"}
            title={isPreviewMuted ? "Activar sonido" : "Silenciar"}
            className={`absolute bottom-24 right-3 z-20 w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center shadow-lg transition-colors cursor-pointer border ${
              isPreviewMuted
                ? "bg-black/60 border-white/15 text-white/80"
                : "bg-teal-500/85 border-teal-300/40 text-white"
            }`}
          >
            {isPreviewMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* TOP FLOATING BAR */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black via-black/80 to-transparent px-3 pt-[calc(6px+env(safe-area-inset-top))] pb-8">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-1.5">
            {/* Volver */}
            <button
              onClick={onGoToFeed}
              aria-label="Volver"
              title="Volver"
              className="h-8 w-8 shrink-0 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Foto / Video (centrado en el espacio libre) */}
            <div className="flex-1 min-w-0 flex justify-center">
              <div className="flex items-center bg-black/50 backdrop-blur-md p-0.5 rounded-full border border-white/15 shadow-lg">
                <button
                  onClick={() => { setEditorMode("image"); setIsVideoPlaying(false); }}
                  className={`h-7 px-2.5 rounded-full text-[9px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                    editorMode === "image" ? "bg-teal-500 text-white shadow" : "text-slate-300 hover:text-white"
                  }`}
                >
                  <ImageIcon className="w-3 h-3" /> Foto
                </button>
                <button
                  onClick={() => setEditorMode("video")}
                  className={`h-7 px-2.5 rounded-full text-[9px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                    editorMode === "video" ? "bg-teal-500 text-white shadow" : "text-slate-300 hover:text-white"
                  }`}
                >
                  <Video className="w-3 h-3" /> Video
                </button>
              </div>
            </div>

            {/* Guardar + Exportar */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleSaveToDevice}
                disabled={isSavingToDevice}
                className="h-8 px-2.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white text-[9px] font-bold flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isSavingToDevice ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
                {isSavingToDevice ? "Guardando" : "Guardar"}
              </button>
              <button
                onClick={handleExportAndPublishFlyer}
                disabled={isPublishing}
                className="h-8 px-3 rounded-full bg-teal-500 hover:bg-teal-400 text-white text-[9px] font-extrabold flex items-center gap-1 shadow-lg shadow-teal-500/25 transition-all active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isPublishing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                {isPublishing ? "Publicando" : isStateMode ? "Publicar" : "Exportar"}
              </button>
            </div>
          </div>

          {(saveMessage || publishError) && (
            <div className="mt-2 flex flex-col items-end gap-1">
              {saveMessage && (
                <span className="bg-black/85 text-white text-[9px] font-bold px-2.5 py-1 rounded-lg border border-white/10 shadow-lg">
                  {saveMessage}
                </span>
              )}
              {publishError && (
                <span className="bg-red-600/95 text-white text-[9px] font-bold px-2.5 py-1 rounded-lg border border-red-400/30 shadow-lg">
                  {publishError}
                </span>
              )}
            </div>
          )}

        </div>
      </div>

      {/* OVERLAY INFERIOR: hoja de herramientas + barra de iconos.
          Va absoluto para que el lienzo ocupe toda la pantalla por detrás.
          flex-col-reverse mantiene la barra abajo y la hoja justo encima. */}
      <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col-reverse">
      {/* BOTTOM TOOLBAR (iconos) */}
      <div className="bg-gradient-to-t from-black/95 via-black/85 to-black/60 px-2 pt-2 pb-[calc(6px+env(safe-area-inset-bottom))]">
        <div className="flex justify-around items-end">
          {TOOLS.map(tool => {
            const IconComponent = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                onClick={() => setActiveTool(isActive ? null : tool.id)}
                className={`flex flex-col items-center gap-0.5 transition-all cursor-pointer py-1 px-2 rounded-xl ${
                  isActive ? "text-teal-400 bg-teal-400/10" : "text-white/70 hover:text-white"
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  isActive ? "bg-teal-400/20" : "bg-white/10"
                }`}>
                  <IconComponent className="w-4 h-4" />
                </div>
                <span className="text-[7px] font-bold">{tool.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* IMAGEN: riel horizontal de filtros (no tapa la foto) */}
      {activeTool === "presets" && (
        <FilterRail
          filters={PRESET_FILTERS_EXPANDED}
          selectedFilterId={selectedFilterId}
          onSelectFilter={setSelectedFilterId}
          fileInputRef={fileInputRef}
          onFileChange={handleImageFileChange}
          hasUploadedImage={!!uploadedImage}
          onResetImage={handleResetMedia}
          editorMode={editorMode}
          selectedMusicId={selectedMusicId}
          setSelectedMusicId={setSelectedMusicId}
          transitionStyle={transitionStyle}
          setTransitionStyle={setTransitionStyle}
          setIsVideoPlaying={setIsVideoPlaying}
          musicLibrary={musicLibrary}
        />
      )}

      {/* AJUSTES: chips + un slider horizontal activo */}
      {activeTool === "sliders" && (
        <AdjustmentsRail
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          onReset={handleResetAdjustments}
          editorMode={editorMode}
          selectedMusicId={selectedMusicId}
          setSelectedMusicId={setSelectedMusicId}
          transitionStyle={transitionStyle}
          setTransitionStyle={setTransitionStyle}
          setIsVideoPlaying={setIsVideoPlaying}
          musicLibrary={musicLibrary}
        />
      )}

      {/* TEXTO: caja compacta + tamaño + animaciones */}
      {activeTool === "text" && (
        <TextRail
          bannerTitle={bannerTitle}
          setBannerTitle={setBannerTitle}
          textSizePercent={textSizePercent}
          setTextSizePercent={setTextSizePercent}
          textAnimation={textAnimation}
          setTextAnimation={setTextAnimation}
          editorMode={editorMode}
          selectedMusicId={selectedMusicId}
          setSelectedMusicId={setSelectedMusicId}
          transitionStyle={transitionStyle}
          setTransitionStyle={setTransitionStyle}
          setIsVideoPlaying={setIsVideoPlaying}
          musicLibrary={musicLibrary}
        />
      )}

      {/* RECORTE DE VIDEO: barra con manijas arrastrables (herramienta inferior) */}
      {activeTool === "trim" && isVideoMedia && (
        <div className="bg-[#0c1617]/95 backdrop-blur-md border-t border-teal-950/40 shadow-2xl animate-fade-in px-3 pt-2 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wider">
              Recorte de video
            </span>
            <button
              onClick={() => setActiveTool(null)}
              aria-label="Cerrar recorte"
              className="text-slate-400 hover:text-white transition-colors cursor-pointer p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div ref={trimBarRef} className="relative h-9 mt-6 select-none touch-none">
            <div className="absolute inset-0 rounded-xl overflow-hidden bg-gradient-to-r from-slate-700/70 via-slate-600/50 to-slate-700/70">
              {/* Filmstrip de miniaturas */}
              {trimThumbs.length > 0 ? (
                <div className="absolute inset-0 flex">
                  {trimThumbs.map((thumb, index) => (
                    <img
                      key={index}
                      src={thumb}
                      alt=""
                      draggable={false}
                      className="flex-1 min-w-0 h-full object-cover"
                    />
                  ))}
                </div>
              ) : thumbsLoading ? (
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-slate-700/70 via-slate-500/50 to-slate-700/70" />
              ) : null}

              {/* Zonas fuera del recorte */}
              <div
                className="absolute inset-y-0 left-0 bg-black/60"
                style={{ width: `${videoDuration > 0 ? (trimStart / videoDuration) * 100 : 0}%` }}
              />
              <div
                className="absolute inset-y-0 right-0 bg-black/60"
                style={{ width: `${videoDuration > 0 ? ((videoDuration - effectiveTrimEnd()) / videoDuration) * 100 : 0}%` }}
              />
              {/* Región seleccionada */}
              <div
                className="absolute inset-y-0 border-y-2 border-teal-400"
                style={{
                  left: `${videoDuration > 0 ? (trimStart / videoDuration) * 100 : 0}%`,
                  width: `${videoDuration > 0 ? ((Math.max(trimStart, effectiveTrimEnd()) - trimStart) / videoDuration) * 100 : 0}%`,
                }}
              />
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
                style={{ left: `${videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0}%` }}
              />
            </div>

            {/* Burbuja con el tiempo de la manija activa */}
            {activeTrimHandle && (
              <div
                className="absolute -top-6 z-10 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/85 border border-white/15 text-[8px] font-mono text-teal-300 shadow-lg pointer-events-none"
                style={{
                  left: `${videoDuration > 0 ? ((activeTrimHandle === "start" ? trimStart : effectiveTrimEnd()) / videoDuration) * 100 : 0}%`,
                }}
              >
                {formatClock(activeTrimHandle === "start" ? trimStart : effectiveTrimEnd())}
              </div>
            )}

            {/* Manija inicio */}
            <div
              onPointerDown={(e) => startTrimDrag("start", e)}
              className="absolute top-0 bottom-0 w-6 -ml-3 flex items-center justify-center cursor-ew-resize touch-none"
              style={{ left: `${videoDuration > 0 ? (trimStart / videoDuration) * 100 : 0}%` }}
            >
              <div className="w-2.5 h-8 rounded-sm bg-teal-400 shadow-lg flex items-center justify-center">
                <span className="w-0.5 h-4 bg-teal-900/50 rounded" />
              </div>
            </div>

            {/* Manija fin */}
            <div
              onPointerDown={(e) => startTrimDrag("end", e)}
              className="absolute top-0 bottom-0 w-6 -ml-3 flex items-center justify-center cursor-ew-resize touch-none"
              style={{ left: `${videoDuration > 0 ? (effectiveTrimEnd() / videoDuration) * 100 : 100}%` }}
            >
              <div className="w-2.5 h-8 rounded-sm bg-teal-400 shadow-lg flex items-center justify-center">
                <span className="w-0.5 h-4 bg-teal-900/50 rounded" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2">
            <p className="text-[8px] text-slate-400">
              Recorte:{" "}
              <span className="font-mono text-teal-300">
                {formatClock(trimStart)} → {formatClock(effectiveTrimEnd())}
              </span>
            </p>
            <button
              onClick={handleResetTrim}
              className="h-6 px-2 rounded-lg bg-white/10 text-slate-300 hover:bg-white/20 text-[8px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" /> Quitar
            </button>
          </div>
          <p className="text-center text-[7px] text-slate-500 mt-1">
            Arrastra las manijas para elegir el inicio y el fin.
          </p>
        </div>
      )}

      {/* BOTTOM SHEET (resto de herramientas) */}
      {activeTool && activeTool !== "presets" && activeTool !== "sliders" && activeTool !== "text" && activeTool !== "trim" && (
        <div className="bg-[#0c1617]/95 backdrop-blur-md border-t border-teal-950/40 flex flex-col shadow-2xl animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
            <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wider">
              {TOOLS.find(t => t.id === activeTool)?.label}
            </span>
            <button
              onClick={() => setActiveTool(null)}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tool content - altura fija con scroll */}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(40vh - 40px)" }}>
            <EditorTabPanels
              editorTab={editorTab}
              editorMode={editorMode}
              fileInputRef={fileInputRef}
              handleImageFileChange={handleImageFileChange}
              uploadedImage={uploadedImage}
              setUploadedImage={setUploadedImage}
              activePresetIdx={activePresetIdx}
              setActivePresetIdx={setActivePresetIdx}
              selectedFilterId={selectedFilterId}
              setSelectedFilterId={setSelectedFilterId}
              adjustments={adjustments}
              setAdjustments={setAdjustments}
              handleResetAdjustments={handleResetAdjustments}
              bannerTitle={bannerTitle}
              setBannerTitle={setBannerTitle}
              bannerProduct={bannerProduct}
              setBannerProduct={setBannerProduct}
              bannerPrice={bannerPrice}
              setBannerPrice={setBannerPrice}
              showWhatsApp={showWhatsApp}
              setShowWhatsApp={setShowWhatsApp}
              textAnimation={textAnimation}
              setTextAnimation={setTextAnimation}
              textSizePercent={textSizePercent}
              setTextSizePercent={setTextSizePercent}
              selectedStickerIdx={selectedStickerIdx}
              setSelectedStickerIdx={setSelectedStickerIdx}
              isPremiumUnlocked={isPremiumUnlocked}
              isValidating={isValidating}
              activationCodeInput={activationCodeInput}
              setActivationCodeInput={setActivationCodeInput}
              codeFeedback={codeFeedback}
              handleValidatePremiumCode={handleValidatePremiumCode}
              selectedMusicId={selectedMusicId}
              setSelectedMusicId={setSelectedMusicId}
              transitionStyle={transitionStyle}
              setTransitionStyle={setTransitionStyle}
              setIsVideoPlaying={setIsVideoPlaying}
              isStateMode={isStateMode}
              musicLibrary={musicLibrary}
            />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

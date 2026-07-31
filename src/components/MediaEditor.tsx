import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, ImageIcon, Video, Music, Volume2, 
  Check, Play, Pause, Phone, X, Award, Zap,
  Compass, Sliders, Type, Tag
} from "lucide-react";
import { BusinessFlyer } from "./BusinessPanel";
import { STATIC_PRESET_IMAGES, PRESET_FILTERS_EXPANDED, PRESET_MUSIC, ANIMATION_PRESETS, STICKER_TEMPLATES_PRO } from "./editor/editorConstants";
import EditorTabPanels from "./editor/EditorTabPanels";
import { supabase } from "../lib/supabase";

interface MediaEditorProps {
  onPublishFlyer: (flyer: BusinessFlyer) => void;
  onGoToFeed: () => void;
  isStateMode?: boolean;
  onPublishState?: (mediaUrl: string, mediaType: "image" | "video", caption: string) => void;
  initialMediaUrl?: string;
  initialMediaType?: "image" | "video";
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
  const [textOffsetY, setTextOffsetY] = useState(0); // draggable vertical offset (px)
  const dragRef = useRef({ startY: 0, startOffset: 0, dragging: false });

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
  const [videoDuration, setVideoDuration] = useState(15);
  const [selectedMusicId, setSelectedMusicId] = useState("none");
  const [transitionStyle, setTransitionStyle] = useState<"fade" | "zoom" | "slide">("fade");
  const [currentTime, setCurrentTime] = useState(0);

  // Ref holders
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // Sound and simulation loop for videos
  const activeMusic = PRESET_MUSIC.find(m => m.id === selectedMusicId);

  useEffect(() => {
    if (isVideoPlaying) {
      // Audio trigger
      if (activeMusic?.url) {
        if (!audioRef.current) {
          audioRef.current = new Audio(activeMusic.url);
          audioRef.current.loop = true;
        }
        audioRef.current.play().catch(e => console.log("Audio play error", e));
      }

      // Smooth frame simulator for UI performance metrics
      const intervalMs = 100;
      timerIntervalRef.current = window.setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= videoDuration) {
            // Loop back
            if (audioRef.current) {
              audioRef.current.currentTime = 0;
            }
            return 0;
          }
          return Number((prev + intervalMs / 1000).toFixed(2));
        });
      }, intervalMs);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [isVideoPlaying, selectedMusicId, videoDuration]);

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

  // Handle custom image upload from device
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setUploadedImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Toggle playback
  const handleTogglePlay = () => {
    setIsVideoPlaying(prev => !prev);
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

  // Handle Export and submit flyer
  const handleExportAndPublishFlyer = () => {
    if (isStateMode && onPublishState) {
      onPublishState(
        currentImageSource, 
        editorMode, 
        bannerProduct && bannerProduct !== "Calzado Premium Red On" ? bannerProduct : bannerTitle
      );
      return;
    }

    const finalFlyer: BusinessFlyer = {
      id: "flyer_pro_" + Date.now(),
      businessName: bannerTitle || "Mi Marca Pro",
      description: bannerProduct || "Promoción exclusiva",
      location: "Caracas, Distrito Capital",
      flyerUrl: currentImageSource,
      isGenerated: true,
      templateId: "sunset",
      productName: bannerProduct,
      price: bannerPrice,
      musicUrl: activeMusic?.url || undefined,
      musicName: activeMusic?.name !== "Sin Música" ? activeMusic?.name : undefined,
      views: 1,
      clicks: 0,
      ownerName: "Nelson Castro (Socio Premium)",
      ownerAvatar: "",
      ownerPhone: "+58 412 1234567"
    };

    onPublishFlyer(finalFlyer);
  };

  const TOOLS = [
    { id: "presets", icon: ImageIcon, label: "Imagen" },
    { id: "sliders", icon: Sliders, label: "Ajustes" },
    { id: "text", icon: Type, label: "Texto" },
    { id: "stickers", icon: Tag, label: "Stickers" },
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

      {/* IMAGE CANVAS (flex-1 to fill remaining space) */}
      <div className="relative flex-1 w-full min-h-0 overflow-hidden">
        {/* Image with filters */}
        <div 
          style={{ 
            ...getVideoTransitionCss(), 
            filter: buildCombinedFilterCss() 
          }}
          className="absolute inset-0 w-full h-full transition-all duration-150"
        >
          {currentImageSource.startsWith("data:video") ? (
            <video 
              src={currentImageSource} 
              autoPlay 
              loop 
              muted 
              playsInline
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
          className="absolute inset-x-3 z-10 space-y-1 text-left cursor-grab active:cursor-grabbing select-none"
          style={{
            transform: `scale(${textSizePercent / 100})`,
            transformOrigin: "bottom left",
            bottom: `${80 + textOffsetY}px`,
          }}
          onMouseDown={(e) => {
            dragRef.current = { startY: e.clientY, startOffset: textOffsetY, dragging: true };
            const onMove = (ev: MouseEvent) => {
              if (!dragRef.current.dragging) return;
              const delta = ev.clientY - dragRef.current.startY;
              setTextOffsetY(Math.max(-120, Math.min(40, dragRef.current.startOffset + delta)));
            };
            const onUp = () => { dragRef.current.dragging = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            dragRef.current = { startY: touch.clientY, startOffset: textOffsetY, dragging: true };
            const onMove = (ev: TouchEvent) => {
              if (!dragRef.current.dragging) return;
              const delta = ev.touches[0].clientY - dragRef.current.startY;
              setTextOffsetY(Math.max(-120, Math.min(40, dragRef.current.startOffset + delta)));
            };
            const onUp = () => { dragRef.current.dragging = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
            window.addEventListener("touchmove", onMove, { passive: true });
            window.addEventListener("touchend", onUp);
          }}
        >
          {bannerTitle && (
            <span className={`inline-block text-[7px] font-black bg-rose-600 text-white px-2 py-0.5 rounded uppercase tracking-wider shadow-md ${getSelectedAnimClass()}`}>
              {bannerTitle}
            </span>
          )}
          {bannerProduct && (
            <h4 className="text-[10px] font-black text-white tracking-tight leading-tight uppercase drop-shadow-md">
              {bannerProduct}
            </h4>
          )}
          {(bannerPrice || showWhatsApp) && (
            <div className="flex justify-between items-center pt-1 border-t border-white/15">
              {bannerPrice && (
                <span className="text-[11px] font-black text-emerald-400 font-mono tracking-tight leading-none">
                  {bannerPrice}
                </span>
              )}
              {showWhatsApp && (
                <span className="text-[6px] text-teal-300 font-bold bg-teal-950/80 border border-teal-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                  <Phone className="w-2 h-2 text-teal-400 fill-teal-400" /> WhatsApp
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sticker overlay */}
        {selectedStickerIdx >= 0 && (
          <div className={`absolute top-14 right-3.5 z-10 px-2 py-1 rounded text-[7px] font-black rotate-12 shadow-lg ${STICKER_TEMPLATES_PRO[selectedStickerIdx].bg}`}>
            {STICKER_TEMPLATES_PRO[selectedStickerIdx].text}
          </div>
        )}

        {/* Watermark */}
        {!isPremiumUnlocked ? (
          <div className="absolute top-2.5 left-2.5 z-10 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-full border border-white/10 flex items-center gap-1">
            <Zap className="w-2 h-2 text-yellow-400 animate-pulse" />
            <span className="text-[5.5px] font-black text-slate-200 uppercase tracking-widest">Creado en Red On</span>
          </div>
        ) : (
          <div className="absolute top-2.5 left-2.5 z-10 bg-gradient-to-r from-teal-500 to-indigo-600 px-2 py-0.5 rounded-full shadow border border-white/25 flex items-center gap-1 animate-pulse">
            <Award className="w-2 h-2 text-yellow-300 fill-yellow-300" />
            <span className="text-[5.5px] font-black text-white uppercase tracking-wider">Red On VIP Premium</span>
          </div>
        )}

        {/* Music badge */}
        {editorMode === "video" && selectedMusicId !== "none" && (
          <div className="absolute top-2.5 right-2.5 z-10 bg-teal-400 px-2 py-0.5 rounded-full text-[6px] font-bold flex items-center gap-1 text-white shadow animate-pulse">
            <Music className="w-2.5 h-2.5 text-white animate-spin" />
            <span>{activeMusic?.name.split(" ")[0]}...</span>
          </div>
        )}
      </div>

      {/* TOP FLOATING BAR */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-3 pt-2 pb-6 pointer-events-none">
        <div className="flex items-center justify-between pointer-events-auto">
          <button
            onClick={onGoToFeed}
            className="bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-[9px] font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1"
          >
            ✕ Volver
          </button>

          <div className="flex bg-black/60 p-0.5 rounded-lg border border-white/10 text-[8px] font-bold">
            <button
              onClick={() => { setEditorMode("image"); setIsVideoPlaying(false); }}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                editorMode === "image" ? "bg-teal-500 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <ImageIcon className="w-3 h-3 inline mr-1" /> Foto
            </button>
            <button
              onClick={() => setEditorMode("video")}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                editorMode === "video" ? "bg-teal-500 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <Video className="w-3 h-3 inline mr-1" /> Video
            </button>
          </div>

          <button
            onClick={handleExportAndPublishFlyer}
            className="bg-teal-500 hover:bg-teal-400 text-white font-extrabold text-[9px] px-3 py-1.5 rounded-lg transition-all shadow-lg cursor-pointer flex items-center gap-1"
          >
            <Check className="w-3 h-3" /> {isStateMode ? "Publicar" : "Exportar"}
          </button>
        </div>

        {/* Video scrubber */}
        {editorMode === "video" && (
          <div className="flex items-center gap-2 mt-2 bg-black/40 p-1.5 rounded-lg pointer-events-auto">
            <button
              onClick={handleTogglePlay}
              className="w-5 h-5 rounded bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center cursor-pointer shrink-0"
            >
              {isVideoPlaying ? <Pause className="w-2.5 h-2.5 fill-white" /> : <Play className="w-2.5 h-2.5 fill-white" />}
            </button>
            <div className="flex-1 h-1 bg-slate-900 rounded overflow-hidden">
              <div className="h-full bg-rose-500 rounded transition-all duration-100 ease-linear" style={{ width: `${(currentTime / videoDuration) * 100}%` }}></div>
            </div>
            <span className="text-[6px] font-mono text-slate-400 shrink-0">00:{currentTime.toFixed(0)}s</span>
          </div>
        )}
      </div>

      {/* BOTTOM TOOLBAR (iconos) */}
      <div className="shrink-0 bg-gradient-to-t from-black/90 via-black/80 to-black/60 px-2 pt-2 pb-1.5 z-20">
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

      {/* BOTTOM SHEET (shown when tool is active) */}
      {activeTool && (
        <div className="shrink-0 bg-[#0c1617] border-t border-teal-950/40 flex flex-col shadow-2xl animate-fade-in">
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
            />
          </div>
        </div>
      )}
    </div>
  );
}

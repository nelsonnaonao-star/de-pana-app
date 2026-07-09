import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, ImageIcon, Video, Music, Volume2, 
  Check, Play, Pause, Phone, X, Award, Zap
} from "lucide-react";
import { BusinessFlyer } from "./BusinessPanel";
import { STATIC_PRESET_IMAGES, PRESET_FILTERS_EXPANDED, PRESET_MUSIC, ANIMATION_PRESETS, STICKER_TEMPLATES_PRO } from "./editor/editorConstants";
import EditorTabPanels from "./editor/EditorTabPanels";

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
  const [bannerTitle, setBannerTitle] = useState("SÚPER PROMO");
  const [bannerProduct, setBannerProduct] = useState("Calzado Premium Red On");
  const [bannerPrice, setBannerPrice] = useState("$29.99");
  const [textAnimation, setTextAnimation] = useState("none");
  const [textSizePercent, setTextSizePercent] = useState<number>(100);

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

  // Premium Code Validation (REDON2026, VIP_EXITO, NELSON_EMPRENDE)
  const handleValidatePremiumCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = activationCodeInput.trim().toUpperCase();

    if (["REDON2026", "VIP_EXITO", "NELSON_EMPRENDE", "PREMIUM_PRO"].includes(cleanCode)) {
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
  };

  // Compile CSS filter string combined dynamically
  const buildCombinedFilterCss = () => {
    let filterString = "";

    // Base preset classes mapped to CSS native variables
    if (selectedFilterId === "caribe") filterString += "saturate-[1.50] contrast-[1.10] brightness-[1.05] ";
    else if (selectedFilterId === "retro") filterString += "sepia-[0.40] saturate-[1.15] contrast-[0.90] hue-rotate-[15deg] ";
    else if (selectedFilterId === "cine") filterString += "contrast-[1.30] brightness-[0.95] saturate-[1.20] ";
    else if (selectedFilterId === "polar") filterString += "hue-rotate-[180deg] saturate-[1.20] contrast-[1.05] ";
    else if (selectedFilterId === "bw") filterString += "grayscale-[1.00] contrast-[1.30] ";
    else if (selectedFilterId === "sunset") filterString += "sepia-[0.30] saturate-[1.35] hue-rotate-[340deg] brightness-[1.05] ";
    else if (selectedFilterId === "cyber") filterString += "hue-rotate-[290deg] saturate-[2.00] brightness-[1.10] contrast-[1.25] ";
    else if (selectedFilterId === "dream") filterString += "brightness-[1.10] contrast-[0.95] saturate-[1.25] blur-[0.5px] ";
    else if (selectedFilterId === "drama") filterString += "contrast-[1.60] brightness-[0.90] saturate-[0.75] ";
    else if (selectedFilterId === "forest") filterString += "hue-rotate-[90deg] saturate-[1.10] brightness-[0.95] ";

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
      ownerAvatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80",
      ownerPhone: "+58 412 1234567"
    };

    onPublishFlyer(finalFlyer);
  };

  return (
    <div className="flex-1 bg-slate-900 text-white flex flex-col h-full overflow-hidden select-none text-left">
      
      {/* Dynamic inline styles to support machine-writing, zoom-in-out, vibrating keyframe animations cleanly */}
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

      {/* 1. TOP BAR COMPACT TITLE */}
      <div className="bg-[#051e20] border-b border-teal-950/40 px-3 py-2 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-teal-400 animate-pulse" />
          <div>
            <h4 className="text-[10px] font-black tracking-tight uppercase leading-none">Editor Red On Studio</h4>
            <span className="text-[7.5px] text-teal-300 font-mono mt-0.5 block">Diseño Profesional de Alto Rendimiento</span>
          </div>
        </div>

        {/* Video Mode vs Photo Mode Toggle */}
        <div className="flex bg-black/40 p-0.5 rounded-lg border border-teal-500/10 text-[8px] font-bold">
          <button
            onClick={() => {
              setEditorMode("image");
              setIsVideoPlaying(false);
            }}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              editorMode === "image" ? "bg-teal-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <ImageIcon className="w-3 h-3 inline mr-1" /> Foto
          </button>
          <button
            onClick={() => setEditorMode("video")}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              editorMode === "video" ? "bg-teal-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            <Video className="w-3 h-3 inline mr-1" /> Video Reel
          </button>
        </div>
      </div>

      {/* 2. LIVE INTERACTIVE CANVAS (PERFECT IN HIGH & LOW END PHONE SIMULATION) */}
      <div className="p-2 shrink-0 bg-slate-950 flex flex-col items-center justify-center relative border-b border-white/5 shadow-inner">
        
        {/* The Frame Box */}
        <div className="relative aspect-[4/3] w-full max-w-[245px] bg-slate-900 rounded-2xl overflow-hidden border border-white/10 shadow-xl flex flex-col justify-end">
          
          {/* Main Visual Image Layer with Cumulative CSS Filter values */}
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

          {/* Video Playback Scanlines/VHS overlay */}
          {editorMode === "video" && selectedFilterId === "retro" && (
            <div className="absolute inset-0 pointer-events-none bg-indigo-900/10 mix-blend-overlay z-15">
              <div className="absolute top-2 left-2 text-[6px] font-mono text-emerald-400">PLAY ▶ 00:{currentTime.toFixed(1)}s</div>
              <div className="absolute bottom-2 right-2 text-[6px] font-mono text-red-500 font-bold">REC • VHS</div>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-1.5 animate-pulse" style={{ animationDuration: "0.8s" }}></div>
            </div>
          )}

          {/* Shading layer for optimal visual contrast */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none z-0"></div>

          {/* INTERACTIVE TEXT OVERLAYS (Responsive, custom animates, custom scale) */}
          <div 
            className="absolute inset-x-3 bottom-3.5 z-10 space-y-1 text-left" 
            style={{ transform: `scale(${textSizePercent / 100})`, transformOrigin: "bottom left" }}
          >
            {/* Title / Brand Badge */}
            <span className={`inline-block text-[7px] font-black bg-rose-600 text-white px-2 py-0.5 rounded uppercase tracking-wider shadow-md ${getSelectedAnimClass()}`}>
              {bannerTitle || "SÚPER OFERTA"}
            </span>

            {/* Product Detail */}
            <h4 className="text-[10px] font-black text-white tracking-tight leading-tight uppercase drop-shadow-md">
              {bannerProduct || "Producto en Oferta Especial"}
            </h4>

            {/* Price tag */}
            <div className="flex justify-between items-center pt-1 border-t border-white/15">
              <span className="text-[11px] font-black text-emerald-400 font-mono tracking-tight leading-none">
                {bannerPrice || "$0.00"}
              </span>
              <span className="text-[6px] text-teal-300 font-bold bg-teal-950/80 border border-teal-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                <Phone className="w-2 h-2 text-teal-400 fill-teal-400" /> WhatsApp
              </span>
            </div>
          </div>

          {/* DYNAMIC PRO STICKER OVERLAY */}
          {selectedStickerIdx >= 0 && (
            <div className={`absolute top-3.5 right-3.5 z-15 px-2 py-1 rounded text-[7px] font-black rotate-12 shadow-lg ${STICKER_TEMPLATES_PRO[selectedStickerIdx].bg}`}>
              {STICKER_TEMPLATES_PRO[selectedStickerIdx].text}
            </div>
          )}

          {/* MONTHLY WATERMARK KEY MECHANISM (Shown if not premium unlocked) */}
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

          {/* Selected Background Music Badge Indicator */}
          {editorMode === "video" && selectedMusicId !== "none" && (
            <div className="absolute top-2.5 right-2.5 z-10 bg-[#14b8a6] px-2 py-0.5 rounded-full text-[6px] font-bold flex items-center gap-1 text-white shadow animate-pulse">
              <Music className="w-2.5 h-2.5 text-white animate-spin" />
              <span>{activeMusic?.name.split(" ")[0]}...</span>
            </div>
          )}
        </div>

        {/* Video Scrubber Timeline indicator */}
        {editorMode === "video" && (
          <div className="w-full max-w-[245px] mt-1.5 flex items-center justify-between gap-2 bg-black/50 p-1.5 rounded-lg border border-white/5">
            <button
              onClick={handleTogglePlay}
              className="w-6 h-6 rounded bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center cursor-pointer active:scale-95 shrink-0"
              title="Play/Pause Video"
            >
              {isVideoPlaying ? <Pause className="w-3 h-3 fill-white" /> : <Play className="w-3 h-3 fill-white" />}
            </button>
            
            {/* Timeline track representation */}
            <div className="flex-1 h-1.5 bg-slate-900 rounded overflow-hidden relative">
              <div 
                className="h-full bg-rose-500 rounded transition-all duration-100 ease-linear"
                style={{ width: `${(currentTime / videoDuration) * 100}%` }}
              ></div>
            </div>

            <span className="text-[7px] font-mono text-slate-400 shrink-0">
              00:{currentTime.toFixed(1)}s / {videoDuration}s
            </span>
          </div>
        )}
      </div>

      {/* 3. TABS SELECTOR (PENSADO EN MÓVILES - FÁCIL ACCESO CON DEDO) */}
      <div className="flex bg-[#072426] border-b border-teal-950/40 p-1 shrink-0 text-[8.5px] font-bold text-center uppercase tracking-wide">
        {[
          { id: "presets", name: "Filtros (10+)", icon: Compass },
          { id: "sliders", name: "Ajustes Manuales", icon: Sliders },
          { id: "text", name: "Texto & Animación", icon: Type },
          { id: "stickers", name: "Stickers Pro", icon: Tag },
          { id: "premium", name: "VIP Código", icon: Award }
        ].map(tab => {
          const IconComponent = tab.icon;
          const isActive = editorTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setEditorTab(tab.id as any)}
              className={`flex-1 py-2 flex flex-col items-center justify-center gap-1 transition-all rounded-md cursor-pointer ${
                isActive 
                  ? "bg-[#14b8a6] text-white shadow-sm" 
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <IconComponent className="w-3.5 h-3.5" />
              <span>{tab.name}</span>
            </button>
          );
        })}
      </div>

      {/* 4. SUBTAB DETAIL CONTROLS SCROLL CONTENT */}
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
        textAnimation={textAnimation}
        setTextAnimation={setTextAnimation}
        textSizePercent={textSizePercent}
        setTextSizePercent={setTextSizePercent}
        selectedStickerIdx={selectedStickerIdx}
        setSelectedStickerIdx={setSelectedStickerIdx}
        isPremiumUnlocked={isPremiumUnlocked}
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

      {/* 5. BIG ACTION BAR BUTTON AT BOTTOM */}
      <div className="p-3 bg-[#051e20] border-t border-teal-950/40 shrink-0 flex items-center gap-2">
        <button
          onClick={onGoToFeed}
          className="w-1/4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[9px] py-3 rounded-xl transition-all text-center cursor-pointer"
        >
          Volver
        </button>
        <button
          onClick={handleExportAndPublishFlyer}
          className="flex-1 bg-gradient-to-r from-teal-500 to-[#14b8a6] hover:from-teal-400 hover:to-teal-500 text-white font-extrabold text-[10px] py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-98 cursor-pointer"
        >
          <Check className="w-4 h-4 stroke-[3]" /> {isStateMode ? "PUBLICAR EN MI ESTADO" : "EXPORTAR & PUBLICAR"}
        </button>
      </div>

    </div>
  );
}

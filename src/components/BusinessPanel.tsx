import React, { useState, useEffect, useRef } from "react";
import { 
  Plus, Search, Sparkles, Volume2, VolumeX, MessageSquare, 
  MapPin, Eye, MousePointerClick, Image as ImageIcon, Music, 
  Check, Play, Pause, RefreshCw, BarChart3, Star, Tag, Compass,
  Layers, ChevronRight, Share2, HelpCircle, AlertCircle, Upload, X
} from "lucide-react";
import { Chat, Message } from "../types";
import MediaEditor from "./MediaEditor";
import { uploadChatMedia } from "../services/storage";

export interface BusinessFlyer {
  id: string;
  businessName: string;
  description: string;
  location: string;
  flyerUrl?: string;
  isGenerated: boolean;
  templateId?: "cyber" | "gold" | "blue" | "sunset";
  productName?: string;
  price?: string;
  musicUrl?: string;
  musicName?: string;
  views: number;
  clicks: number;
  ownerName: string;
  ownerAvatar: string;
  ownerPhone: string;
}

interface BusinessPanelProps {
  onStartBusinessChat: (businessName: string, avatar: string, initialText: string, flyerId: string) => void;
  flyers: BusinessFlyer[];
  onAddFlyer: (flyer: BusinessFlyer) => void;
  onIncrementView: (flyerId: string) => void;
  onIncrementClick: (flyerId: string) => void;
  onEditingChange?: (isEditing: boolean) => void;
}

// Preset Premium Background Music
const MUSIC_PRESETS = [
  { id: "none", name: "Sin Música", url: "" },
  { id: "lofi", name: "Lofi Calm Beats ☕", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { id: "pop", name: "Corporate Chill Pop 🚀", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
  { id: "synth", name: "Synthwave Sunset 🌆", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
  { id: "epic", name: "Upbeat Entrepreneur 🎉", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" }
];

// Preset Premium Sample Flyers (for the upload flow)
const FLYER_SAMPLES = [
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=400&q=80", // Red Shoes
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80", // Headphones
  "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?auto=format&fit=crop&w=400&q=80", // Tech Fashion
  "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=400&q=80"  // Hamburguesa Gourmet
];

// Presets for pre-designed Templates
const TEMPLATE_PRESETS = [
  {
    id: "cyber",
    name: "Ciberespacio Neón",
    bgClass: "bg-gradient-to-br from-slate-950 via-teal-950 to-slate-900 border-2 border-teal-400 text-teal-300",
    textClass: "text-teal-400",
    accentClass: "text-rose-400 font-mono text-sm shadow-teal-500/20",
    headerClass: "text-white font-black tracking-widest text-center uppercase",
    descClass: "text-slate-300 font-mono text-[9px]",
    badgeClass: "bg-teal-400/20 border border-teal-400 text-teal-300"
  },
  {
    id: "gold",
    name: "Oro Minimalista",
    bgClass: "bg-gradient-to-br from-[#12110e] via-[#24211a] to-[#12110e] border-2 border-amber-300 text-amber-200",
    textClass: "text-amber-300 font-serif",
    accentClass: "text-amber-100 font-serif font-bold text-sm",
    headerClass: "text-amber-200 font-serif font-semibold tracking-wide text-center uppercase",
    descClass: "text-amber-100/80 font-serif text-[10px] italic",
    badgeClass: "bg-amber-400/10 border border-amber-400/40 text-amber-300"
  },
  {
    id: "blue",
    name: "Azul Corporativo",
    bgClass: "bg-gradient-to-br from-blue-900 via-[#071330] to-slate-950 border-2 border-blue-400 text-blue-200",
    textClass: "text-blue-300 font-sans",
    accentClass: "text-white font-bold text-xs bg-blue-500/30 px-2 py-0.5 rounded",
    headerClass: "text-white font-bold tracking-tight text-center",
    descClass: "text-slate-200 font-sans text-[10px]",
    badgeClass: "bg-blue-400/20 border border-blue-400 text-blue-100"
  },
  {
    id: "sunset",
    name: "Sunset Tropical",
    bgClass: "bg-gradient-to-br from-orange-500 via-rose-500 to-indigo-600 border-2 border-orange-300 text-white",
    textClass: "text-yellow-200 font-sans font-extrabold",
    accentClass: "text-yellow-100 font-black text-sm drop-shadow",
    headerClass: "text-white font-black tracking-tight text-center uppercase drop-shadow-md",
    descClass: "text-orange-50/95 font-sans text-[10px] leading-relaxed",
    badgeClass: "bg-white/20 border border-white/40 text-white"
  }
];

export default function BusinessPanel({
  onStartBusinessChat,
  flyers,
  onAddFlyer,
  onIncrementView,
  onIncrementClick,
  onEditingChange
}: BusinessPanelProps) {
  // Navigation: "feed" (Explorar), "create" (Publicar), "editor" (Editor Pro), "stats" (Mis Estadísticas)
  const [activeSubTab, setActiveSubTab] = useState<"feed" | "create" | "editor" | "stats">("feed");

  // Create Mode Selection: "upload" (Subir propio), "generate" (Generador inteligente)
  const [createMode, setCreateMode] = useState<"upload" | "generate">("upload");

  // State for active music playing
  const [playingMusicUrl, setPlayingMusicUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Form states for manual upload
  const [upName, setUpName] = useState("");
  const [upDesc, setUpDesc] = useState("");
  const [upLoc, setUpLoc] = useState("");
  const [upFlyerUrl, setUpFlyerUrl] = useState(FLYER_SAMPLES[0]);
  const [upMusicId, setUpMusicId] = useState("none");
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states for template generator
  const [genName, setGenName] = useState("");
  const [genProduct, setGenProduct] = useState("");
  const [genPrice, setGenPrice] = useState("");
  const [genDesc, setGenDesc] = useState("");
  const [genLoc, setGenLoc] = useState("");
  const [genTemplateId, setGenTemplateId] = useState<"cyber" | "gold" | "blue" | "sunset">("cyber");
  const [genMusicId, setGenMusicId] = useState("none");

  // Track search filters in Explorar
  const [searchQuery, setSearchQuery] = useState("");

  // Handle music player
  const toggleMusic = (url: string) => {
    if (!url) return;

    if (playingMusicUrl === url) {
      audioRef.current?.pause();
      setPlayingMusicUrl(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(url);
      audioRef.current.loop = true;
      audioRef.current.play().catch(e => console.log("Audio play error", e));
      setPlayingMusicUrl(url);
    }
  };

  // Clean audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  // Notify parent of editing state changes for layout optimization
  useEffect(() => {
    if (onEditingChange) {
      onEditingChange(activeSubTab === "editor");
    }
  }, [activeSubTab, onEditingChange]);

  // When a flyer is rendered in viewport, we increment its views
  const handleFlyerImpression = (flyerId: string) => {
    onIncrementView(flyerId);
  };

  // Publish manual flyer
  const handlePublishManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!upName.trim() || !upDesc.trim() || !upLoc.trim()) return;

    const selectedMusic = MUSIC_PRESETS.find(m => m.id === upMusicId);

    const newFlyer: BusinessFlyer = {
      id: "flyer_" + Date.now(),
      businessName: upName,
      description: upDesc,
      location: upLoc,
      flyerUrl: upFlyerUrl,
      isGenerated: false,
      musicUrl: selectedMusic?.url || undefined,
      musicName: selectedMusic?.name !== "Sin Música" ? selectedMusic?.name : undefined,
      views: 1, // Start with 1 view
      clicks: 0,
      ownerName: "Nelson Castro (Tú)",
      ownerAvatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80",
      ownerPhone: "+58 412 1234567"
    };

    onAddFlyer(newFlyer);
    // Reset form & go to stats
    setUpName("");
    setUpDesc("");
    setUpLoc("");
    setActiveSubTab("stats");
  };

  // Publish generated flyer
  const handlePublishGenerated = (e: React.FormEvent) => {
    e.preventDefault();
    if (!genName.trim() || !genProduct.trim() || !genPrice.trim() || !genLoc.trim()) return;

    const selectedMusic = MUSIC_PRESETS.find(m => m.id === genMusicId);

    const newFlyer: BusinessFlyer = {
      id: "flyer_" + Date.now(),
      businessName: genName,
      description: genDesc,
      location: genLoc,
      isGenerated: true,
      templateId: genTemplateId,
      productName: genProduct,
      price: genPrice,
      musicUrl: selectedMusic?.url || undefined,
      musicName: selectedMusic?.name !== "Sin Música" ? selectedMusic?.name : undefined,
      views: 1, // Start with 1 view
      clicks: 0,
      ownerName: "Nelson Castro (Tú)",
      ownerAvatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80",
      ownerPhone: "+58 412 1234567"
    };

    onAddFlyer(newFlyer);
    // Reset form & go to stats
    setGenName("");
    setGenProduct("");
    setGenPrice("");
    setGenDesc("");
    setGenLoc("");
    setActiveSubTab("stats");
  };

  // Click on "Chatear con el negocio"
  const handleChatAction = (flyer: BusinessFlyer) => {
    onIncrementClick(flyer.id);
    const initialText = `¡Hola! Me interesó tu anuncio en Red On Negocios: "${flyer.isGenerated ? flyer.productName : flyer.businessName}". ¿Está disponible?`;
    onStartBusinessChat(flyer.businessName, flyer.flyerUrl || flyer.ownerAvatar, initialText, flyer.id);
  };

  // Filtered public flyers based on search
  const filteredFlyers = flyers.filter(f => 
    f.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.productName && f.productName.toLowerCase().includes(searchQuery.toLowerCase())) ||
    f.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Active template styling configurations
  const activeTemplate = TEMPLATE_PRESETS.find(t => t.id === genTemplateId) || TEMPLATE_PRESETS[0];

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-none relative">
      {/* 1. TOP SECTIONS / NAVIGATION SUB-BAR */}
      <div className="bg-[#0a4d52] text-white px-3 pt-3 pb-1 shrink-0 flex flex-col gap-2 relative z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-teal-300" />
            <h3 className="text-xs font-black tracking-tight">Red On Negocios</h3>
          </div>
          <span className="text-[8px] bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
            Modo Emprendedor
          </span>
        </div>

        {/* Dynamic Horizontal Sub Tabs */}
        <div className="flex gap-0.5 bg-black/15 p-1 rounded-lg text-[8.5px] font-bold uppercase mt-1">
          <button
            onClick={() => setActiveSubTab("feed")}
            className={`flex-1 py-1 text-center rounded-md transition-all cursor-pointer ${
              activeSubTab === "feed" ? "bg-[#14b8a6] text-white" : "text-slate-300 hover:text-white"
            }`}
          >
            Feed
          </button>
          <button
            onClick={() => setActiveSubTab("create")}
            className={`flex-1 py-1 text-center rounded-md transition-all cursor-pointer ${
              activeSubTab === "create" ? "bg-[#14b8a6] text-white" : "text-slate-300 hover:text-white"
            }`}
          >
            Publicar
          </button>
          <button
            onClick={() => setActiveSubTab("editor")}
            className={`flex-1 py-1 text-center rounded-md transition-all cursor-pointer ${
              activeSubTab === "editor" ? "bg-[#14b8a6] text-white" : "text-slate-300 hover:text-white"
            }`}
          >
            Editor Pro 🎨
          </button>
          <button
            onClick={() => setActiveSubTab("stats")}
            className={`flex-1 py-1 text-center rounded-md transition-all cursor-pointer ${
              activeSubTab === "stats" ? "bg-[#14b8a6] text-white" : "text-slate-300 hover:text-white"
}`}
          >
            Mis Stats
          </button>
        </div>
      </div>

      {/* 2. MAIN ACTIVE LAYOUT CONTENT */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 relative">
        
        {/* ======================================= */}
        {/* TAB 1: EXPLORAR FEED DE PUBLICACIONES */}
        {/* ======================================= */}
        {activeSubTab === "feed" && (
          <div className="space-y-3 animate-fade-in">
            {/* Search filter input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3 h-3 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar productos, negocios o ubicaciones..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white text-slate-800 text-[10px] pl-8 pr-3 py-2 rounded-xl border border-slate-200 shadow-sm outline-none focus:border-[#14b8a6] transition-all"
              />
            </div>

            {/* List of Published flyers */}
            <div className="space-y-4">
              {filteredFlyers.map((flyer) => {
                const isMyFlyer = flyer.ownerName.includes("Tú");
                const isPlaying = playingMusicUrl === flyer.musicUrl && flyer.musicUrl;

                return (
                  <div
                    key={flyer.id}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col p-3.5 space-y-3.5 hover:shadow transition-all relative"
                    onMouseEnter={() => handleFlyerImpression(flyer.id)}
                  >
                    {/* Header: User avatar and Name */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img
                          src={flyer.ownerAvatar}
                          alt={flyer.ownerName}
                          className="w-7 h-7 rounded-full object-cover border border-slate-100"
                        />
                        <div>
                          <h4 className="text-[10px] font-bold text-slate-800 leading-none">
                            {flyer.businessName}
                          </h4>
                          <span className="text-[8px] text-slate-400 font-mono mt-0.5 block">
                            Publicador: {flyer.ownerName}
                          </span>
                        </div>
                      </div>

                      {/* Views / Clicks statistics indicator */}
                      <div className="flex items-center gap-2 text-[9px] text-slate-500 font-mono">
                        <span className="flex items-center gap-0.5" title="Visualizaciones">
                          <Eye className="w-3 h-3 text-[#14b8a6]" /> {flyer.views}
                        </span>
                        <span className="flex items-center gap-0.5" title="Clicks a Chat">
                          <MousePointerClick className="w-3 h-3 text-indigo-500" /> {flyer.clicks}
                        </span>
                      </div>
                    </div>

                    {/* Flyer Rendering block (Either Image or Template generated) */}
                    <div className="relative rounded-xl overflow-hidden aspect-video shadow-inner bg-slate-900 border border-slate-100 flex items-center justify-center">
                      {flyer.isGenerated ? (
                        /* DYNAMIC PRE-DESIGNED TEMPLATE */
                        <div className={`w-full h-full p-4 flex flex-col justify-between text-left ${
                          TEMPLATE_PRESETS.find(t => t.id === flyer.templateId)?.bgClass || ""
                        }`}>
                          <div className="flex justify-between items-start">
                            <span className="text-[8px] font-bold bg-white/20 border border-white/20 px-2 py-0.5 rounded-full uppercase">
                              Producto Destacado
                            </span>
                            <span className="text-xs font-black bg-[#14b8a6] text-white px-2.5 py-0.5 rounded-lg shadow-md font-mono">
                              {flyer.price}
                            </span>
                          </div>

                          <div className="space-y-1">
                            <h3 className={`text-sm font-black leading-tight uppercase ${
                              TEMPLATE_PRESETS.find(t => t.id === flyer.templateId)?.textClass || ""
                            }`}>
                              {flyer.productName}
                            </h3>
                            <p className="text-[9px] opacity-90 line-clamp-2 leading-relaxed">
                              {flyer.description}
                            </p>
                          </div>

                          <div className="flex justify-between items-center text-[8px] opacity-80 border-t border-white/10 pt-1.5 font-medium">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-red-400" /> {flyer.location}
                            </span>
                            <span className="font-mono text-cyan-300">Generado en Red On</span>
                          </div>
                        </div>
                      ) : (
                        /* UPLOADED FLYER IMAGE WITH DESCRIPTION */
                        <>
                          <img
                            src={flyer.flyerUrl}
                            alt="Flyer"
                            className="w-full h-full object-cover"
                          />
                          {/* Ambient shadow gradient */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent flex flex-col justify-end p-3 text-white">
                            <p className="text-[10px] font-semibold leading-relaxed text-slate-100 line-clamp-2">
                              {flyer.description}
                            </p>
                            <span className="text-[8px] text-slate-300 flex items-center gap-1 mt-1 font-medium">
                              <MapPin className="w-3 h-3 text-[#14b8a6]" /> {flyer.location}
                            </span>
                          </div>
                        </>
                      )}

                      {/* Ambient Background Music Playback overlay shortcut */}
                      {flyer.musicUrl && (
                        <button
                          onClick={() => toggleMusic(flyer.musicUrl!)}
                          className={`absolute top-2.5 right-2.5 p-1.5 rounded-full backdrop-blur-md shadow-md text-white transition-all flex items-center gap-1 cursor-pointer z-20 ${
                            isPlaying ? "bg-rose-500 scale-110 animate-pulse" : "bg-black/60 hover:bg-black/85"
                          }`}
                        >
                          {isPlaying ? (
                            <>
                              <Volume2 className="w-3 h-3" />
                              <span className="text-[7px] font-black uppercase tracking-tight pr-1">Tocando</span>
                            </>
                          ) : (
                            <VolumeX className="w-3 h-3 text-slate-300" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Flyer Audio wave animation indicator */}
                    {isPlaying && (
                      <div className="bg-teal-50 px-3 py-1.5 rounded-xl flex items-center justify-between border border-teal-100">
                        <div className="flex items-center gap-1.5 text-teal-800 text-[9px] font-bold">
                          <Music className="w-3.5 h-3.5 text-teal-600 animate-bounce" />
                          <span>Música de Fondo: {flyer.musicName || "Ambiente Pro"}</span>
                        </div>
                        <div className="flex gap-0.5 h-3 items-end">
                          <span className="w-0.5 bg-teal-500 rounded-full h-3 animate-pulse"></span>
                          <span className="w-0.5 bg-teal-500 rounded-full h-1.5 animate-pulse delay-75"></span>
                          <span className="w-0.5 bg-teal-500 rounded-full h-2.5 animate-pulse delay-100"></span>
                          <span className="w-0.5 bg-teal-500 rounded-full h-1 animate-pulse delay-150"></span>
                        </div>
                      </div>
                    )}

                    {/* Action footer: Chatear direct button */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleChatAction(flyer)}
                        className="flex-1 bg-[#0a4d52] hover:bg-[#10646a] text-white font-bold text-[10px] py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Chatear con el Negocio
                      </button>
                      
                      {isMyFlyer && (
                        <span className="px-3 bg-teal-50 text-[#0a4d52] font-extrabold text-[8px] rounded-xl flex items-center border border-teal-100">
                          Tu publicación
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {filteredFlyers.length === 0 && (
                <div className="text-center py-10 bg-white rounded-2xl border border-dashed text-slate-400 space-y-1">
                  <p className="text-xs font-semibold">No hay publicaciones activas</p>
                  <p className="text-[10px]">Crea o busca con otros términos.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================= */}
        {/* TAB 2: PUBLICAR NUEVO FLYER / GENERAR */}
        {/* ======================================= */}
        {activeSubTab === "create" && (
          <div className="space-y-4 animate-fade-in text-left">
            {/* Create Mode select tabs */}
            <div className="flex border border-slate-200 rounded-xl overflow-hidden text-[9px] font-black uppercase text-center bg-white shadow-sm">
              <button
                onClick={() => setCreateMode("upload")}
                className={`flex-1 py-2.5 cursor-pointer transition-colors ${
                  createMode === "upload" ? "bg-[#0a4d52] text-white" : "text-slate-400 hover:bg-slate-50"
                }`}
              >
                Subir Mi Flyer
              </button>
              <button
                onClick={() => setCreateMode("generate")}
                className={`flex-1 py-2.5 cursor-pointer transition-colors flex items-center justify-center gap-1 ${
                  createMode === "generate" ? "bg-[#0a4d52] text-white" : "text-slate-400 hover:bg-slate-50"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-spin" /> Generador de Flyer
              </button>
            </div>

            {/* FORM A: MANUAL UPLOAD FLOW */}
            {createMode === "upload" && (
              <form onSubmit={handlePublishManual} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5 border-b pb-2">
                  <ImageIcon className="w-4 h-4 text-[#14b8a6]" /> Datos del Negocio & Flyer
                </h4>

                <div className="space-y-3.5">
                  {/* Business Name */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                      Nombre de tu Negocio
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Burger House Premium"
                      value={upName}
                      onChange={(e) => setUpName(e.target.value)}
                      className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                    />
                  </div>

                  {/* Description of what you sell */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                      ¿Qué vendes / Descripción?
                    </label>
                    <textarea
                      required
                      rows={2}
                      placeholder="Ej: Las mejores hamburguesas gourmet con papas fritas y salsas de la casa en Caracas..."
                      value={upDesc}
                      onChange={(e) => setUpDesc(e.target.value)}
                      className="w-full bg-slate-50 border text-[10px] px-3 py-2 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                    />
                  </div>

                  {/* Location */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                      Ubicación de tu Negocio
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Altamira, Caracas, Venezuela"
                      value={upLoc}
                      onChange={(e) => setUpLoc(e.target.value)}
                      className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                    />
                  </div>

                  {/* Select Flyer Image from Samples or Upload */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                      Selecciona una Imagen de Flyer
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {FLYER_SAMPLES.map((sample, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setUpFlyerUrl(sample)}
                          className={`aspect-square rounded-xl overflow-hidden border-2 relative hover:scale-105 transition-all ${
                            upFlyerUrl === sample ? "border-[#14b8a6]" : "border-transparent opacity-75 hover:opacity-100"
                          }`}
                        >
                          <img src={sample} alt="Option" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>

                    {/* Upload custom image */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingImage(true);
                        try {
                          const url = await uploadChatMedia(file, "flyers");
                          setUpFlyerUrl(url);
                        } catch (err) {
                          console.error("Error uploading flyer image:", err);
                        }
                        setUploadingImage(false);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="w-full mt-2 flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-bold py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                    >
                      {uploadingImage ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      {uploadingImage ? "Subiendo imagen..." : "Subir tu propia imagen"}
                    </button>
                    {upFlyerUrl && !FLYER_SAMPLES.includes(upFlyerUrl) && (
                      <div className="relative mt-2 rounded-xl overflow-hidden border-2 border-[#14b8a6]">
                        <img src={upFlyerUrl} alt="Tu imagen" className="w-full h-28 object-cover" />
                        <button
                          type="button"
                          onClick={() => setUpFlyerUrl(FLYER_SAMPLES[0])}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-0.5 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                        <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[7px] font-bold px-1.5 py-0.5 rounded">
                          TU IMAGEN
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Select Flyer Background Music */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
                      <Music className="w-3 h-3 text-teal-600" /> Añadir Música de Fondo al Flyer
                    </label>
                    <select
                      value={upMusicId}
                      onChange={(e) => setUpMusicId(e.target.value)}
                      className="w-full bg-slate-50 border text-[10px] px-3 py-2 rounded-xl outline-none focus:border-[#14b8a6] font-medium"
                    >
                      {MUSIC_PRESETS.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#14b8a6] hover:bg-[#1bc3bd] text-white font-bold text-[10px] py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md mt-4 cursor-pointer"
                >
                  <Compass className="w-4 h-4 animate-pulse" /> Publicar Flyer en Red On
                </button>
              </form>
            )}

            {/* FORM B: TEMPLATE GENERATOR FLOW */}
            {createMode === "generate" && (
              <div className="space-y-4">
                
                {/* Visual template selector */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">
                    Paso 1: Selecciona una Plantilla Profesional
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {TEMPLATE_PRESETS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setGenTemplateId(t.id as any)}
                        className={`p-2.5 text-center text-[10px] font-bold rounded-xl border transition-all cursor-pointer ${
                          genTemplateId === t.id 
                            ? "border-[#14b8a6] bg-teal-50 text-[#0a4d52]" 
                            : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Form fields for Flyer generation */}
                <form onSubmit={handlePublishGenerated} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                  <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5 border-b pb-2">
                    <Sparkles className="w-4 h-4 text-amber-500 animate-spin" /> Paso 2: Llena los datos de tu Producto
                  </h4>

                  <div className="space-y-3.5">
                    {/* Business Name */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                        Nombre de tu Marca o Negocio
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: TechStore C.A."
                        value={genName}
                        onChange={(e) => setGenName(e.target.value)}
                        className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                      />
                    </div>

                    {/* What you sell / Product Name */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                        ¿Qué vendes? (Nombre de tu producto/oferta)
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: Smartwatch Pro Serie 9"
                        value={genProduct}
                        onChange={(e) => setGenProduct(e.target.value)}
                        className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                      />
                    </div>

                    {/* Price */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                        Precio del Producto/Servicio
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: $29.99"
                        value={genPrice}
                        onChange={(e) => setGenPrice(e.target.value)}
                        className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                      />
                    </div>

                    {/* Description */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                        Descripción Corta de la Oferta
                      </label>
                      <textarea
                        required
                        rows={2}
                        placeholder="Ej: Resistente al agua, monitoreo de salud completo, batería de larga duración. ¡Garantía de 1 año!"
                        value={genDesc}
                        onChange={(e) => setGenDesc(e.target.value)}
                        className="w-full bg-slate-50 border text-[10px] px-3 py-2 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                      />
                    </div>

                    {/* Location */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                        Ubicación
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: CC Sambil Chacao, Caracas"
                        value={genLoc}
                        onChange={(e) => setGenLoc(e.target.value)}
                        className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-[#14b8a6] focus:bg-white"
                      />
                    </div>

                    {/* Select Flyer Background Music */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
                        <Music className="w-3 h-3 text-teal-600" /> Paso 3: Ponle Música a tu Flyer
                      </label>
                      <select
                        value={genMusicId}
                        onChange={(e) => setGenMusicId(e.target.value)}
                        className="w-full bg-slate-50 border text-[10px] px-3 py-2 rounded-xl outline-none focus:border-[#14b8a6] font-medium"
                      >
                        {MUSIC_PRESETS.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* PREVIEW CONTAINER OF GENERATED FLYER */}
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                    <span className="text-[8px] font-bold uppercase text-slate-400 block tracking-widest">
                      VISTA PREVIA EN TIEMPO REAL:
                    </span>

                    <div className={`aspect-video rounded-xl p-3.5 flex flex-col justify-between text-left relative overflow-hidden shadow-md transition-all ${activeTemplate.bgClass}`}>
                      {/* Top bar */}
                      <div className="flex justify-between items-start">
                        <span className="text-[7px] font-bold bg-white/20 border border-white/20 px-1.5 py-0.5 rounded uppercase">
                          {genName || "NOMBRE MARCA"}
                        </span>
                        <span className="text-[10px] font-black bg-[#14b8a6] text-white px-2 py-0.5 rounded font-mono">
                          {genPrice || "$0.00"}
                        </span>
                      </div>

                      {/* Content middle */}
                      <div className="space-y-1">
                        <h4 className={`text-xs font-black tracking-tight uppercase leading-tight ${activeTemplate.textClass}`}>
                          {genProduct || "TU PRODUCTO AQUÍ"}
                        </h4>
                        <p className="text-[8px] opacity-90 line-clamp-2 leading-tight">
                          {genDesc || "La descripción que ingreses arriba se formateará automáticamente aquí para capturar la atención del cliente."}
                        </p>
                      </div>

                      {/* Footer bar */}
                      <div className="flex justify-between items-center text-[7px] opacity-80 border-t border-white/10 pt-1 font-medium">
                        <span className="flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5 text-red-400" /> {genLoc || "Ubicación negocio"}
                        </span>
                        <span className="font-mono">Plantilla: {activeTemplate.name}</span>
                      </div>
                    </div>
                  </div>

                  {/* Submit and Publish */}
                  <button
                    type="submit"
                    className="w-full bg-[#0a4d52] hover:bg-[#10646a] text-white font-bold text-[10px] py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md mt-4 cursor-pointer"
                  >
                    <Check className="w-4 h-4 text-emerald-400" /> Generar y Publicar Flyer
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* ======================================= */}
        {/* TAB 4: RESERVADO O REMOVIDO DE ESTE FLUJO INTERNO */}
        {/* ======================================= */}

        {/* ======================================= */}
        {/* TAB 3: MIS ESTADÍSTICAS (VISTAS Y CLICS) */}
        {/* ======================================= */}
        {activeSubTab === "stats" && (
          <div className="space-y-4 animate-fade-in text-left">
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3.5">
              <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5 border-b pb-2">
                <BarChart3 className="w-4 h-4 text-[#10646a]" /> Estadísticas Generales de Mis Publicaciones
              </h4>

              {/* Grid of numeric metrics */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col justify-between">
                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                    Total Visualizaciones
                  </span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-[#10646a]">
                      {flyers.filter(f => f.ownerName.includes("Tú")).reduce((acc, curr) => acc + curr.views, 0)}
                    </span>
                    <span className="text-[9px] text-slate-400">vistas</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col justify-between">
                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                    Chats Iniciados (Clics)
                  </span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl font-black text-indigo-600">
                      {flyers.filter(f => f.ownerName.includes("Tú")).reduce((acc, curr) => acc + curr.clicks, 0)}
                    </span>
                    <span className="text-[9px] text-slate-400">clics</span>
                  </div>
                </div>
              </div>
            </div>

            {/* List of my published flyers with specific statistics */}
            <div className="space-y-3">
              <h5 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider px-1">
                Tus Flyers Activos ({flyers.filter(f => f.ownerName.includes("Tú")).length})
              </h5>

              {flyers.filter(f => f.ownerName.includes("Tú")).map((flyer) => (
                <div
                  key={flyer.id}
                  className="bg-white p-3.5 rounded-2xl border border-slate-100 shadow-sm space-y-3"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-[10px] font-bold text-slate-800">
                        {flyer.isGenerated ? flyer.productName : flyer.businessName}
                      </h4>
                      <span className="text-[8px] text-slate-400 flex items-center gap-1 mt-0.5 font-medium">
                        <MapPin className="w-2.5 h-2.5 text-red-400" /> {flyer.location}
                      </span>
                    </div>

                    <span className="text-[8px] font-extrabold bg-[#14b8a6]/10 text-[#0a4d52] px-2 py-0.5 rounded-full uppercase">
                      {flyer.isGenerated ? "Generado" : "Manual"}
                    </span>
                  </div>

                  {/* Individual statistics row */}
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-xl text-center text-[10px] font-mono border border-slate-100">
                    <div className="flex flex-col border-r border-slate-200">
                      <span className="text-[7px] text-slate-400 uppercase font-sans font-bold">Vistas</span>
                      <span className="text-xs font-black text-slate-800">{flyer.views} 👁️</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[7px] text-slate-400 uppercase font-sans font-bold">Clicks</span>
                      <span className="text-xs font-black text-indigo-600">{flyer.clicks} 🖱️</span>
                    </div>
                  </div>
                </div>
              ))}

              {flyers.filter(f => f.ownerName.includes("Tú")).length === 0 && (
                <div className="text-center py-10 bg-white rounded-2xl border border-slate-100 text-slate-400 space-y-2">
                  <p className="text-xs font-semibold">Aún no has publicado ningún flyer</p>
                  <button
                    onClick={() => setActiveSubTab("create")}
                    className="text-[10px] text-[#14b8a6] hover:underline font-bold"
                  >
                    ¡Crea tu primer flyer ahora!
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ======================================= */}
      {/* FULL-SCREEN ROOT OVERLAY: EDITOR PRO 🎨 */}
      {/* ======================================= */}
      {activeSubTab === "editor" && (
        <div className="absolute inset-0 bg-slate-900 z-50 flex flex-col overflow-hidden">
          <MediaEditor 
            onPublishFlyer={(newFlyer) => {
              onAddFlyer(newFlyer);
              setActiveSubTab("stats");
            }}
            onGoToFeed={() => {
              setActiveSubTab("feed");
            }}
          />
        </div>
      )}
    </div>
  );
}

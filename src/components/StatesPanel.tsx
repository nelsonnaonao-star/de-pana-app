import React, { useState, useEffect } from "react";
import { 
  Plus, Play, Camera, ChevronLeft, Send, X, Flame, Sparkles, 
  Smile, Layout, Check, Heart, MessageCircle, Clock, Eye, Trash2,
  Video, Upload, Award
} from "lucide-react";
import { Chat, Message } from "../types";
import MediaEditor from "./MediaEditor";
import { useSupabase } from "../contexts/SupabaseContext";
import { getMyStories, getAllStories, createStory, deleteStory } from "../services/contentService";

export interface Story {
  id: string;
  type: "text" | "image" | "video";
  content: string; // text content, image URL, or video URL
  caption?: string;
  background?: string; // gradient CSS class (for text story)
  time: string;
}

export interface UserState {
  id: string;
  userName: string;
  userAvatar: string;
  stories: Story[];
  hasUnseen: boolean;
  isMe?: boolean;
}

interface StatesPanelProps {
  onStartChat: (name: string, avatar: string, initialText: string) => void;
}

// Premium Background Gradients for Text Statuses
const GRADIENTS = [
  "from-indigo-600 via-purple-600 to-pink-500",
  "from-emerald-500 to-teal-700",
  "from-rose-500 to-orange-500",
  "from-slate-900 via-purple-900 to-slate-900",
  "from-cyan-500 to-blue-600",
  "from-amber-500 to-rose-600"
];

// Pre-designed sample photos for Status images
const PHOTO_SAMPLES = [
  { url: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80", tag: "Estilo de vida" },
  { url: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80", tag: "Comida Gourmet" },
  { url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=400&q=80", tag: "Futuro & Tech" },
  { url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=400&q=80", tag: "Naturaleza" }
];

export default function StatesPanel({ onStartChat }: StatesPanelProps) {
  const { user } = useSupabase();

  // Load stories from API on mount
  useEffect(() => {
    getAllStories().then(apiStories => {
      if (!apiStories || apiStories.length === 0) return;
      const grouped: Record<string, any> = {};
      for (const s of apiStories) {
        const uid = s.user_id;
        if (!grouped[uid]) {
          grouped[uid] = {
            id: uid + '_state',
            userName: s.profiles?.name || 'Usuario',
            userAvatar: s.profiles?.avatar_url || '',
            hasUnseen: true,
            stories: [],
          };
        }
        grouped[uid].stories.push({
          id: s.id,
          type: s.type,
          content: s.content,
          time: s.created_at ? new Date(s.created_at).toLocaleString() : '',
        });
      }
      setUserStates(Object.values(grouped));
    }).catch(() => {});
  }, []);

  const [userStates, setUserStates] = useState<UserState[]>([]);

  const [myStories, setMyStories] = useState<Story[]>([]);

  // Screen state inside States: "list" (Ver estados), "create_text" (Crear estado texto), "create_image" (Crear estado imagen)
  const [subView, setSubView] = useState<"list" | "create_text" | "create_image">("list");

  // Upload and Pro Editor states
  const [uploadedMedia, setUploadedMedia] = useState<{ url: string; type: "image" | "video"; name: string } | null>(null);
  const [showPublishDecisionModal, setShowPublishDecisionModal] = useState<boolean>(false);
  const [isEditingProState, setIsEditingProState] = useState<boolean>(false);

  // State of Active Story Viewer
  const [activeUserStates, setActiveUserStates] = useState<UserState | null>(null);
  const [activeStoryIdx, setActiveStoryIdx] = useState<number>(0);
  const [storyProgress, setStoryProgress] = useState<number>(0);
  const [storyReplyText, setStoryReplyText] = useState<string>("");

  // Editor states (Text creator)
  const [newTextContent, setNewTextContent] = useState<string>("");
  const [selectedGradientIdx, setSelectedGradientIdx] = useState<number>(0);

  // Editor states (Image creator)
  const [newImageCaption, setNewImageCaption] = useState<string>("");
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>(PHOTO_SAMPLES[0].url);

  // Auto-advance logic for story viewer
  useEffect(() => {
    if (!activeUserStates) return;

    setStoryProgress(0);
    const interval = setInterval(() => {
      setStoryProgress(prev => {
        if (prev >= 100) {
          // Go to next story
          if (activeStoryIdx < activeUserStates.stories.length - 1) {
            setActiveStoryIdx(idx => idx + 1);
            return 0;
          } else {
            // Close viewer
            handleCloseStoryViewer();
            return 0;
          }
        }
        return prev + 2; // increments every 100ms, total 5 seconds per story
      });
    }, 100);

    return () => clearInterval(interval);
  }, [activeUserStates, activeStoryIdx]);

  // Open story viewer
  const handleOpenStoryViewer = (userState: UserState) => {
    setActiveUserStates(userState);
    setActiveStoryIdx(0);
    setStoryProgress(0);

    // Mark as seen
    if (!userState.isMe) {
      setUserStates(prev => prev.map(u => u.id === userState.id ? { ...u, hasUnseen: false } : u));
    }
  };

  const handleCloseStoryViewer = () => {
    setActiveUserStates(null);
    setStoryReplyText("");
  };

  // Skip / Previous story clicks
  const handleStoryTap = (direction: "prev" | "next") => {
    if (!activeUserStates) return;

    if (direction === "prev") {
      if (activeStoryIdx > 0) {
        setActiveStoryIdx(idx => idx - 1);
        setStoryProgress(0);
      }
    } else {
      if (activeStoryIdx < activeUserStates.stories.length - 1) {
        setActiveStoryIdx(idx => idx + 1);
        setStoryProgress(0);
      } else {
        handleCloseStoryViewer();
      }
    }
  };

  // Reply to story via chat
  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storyReplyText.trim() || !activeUserStates) return;

    const currentStory = activeUserStates.stories[activeStoryIdx];
    const contextQuote = currentStory.type === "text" 
      ? `"${currentStory.content}"` 
      : `[${currentStory.type === "video" ? "Video" : "Imagen"} de Estado]`;

    const initialText = `Respondí a tu estado ${contextQuote}:\n\n${storyReplyText}`;
    
    onStartChat(activeUserStates.userName, activeUserStates.userAvatar, initialText);
    handleCloseStoryViewer();
  };

  // Helper: save story to API
  const saveStoryToApi = (story: Story) => {
    if (!user) return;
    createStory({
      user_id: user.id,
      type: story.type,
      content: story.content,
    }).catch(() => {});
  };

  // Publish Text Status
  const handlePublishText = () => {
    if (!newTextContent.trim()) return;

    const newStory: Story = {
      id: "my_text_" + Date.now(),
      type: "text",
      content: newTextContent,
      background: GRADIENTS[selectedGradientIdx],
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setNewTextContent("");
    setSubView("list");
  };

  // Publish Image Status
  const handlePublishImage = () => {
    const newStory: Story = {
      id: "my_img_" + Date.now(),
      type: "image",
      content: selectedImageUrl,
      caption: newImageCaption,
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setNewImageCaption("");
    setSubView("list");
  };

  // Real Upload Handlers (Original vs PRO Editor choice)
  const handleFileUploaded = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileType = file.type.startsWith("video") ? "video" : "image";
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setUploadedMedia({
          url: event.target.result as string,
          type: fileType,
          name: file.name
        });
        setShowPublishDecisionModal(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePublishOriginal = () => {
    if (!uploadedMedia) return;

    const newStory: Story = {
      id: "my_upload_" + Date.now(),
      type: uploadedMedia.type,
      content: uploadedMedia.url,
      caption: `Publicado original: ${uploadedMedia.name}`,
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setUploadedMedia(null);
    setShowPublishDecisionModal(false);
    setSubView("list");
  };

  const handleGoToProEditor = () => {
    setShowPublishDecisionModal(false);
    setIsEditingProState(true);
  };

  const handlePublishProState = (editedUrl: string, mediaType: "image" | "video", caption: string) => {
    const newStory: Story = {
      id: "my_pro_" + Date.now(),
      type: mediaType,
      content: editedUrl,
      caption: caption || "Editado con Red On PRO Editor ✨🎨",
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setIsEditingProState(false);
    setUploadedMedia(null);
    setSubView("list");
  };

  // Delete my story
  const handleDeleteMyStory = (storyId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMyStories(prev => prev.filter(s => s.id !== storyId));
    deleteStory(storyId).catch(() => {});
  };

  // Combine my stories in a UserState representation for the viewer
  const myUserStateRepresentation: UserState = {
    id: "me_state",
    userName: "Mi Estado (Nelson)",
    userAvatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80",
    stories: myStories,
    hasUnseen: false,
    isMe: true
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-none">
      
      {/* 1. TOP HEADER SUB-BAR */}
      <div className="bg-[#0a4d52] text-white px-3 pt-3 pb-2 shrink-0 flex flex-col gap-1.5 relative z-10 shadow-sm text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-teal-300" />
            <h3 className="text-xs font-black tracking-tight">Estados de Red On</h3>
          </div>
          <span className="text-[8px] bg-teal-400 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Momentáneos (24h)
          </span>
        </div>
      </div>

      {/* 2. BODY SCROLL CONTROLLER */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-left">
        
        {/* ======================================= */}
        {/* SUBVIEW 1: LIST OF STATES AND STORY ACTIONS */}
        {/* ======================================= */}
        {subView === "list" && (
          <div className="space-y-4 animate-fade-in">
            
            {/* Hidden native file input for states */}
            <input
              id="state-media-upload-input"
              type="file"
              accept="image/*,video/*"
              onChange={handleFileUploaded}
              className="hidden"
            />

            {/* Creation Buttons Quick Row */}
            <div className="grid grid-cols-3 gap-1.5 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm">
              <button
                onClick={() => setSubView("create_text")}
                className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-[#0a4d52] font-extrabold text-[9px] rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
              >
                <Layout className="w-4 h-4 text-teal-600" />
                Texto
              </button>
              <button
                onClick={() => setSubView("create_image")}
                className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-[#0a4d52] font-extrabold text-[9px] rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
              >
                <Camera className="w-4 h-4 text-indigo-600" />
                Catálogo Foto
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById("state-media-upload-input");
                  if (el) el.click();
                }}
                className="py-2 px-1 bg-teal-500 hover:bg-teal-600 border border-teal-600 text-white font-extrabold text-[9px] rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer shadow-sm relative overflow-hidden animate-pulse"
              >
                <Upload className="w-4 h-4 text-white" />
                Subir Foto/Video
                <span className="absolute top-0 right-0 bg-amber-500 text-[6px] font-black px-1 rounded-bl leading-none py-0.5">PRO</span>
              </button>
            </div>

            {/* MY PERSONAL STORIES LIST */}
            <div className="space-y-2">
              <h4 className="text-[9px] font-black uppercase text-slate-400 tracking-wider px-1">
                Mi Estado (Tus publicaciones)
              </h4>

              {myStories.length > 0 ? (
                <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                  <div 
                    onClick={() => handleOpenStoryViewer(myUserStateRepresentation)}
                    className="flex items-center justify-between cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar with colorful border */}
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full border-2 border-emerald-500 scale-110"></div>
                        <img
                          src={myUserStateRepresentation.userAvatar}
                          alt="Me"
                          className="w-9 h-9 rounded-full object-cover border-2 border-white relative z-10"
                        />
                      </div>
                      
                      <div>
                        <h5 className="text-[10px] font-bold text-slate-800 leading-none group-hover:text-teal-400">
                          Ver mis estados ({myStories.length})
                        </h5>
                        <span className="text-[8px] text-slate-400 font-mono mt-1 block">
                          Toca para reproducir tus historias
                        </span>
                      </div>
                    </div>

                    <Play className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                  </div>

                  {/* Tiny list of published slides with Delete options */}
                  <div className="border-t border-slate-100 pt-2 space-y-1.5">
                    {myStories.map((story) => (
                      <div 
                        key={story.id}
                        className="flex items-center justify-between bg-slate-50 p-2 rounded-xl text-[9px] font-medium"
                      >
                        <div className="flex items-center gap-2 truncate max-w-[180px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                          <span className="text-slate-600 truncate italic">
                            {story.type === "text" ? story.content : `[Foto] ${story.caption || ""}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[8px] text-slate-400">
                          <span>{story.time}</span>
                          <button
                            onClick={(e) => handleDeleteMyStory(story.id, e)}
                            className="p-1 hover:text-rose-500 transition-colors cursor-pointer"
                            title="Eliminar Estado"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              ) : (
                <div className="bg-white p-3.5 rounded-2xl border border-dashed text-center text-slate-400 space-y-1">
                  <p className="text-[10px] font-semibold">No tienes ningún estado activo</p>
                  <p className="text-[8px]">¡Comparte tu día con tus contactos!</p>
                </div>
              )}
            </div>

            {/* CONTACTS STORIES LIST */}
            <div className="space-y-2">
              <h4 className="text-[9px] font-black uppercase text-slate-400 tracking-wider px-1">
                Estados Recientes
              </h4>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
                {userStates.map((userState) => (
                  <div
                    key={userState.id}
                    onClick={() => handleOpenStoryViewer(userState)}
                    className="p-3 flex items-center justify-between hover:bg-slate-50/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Ring Indicator */}
                      <div className="relative">
                        <div className={`absolute inset-0 rounded-full scale-110 border-2 ${
                          userState.hasUnseen 
                            ? "border-teal-400 animate-pulse" 
                            : "border-slate-200"
                        }`}></div>
                        <img
                          src={userState.userAvatar}
                          alt={userState.userName}
                          className="w-9 h-9 rounded-full object-cover border-2 border-white relative z-10"
                        />
                      </div>

                      <div>
                        <h5 className="text-[10px] font-black text-slate-800 leading-none">
                          {userState.userName}
                        </h5>
                        <span className="text-[8px] text-slate-400 font-mono mt-1 block">
                          {userState.stories[userState.stories.length - 1].time} • {userState.stories.length} {userState.stories.length === 1 ? "publicación" : "publicaciones"}
                        </span>
                      </div>
                    </div>

                    <ChevronLeft className="w-4 h-4 text-slate-300 rotate-180" />
                  </div>
                ))}
              </div>
            </div>

            {/* Hint Box */}
            <div className="bg-teal-50/50 rounded-xl p-3 border border-teal-100 flex gap-2 items-start">
              <Sparkles className="w-4 h-4 text-[#10646a] shrink-0 mt-0.5 animate-spin" />
              <p className="text-[8.5px] text-slate-500 leading-relaxed">
                Los estados de Red On desaparecen automáticamente cada 24 horas. ¡El diseño es dinámico y soporta respuestas directas al chat privado del publicador!
              </p>
            </div>

          </div>
        )}

        {/* ======================================= */}
        {/* SUBVIEW 2: CREATE TEXT STATUS EDITOR */}
        {/* ======================================= */}
        {subView === "create_text" && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSubView("list")}
                className="text-[9px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-0.5 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Volver
              </button>
              <h4 className="text-[10px] font-black uppercase text-slate-400">Crear Estado de Texto</h4>
            </div>

            {/* Live Interactive editor canvas */}
            <div className={`aspect-[9/16] max-h-[300px] w-full rounded-2xl bg-gradient-to-br ${GRADIENTS[selectedGradientIdx]} flex flex-col justify-between p-5 text-white shadow-lg relative overflow-hidden`}>
              <div className="flex justify-between items-center z-10">
                <span className="text-[8px] font-bold tracking-widest uppercase bg-white/20 border border-white/10 px-2 py-0.5 rounded-full">
                  Editor Texto Red On
                </span>
                
                {/* Button to cycle colors */}
                <button
                  onClick={() => setSelectedGradientIdx((prev) => (prev + 1) % GRADIENTS.length)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
                  title="Cambiar Color de Fondo"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </div>

              {/* Text Input area directly inside canvas */}
              <div className="flex-1 flex items-center justify-center py-4 z-10">
                <textarea
                  required
                  placeholder="¿En qué estás pensando hoy? Escribe algo increíble..."
                  value={newTextContent}
                  onChange={(e) => setNewTextContent(e.target.value)}
                  maxLength={160}
                  rows={4}
                  className="w-full text-center bg-transparent border-none text-xs font-extrabold text-white placeholder-white/60 resize-none outline-none focus:ring-0 leading-relaxed max-w-[180px]"
                />
              </div>

              <div className="text-center text-[7.5px] opacity-75 font-mono z-10">
                {newTextContent.length} / 160 caracteres
              </div>
            </div>

            {/* Bottom Actions */}
            <button
              onClick={handlePublishText}
              disabled={!newTextContent.trim()}
              className="w-full bg-teal-400 hover:bg-teal-500 text-white disabled:opacity-50 disabled:pointer-events-none font-bold text-[10px] py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <Check className="w-4 h-4" /> Compartir en Mi Estado
            </button>
          </div>
        )}

        {/* ======================================= */}
        {/* SUBVIEW 3: CREATE IMAGE STATUS EDITOR */}
        {/* ======================================= */}
        {subView === "create_image" && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSubView("list")}
                className="text-[9px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-0.5 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Volver
              </button>
              <h4 className="text-[10px] font-black uppercase text-slate-400">Crear Estado con Foto</h4>
            </div>

            {/* Interactive Image Choice */}
            <div className="space-y-2">
              <span className="text-[8px] font-bold uppercase text-slate-400 block tracking-wider">
                1. Selecciona una Imagen Profesional
              </span>
              <div className="grid grid-cols-4 gap-2">
                {PHOTO_SAMPLES.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImageUrl(p.url)}
                    className={`aspect-square rounded-xl overflow-hidden border-2 relative hover:scale-105 transition-all cursor-pointer ${
                      selectedImageUrl === p.url ? "border-teal-400" : "border-transparent opacity-75"
                    }`}
                  >
                    <img src={p.url} alt="Option" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[6px] font-bold py-0.5 text-center truncate">
                      {p.tag}
                    </span>
                  </button>
                ))}
              </div>

              {/* Upload own photo/video link option */}
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById("state-media-upload-input");
                    if (el) el.click();
                  }}
                  className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-[#0a4d52] font-black text-[8px] px-3 py-1.5 rounded-lg transition-all cursor-pointer border border-slate-200/50"
                >
                  <Upload className="w-3.5 h-3.5 text-teal-600 animate-bounce" /> O subir tu propio archivo (Foto/Video)
                </button>
              </div>
            </div>

            {/* Live Interactive editor image canvas */}
            <div className="space-y-2">
              <span className="text-[8px] font-bold uppercase text-slate-400 block tracking-wider">
                2. Vista Previa & Leyenda
              </span>

              <div className="aspect-[9/16] max-h-[300px] w-full rounded-2xl relative overflow-hidden shadow-lg border border-slate-100 flex flex-col justify-between p-4 bg-slate-900 text-white">
                <img
                  src={selectedImageUrl}
                  alt="Background"
                  className="absolute inset-0 w-full h-full object-cover opacity-90"
                />
                
                {/* Overlay shadow */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/80 z-0"></div>

                <div className="flex justify-between items-center z-10">
                  <span className="text-[7px] font-bold tracking-widest uppercase bg-black/40 border border-white/15 px-2 py-0.5 rounded-full">
                    Vista de Foto Red On
                  </span>
                </div>

                {/* Caption editor overlay */}
                <div className="z-10 bg-black/60 backdrop-blur-sm border border-white/10 rounded-xl p-2">
                  <input
                    type="text"
                    required
                    placeholder="Escribe una leyenda para tu foto..."
                    value={newImageCaption}
                    onChange={(e) => setNewImageCaption(e.target.value)}
                    maxLength={70}
                    className="w-full bg-transparent border-none text-white text-[9.5px] font-bold text-center placeholder-slate-300 outline-none focus:ring-0"
                  />
                  <div className="text-[6.5px] text-right text-slate-300 mt-1 font-mono">
                    {newImageCaption.length} / 70 max
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <button
              onClick={handlePublishImage}
              className="w-full bg-teal-400 hover:bg-teal-500 text-white font-bold text-[10px] py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <Check className="w-4 h-4" /> Compartir en Mi Estado
            </button>
          </div>
        )}

      </div>

      {/* ========================================================= */}
      {/* 3. ABSOLUTE FULL-SCREEN STORY VIEWER (DYNAMIC COMPONENT) */}
      {/* ========================================================= */}
      {activeUserStates && (
        <div className="absolute inset-0 bg-slate-950 z-50 flex flex-col text-white animate-fade-in">
          
          {/* Top Progress Bar indicator */}
          <div className="px-3.5 pt-3.5 flex gap-1 shrink-0 z-20">
            {activeUserStates.stories.map((story, idx) => (
              <div 
                key={story.id}
                className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden"
              >
                <div 
                  className="h-full bg-teal-400 rounded-full transition-all duration-100 ease-linear"
                  style={{
                    width: idx < activeStoryIdx ? "100%" : idx === activeStoryIdx ? `${storyProgress}%` : "0%"
                  }}
                ></div>
              </div>
            ))}
          </div>

          {/* User Creator Info & Close button */}
          <div className="px-3.5 pt-2 flex items-center justify-between shrink-0 z-20">
            <div className="flex items-center gap-2">
              <img
                src={activeUserStates.userAvatar}
                alt={activeUserStates.userName}
                className="w-8 h-8 rounded-full object-cover border border-white/25"
              />
              <div>
                <h4 className="text-[10px] font-black leading-none">
                  {activeUserStates.userName}
                </h4>
                <span className="text-[7.5px] text-slate-300 font-mono mt-0.5 block">
                  {activeUserStates.stories[activeStoryIdx].time}
                </span>
              </div>
            </div>

            <button
              onClick={handleCloseStoryViewer}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* MAIN ACTIVE SCREEN (TEXT OR IMAGE STORY TYPE) */}
          <div className="flex-1 relative flex items-center justify-center p-6 z-10 select-none">
            
            {/* Left & Right click zones for fast control */}
            <div 
              onClick={() => handleStoryTap("prev")}
              className="absolute left-0 inset-y-0 w-1/4 z-20 cursor-pointer active:bg-white/5 transition-colors"
            ></div>
            <div 
              onClick={() => handleStoryTap("next")}
              className="absolute right-0 inset-y-0 w-1/4 z-20 cursor-pointer active:bg-white/5 transition-colors"
            ></div>

            {/* Render Slide */}
            {activeUserStates.stories[activeStoryIdx].type === "text" ? (
              /* Text Slide with gradient background */
              <div className={`absolute inset-0 bg-gradient-to-br ${
                activeUserStates.stories[activeStoryIdx].background || GRADIENTS[activeStoryIdx % GRADIENTS.length]
              } flex items-center justify-center p-8 text-center`}>
                <p className="text-sm font-black tracking-wide leading-relaxed drop-shadow max-w-[240px]">
                  {activeUserStates.stories[activeStoryIdx].content}
                </p>
              </div>
            ) : activeUserStates.stories[activeStoryIdx].type === "video" ? (
              /* Video Slide */
              <>
                <video
                  src={activeUserStates.stories[activeStoryIdx].content}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-contain"
                />
                
                {/* Top/Bottom Overlay gradients for readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45 pointer-events-none z-10"></div>

                {/* Slide Caption */}
                {activeUserStates.stories[activeStoryIdx].caption && (
                  <div className="absolute bottom-16 inset-x-4 bg-black/50 backdrop-blur-md rounded-2xl p-3 border border-white/10 text-center text-[10px] font-semibold leading-relaxed z-30">
                    {activeUserStates.stories[activeStoryIdx].caption}
                  </div>
                )}
              </>
            ) : (
              /* Image Slide */
              <>
                <img
                  src={activeUserStates.stories[activeStoryIdx].content}
                  alt="Story Content"
                  className="absolute inset-0 w-full h-full object-contain"
                />
                
                {/* Top/Bottom Overlay gradients for readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45 pointer-events-none z-10"></div>

                {/* Slide Caption */}
                {activeUserStates.stories[activeStoryIdx].caption && (
                  <div className="absolute bottom-16 inset-x-4 bg-black/50 backdrop-blur-md rounded-2xl p-3 border border-white/10 text-center text-[10px] font-semibold leading-relaxed z-30">
                    {activeUserStates.stories[activeStoryIdx].caption}
                  </div>
                )}
              </>
            )}
          </div>

          {/* BOTTOM REPLY BAR (FOR PRIVATE CHAT) - Hidden if it is ME */}
          {!activeUserStates.isMe ? (
            <form 
              onSubmit={handleSendReply}
              className="p-3 bg-black/85 border-t border-white/10 z-20 flex gap-2 items-center"
            >
              <input
                type="text"
                required
                placeholder="Responder al estado de manera privada..."
                value={storyReplyText}
                onChange={(e) => setStoryReplyText(e.target.value)}
                className="flex-1 bg-white/10 text-white placeholder-slate-400 text-[10px] px-3.5 py-2.5 rounded-xl border border-white/10 outline-none focus:border-teal-400"
              />
              <button
                type="submit"
                className="w-9 h-9 bg-teal-400 hover:bg-teal-500 text-white rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          ) : (
            /* Views Count indicator on ME states */
            <div className="p-3.5 bg-black/85 border-t border-white/10 z-20 flex items-center justify-center gap-1.5 font-mono text-[9px] text-slate-300">
              <Eye className="w-3.5 h-3.5 text-teal-400" />
              <span>0 visualizaciones (Estado publicado recientemente)</span>
            </div>
          )}

        </div>
      )}

      {/* ========================================================= */}
      {/* 4. CHOOSE PUBLISH MODE MODAL (ORIGINAL VS PRO EDITOR) 🚀  */}
      {/* ========================================================= */}
      {showPublishDecisionModal && uploadedMedia && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in text-left">
          <div className="bg-slate-900 border border-slate-800/80 rounded-3xl w-full max-w-[280px] overflow-hidden shadow-lg p-5 text-center space-y-4">
            
            {/* Pulsing visual icon indicator */}
            <div className="relative mx-auto w-12 h-12 flex items-center justify-center bg-teal-500/10 border border-teal-500/30 rounded-2xl">
              <Sparkles className="w-6 h-6 text-teal-400 animate-pulse" />
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
              </span>
            </div>

            <div className="space-y-1">
              <h3 className="text-white text-xs font-black tracking-tight leading-snug">
                ¡Archivo Cargado con Éxito! 🎉
              </h3>
              <p className="text-[8.5px] text-slate-400 font-mono truncate max-w-full px-2">
                {uploadedMedia.name} ({uploadedMedia.type === "video" ? "Video" : "Imagen"})
              </p>
            </div>

            {/* Quick visual preview box */}
            <div className="aspect-[16/10] bg-black/40 rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center">
              {uploadedMedia.type === "video" ? (
                <>
                  <video 
                    src={uploadedMedia.url} 
                    muted 
                    playsInline 
                    loop 
                    autoPlay 
                    className="w-full h-full object-cover opacity-60" 
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <Video className="w-6 h-6 text-white drop-shadow animate-pulse" />
                  </div>
                </>
              ) : (
                <img 
                  src={uploadedMedia.url} 
                  alt="Preview" 
                  className="w-full h-full object-cover opacity-70" 
                />
              )}
              <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-md border border-white/10 px-1.5 py-0.5 rounded-md text-[6.5px] text-slate-300 font-bold uppercase tracking-wide">
                Vista Previa
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[8.5px] text-slate-300 font-medium px-1">
                ¿Cómo deseas publicar este archivo en tu estado de Red On?
              </p>

              {/* High conversion PRO action button */}
              <button
                onClick={handleGoToProEditor}
                className="w-full py-2.5 px-3 bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white font-black text-[9.5px] rounded-xl shadow-lg hover:shadow-teal-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Award className="w-4 h-4 text-amber-300 fill-amber-300 animate-spin" style={{ animationDuration: '6s' }} />
                Pasar por Editor PRO (Recomendado)
              </button>

              {/* Standard Original action button */}
              <button
                onClick={handlePublishOriginal}
                className="w-full py-2.5 px-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-200 font-bold text-[9px] rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 text-slate-400" />
                Publicar Versión Original
              </button>
            </div>

            <button
              onClick={() => {
                setUploadedMedia(null);
                setShowPublishDecisionModal(false);
              }}
              className="text-[8px] font-bold text-slate-500 hover:text-slate-400 cursor-pointer block mx-auto pt-1"
            >
              Cancelar Carga
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 5. FULL-SCREEN EDITOR PRO OVERLAY (STATE-MODE INTEGRATION) */}
      {/* ========================================================= */}
      {isEditingProState && uploadedMedia && (
        <div className="absolute inset-0 bg-slate-900 z-50 flex flex-col overflow-hidden animate-fade-in">
          <MediaEditor 
            isStateMode={true}
            initialMediaUrl={uploadedMedia.url}
            initialMediaType={uploadedMedia.type}
            onPublishState={handlePublishProState}
            onPublishFlyer={() => {}} // Dummy prop satisfy TS signature
            onGoToFeed={() => {
              setIsEditingProState(false);
              // Bring back choice modal or cancel cleanly
              setShowPublishDecisionModal(true);
            }}
          />
        </div>
      )}

    </div>
  );
}

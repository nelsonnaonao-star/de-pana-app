import React, { useState, useEffect } from "react";
import { 
  Plus, Play, Camera, ChevronLeft, Send, X, Flame, Sparkles, 
  Smile, Layout, Check, Heart, MessageCircle, Clock, Eye, Trash2,
  Video, Upload, Award, Info
} from "lucide-react";
import { Chat, Message } from "../types";
import MediaEditor from "./MediaEditor";
import { useSupabase } from "../contexts/SupabaseContext";
import toast from "react-hot-toast";
import { getAllStories, createStory, deleteStory, registerStoryView, getStoryViewers, toggleStoryReaction } from "../services/contentService";

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


export default function StatesPanel({ onStartChat }: StatesPanelProps) {
  const { user, profile, contacts } = useSupabase();

  // Load stories from API on mount (contacts + own, last 24h)
  useEffect(() => {
    if (!user?.id) return;

    getAllStories().then(apiStories => {
      if (!apiStories || apiStories.length === 0) {
        setUserStates([]);
        setMyStories([]);
        return;
      }

      const myList: Story[] = [];
      const grouped: Record<string, any> = {};

      for (const s of apiStories) {
        if (s.user_id === user.id) {
          myList.push({
            id: s.id,
            type: s.type,
            content: s.content,
            caption: s.caption || undefined,
            background: s.background || undefined,
            time: s.created_at ? new Date(s.created_at).toLocaleString() : '',
          });
        } else {
          if (!grouped[s.user_id]) {
            grouped[s.user_id] = {
              id: s.user_id + '_state',
              userName: s.profiles?.name || 'Usuario',
              userAvatar: s.profiles?.avatar_url || '',
              hasUnseen: true,
              stories: [],
            };
          }
          grouped[s.user_id].stories.push({
            id: s.id,
            type: s.type,
            content: s.content,
            caption: s.caption || undefined,
            background: s.background || undefined,
            time: s.created_at ? new Date(s.created_at).toLocaleString() : '',
          });
        }
      }

      setMyStories(myList);
      setUserStates(Object.values(grouped));
    }).catch(() => {});
  }, [user?.id]);

  const [userStates, setUserStates] = useState<UserState[]>([]);

  const [myStories, setMyStories] = useState<Story[]>([]);

  // Screen state inside States: "list" (Ver estados), "create_text" (Crear estado texto), "create_image" (Crear estado imagen)
  const [subView, setSubView] = useState<"list" | "create_text" | "create_image">("list");

  // Upload and Pro Editor states
  const [uploadedMedia, setUploadedMedia] = useState<{ url: string; type: "image" | "video"; name: string } | null>(null);
  const [showPublishDecisionModal, setShowPublishDecisionModal] = useState<boolean>(false);
  const [isEditingProState, setIsEditingProState] = useState<boolean>(false);
  const [publishStep, setPublishStep] = useState<"choice" | "comment">("choice");
  const [publishComment, setPublishComment] = useState<string>("");

  // State of Active Story Viewer
  const [activeUserStates, setActiveUserStates] = useState<UserState | null>(null);
  const [activeStoryIdx, setActiveStoryIdx] = useState<number>(0);
  const [storyProgress, setStoryProgress] = useState<number>(0);
  const [storyReplyText, setStoryReplyText] = useState<string>("");

  const [isImageLoaded, setIsImageLoaded] = useState(false);

  // Viewers data for my stories
  const [viewersData, setViewersData] = useState<{ viewers: Array<{ viewer_id: string; name: string; avatar: string; viewed_at: string; reactions: string[] }>; total: number } | null>(null);
  const [showViewersSheet, setShowViewersSheet] = useState(false);
  const [myCurrentReaction, setMyCurrentReaction] = useState<string | null>(null);

  // Editor states (Text creator)
  const [newTextContent, setNewTextContent] = useState<string>("");
  const [selectedGradientIdx, setSelectedGradientIdx] = useState<number>(0);

  // Editor states (Image creator)
  const [newImageCaption, setNewImageCaption] = useState<string>("");
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>("");

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

  // Register view + load reactions when story opens, and load viewers for owner stories
  useEffect(() => {
    if (!activeUserStates || activeUserStates.stories.length === 0) return;
    const currentStory = activeUserStates.stories[activeStoryIdx];
    setIsImageLoaded(false);
    if (activeUserStates.isMe) {
      getStoryViewers(currentStory.id).then(setViewersData).catch(() => {});
    } else {
      registerStoryView(currentStory.id).catch(() => {});
    }
    setMyCurrentReaction(null);

    // Prefetch next story image
    const nextIdx = activeStoryIdx + 1;
    if (nextIdx < activeUserStates.stories.length) {
      const nextStory = activeUserStates.stories[nextIdx];
      if (nextStory.type === "image" || nextStory.type === "video") {
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = nextStory.content;
        link.as = nextStory.type === "video" ? "video" : "image";
        document.head.appendChild(link);
        setTimeout(() => document.head.removeChild(link), 5000);
      }
    }
  }, [activeUserStates?.id, activeStoryIdx]);

  // Open story viewer
  const handleOpenStoryViewer = (userState: UserState) => {
    if (!userState.stories || userState.stories.length === 0) return;
    setActiveUserStates(userState);
    setActiveStoryIdx(0);
    setStoryProgress(0);
    setMyCurrentReaction(null);
    setViewersData(null);
    setShowViewersSheet(false);

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
        setSelectedImageUrl(event.target.result as string);
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
    setPublishStep("comment");
    setPublishComment("");
  };

  const handlePublishNow = () => {
    if (!uploadedMedia) return;

    const newStory: Story = {
      id: "my_upload_" + Date.now(),
      type: uploadedMedia.type,
      content: uploadedMedia.url,
      caption: publishComment.trim() || `Publicado original: ${uploadedMedia.name}`,
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setUploadedMedia(null);
    setShowPublishDecisionModal(false);
    setPublishStep("choice");
    setPublishComment("");
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
    userAvatar: profile?.avatar || profile?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80",
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
        {/* Hidden native file input for states (always in DOM) */}
        <input
          id="state-media-upload-input"
          type="file"
          accept="image/*,video/*"
          onChange={handleFileUploaded}
          className="hidden"
        />

        {/* ======================================= */}
        {/* SUBVIEW 1: LIST OF STATES AND STORY ACTIONS */}
        {/* ======================================= */}
        {subView === "list" && (
          <div className="space-y-4 animate-fade-in">

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
                onClick={() => {
                  const el = document.getElementById("state-media-upload-input");
                  if (el) el.click();
                }}
                className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-[#0a4d52] font-extrabold text-[9px] rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
              >
                <Upload className="w-4 h-4 text-indigo-600" />
                Cargar Foto
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

            {/* HORIZONTAL STORIES CAROUSEL */}
            <div className="flex overflow-x-auto items-start gap-4 py-3 px-1 scrollbar-none">
              {/* My State (always first) */}
              <div
                onClick={() => handleOpenStoryViewer(myUserStateRepresentation)}
                className="flex flex-col items-center gap-1 min-w-[70px] cursor-pointer"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-full ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-50 object-cover overflow-hidden">
                    {myStories.length > 0 ? (
                      <img
                        src={myUserStateRepresentation.userAvatar}
                        alt="Mi estado"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                        <Plus className="w-5 h-5 text-slate-500" />
                      </div>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-medium text-gray-700 text-center truncate w-full">
                  Mi estado
                </span>
              </div>

              {/* Contact stories */}
              {userStates.map((userState) => (
                <div
                  key={userState.id}
                  onClick={() => handleOpenStoryViewer(userState)}
                  className="flex flex-col items-center gap-1 min-w-[70px] cursor-pointer"
                >
                  <div className="relative">
                    <img
                      src={userState.userAvatar}
                      alt={userState.userName}
                      className={`w-16 h-16 rounded-full object-cover ${
                        userState.hasUnseen
                          ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-50"
                          : "ring-1 ring-slate-300 ring-offset-1 ring-offset-slate-50"
                      }`}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-gray-700 text-center truncate w-full">
                    {userState.userName}
                  </span>
                </div>
              ))}
            </div>

            {/* Hint Box */}
            <div className="bg-teal-50/50 rounded-xl p-3 border border-teal-100 flex gap-2 items-start">
              <Info className="w-4 h-4 text-[#10646a] shrink-0 mt-0.5" />
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

            {/* Image selection area: upload prompt or preview */}
            {!selectedImageUrl ? (
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById("state-media-upload-input");
                  if (el) el.click();
                }}
                className="w-full aspect-[9/16] max-h-[300px] flex flex-col items-center justify-center gap-3 bg-white hover:bg-slate-50 rounded-2xl transition-all cursor-pointer border-2 border-dashed border-slate-300 hover:border-teal-400"
              >
                <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-teal-500" />
                </div>
                <span className="text-[11px] font-bold text-slate-500">Subir foto o video</span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <div className="aspect-[9/16] max-h-[300px] w-full rounded-2xl overflow-hidden shadow-lg border border-slate-100 bg-black">
                    {selectedImageUrl && (
                      <img
                        src={selectedImageUrl}
                        alt="Vista previa"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none"></div>
                    <div className="absolute top-3 left-3">
                      <span className="text-[7px] font-bold tracking-widest uppercase bg-black/50 backdrop-blur-sm border border-white/15 px-2 py-1 rounded-full text-white/80">
                        Vista Previa
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedImageUrl(""); setNewImageCaption(""); }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center shadow-md transition-all cursor-pointer z-10"
                    title="Quitar foto"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="Escribe una leyenda..."
                    value={newImageCaption}
                    onChange={(e) => setNewImageCaption(e.target.value)}
                    maxLength={70}
                    className="w-full bg-gray-100 text-slate-800 text-[11px] font-medium px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 placeholder-slate-400"
                  />
                  <div className="text-[7px] text-right text-slate-400 font-mono">
                    {newImageCaption.length} / 70
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <button
              onClick={handlePublishImage}
              disabled={!selectedImageUrl}
              className={`w-full font-bold text-[10px] py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer ${
                selectedImageUrl
                  ? "bg-teal-400 hover:bg-teal-500 text-white"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
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
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col text-white animate-fade-in">
          
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
          <div className="flex-1 relative flex items-center justify-center w-full h-full overflow-hidden select-none">
            
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
                {!isImageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center z-20">
                    <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <img
                  src={activeUserStates.stories[activeStoryIdx].content}
                  alt="Story Content"
                  onLoad={() => setIsImageLoaded(true)}
                  className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
                    isImageLoaded ? "opacity-100" : "opacity-0"
                  }`}
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

          {/* BOTTOM BAR: PRIVATE REPLY + REACTIONS (non-owner) or VIEWS COUNT (owner) */}
          {!activeUserStates.isMe ? (
            <div className="p-3 bg-black/85 border-t border-white/10 z-20 flex flex-col gap-2">
              {/* Reaction row */}
              <div className="flex items-center justify-center gap-2">
                {["❤️", "😂", "😮", "🔥", "👍"].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => {
                      toggleStoryReaction(activeUserStates.stories[activeStoryIdx].id, emoji).then((res) => {
                        if (res.reacted) {
                          setMyCurrentReaction(emoji);
                          toast.success(`Reaccionaste ${emoji}`, { duration: 1500, position: "top-center" });
                        } else {
                          setMyCurrentReaction(null);
                          toast("Reacción eliminada", { duration: 1000, position: "top-center" });
                        }
                      }).catch(() => {});
                    }}
                    className={`text-lg w-8 h-8 flex items-center justify-center rounded-full transition-all cursor-pointer ${
                      myCurrentReaction === emoji ? "bg-teal-500/30 scale-110 ring-1 ring-teal-400" : "hover:bg-white/10"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {/* Reply form */}
              <form onSubmit={handleSendReply} className="flex gap-2 items-center">
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
            </div>
          ) : (
            /* Views Count indicator on ME states - clickable to open viewers sheet */
            <div
              onClick={() => setShowViewersSheet(true)}
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
      )}

      {/* ========================================================= */}
      {/* VIEWERS BOTTOM SHEET (for OWNER stories)                */}
      {/* ========================================================= */}
      {showViewersSheet && viewersData && (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex flex-col justify-end animate-fade-in" onClick={() => setShowViewersSheet(false)}>
          <div
            className="bg-slate-900 border-t border-slate-700/50 rounded-t-2xl max-h-[70%] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 shrink-0">
              <h3 className="text-white text-xs font-black tracking-tight">
                Visualizaciones ({viewersData.total})
              </h3>
              <button
                onClick={() => setShowViewersSheet(false)}
                className="p-1 rounded-full hover:bg-slate-800 text-slate-400 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {viewersData.viewers.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-[10px] font-mono">
                  Nadie ha visto este estado aún
                </div>
              ) : (
                <div className="divide-y divide-slate-800/50">
                  {viewersData.viewers.map(v => (
                    <div key={v.viewer_id} className="flex items-center gap-3 px-4 py-2.5">
                      <img
                        src={v.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80"}
                        alt={v.name}
                        className="w-7 h-7 rounded-full object-cover border border-slate-700"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-[10px] font-bold leading-tight truncate">
                          {v.name}
                        </p>
                        <p className="text-[7.5px] text-slate-500 font-mono mt-0.5">
                          {new Date(v.viewed_at).toLocaleString()}
                        </p>
                      </div>
                      {v.reactions.length > 0 && (
                        <div className="flex gap-0.5 shrink-0">
                          {v.reactions.map((r, i) => (
                            <span key={i} className="text-sm">{r}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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

            {publishStep === "choice" ? (
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
            ) : null}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 6. FULL-SCREEN COMMENT STEP (Instagram/WhatsApp style)    */}
      {/* ========================================================= */}
      {showPublishDecisionModal && uploadedMedia && publishStep === "comment" && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
          {/* Close button top-left */}
          <button
            onClick={() => setPublishStep("choice")}
            className="absolute top-4 left-4 z-10 text-white/80 hover:text-white p-2 cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Full-screen media */}
          <div className="flex-1 flex items-center justify-center min-h-0">
            {uploadedMedia.type === "video" ? (
              <video
                src={uploadedMedia.url}
                muted
                playsInline
                loop
                autoPlay
                className="w-full h-full object-contain"
              />
            ) : (
              <img
                src={uploadedMedia.url}
                alt="Preview"
                className="w-full h-full object-contain"
              />
            )}
          </div>

          {/* Bottom bar */}
          <div className="w-full p-4 bg-black/50 backdrop-blur-md flex items-center gap-3">
            <input
              type="text"
              placeholder="Añade un comentario..."
              value={publishComment}
              onChange={(e) => setPublishComment(e.target.value)}
              className="flex-1 bg-gray-800 text-white text-sm rounded-full px-5 py-3 outline-none placeholder-gray-400 border border-white/10 focus:border-teal-400 transition-colors"
            />
            <button
              onClick={handlePublishNow}
              className="w-11 h-11 bg-teal-500 hover:bg-teal-400 text-white rounded-full flex items-center justify-center shrink-0 transition-all shadow-lg cursor-pointer"
            >
              <Send className="w-5 h-5" />
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

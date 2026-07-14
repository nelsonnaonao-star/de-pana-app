import React, { useState, useEffect } from "react";
import { 
  Plus, Users, Bell, BellOff, ArrowLeft, Send, Sparkles, Check,
  Heart, ThumbsUp, Flame
} from "lucide-react";
import { getChannels, subscribeToChannel, unsubscribeFromChannel, createChannelUpdate, reactToChannelUpdate, createChannel } from "../services/contentService";
import { useSupabase } from "../contexts/SupabaseContext";

export interface ChannelUpdate {
  id: string;
  text: string;
  time: string;
  reactions: {
    like: number;
    fire: number;
    heart: number;
  };
  myReaction?: "like" | "fire" | "heart";
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  avatar: string;
  followers: number;
  admin_id: string;
  isJoined: boolean;
  isMuted: boolean;
  isCreatedByMe?: boolean;
  updates: ChannelUpdate[];
}

// Preset avatars for channels creation
const CHANNEL_AVATARS = [
  "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?auto=format&fit=crop&w=120&q=80", // Tech
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=120&q=80", // Food
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=120&q=80", // Nature
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=120&q=80"  // Shoes
];

export default function ChannelsPanel() {
  const { user } = useSupabase();

  // Load channels from API on mount
  useEffect(() => {
    getChannels().then(apiChannels => {
      if (!apiChannels || apiChannels.length === 0) return;
      const mapped: Channel[] = apiChannels.map((c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
        avatar: c.avatar || '',
        followers: c.followers || 0,
        admin_id: c.admin_id || '',
        isJoined: false,
        isMuted: false,
        isCreatedByMe: c.admin_id === user?.id,
        updates: [],
      }));
      setChannels(mapped);
    }).catch(() => {});
  }, [user?.id]);

  const [channels, setChannels] = useState<Channel[]>([]);

  // Screen state within Channels: "list" (Explorar canales), "detail" (Canal seleccionado), "create" (Crear canal)
  const [currentView, setCurrentView] = useState<"list" | "detail" | "create">("list");

  // Selected channel detail
  const [selectedChannelId, setSelectedChannelId] = useState<string>("chan_official");

  // Create Channel form states
  const [newChanName, setNewChanName] = useState("");
  const [newChanDesc, setNewChanDesc] = useState("");
  const [selectedAvatarIdx, setSelectedAvatarIdx] = useState(0);

  // New post within my own Channel form
  const [newUpdateText, setNewUpdateText] = useState("");

  const activeChannel = channels.find(c => c.id === selectedChannelId) || channels[0];

  // Join/Leave Channel toggle
  const handleToggleJoin = (channelId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!user) return;
    setChannels(prev => prev.map(c => {
      if (c.id === channelId) {
        const joined = !c.isJoined;
        if (joined) {
          subscribeToChannel(channelId, user.id).catch(() => {});
        } else {
          unsubscribeFromChannel(channelId, user.id).catch(() => {});
        }
        return {
          ...c,
          isJoined: joined,
          followers: joined ? c.followers + 1 : c.followers - 1
        };
      }
      return c;
    }));
  };

  // Mute/Unmute Channel toggle
  const handleToggleMute = (channelId: string) => {
    setChannels(prev => prev.map(c => {
      if (c.id === channelId) {
        return { ...c, isMuted: !c.isMuted };
      }
      return c;
    }));
  };

  // React to a post update
  const handleReactToUpdate = (channelId: string, updateId: string, reactionType: "like" | "fire" | "heart") => {
    if (!user) return;
    setChannels(prev => prev.map(c => {
      if (c.id === channelId) {
        const updatedUpdates = c.updates.map(up => {
          if (up.id === updateId) {
            const isSelf = up.myReaction === reactionType;
            const prevReaction = up.myReaction;

            let reactionCounts = { ...up.reactions };

            if (prevReaction) {
              reactionCounts[prevReaction] = Math.max(0, reactionCounts[prevReaction] - 1);
            }

            if (!isSelf) {
              reactionCounts[reactionType] += 1;
            }

            reactToChannelUpdate(updateId, user.id, isSelf ? prevReaction : reactionType).catch(() => {});

            return {
              ...up,
              reactions: reactionCounts,
              myReaction: isSelf ? undefined : reactionType
            };
          }
          return up;
        });
        return { ...c, updates: updatedUpdates };
      }
      return c;
    }));
  };

  // Submit and Create Channel
  const handleCreateChannelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChanName.trim() || !newChanDesc.trim()) return;

    const welcomeText = `🎉 ¡Bienvenidos al canal oficial de ${newChanName}! Aquí compartiremos todas nuestras ofertas, novedades y promociones exclusivas. ¡No olvides reaccionar a nuestras publicaciones!`;

    const newChan: Channel = {
      id: "chan_custom_" + Date.now(),
      name: newChanName,
      description: newChanDesc,
      avatar: CHANNEL_AVATARS[selectedAvatarIdx],
      followers: 1,
      admin_id: user?.id || "",
      isJoined: true,
      isMuted: false,
      isCreatedByMe: true,
      updates: [
        {
          id: "up_init_" + Date.now(),
          text: welcomeText,
          time: "Ahora mismo",
          reactions: { like: 1, fire: 1, heart: 1 }
        }
      ]
    };

    setChannels(prev => [newChan, ...prev]);
    setSelectedChannelId(newChan.id);
    setNewChanName("");
    setNewChanDesc("");
    setCurrentView("detail");

    // Persist to API
    if (user) {
      createChannel({
        name: newChanName,
        description: newChanDesc,
        avatar: CHANNEL_AVATARS[selectedAvatarIdx],
        created_by: user.id,
      }).then(created => {
        if (created?.id) {
          createChannelUpdate({ channel_id: created.id, text: welcomeText }).catch(() => {});
        }
      }).catch(() => {});
    }
  };

  // Owner publishes an update in their channel
  const handlePublishUpdateInChannel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUpdateText.trim()) return;

    const newUp: ChannelUpdate = {
      id: "up_custom_post_" + Date.now(),
      text: newUpdateText,
      time: "Ahora mismo",
      reactions: { like: 0, fire: 0, heart: 0 }
    };

    setChannels(prev => prev.map(c => {
      if (c.id === selectedChannelId) {
        return {
          ...c,
          updates: [newUp, ...c.updates]
        };
      }
      return c;
    }));

    setNewUpdateText("");

    createChannelUpdate({ channel_id: selectedChannelId, text: newUpdateText }).catch(() => {});
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-none">
      
      {/* 1. TOP HEADER SUB-BAR */}
      <div className="bg-[#0a4d52] text-white px-3 py-3 shrink-0 flex flex-col gap-1.5 relative z-10 shadow-sm text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-teal-300 animate-pulse" />
            <h3 className="text-xs font-black tracking-tight">Canales Informativos</h3>
          </div>
          <span className="text-[8px] bg-teal-400 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Unidireccional
          </span>
        </div>
      </div>

      {/* 2. BODY CONTENT (CONDITIONAL ACCORDING TO VIEW) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 relative">
        
        {/* ======================================= */}
        {/* VIEW 1: EXPLORAR LIST OF CANALES */}
        {/* ======================================= */}
        {currentView === "list" && (
          <div className="space-y-4 animate-fade-in text-left">
            
            {/* Create Channel banner prompt */}
            <div className="bg-gradient-to-r from-teal-900 to-[#10646a] rounded-2xl p-3.5 text-white shadow-md flex items-center justify-between">
              <div className="space-y-1 max-w-[160px]">
                <h4 className="text-[11px] font-black flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> Crea Tu Propio Canal
                </h4>
                <p className="text-[8.5px] text-teal-100/90 leading-relaxed font-medium">
                  Difunde las novedades de tu marca con miles de seguidores en Red On de forma ilimitada.
                </p>
              </div>
              <button
                onClick={() => setCurrentView("create")}
                className="bg-teal-400 hover:bg-teal-500 text-white font-black text-[9px] px-3.5 py-2.5 rounded-xl transition-all shadow cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" /> Crear
              </button>
            </div>

            {/* List of active channels */}
            <div className="space-y-2.5">
              <h5 className="text-[9px] font-black uppercase text-slate-400 tracking-wider px-1">
                Canales Destacados para Seguir
              </h5>

              {channels.map((chan) => (
                <div
                  key={chan.id}
                  onClick={() => {
                    setSelectedChannelId(chan.id);
                    setCurrentView("detail");
                  }}
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 flex items-center justify-between hover:shadow hover:border-slate-200 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 truncate pr-2">
                    <img
                      src={chan.avatar}
                      alt={chan.name}
                      className="w-10 h-10 rounded-2xl object-cover border border-slate-100 shrink-0"
                    />

                    <div className="truncate text-left">
                      <h4 className="text-[10.5px] font-bold text-slate-800 leading-tight">
                        {chan.name}
                      </h4>
                      <p className="text-[8.5px] text-slate-400 truncate mt-0.5 font-medium leading-none">
                        {chan.followers.toLocaleString()} seguidores
                      </p>
                      <p className="text-[8px] text-slate-500 line-clamp-1 mt-1 leading-tight italic">
                        {chan.description}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleToggleJoin(chan.id, e)}
                    className={`text-[8.5px] font-extrabold px-3 py-1.5 rounded-lg shrink-0 transition-all cursor-pointer ${
                      chan.isJoined
                        ? "bg-slate-100 text-slate-400 border border-slate-200/50"
                        : "bg-[#0a4d52] hover:bg-[#10646a] text-white shadow-sm"
                    }`}
                  >
                    {chan.isJoined ? "Siguiendo" : "Seguir"}
                  </button>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ======================================= */}
        {/* VIEW 2: CHANNEL CHAT FEED DETAILS */}
        {/* ======================================= */}
        {currentView === "detail" && (
          <div className="flex flex-col h-full animate-fade-in text-left">
            
            {/* Top header detail banner with back button */}
            <div className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm flex items-center justify-between shrink-0 mb-3.5">
              <div className="flex items-center gap-2.5 truncate">
                <button
                  onClick={() => setCurrentView("list")}
                  className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <img
                  src={activeChannel.avatar}
                  alt={activeChannel.name}
                  className="w-8 h-8 rounded-xl object-cover border border-slate-100"
                />

                <div className="truncate">
                  <h4 className="text-[10px] font-black text-slate-800 leading-none">
                    {activeChannel.name}
                  </h4>
                  <span className="text-[7.5px] text-slate-400 font-mono mt-0.5 block leading-none">
                    {activeChannel.followers.toLocaleString()} seguidores
                  </span>
                </div>
              </div>

              {/* Follow, Unfollow & Notifications Toggler */}
              <div className="flex items-center gap-1.5">
                {activeChannel.isJoined && (
                  <button
                    onClick={() => handleToggleMute(activeChannel.id)}
                    className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 transition-all cursor-pointer"
                    title={activeChannel.isMuted ? "Activar Notificaciones" : "Silenciar Canal"}
                  >
                    {activeChannel.isMuted ? (
                      <BellOff className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                    ) : (
                      <Bell className="w-3.5 h-3.5 text-teal-600" />
                    )}
                  </button>
                )}

                <button
                  onClick={() => handleToggleJoin(activeChannel.id)}
                  className={`text-[8px] font-black px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                    activeChannel.isJoined
                      ? "bg-slate-100 text-slate-400 border border-slate-200/50"
                      : "bg-teal-400 text-white shadow-sm"
                  }`}
                >
                  {activeChannel.isJoined ? "Siguiendo" : "Seguir"}
                </button>
              </div>
            </div>

            {/* CHANNEL FEED AREA (THE CHAT BALLOONS) */}
            <div className="flex-1 space-y-3.5 overflow-y-auto pr-1 pb-16">
              
              {/* Channel Bio container */}
              <div className="bg-slate-100/50 border border-slate-200/40 p-3 rounded-2xl text-center space-y-1 max-w-[240px] mx-auto">
                <p className="text-[8.5px] text-slate-500 leading-relaxed italic">
                  "{activeChannel.description}"
                </p>
                <div className="text-[7px] text-slate-400 font-mono">
                  Creado: {activeChannel.isCreatedByMe ? "Por Ti (Emprendedor)" : "Oficial Red On"}
                </div>
              </div>

              {/* Feed posts list */}
              {activeChannel.updates.map((up) => {
                const hasReactedLike = up.myReaction === "like";
                const hasReactedFire = up.myReaction === "fire";
                const hasReactedHeart = up.myReaction === "heart";

                return (
                  <div
                    key={up.id}
                    className="bg-white border border-slate-100 shadow-sm rounded-2xl p-3 space-y-3 relative hover:shadow transition-all"
                  >
                    {/* Timestamp & Info */}
                    <div className="flex items-center justify-between border-b border-slate-50 pb-1.5">
                      <span className="text-[8px] bg-slate-50 text-slate-400 font-mono font-bold px-2 py-0.5 rounded-full uppercase">
                        ACTUALIZACIÓN
                      </span>
                      <span className="text-[7.5px] text-slate-400 font-mono">
                        {up.time}
                      </span>
                    </div>

                    {/* Rich text post content */}
                    <p className="text-[9.5px] text-slate-700 leading-relaxed whitespace-pre-line font-medium">
                      {up.text}
                    </p>

                    {/* Interactive reactions container */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        onClick={() => handleReactToUpdate(activeChannel.id, up.id, "like")}
                        className={`px-2 py-1 rounded-lg text-[9px] font-bold font-mono transition-all flex items-center gap-1 cursor-pointer border ${
                          hasReactedLike 
                            ? "bg-teal-50 border-teal-400 text-teal-600 scale-105" 
                            : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" /> {up.reactions.like}
                      </button>

                      <button
                        onClick={() => handleReactToUpdate(activeChannel.id, up.id, "fire")}
                        className={`px-2 py-1 rounded-lg text-[9px] font-bold font-mono transition-all flex items-center gap-1 cursor-pointer border ${
                          hasReactedFire 
                            ? "bg-rose-50 border-rose-400 text-rose-600 scale-105" 
                            : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        <Flame className="w-3 h-3 text-orange-500" /> {up.reactions.fire}
                      </button>

                      <button
                        onClick={() => handleReactToUpdate(activeChannel.id, up.id, "heart")}
                        className={`px-2 py-1 rounded-lg text-[9px] font-bold font-mono transition-all flex items-center gap-1 cursor-pointer border ${
                          hasReactedHeart 
                            ? "bg-pink-50 border-pink-400 text-pink-600 scale-105" 
                            : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        <Heart className="w-3 h-3 text-rose-500" /> {up.reactions.heart}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* IF CREATOR: SHOW PUBLISH FORM OVERLAY AT BOTTOM */}
            {activeChannel.isCreatedByMe && (
              <form 
                onSubmit={handlePublishUpdateInChannel}
                className="absolute bottom-2 inset-x-2 bg-white rounded-2xl border border-slate-200 shadow-lg p-2.5 flex gap-2 items-center"
              >
                <input
                  type="text"
                  required
                  placeholder="Publica un nuevo mensaje en tu canal..."
                  value={newUpdateText}
                  onChange={(e) => setNewUpdateText(e.target.value)}
                  className="flex-1 bg-slate-50 border text-[9.5px] px-3.5 py-2.5 rounded-xl outline-none focus:border-teal-400 focus:bg-white"
                />
                <button
                  type="submit"
                  className="w-9 h-9 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            )}

          </div>
        )}

        {/* ======================================= */}
        {/* VIEW 3: CREATE NEW CHANNEL FORM */}
        {/* ======================================= */}
        {currentView === "create" && (
          <form onSubmit={handleCreateChannelSubmit} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4 text-left animate-fade-in">
            <div className="flex items-center justify-between border-b pb-2">
              <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500 animate-spin" /> Configurar Nuevo Canal
              </h4>
              <button
                type="button"
                onClick={() => setCurrentView("list")}
                className="text-[9px] font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Channel Title */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                  Nombre del Canal
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Emprendimientos CCS"
                  value={newChanName}
                  onChange={(e) => setNewChanName(e.target.value)}
                  className="w-full bg-slate-50 border text-[10px] px-3 py-2.5 rounded-xl outline-none focus:border-teal-400 focus:bg-white font-semibold"
                />
              </div>

              {/* Channel Description */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                  Descripción del Canal
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Ej: Descuentos, promociones e información de comercio local..."
                  value={newChanDesc}
                  onChange={(e) => setNewChanDesc(e.target.value)}
                  className="w-full bg-slate-50 border text-[10px] px-3 py-2 rounded-xl outline-none focus:border-teal-400 focus:bg-white"
                />
              </div>

              {/* Select Channel Avatar from preset options */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">
                  Selecciona el Icono del Canal
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {CHANNEL_AVATARS.map((avatarUrl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedAvatarIdx(idx)}
                      className={`aspect-square rounded-xl overflow-hidden border-2 relative hover:scale-105 transition-all cursor-pointer ${
                        selectedAvatarIdx === idx ? "border-teal-400" : "border-transparent opacity-75"
                      }`}
                    >
                      <img src={avatarUrl} alt="Option" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <button
              type="submit"
              className="w-full bg-[#0a4d52] hover:bg-[#10646a] text-white font-bold text-[10px] py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md mt-4 cursor-pointer"
            >
              <Check className="w-4 h-4 text-emerald-400" /> Crear y Publicar Canal
            </button>
          </form>
        )}

      </div>
    </div>
  );
}

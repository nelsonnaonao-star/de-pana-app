import React, { useState, useRef, useEffect } from "react";
import { 
  ArrowLeft, Phone, Video, Send, Smile, Paperclip, 
  Mic, Play, Pause, FileUp, Music, Image, VideoIcon, 
  BarChart2, X, Check, Volume2, HelpCircle, Palette,
  Film, MoreVertical 
} from "lucide-react";
import { Chat, Message } from "../types";
import GifPicker from "./GifPicker";
import { useSupabase } from "../contexts/SupabaseContext";
import { getMessages, sendMessage as apiSendMessage, markAsRead, deleteMessage as apiDeleteMessage } from "../services/messages";
import { supabase } from "../lib/supabase";

// 20 customizable background presets for the chat window
const CHAT_BACKGROUNDS = [
  { id: "default", name: "Clásico Red On 📱", value: "#f8fafc" },
  { id: "stars", name: "Noche Estrellada 🌌", value: "url('https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "sand", name: "Arena del Desierto 🏜️", value: "linear-gradient(135deg, #fef3c7, #fde68a)" },
  { id: "bamboo", name: "Bosque de Bambú 🎋", value: "url('https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "sunset", name: "Atardecer Cálido 🌅", value: "linear-gradient(to top, #ff7e5f, #feb47b)" },
  { id: "foggy_forest", name: "Bosque de Niebla 🌲", value: "url('https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "neon", name: "Azul Neón 🌀", value: "linear-gradient(135deg, #0f172a, #1e3a8a, #0369a1)" },
  { id: "pink", name: "Rosa Pastel 🌸", value: "linear-gradient(135deg, #fce7f3, #fbcfe8)" },
  { id: "minimal_white", name: "Minimalista Blanco 🤍", value: "#ffffff" },
  { id: "marble", name: "Mármol Elegante 🪨", value: "url('https://images.unsplash.com/photo-1533090161767-e6ffed986c88?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "rain", name: "Ciudad Lluvia 🌧️", value: "url('https://images.unsplash.com/photo-1428908728789-d2de25dbd4e2?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "dark_simple", name: "Sencillo Oscuro 🖤", value: "#0f172a" },
  { id: "olive", name: "Verde Oliva 🍃", value: "linear-gradient(135deg, #ecfdf5, #d1fae5)" },
  { id: "beach", name: "Playa Caribeña 🏖️", value: "url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "fire", name: "Fuego de Campamento 🔥", value: "linear-gradient(to top, #ed64a6, #f56565, #ed8936)" },
  { id: "nebula", name: "Nebulosa Espacial 🛸", value: "url('https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "lofi", name: "Lofi Room ☕", value: "url('https://images.unsplash.com/photo-1518156677180-95a2893f3e9f?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "gold", name: "Oro Imperial 👑", value: "linear-gradient(135deg, #b45309, #d97706, #f59e0b)" },
  { id: "retro", name: "Papel Retro 📜", value: "url('https://images.unsplash.com/photo-1517816743773-6e0fd518b4a6?auto=format&fit=crop&w=1920&q=90') center/cover no-repeat" },
  { id: "cyber_neon", name: "Cyberpunk 👾", value: "linear-gradient(135deg, #4c1d95, #701a75, #4a044e)" }
];

// Custom bubble color options for the user (me)
const BUBBLE_PRESETS_ME = [
  { id: "teal_dark", name: "Clásico Red On 📱", css: "bg-gradient-to-br from-[#10646a] to-[#0a4d52] text-white rounded-br-none" },
  { id: "blue", name: "Azul Real 💙", css: "bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-br-none" },
  { id: "purple", name: "Púrpura Místico 💜", css: "bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-br-none" },
  { id: "emerald", name: "Verde Esmeralda 💚", css: "bg-gradient-to-br from-emerald-600 to-emerald-800 text-white rounded-br-none" },
  { id: "pink", name: "Rosa Vibrante 💗", css: "bg-gradient-to-br from-pink-500 to-pink-700 text-white rounded-br-none" },
  { id: "orange", name: "Naranja Energía 🧡", css: "bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-br-none" },
  { id: "red", name: "Fuego Carmesí ❤️", css: "bg-gradient-to-br from-red-600 to-red-800 text-white rounded-br-none" },
  { id: "slate", name: "Negro Carbón 🖤", css: "bg-gradient-to-br from-slate-800 to-slate-950 text-white rounded-br-none" },
  { id: "gold", name: "Oro Imperial 👑", css: "bg-gradient-to-br from-amber-500 to-amber-700 text-slate-950 font-semibold rounded-br-none" }
];

// Custom bubble color options for the contact (them)
const BUBBLE_PRESETS_THEM = [
  { id: "white", name: "Blanco Puro 🤍", css: "bg-white text-slate-800 rounded-bl-none border border-slate-100" },
  { id: "slate_light", name: "Gris Moderno 🏐", css: "bg-slate-200 text-slate-900 rounded-bl-none border border-slate-300" },
  { id: "emerald_dark", name: "Verde Esmeralda 💚", css: "bg-emerald-600 text-white rounded-bl-none" },
  { id: "blue_vibrant", name: "Azul Intenso 💙", css: "bg-blue-600 text-white rounded-bl-none" },
  { id: "purple_vibrant", name: "Violeta Eléctrico 💜", css: "bg-purple-600 text-white rounded-bl-none" },
  { id: "rose_vibrant", name: "Rosa Chicle 💗", css: "bg-pink-500 text-white rounded-bl-none" },
  { id: "amber_dark", name: "Oro Imperial 👑", css: "bg-amber-500 text-slate-950 font-semibold rounded-bl-none" },
  { id: "red_vibrant", name: "Rojo Pasión ❤️", css: "bg-red-500 text-white rounded-bl-none" },
  { id: "dark", name: "Oscuro Elegante 🖤", css: "bg-slate-900 text-slate-100 rounded-bl-none border border-slate-800" }
];

interface ChatRoomProps {
  chat: Chat;
  onBack: () => void;
  onSendMessage: (msg: Message) => void;
  onTriggerCall: (type: "audio" | "video") => void;
  currentUserId?: string;
  currentUserName?: string;
}

export default function ChatRoom({ chat, onBack, onSendMessage, onTriggerCall, currentUserId, currentUserName }: ChatRoomProps) {
  const { user, profile } = useSupabase();
  const uid = currentUserId ?? user?.id;
  const uname = currentUserName ?? profile?.name ?? user?.email;

  const [inputText, setInputText] = useState("");
  const [showAttachments, setShowAttachments] = useState(false);
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null); // messageId
  const [recordingType, setRecordingType] = useState<"voice" | "video" | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState<string | null>(null); // messageId
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [messages, setMessages] = useState<Message[]>(chat.messages || []);

  // Fetch real messages from API on mount
  useEffect(() => {
    if (chat.id) {
      getMessages(chat.id).then(apiMessages => {
        if (apiMessages && apiMessages.length > 0) {
          const mapped = apiMessages.map(m => ({
            id: m.id,
            sender: m.sender_id === uid ? ("me" as const) : ("other" as const),
            text: m.text,
            timestamp: m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
            type: (m.type as Message["type"]) || "text",
            mediaUrl: m.image_url || m.sticker_url || m.gif_url || m.audio_url || m.video_url,
            reactions: m.reactions,
          }));
          setMessages(mapped);
        }
      }).catch(() => {});
    }
  }, [chat.id, uid]);

  // Live Chat Style states with localStorage caching
  const [selectedBgId, setSelectedBgId] = useState(() => {
    return localStorage.getItem("chat_bg_id") || "default";
  });
  const [bubbleColorMeId, setBubbleColorMeId] = useState(() => {
    return localStorage.getItem("bubble_color_me") || "teal_dark";
  });
  const [bubbleColorThemId, setBubbleColorThemId] = useState(() => {
    return localStorage.getItem("bubble_color_them") || "white";
  });
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);

  // Synchronize style choices with localStorage
  useEffect(() => {
    localStorage.setItem("chat_bg_id", selectedBgId);
  }, [selectedBgId]);

  useEffect(() => {
    localStorage.setItem("bubble_color_me", bubbleColorMeId);
  }, [bubbleColorMeId]);

  useEffect(() => {
    localStorage.setItem("bubble_color_them", bubbleColorThemId);
  }, [bubbleColorThemId]);

  // Poll Form State
  const [showPollForm, setShowPollForm] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOption1, setPollOption1] = useState("");
  const [pollOption2, setPollOption2] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recordingTimer = useRef<number | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Audio recording timer simulation
  useEffect(() => {
    if (recordingType) {
      setRecordingSeconds(0);
      recordingTimer.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
    }
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, [recordingType]);

  // Supabase Realtime subscription for new messages
  const messagesChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!chat.id || !uid) return;

    const channel = supabase.channel(`messages-${chat.id}`);
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `chat_id=eq.${chat.id}`,
    }, (payload: any) => {
      const newMsg = payload.new;
      if (newMsg.sender_id !== uid) {
        const mapped: Message = {
          id: newMsg.id,
          sender: 'other',
          text: newMsg.text || '',
          timestamp: newMsg.created_at ? new Date(newMsg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : '',
          type: (newMsg.type as Message['type']) || 'text',
          mediaUrl: newMsg.image_url || newMsg.sticker_url || newMsg.gif_url || newMsg.audio_url || newMsg.video_url,
          reactions: newMsg.reactions,
        };
        setMessages(prev => [...prev, mapped]);
        markAsRead(chat.id, uid, uname).catch(() => {});
      }
    });
    channel.subscribe();
    messagesChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      messagesChannelRef.current = null;
    };
  }, [chat.id, uid, uname]);

  // Read receipts on mount and when new messages arrive
  useEffect(() => {
    if (chat.id && uid && uname) {
      markAsRead(chat.id, uid, uname).catch(() => {});
    }
  }, [chat.id, uid, uname]);

  // Supabase Realtime Broadcast for typing indicator
  useEffect(() => {
    const channel = supabase.channel(`presence-${chat.id}`);

    (channel as any).on('broadcast', { event: 'typing' }, (payload: { userId?: string; isTyping?: boolean }) => {
      if (payload.userId && payload.userId !== uid) {
        setPartnerTyping(!!payload.isTyping);
        if (payload.isTyping) {
          setTimeout(() => setPartnerTyping(false), 4000);
        }
      }
    });

    (channel as any).subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, [chat.id, uid]);

  const emitTyping = (isTyping: boolean) => {
    if (!channelRef.current || !uid) return;
    (channelRef.current as any).send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: uid, isTyping },
    });
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const tempId = `temp_${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      text: inputText,
      timestamp,
      type: "text"
    };

    // Optimistic add
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setInputText("");

    // Stop typing indicator
    emitTyping(false);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    try {
      const saved = await apiSendMessage({
        chat_id: chat.id,
        text: inputText,
        type: "text",
        sender_id: uid,
      });
      setMessages(prev => prev.map((m) =>
        m.id === tempId ? { ...m, id: saved.id } : m
      ));
    } catch {
      alert("Error al enviar mensaje");
      setMessages(prev => prev.filter((m) => m.id !== tempId));
    }
  };

  const handleSendSticker = async (url: string, type: "gif" | "sticker") => {
    const tempId = `temp_${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp,
      type: "image",
      mediaUrl: url,
      fileName: type === "gif" ? "GIF.gif" : "Sticker.png"
    };

    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowGifPicker(false);
    setShowAttachments(false);

    try {
      const saved = await apiSendMessage({
        chat_id: chat.id,
        type: "image",
        sender_id: uid,
        sticker_url: type === "sticker" ? url : undefined,
        gif_url: type === "gif" ? url : undefined,
        image_url: url,
      });
      setMessages(prev => prev.map((m) =>
        m.id === tempId ? { ...m, id: saved.id } : m
      ));
    } catch {
      alert("Error al enviar sticker");
      setMessages(prev => prev.filter((m) => m.id !== tempId));
    }
  };

  const handleSendMusic = () => {
    const newMsg: Message = {
      id: "msg_" + Date.now(),
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "audio",
      mediaUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
      fileName: "Golden_Hour_Vibes.mp3",
      fileSize: "5.2 MB",
      duration: "4:01"
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowAttachments(false);
  };

  const handleSendVideo = () => {
    const newMsg: Message = {
      id: "msg_" + Date.now(),
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "video",
      mediaUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      fileName: "RedOn_Demo_Video.mp4",
      fileSize: "12.4 MB"
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowAttachments(false);
  };

  const handleCreatePoll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim()) return;

    const newMsg: Message = {
      id: "msg_" + Date.now(),
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "poll",
      pollQuestion: pollQuestion,
      pollOptions: [
        { id: "o1_" + Date.now(), text: pollOption1, votes: 0, votedUsers: [] },
        { id: "o2_" + Date.now(), text: pollOption2, votes: 0, votedUsers: [] }
      ]
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowPollForm(false);
    setPollQuestion("");
    setPollOption1("");
    setPollOption2("");
    setShowAttachments(false);
  };

  const handleVote = (messageId: string, optionId: string) => {
    setMessages(prev => prev.map((m) => {
      if (m.id === messageId && m.pollOptions) {
        const options = m.pollOptions.map((o) => {
          const alreadyVoted = o.votedUsers.includes("me");
          if (o.id === optionId) {
            return {
              ...o,
              votes: alreadyVoted ? o.votes - 1 : o.votes + 1,
              votedUsers: alreadyVoted ? o.votedUsers.filter((u) => u !== "me") : [...o.votedUsers, "me"]
            };
          } else {
            return {
              ...o,
              votes: o.votedUsers.includes("me") ? o.votes - 1 : o.votes,
              votedUsers: o.votedUsers.filter((u) => u !== "me")
            };
          }
        });
        return { ...m, pollOptions: options };
      }
      return m;
    }));
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    setMessages(prev => prev.map((m) => {
      if (m.id === messageId) {
        const reactions = { ...(m.reactions || {}) };
        reactions[emoji] = (reactions[emoji] || 0) + 1;
        return { ...m, reactions };
      }
      return m;
    }));
    setActiveReactionMenu(null);
  };

  const handleDeleteMessage = async (messageId: string) => {
    setActiveReactionMenu(null);
    setMessages(prev => prev.filter((m) => m.id !== messageId));
    try {
      await apiDeleteMessage(messageId);
    } catch (e) {
      console.error("[CHAT] Delete error:", e);
    }
  };

  const handleFinishVoiceNote = () => {
    if (!recordingType) return;
    const durStr = `${Math.floor(recordingSeconds / 60)}:${(recordingSeconds % 60).toString().padStart(2, "0")}`;
    const newMsg: Message = {
      id: "msg_" + Date.now(),
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: recordingType === "voice" ? "voice_note" : "video_note",
      duration: durStr,
      mediaUrl: recordingType === "voice" ? "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" : undefined
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setRecordingType(null);
  };

  return (
    <div 
      className="flex-1 flex flex-col h-full overflow-hidden relative"
      style={{ 
        background: CHAT_BACKGROUNDS.find(bg => bg.id === selectedBgId)?.value || "#f8fafc",
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      {/* Subtle dark overlay for darker backgrounds to ensure text remains highly readable across the whole chat screen */}
      {selectedBgId !== "default" && selectedBgId !== "minimal_white" && selectedBgId !== "olive" && selectedBgId !== "pink" && (
        <div className="absolute inset-0 bg-black/15 pointer-events-none z-0"></div>
      )}

      {/* HEADER BAR */}
      <div className="relative text-white px-4 pt-5 pb-9 overflow-hidden shrink-0 z-10 bg-[#0a4d52]">
        {/* SVG Waves Background */}
        <svg
          viewBox="0 0 320 120"
          className="absolute inset-0 w-full h-full z-0 pointer-events-none select-none"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chatHeaderGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="50%" stopColor="#197a82" />
              <stop offset="100%" stopColor="#3ab3b8" />
            </linearGradient>
            <linearGradient id="chatHeaderGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0a4c51" />
              <stop offset="50%" stopColor="#10646a" />
              <stop offset="100%" stopColor="#188c94" />
            </linearGradient>
            <linearGradient id="chatHeaderGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#073337" />
              <stop offset="50%" stopColor="#0a4d52" />
              <stop offset="100%" stopColor="#116b72" />
            </linearGradient>
          </defs>
          <path d="M0,0 L0,110 C80,150 200,70 320,120 L320,0 Z" fill="url(#chatHeaderGrad1)" opacity="0.3" />
          <path d="M0,0 L0,100 C100,140 220,80 320,108 L320,0 Z" fill="url(#chatHeaderGrad2)" opacity="0.55" />
          <path d="M0,0 L0,88 C80,122 180,60 320,92 L320,0 Z" fill="url(#chatHeaderGrad3)" />
        </svg>

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
              <ArrowLeft className="w-5 h-5 text-teal-100" />
            </button>
            <div className="relative">
              <img src={chat.avatar} alt={chat.name} className="w-9 h-9 rounded-full object-cover border border-white/20" />
              {chat.status === "online" && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#0a4d52]"></span>
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold leading-tight truncate max-w-[120px]">{chat.name}</h3>
              <span className="text-[10px] text-teal-200 block">
                {partnerTyping ? "Escribiendo..." : chat.status === "online" ? "En línea" : "Desconectado"}
              </span>
            </div>
          </div>

          {/* Call Trigger Buttons */}
          <div className="flex items-center gap-1">
            <button 
              onClick={() => onTriggerCall("audio")}
              className="p-1.5 hover:bg-white/10 rounded-full transition-all text-teal-100 hover:text-white"
              title="Llamada de voz"
            >
              <Phone className="w-4 h-4" />
            </button>
            <button 
              onClick={() => onTriggerCall("video")}
              className="p-1.5 hover:bg-white/10 rounded-full transition-all text-teal-100 hover:text-white"
              title="Video llamada"
            >
              <Video className="w-4 h-4" />
            </button>
            {/* 3 dots menu */}
            <div className="relative">
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className={`p-1.5 rounded-full transition-all cursor-pointer ${
                  showDropdown ? "bg-white/20 text-white" : "text-teal-100 hover:bg-white/10 hover:text-white"
                }`}
                title="Más opciones"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              
              {showDropdown && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowDropdown(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-40 min-w-[170px] animate-fade-in">
                    <button
                      onClick={() => { setShowCustomizer(true); setShowDropdown(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <Palette className="w-3.5 h-3.5 text-teal-600" />
                      Personalizar chat
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CHAT CUSTOMIZER DRAWER */}
      {showCustomizer && (
        <div className="bg-slate-900 border-b border-slate-800 p-3 text-white space-y-3 z-20 shrink-0 max-h-[300px] overflow-y-auto shadow-lg animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-teal-400 flex items-center gap-1">
              <Palette className="w-3.5 h-3.5 text-teal-400 animate-pulse" /> Personalización del Chat
            </span>
            <button 
              onClick={() => setShowCustomizer(false)}
              className="text-slate-400 hover:text-white text-[10px] bg-slate-800 px-2 py-0.5 rounded cursor-pointer font-bold"
            >
              Cerrar
            </button>
          </div>

          {/* Bubble style choices for me & them */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            {/* COLOR ME */}
            <div className="space-y-1.5 text-left">
              <span className="text-[8px] font-extrabold text-teal-300 uppercase block">Mis Burbujas (Para Mí)</span>
              <div className="grid grid-cols-3 gap-1">
                {BUBBLE_PRESETS_ME.map((preset) => {
                  const isSelected = bubbleColorMeId === preset.id;
                  // Get simple color representation from css class
                  const bgVal = preset.id === "teal_dark" ? "#0a4d52" :
                                preset.id === "blue" ? "#2563eb" :
                                preset.id === "purple" ? "#9333ea" :
                                preset.id === "emerald" ? "#059669" :
                                preset.id === "pink" ? "#ec4899" :
                                preset.id === "orange" ? "#f97316" :
                                preset.id === "red" ? "#dc2626" :
                                preset.id === "slate" ? "#1e293b" : "#d97706";
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.name}
                      onClick={() => setBubbleColorMeId(preset.id)}
                      className={`w-full h-7 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                        isSelected ? "border-white scale-110 shadow-md ring-2 ring-teal-500/50" : "border-white/10 hover:border-white/30"
                      }`}
                      style={{ backgroundColor: bgVal }}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[4]" />}
                    </button>
                  );
                })}
              </div>
              <span className="text-[7px] text-slate-400 font-medium block truncate">
                {BUBBLE_PRESETS_ME.find(b => b.id === bubbleColorMeId)?.name}
              </span>
            </div>

            {/* COLOR THEM */}
            <div className="space-y-1.5 text-left">
              <span className="text-[8px] font-extrabold text-teal-300 uppercase block">Burbujas de {chat.name}</span>
              <div className="grid grid-cols-3 gap-1">
                {BUBBLE_PRESETS_THEM.map((preset) => {
                  const isSelected = bubbleColorThemId === preset.id;
                  const bgVal = preset.id === "white" ? "#ffffff" :
                                preset.id === "slate_light" ? "#e2e8f0" :
                                preset.id === "emerald_dark" ? "#059669" :
                                preset.id === "blue_vibrant" ? "#2563eb" :
                                preset.id === "purple_vibrant" ? "#7c3aed" :
                                preset.id === "rose_vibrant" ? "#ec4899" :
                                preset.id === "amber_dark" ? "#d97706" :
                                preset.id === "red_vibrant" ? "#ef4444" : "#0f172a";
                  const tickColor = preset.id === "white" || preset.id === "slate_light" || preset.id === "amber_dark" ? "text-slate-800" : "text-white";
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.name}
                      onClick={() => setBubbleColorThemId(preset.id)}
                      className={`w-full h-7 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                        isSelected ? "border-teal-400 scale-110 shadow-md ring-2 ring-teal-500/50" : "border-white/10 hover:border-white/30"
                      }`}
                      style={{ backgroundColor: bgVal }}
                    >
                      {isSelected && <Check className={`w-3.5 h-3.5 ${tickColor} stroke-[4]`} />}
                    </button>
                  );
                })}
              </div>
              <span className="text-[7px] text-slate-400 font-medium block truncate">
                {BUBBLE_PRESETS_THEM.find(b => b.id === bubbleColorThemId)?.name}
              </span>
            </div>
          </div>

          {/* Background selection - EXACTLY 20 BACKGROUNDS */}
          <div className="space-y-1.5 text-left border-t border-slate-800 pt-2.5">
            <span className="text-[8px] font-extrabold text-teal-300 uppercase block">20 Fondos para el Chat</span>
            <div className="grid grid-cols-5 gap-1.5 max-h-[110px] overflow-y-auto p-0.5">
              {CHAT_BACKGROUNDS.map((bg, idx) => {
                const isSelected = selectedBgId === bg.id;
                const previewStyle = bg.value.includes("url") 
                  ? { background: bg.value, backgroundSize: "cover", backgroundPosition: "center" } 
                  : { background: bg.value };
                return (
                  <button
                    key={bg.id}
                    type="button"
                    title={bg.name}
                    onClick={() => setSelectedBgId(bg.id)}
                    className={`aspect-square rounded-lg border flex flex-col items-center justify-center relative overflow-hidden transition-all cursor-pointer ${
                      isSelected ? "border-white scale-105 shadow-md ring-2 ring-teal-500/50" : "border-white/10 hover:border-white/30"
                    }`}
                    style={previewStyle}
                  >
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[6px] text-white text-center py-0.5 leading-none truncate px-0.5">
                      {idx + 1}. {bg.name.split(" ")[0]}
                    </span>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-[#14b8a6] flex items-center justify-center shadow-lg absolute">
                        <Check className="w-2.5 h-2.5 text-white stroke-[4]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MESSAGES LIST AREA */}
      <div 
        className="flex-1 p-4 overflow-y-auto space-y-3.5 relative transition-all duration-300 bg-transparent"
      >
        <div className="relative z-10 space-y-3.5">
          {messages.map((msg) => {
            const isMe = msg.sender === "me";
            const activeMeBubble = BUBBLE_PRESETS_ME.find(b => b.id === bubbleColorMeId) || BUBBLE_PRESETS_ME[0];
            const activeThemBubble = BUBBLE_PRESETS_THEM.find(b => b.id === bubbleColorThemId) || BUBBLE_PRESETS_THEM[0];

            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} relative group`}>
                
                {/* Message Bubble container */}
                <div 
                  className={`max-w-[85%] rounded-2xl px-3 py-2.5 shadow-sm text-xs relative cursor-pointer select-none transition-all duration-200 ${
                    isMe ? activeMeBubble.css : activeThemBubble.css
                  }`}
                  onClick={() => setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id)}
                >
                {/* Text Messages */}
                {msg.type === "text" && <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>}

                {/* Sticker/Images */}
                {msg.type === "image" && (
                  <div className="space-y-1.5">
                    <img src={msg.mediaUrl} alt="Sticker" className="rounded-xl w-full max-h-40 object-cover border border-slate-100/10" />
                    {msg.fileName && <span className="text-[9px] opacity-75 block font-mono">{msg.fileName}</span>}
                  </div>
                )}

                {/* Video Messages */}
                {msg.type === "video" && (
                  <div className="space-y-1.5 w-44">
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center border border-white/10">
                      <video src={msg.mediaUrl} controls className="w-full h-full object-cover" />
                    </div>
                    <span className="text-[9px] font-mono opacity-85 block truncate">🎬 {msg.fileName} ({msg.fileSize})</span>
                  </div>
                )}

                {/* Audio/Music Messages */}
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

                {/* Voice notes */}
                {msg.type === "voice_note" && (
                  <div className="flex items-center gap-2 w-44">
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

                {/* Video Note (Circular design matching WhatsApp video notes) */}
                {msg.type === "video_note" && (
                  <div className="space-y-1.5 flex flex-col items-center">
                    <div className="w-24 h-24 rounded-full border-4 border-[#14b8a6] overflow-hidden bg-teal-950 flex items-center justify-center relative shadow-inner">
                      <div className="absolute inset-0 bg-gradient-to-tr from-teal-500/20 to-transparent"></div>
                      <VideoIcon className="w-8 h-8 text-white/85 animate-pulse" />
                    </div>
                    <span className="text-[9px] font-bold tracking-tight opacity-90">📹 Nota de Video ({msg.duration || "0:08"})</span>
                  </div>
                )}

                {/* Polls */}
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

                {/* Timestamp & double check */}
                <div className="flex items-center justify-end gap-1 mt-1 text-[8px] opacity-70">
                  <span>{msg.timestamp}</span>
                  {isMe && <span className="text-cyan-300">✓✓</span>}
                </div>
              </div>

              {/* Message Reactions display bar */}
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

              {/* Interactive Popup reaction menu when clicked */}
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
                  {/* Share/Forward Simulation button */}
                  <button 
                    onClick={() => {
                      alert(`¡Mensaje reenviado exitosamente!`);
                      setActiveReactionMenu(null);
                    }}
                    className="text-[9px] font-bold text-teal-600 hover:underline px-1"
                  >
                    Reenviar
                  </button>
                  {/* Delete button (only for own messages) */}
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
        })}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* ATTACHMENT POPUP TRAY */}
      {showAttachments && (
        <div className="absolute bottom-20 left-4 right-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.18)] border border-slate-100 p-4 grid grid-cols-4 gap-3 z-30 animate-fade-in">
          <button 
            onClick={() => { setShowGifPicker(true); setShowAttachments(false); }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform shadow-sm">
              <Film className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">GIF / Sticker</span>
          </button>

          <button 
            onClick={handleSendVideo}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-600 group-hover:scale-110 transition-transform shadow-sm">
              <VideoIcon className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Video</span>
          </button>

          <button 
            onClick={handleSendMusic}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-cyan-50 flex items-center justify-center text-cyan-600 group-hover:scale-110 transition-transform shadow-sm">
              <Music className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Música / Audio</span>
          </button>

          <button 
            onClick={() => {
              setShowPollForm(true);
            }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform shadow-sm">
              <BarChart2 className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Encuesta</span>
          </button>
        </div>
      )}

      {/* POLL FORM SCREEN OVERLAY */}
      {showPollForm && (
        <div className="absolute inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
          <form onSubmit={handleCreatePoll} className="bg-white rounded-2xl p-4 w-full max-w-xs space-y-3 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <BarChart2 className="w-4 h-4 text-emerald-600" /> Nueva Encuesta
              </h3>
              <button type="button" onClick={() => setShowPollForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <input 
                type="text" 
                placeholder="Pregunta de la encuesta" 
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                required
                className="w-full bg-slate-50 p-2 text-[11px] rounded-lg border outline-none focus:border-emerald-500"
              />
              <input 
                type="text" 
                placeholder="Opción 1" 
                value={pollOption1}
                onChange={(e) => setPollOption1(e.target.value)}
                required
                className="w-full bg-slate-50 p-2 text-[10px] rounded-lg border outline-none focus:border-emerald-500"
              />
              <input 
                type="text" 
                placeholder="Opción 2" 
                value={pollOption2}
                onChange={(e) => setPollOption2(e.target.value)}
                required
                className="w-full bg-slate-50 p-2 text-[10px] rounded-lg border outline-none focus:border-emerald-500"
              />
            </div>
            <button 
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition-colors"
            >
              <Check className="w-3.5 h-3.5" /> Enviar Encuesta
            </button>
          </form>
        </div>
      )}

      {/* GIF / STICKER PICKER OVERLAY */}
      {showGifPicker && (
        <GifPicker
          onSelect={(url, type) => handleSendSticker(url, type)}
          onClose={() => setShowGifPicker(false)}
        />
      )}

      {/* FLOATING CHAT INPUT AREA */}
      <div className="px-3 pb-4 pt-2 bg-transparent relative z-10 shrink-0 flex items-center gap-2">
        {recordingType ? (
          // ACTIVE RECORDING MODE
          <div className="flex-1 flex items-center justify-between bg-teal-900/95 backdrop-blur-md px-4 py-2.5 rounded-full border border-teal-800/80 shadow-[0_8px_30px_rgba(0,0,0,0.25)] text-white animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>
              <span className="text-[10px] font-bold tracking-wide">
                {recordingType === "voice" ? "Grabando voz" : "Grabando video circular"} • <span className="text-teal-300 font-mono">{recordingSeconds}s</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setRecordingType(null)}
                className="px-2.5 py-1 text-[10px] font-semibold text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button 
                onClick={handleFinishVoiceNote}
                className="px-3 py-1 text-[10px] font-bold text-teal-950 bg-teal-300 hover:bg-teal-200 rounded-full flex items-center gap-1 transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Check className="w-3 h-3 stroke-[3]" /> Enviar
              </button>
            </div>
          </div>
        ) : (
          // STANDARD INPUT MODE - WHATSAPP/TELEGRAM-LIKE DUAL FLOATING SYSTEM
          <>
            {/* 1. Main Input Pill (Always solid white, no dark style overrides) */}
            <div className="flex-1 bg-white rounded-full px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-100/50 flex items-center gap-2 transition-all duration-300">
              {/* Emoji/Smile button */}
              <button 
                onClick={() => { setShowGifPicker(true); }}
                className="p-1 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer"
                title="GIFs y Stickers"
              >
                <Smile className="w-5 h-5" />
              </button>

              {/* Text Input */}
              <input 
                type="text" 
                placeholder="Escribe un mensaje..."
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  emitTyping(true);
                  if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                  typingTimerRef.current = setTimeout(() => {
                    emitTyping(false);
                  }, 1500);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendText();
                }}
                className="flex-1 bg-transparent text-xs py-1 px-1 outline-none border-none text-slate-800 placeholder-slate-400 font-medium"
              />

              {/* Attachment Clip Button */}
              <button 
                onClick={() => setShowAttachments(!showAttachments)}
                className={`p-1 rounded-full transition-all cursor-pointer ${
                  showAttachments 
                    ? "bg-[#0a4d52] text-white rotate-45 shadow-inner scale-105" 
                    : "text-slate-400 hover:text-[#0a4d52]"
                }`}
                title="Adjuntar multimedia o encuestas"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              {/* Circular Video Note trigger inside pill when text is empty */}
              {!inputText.trim() && (
                <button 
                  onClick={() => setRecordingType("video")}
                  className="p-1 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer"
                  title="Grabar Nota de video circular"
                >
                  <VideoIcon className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* 2. Separate Circular Action Button */}
            {inputText.trim() ? (
              <button 
                onClick={handleSendText}
                className="w-10 h-10 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.2)] active:scale-95 transition-all cursor-pointer shrink-0"
                title="Enviar mensaje"
              >
                <Send className="w-4 h-4 ml-0.5 text-white" />
              </button>
            ) : (
              <button 
                onClick={() => setRecordingType("voice")}
                className="w-10 h-10 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.2)] active:scale-95 transition-all cursor-pointer shrink-0"
                title="Grabar Nota de voz"
              >
                <Mic className="w-4 h-4 text-white" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from "react";
import { App as CapacitorApp } from '@capacitor/app';
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { 
  ArrowLeft, Phone, Video, Send, Smile, Paperclip, 
  Mic, Music, VideoIcon, 
  BarChart2, X, Check, Palette,
  Film, MoreVertical, Camera as CameraIcon, Image, File, Search, ChevronUp, ChevronDown, MapPin
} from "lucide-react";
import { Chat, Message } from "../types";
import GifPicker from "./GifPicker";
import MessageBubble from "./chat/MessageBubble";
import ChatCustomizer from "./chat/ChatCustomizer";
import ChatPatternBackground from "./chat/ChatPatternBackground";
import { useSupabase } from "../contexts/SupabaseContext";
import { getMessages, sendMessage as apiSendMessage, markAsRead, deleteMessage as apiDeleteMessage, editMessage as apiEditMessage, clearForMe } from "../services/messages";
import { deleteChat as apiDeleteChat } from "../services/chats";
import { supabase } from "../lib/supabase";
import { uploadChatMedia } from "../services/storage";
import { CHAT_BACKGROUNDS } from "./chat/chatConstants";
import { useOfflineQueue } from "../hooks/useOfflineQueue";

interface ChatRoomProps {
  chat: Chat;
  onBack: () => void;
  onSendMessage: (msg: Message) => void;
  onTriggerCall: (type: "audio" | "video") => void;
  onForwardMessage?: (msg: Message) => void;
  onChatDeleted?: (chatId: string) => void;
  onMessageDeleted?: (chatId: string, messageId: string) => void;
  onChatCleared?: (chatId: string) => void;
  currentUserId?: string;
  currentUserName?: string;
  refetchTrigger?: number;
  onRegisterBackHandler?: (handler: (() => boolean) | null) => void;
}

export default function ChatRoom({ chat, onBack, onSendMessage, onTriggerCall, onForwardMessage, onChatDeleted, onMessageDeleted, onChatCleared, currentUserId, currentUserName, refetchTrigger, onRegisterBackHandler }: ChatRoomProps) {
  const { user, profile } = useSupabase();
  const uid = currentUserId ?? user?.id;
  const uname = currentUserName ?? profile?.name ?? user?.email;

  const { isOnline, queueMessage, isPending } = useOfflineQueue(chat.id, uid, (tempId, savedId) => {
    setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: savedId, status: "sent" } : m));
  });

  const [inputText, setInputText] = useState("");
  const [showAttachments, setShowAttachments] = useState(false);
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null); // messageId
  const [recordingType, setRecordingType] = useState<"voice" | "video" | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState<string | null>(null); // messageId
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [messages, setMessages] = useState<Message[]>(chat.messages || []);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const filteredMessages = searchQuery.trim()
    ? messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const mapApiMsg = (m: any): Message => {
    const durNum = m.audio_duration ? Number(m.audio_duration) : 0;
    const durStr = durNum > 0 ? `${Math.floor(durNum / 60)}:${String(Math.floor(durNum % 60)).padStart(2, "0")}` : undefined;
    return {
      id: m.id,
      sender: m.sender_id === uid ? ("me" as const) : ("other" as const),
      text: m.text,
      timestamp: m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
      rawCreatedAt: m.created_at || undefined,
      type: (m.type as Message["type"]) || "text",
      mediaUrl: m.image_url || m.sticker_url || m.gif_url || m.audio_url || m.video_url || undefined,
      duration: durStr,
      reactions: m.reactions,
      status: (m.status === "read" ? "read" : m.status === "delivered" ? "delivered" : m.sender_id === uid ? "sent" : undefined) as Message["status"],
      forwarded: m.forwarded || false,
      edited: m.edited || false,
      replyToId: m.reply_to_id,
      replyToText: m.reply_to_text,
      replyToSender: m.reply_to_sender,
      pollQuestion: m.poll_question,
      pollOptions: m.poll_options,
      latitude: m.latitude,
      longitude: m.longitude,
      locationName: m.location_name,
    };
  };

  // Merge server messages with local pending (temp) messages to avoid wiping out in-flight sends
  const mergeServerMessages = useCallback((serverMessages: Message[]) => {
    setMessages(prev => {
      const pending = prev.filter(m => m.id.startsWith('msg_') || m.id.startsWith('temp_') || m.status === 'sending' || m.status === 'queued');
      const serverIds = new Set(serverMessages.map(m => m.id));
      const stillPending = pending.filter(m => !serverIds.has(m.id));
      return [...stillPending, ...serverMessages];
    });
  }, []);

  // Fetch initial messages (last 50 only)
  useEffect(() => {
    console.log('[CHAT] useEffect [chat.id, uid] — chat.id:', chat.id, 'uid:', uid);
    if (chat.id) {
      setHasMoreOlder(true);
      getMessages(chat.id, { limit: 50 }).then(apiMessages => {
        console.log('[CHAT] getMessages result count:', apiMessages?.length);
        if (apiMessages && apiMessages.length > 0) {
          const mapped = apiMessages.map(mapApiMsg);
          mergeServerMessages(mapped);
          if (apiMessages.length < 50) setHasMoreOlder(false);
          console.log('[CHAT] ✅ setMessages called with', mapped.length, 'messages');
        } else {
          setHasMoreOlder(false);
          console.log('[CHAT] ⚠️ getMessages returned 0 messages');
        }
      }).catch((err) => {
        console.error('[CHAT] ❌ getMessages error:', err);
      });
    }
  }, [chat.id, uid]);

  // Refetch only newer messages when refetchTrigger changes (FCM push received)
  useEffect(() => {
    if (chat.id && refetchTrigger && refetchTrigger > 0 && messages.length > 0) {
      getMessages(chat.id, { limit: 50 }).then(apiMessages => {
        if (apiMessages && apiMessages.length > 0) {
          const mapped = apiMessages.map(mapApiMsg);
          setMessages(prev => {
            const serverIds = new Set(mapped.map(m => m.id));
            const kept = prev.filter(m => !serverIds.has(m.id));
            return [...kept, ...mapped];
          });
        }
      }).catch(() => {});
    }
  }, [chat.id, uid, refetchTrigger]);

  // Refetch only newer messages when app comes back to foreground
  useEffect(() => {
    const handler = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && chat.id && messages.length > 0) {
        getMessages(chat.id, { limit: 50 }).then(apiMessages => {
          if (apiMessages && apiMessages.length > 0) {
            const mapped = apiMessages.map(mapApiMsg);
            setMessages(prev => {
              const serverIds = new Set(mapped.map(m => m.id));
              const kept = prev.filter(m => !serverIds.has(m.id));
              return [...kept, ...mapped];
            });
          }
        }).catch(() => {});
      }
    });
    return () => { handler.then(h => h.remove()); };
  }, [chat.id, uid]);

  // ── Infinite scroll: load older messages ────────────────────────
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0) return;
    const oldestTs = messages[0]?.rawCreatedAt;
    if (!oldestTs) return;

    setLoadingOlder(true);
    try {
      const container = messagesRef.current;
      const prevScrollHeight = container?.scrollHeight || 0;

      const older = await getMessages(chat.id, { limit: 50, before: oldestTs });
      if (older && older.length > 0) {
        const mapped = older.map(mapApiMsg);
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = mapped.filter(m => !existingIds.has(m.id));
          return [...newMsgs, ...prev];
        });
        // Restore scroll position after prepend
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop += newScrollHeight - prevScrollHeight;
          }
        });
        if (older.length < 50) setHasMoreOlder(false);
      } else {
        setHasMoreOlder(false);
      }
    } catch (err) {
      console.error('[CHAT] Error loading older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [chat.id, messages, loadingOlder, hasMoreOlder]);

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupMembers, setGroupMembers] = useState<Array<{profile_id: string; name?: string; avatar?: string}>>([]);

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const sendingRecordingRef = useRef(false);

  // Only auto-scroll to bottom when user is already near the bottom
  const isNearBottomRef = useRef(true);
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const handleAutoScroll = () => {
      const threshold = 150;
      isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    };
    container.addEventListener('scroll', handleAutoScroll);
    return () => container.removeEventListener('scroll', handleAutoScroll);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ── Infinite scroll trigger: load older when scrolled near top ──
  const handleScroll = useCallback(() => {
    const container = messagesRef.current;
    if (!container || loadingOlder || !hasMoreOlder) return;
    if (container.scrollTop < 80) {
      loadOlderMessages();
    }
  }, [loadingOlder, hasMoreOlder, loadOlderMessages]);

  // Fetch group members when group info panel opens
  useEffect(() => {
    if (!showGroupInfo || !chat.isGroup) return;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from("chat_participants")
          .select("profile_id, profiles(name, avatar_url)")
          .eq("chat_id", chat.id);
        if (rows) {
          const mapped = rows.map((r: any) => ({
            profile_id: r.profile_id,
            name: r.profiles?.name,
            avatar: r.profiles?.avatar_url,
          }));
          setGroupMembers(mapped);
        }
      } catch (e) {
        console.error("[CHAT] Error fetching group members:", e);
      }
    })();
  }, [showGroupInfo, chat.isGroup, chat.id]);

  // Real MediaRecorder + timer
  useEffect(() => {
    if (recordingType) {
      setRecordingSeconds(0);
      const startRec = async () => {
        try {
          const constraints: MediaStreamConstraints =
            recordingType === "video"
              ? { audio: true, video: { facingMode: "user", width: 360, height: 360 } }
              : { audio: true };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          mediaStreamRef.current = stream;
          chunksRef.current = [];
          if (recordingType === "video" && videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = stream;
            videoPreviewRef.current.play().catch(() => {});
          }
          const recorder = new MediaRecorder(stream, {
            audioBitsPerSecond: 128000,
            videoBitsPerSecond: 2500000,
          });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorder.start(1000);
          mediaRecorderRef.current = recorder;
        } catch (err) {
          console.error("[CHAT] getUserMedia error:", err);
          setRecordingType(null);
        }
      };
      startRec();
      recordingTimer.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
      mediaRecorderRef.current = null;
    };
  }, [recordingType]);

  // Attach video stream to preview element
  useEffect(() => {
    if (recordingType === "video" && mediaStreamRef.current && videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = mediaStreamRef.current;
      videoPreviewRef.current.play().catch(() => {});
    }
    return () => {
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
      }
    };
  }, [recordingType]);
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
      console.log('[REALTIME] ═══════ INSERT RECIBIDO ═══════');
      console.log('[REALTIME] chat.id:', chat.id, 'filter: chat_id=eq.' + chat.id);
      console.log('[REALTIME] payload.new:', JSON.stringify(payload.new));
      console.log('[REALTIME] payload.eventType:', payload.eventType);
      const newMsg = payload.new;
      if (newMsg.is_deleted) {
        console.log('[REALTIME] ❌ mensaje marcado como borrado, ignorando');
        return;
      }
      console.log('[REALTIME] sender_id:', newMsg.sender_id, 'uid:', uid, 'son iguales?:', newMsg.sender_id === uid);
      if (newMsg.sender_id !== uid) {
        console.log('[REALTIME] ✅ mensaje de OTRO, agregando al estado');
        // Mark our sent messages as delivered now that the other user received the message
        setMessages(prev => prev.map(m =>
          m.sender === "me" && m.status === "sent" ? { ...m, status: "delivered" as const } : m
        ));
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
    channel.on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'messages',
      filter: `chat_id=eq.${chat.id}`,
    }, (payload: any) => {
      const updated = payload.new;
      if (updated.is_deleted) {
        setMessages(prev => prev.filter(m => m.id !== updated.id));
        return;
      }
      if (updated.sender_id === uid && updated.status === "read") {
        setMessages(prev => prev.map(m =>
          m.id === updated.id ? { ...m, status: "read" as const } : m
        ));
      }
      if (updated.edited) {
        setMessages(prev => prev.map(m =>
          m.id === updated.id ? { ...m, text: updated.text, edited: true } : m
        ));
      }
    });
    channel.subscribe((status: string) => {
      console.log('[REALTIME] channel subscribe status:', status, 'for chat.id:', chat.id);
    });
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

  const handleReplyMessage = (msg: Message) => {
    setReplyTo(msg);
  };

  const handleSendLocation = async () => {
    if (!navigator.geolocation) {
      console.warn("[CHAT] Geolocation not available");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const tempId = `temp_${Date.now()}_loc`;
        const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const newMsg: Message = {
          id: tempId,
          sender: "me",
          timestamp,
          type: "location",
          latitude,
          longitude,
          locationName: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          status: "sending",
        };
        setMessages(prev => [...prev, newMsg]);
        onSendMessage(newMsg);

        try {
          const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
          if (!isLocalChat) {
            const saved = await apiSendMessage({
              chat_id: chat.id,
              type: "location",
              sender_id: uid,
              text: `📍 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
              latitude,
              longitude,
              location_name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            });
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id, status: "sent" } : m));
          } else {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sent" } : m));
          }
        } catch (e) {
          console.error("[CHAT] Error sending location:", e);
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sending" } : m));
        }
      },
      (err) => {
        console.warn("[CHAT] Geolocation error:", err.message, err.code);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const tempId = `temp_${Date.now()}_txt`;
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      text: inputText,
      timestamp,
      type: "text",
      status: isOnline ? "sent" : "sending",
      replyToId: replyTo?.id,
      replyToText: replyTo?.text,
      replyToSender: replyTo?.sender === "me" ? "Tú" : chat.name,
    };

    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setInputText("");
    setReplyTo(null);

    emitTyping(false);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    if (!isOnline) {
      queueMessage(newMsg);
      return;
    }

    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
      if (isLocalChat) {
        setMessages(prev => prev.map((m) => m.id === tempId ? { ...m, id: `local_${Date.now()}` } : m));
      } else {
        const saved = await apiSendMessage({
          chat_id: chat.id,
          text: inputText,
          type: "text",
          sender_id: uid,
          reply_to_id: replyTo?.id,
          reply_to_text: replyTo?.text,
          reply_to_sender: replyTo?.sender === "me" ? "Tú" : chat.name,
        });
        setMessages(prev => prev.map((m) =>
          m.id === tempId ? { ...m, id: saved.id, status: "sent" } : m
        ));
      }
    } catch (e) {
      console.error("[CHAT] Error al enviar mensaje:", e);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sending" } : m));
      queueMessage(newMsg);
    }
  };

  const handleSendSticker = async (value: string, type: "gif" | "sticker" | "emoji") => {
    if (type === "emoji") {
      const tempId = `temp_${Date.now()}_emoji`;
      const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const newMsg: Message = {
        id: tempId,
        sender: "me",
        timestamp,
        type: "sticker",
        mediaUrl: value,
        fileName: "Emoji.png",
        status: isOnline ? "sent" : "sending"
      };
      setMessages(prev => [...prev, newMsg]);
      onSendMessage(newMsg);
      setShowGifPicker(false);
      setShowAttachments(false);
      if (!isOnline) { queueMessage(newMsg); return; }
      try {
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
        if (!isLocalChat) {
          const saved = await apiSendMessage({
            chat_id: chat.id,
            type: "sticker",
            sticker_url: value,
            image_url: value,
            sender_id: uid,
          });
          setMessages(prev => prev.map((m) =>
            m.id === tempId ? { ...m, id: saved.id, status: "sent" } : m
          ));
        }
      } catch (e) {
        console.error("[CHAT] Error al enviar emoji:", e);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sending" } : m));
        queueMessage(newMsg);
      }
      return;
    }
    const url = value;
    const tempId = `temp_${Date.now()}_stkr`;
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp,
      type: type === "sticker" ? "sticker" : "image",
      mediaUrl: url,
      fileName: type === "gif" ? "GIF.gif" : "Sticker.png",
      status: isOnline ? "sent" : "sending"
    };

    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowGifPicker(false);
    setShowAttachments(false);

    if (!isOnline) { queueMessage(newMsg); return; }
    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
      if (isLocalChat) {
        setMessages(prev => prev.map((m) => m.id === tempId ? { ...m, id: `local_${Date.now()}` } : m));
      } else {
        const saved = await apiSendMessage({
          chat_id: chat.id,
          type: type === "sticker" ? "sticker" : "image",
          sender_id: uid,
          sticker_url: type === "sticker" ? url : undefined,
          gif_url: type === "gif" ? url : undefined,
          image_url: url,
        });
        setMessages(prev => prev.map((m) =>
          m.id === tempId ? { ...m, id: saved.id, status: "sent" } : m
        ));
      }
    } catch (e) {
      console.error("[CHAT] Error al enviar sticker:", e);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sending" } : m));
      queueMessage(newMsg);
    }
  };

  const triggerFilePick = async (accept: string, type: Message["type"]) => {
    // For images and videos, use Capacitor Camera plugin on mobile
    if (type === "image" || type === "video") {
      try {
        const isCapacitor = !!(window as any).Capacitor;
        if (isCapacitor) {
          const photo = await CapacitorCamera.getPhoto({
            quality: 75,
            source: CameraSource.Photos,
            resultType: CameraResultType.Uri,
          });
          if (!photo.webPath) return;
          const resp = await fetch(photo.webPath);
          const blob = await resp.blob();
          const ext = photo.format || (type === "video" ? "mp4" : "jpeg");
          const mimeType = type === "video" ? "video/mp4" : "image/jpeg";
          const fileBlob = new Blob([await blob.arrayBuffer()], { type: mimeType });
          const tempId = "msg_" + Date.now();
          const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const localUrl = URL.createObjectURL(fileBlob);
          const sendingMsg: Message = {
            id: tempId, sender: "me", timestamp, type, mediaUrl: localUrl,
            fileName: `${type}_${Date.now()}.${ext}`, fileSize: `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
            status: "sending",
          };
          setMessages(prev => [...prev, sendingMsg]);
          onSendMessage(sendingMsg);
          const url = await uploadChatMedia(fileBlob, type === "video" ? "video" : "image");
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
          });
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, mediaUrl: url } : m));
          const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
          if (!isLocalChat) {
            const payload: any = { chat_id: chat.id, sender_id: uid, type, text: type === "image" ? "Imagen" : "Video" };
            if (type === "image") payload.image_url = url;
            else payload.video_url = url;
            const saved = await apiSendMessage(payload);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id, status: "sent" } : m));
          }
          return;
        }
      } catch (e: any) {
        if (e?.message?.includes("cancelled") || e?.message?.includes("User")) return;
        console.warn("Capacitor Camera failed, falling back to input:", e);
      }
    }

    // Fallback: HTML file input (works on web / some devices)
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const tempId = "msg_" + Date.now();
      const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const sendingMsg: Message = {
        id: tempId, sender: "me", timestamp, type,
        mediaUrl: URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: file.type })),
        fileName: file.name, fileSize: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        status: "sending",
      };
      setMessages(prev => [...prev, sendingMsg]);
      onSendMessage(sendingMsg);

      try {
        const blob = new Blob([file], { type: file.type });
        const url = await uploadChatMedia(blob, "files");
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        });
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, mediaUrl: url } : m));
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
        if (!isLocalChat) {
          const payload: any = { chat_id: chat.id, sender_id: uid, type, text: file.name };
          if (type === "image") { payload.image_url = url; payload.text = "Imagen"; }
          else if (type === "video") { payload.video_url = url; payload.text = "Video"; }
          else if (type === "audio") { payload.audio_url = url; payload.text = "Audio"; }
          const saved = await apiSendMessage(payload);
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id, status: "sent" } : m));
        } else {
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sent" } : m));
        }
      } catch (err) {
        console.error("[CHAT] File upload error:", err);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sent" } : m));
      }
    };
    input.click();
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim()) return;

    const pollOpts = [
      { id: "o1_" + Date.now(), text: pollOption1, votes: 0, votedUsers: [] },
      { id: "o2_" + Date.now(), text: pollOption2, votes: 0, votedUsers: [] }
    ];

    const tempId = "msg_" + Date.now();
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "poll",
      pollQuestion: pollQuestion,
      pollOptions: pollOpts,
      status: "sent",
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowPollForm(false);
    setPollQuestion("");
    setPollOption1("");
    setPollOption2("");
    setShowAttachments(false);

    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
      if (!isLocalChat) {
        const saved = await apiSendMessage({
          chat_id: chat.id,
          type: "poll",
          sender_id: uid,
          text: pollQuestion,
          poll_question: pollQuestion,
          poll_options: pollOpts,
        });
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id } : m));
      }
    } catch (e) {
      console.error("[CHAT] Error saving poll:", e);
    }
  };

  const handleVote = (messageId: string, optionId: string) => {
    let updatedPollOptions: { id: string; text: string; votes: number; votedUsers: string[] }[] | null = null;

    setMessages(prev => {
      const next = prev.map((m) => {
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
          updatedPollOptions = options;
          return { ...m, pollOptions: options };
        }
        return m;
      });
      return next;
    });

    if (updatedPollOptions) {
      Promise.resolve(supabase
        .from("messages")
        .update({ poll_options: updatedPollOptions })
        .eq("id", messageId)
      ).then(() => {}).catch(() => {});
    }
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
    try {
      await apiDeleteMessage(messageId);
      setMessages(prev => prev.filter((m) => m.id !== messageId));
      onMessageDeleted?.(chat.id, messageId);
    } catch (e) {
      console.error("[CHAT] Delete error:", e);
    }
  };

  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);

  // Register Android back handler for ChatRoom internal overlays
  useEffect(() => {
    if (!onRegisterBackHandler) return;
    const handler = (): boolean => {
      if (editingMessage) { setEditingMessage(null); return true; }
      if (replyTo) { setReplyTo(null); return true; }
      if (showAttachments) { setShowAttachments(false); return true; }
      if (activeReactionMenu) { setActiveReactionMenu(null); return true; }
      if (showSearch) { setShowSearch(false); setSearchQuery(""); return true; }
      if (showGifPicker) { setShowGifPicker(false); return true; }
      if (showCustomizer) { setShowCustomizer(false); return true; }
      if (showDeleteConfirm) { setShowDeleteConfirm(false); return true; }
      if (showGroupInfo) { setShowGroupInfo(false); return true; }
      if (showDropdown) { setShowDropdown(false); return true; }
      return false;
    };
    onRegisterBackHandler(handler);
    return () => { onRegisterBackHandler(null); };
  }, [editingMessage, replyTo, showAttachments, activeReactionMenu, showSearch, showGifPicker, showCustomizer, showDeleteConfirm, showGroupInfo, showDropdown, onRegisterBackHandler]);

  const handleEditMessage = async (messageId: string, newText: string) => {
    setActiveReactionMenu(null);
    setEditingMessage(null);
    try {
      await apiEditMessage(messageId, newText);
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: newText, edited: true } : m));
    } catch (e) {
      console.error("[CHAT] Edit error:", e);
    }
  };

  const handleUpdatePrice = (messageId: string, price: string) => {
    setActiveReactionMenu(null);
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, price } : m));
  };

  const handleFinishVoiceNote = async () => {
    if (!recordingType || !mediaRecorderRef.current || sendingRecordingRef.current) return;
    sendingRecordingRef.current = true;
    const currentRecordingType = recordingType;
    const currentDuration = recordingSeconds;

    setRecordingType(null);
    if (recordingTimer.current) clearInterval(recordingTimer.current);

    const recordingDone = new Promise<void>((resolve) => {
      const r = mediaRecorderRef.current!;
      if (r.state !== "inactive") {
        r.onstop = () => resolve();
        r.stop();
      } else {
        resolve();
      }
    });
    await recordingDone;
    const buffers = await Promise.all(chunksRef.current.map(c => c.arrayBuffer()));
    const blob = new Blob(buffers, {
      type: currentRecordingType === "voice" ? "audio/webm" : "video/webm",
    });
    const durStr = `${Math.floor(currentDuration / 60)}:${(currentDuration % 60).toString().padStart(2, "0")}`;
    const tempId = "msg_" + Date.now();
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: currentRecordingType === "voice" ? "voice_note" : "video_note",
      duration: durStr,
      mediaUrl: URL.createObjectURL(blob),
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    try {
      const url = await uploadChatMedia(blob, currentRecordingType === "voice" ? "voice" : "video");
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, mediaUrl: url } : m));

      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id);
      if (!isLocalChat) {
        const saved = await apiSendMessage({
          chat_id: chat.id,
          sender_id: uid,
          type: currentRecordingType === "voice" ? "voice_note" : "video_note",
          audio_url: currentRecordingType === "voice" ? url : undefined,
          video_url: currentRecordingType === "video" ? url : undefined,
          audio_duration: currentDuration,
          text: currentRecordingType === "voice" ? "Nota de voz" : "Nota de video",
        });
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id } : m));
      }
    } catch (err) {
      console.error("[CHAT] Upload recording error:", err);
    }
    sendingRecordingRef.current = false;
  };

  const bgPreset = CHAT_BACKGROUNDS.find(bg => bg.id === selectedBgId);
  const rawBg = bgPreset?.value || "#f8fafc";
  const isPatternBg = rawBg.startsWith("pattern:");
  const isGradientBg = rawBg.startsWith("linear-gradient");
  const isImageBg = rawBg.startsWith("url");

  const patternParts = isPatternBg ? rawBg.replace("pattern:", "").split("|") : [];
  const patternTheme = (patternParts[0] || "stars") as "stars" | "bubbles" | "dots" | "constellation" | "waves" | "sparkle";
  const patternFrom = patternParts[1] || "blue";
  const patternTo = patternParts[2] || "purple";

  const containerBgStyle: React.CSSProperties = isPatternBg
    ? { background: "transparent" }
    : isGradientBg
      ? { backgroundImage: rawBg }
      : isImageBg
        ? {
            backgroundImage: rawBg.replace(/ center\/cover no-repeat$/, ''),
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }
        : { backgroundColor: rawBg };

  return (
    <div 
      className="flex-1 flex flex-col h-full overflow-hidden relative"
      style={containerBgStyle}
    >
      {/* SVG Pattern Background */}
      {isPatternBg && (
        <ChatPatternBackground
          theme={patternTheme}
          gradientFrom={patternFrom}
          gradientTo={patternTo}
          strokeOpacity={0.3}
          className="pointer-events-none"
        />
      )}
      {/* Subtle dark overlay only for dark Unsplash backgrounds */}
      {!isPatternBg && !isGradientBg && selectedBgId !== "default" && selectedBgId !== "minimal_white" && selectedBgId !== "olive" && selectedBgId !== "pink" && (
        <div className="absolute inset-0 bg-black/15 pointer-events-none z-0"></div>
      )}

      {/* HEADER BAR */}
      <div className="relative text-white px-4 pt-5 pb-9 shrink-0 z-40 bg-[#0a4d52]">
        {/* SVG Waves Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        <svg
          viewBox="0 0 320 120"
          className="w-full h-full"
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
        </div>

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
              <ArrowLeft className="w-5 h-5 text-teal-100" />
            </button>
            <div className="relative">
              {chat.isGroup ? (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center border border-white/20">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
              ) : chat.avatar ? (
                <img src={chat.avatar} alt={chat.name} className="w-9 h-9 rounded-full object-cover border border-white/20" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center border border-white/20">
                  <span className="text-white font-bold text-xs">
                    {chat.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                  </span>
                </div>
              )}
              {!chat.isGroup && chat.status === "online" && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#0a4d52]"></span>
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold leading-tight truncate max-w-[120px]">{chat.name}</h3>
              <span className="text-[10px] text-teal-200 block">
                {partnerTyping ? "Escribiendo..." : chat.isGroup ? "Grupo" : chat.status === "online" ? "En línea" : "Desconectado"}
              </span>
            </div>
          </div>

          {/* Call Trigger Buttons */}
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => onTriggerCall("audio")}
              className="p-2 hover:bg-white/10 rounded-full transition-all text-teal-100 hover:text-white"
              title="Llamada de voz"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button 
              onClick={() => onTriggerCall("video")}
              className="p-2 hover:bg-white/10 rounded-full transition-all text-teal-100 hover:text-white"
              title="Video llamada"
            >
              <Video className="w-5 h-5" />
            </button>
            {/* Search button */}
            <button
              onClick={() => { setShowSearch(!showSearch); setSearchQuery(""); setSearchIndex(0); }}
              className={`p-1.5 rounded-full transition-all cursor-pointer ${
                showSearch ? "bg-white/20 text-white" : "text-teal-100 hover:bg-white/10 hover:text-white"
              }`}
              title="Buscar mensajes"
            >
              <Search className="w-4 h-4" />
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
                  <div className="fixed inset-0 z-[100]" onClick={() => setShowDropdown(false)} />
                  <div className="fixed right-4 top-[72px] bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-[110] min-w-[170px] animate-fade-in">
                    <button
                      onClick={async () => {
                        setShowDropdown(false);
                        try {
                          await clearForMe(chat.id);
                          onChatCleared?.(chat.id);
                          onBack();
                        } catch (e) {
                          console.error("[CHAT] clearForMe error:", e);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <rect x="4" y="6" width="16" height="14" rx="1" />
                      </svg>
                      Borrar mensajes
                    </button>
                    <button
                      onClick={() => { setShowCustomizer(true); setShowDropdown(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <Palette className="w-3.5 h-3.5 text-teal-600" />
                      Personalizar chat
                    </button>
                    {chat.isGroup && (
                      <button
                        onClick={() => { setShowGroupInfo(true); setShowDropdown(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-purple-600 hover:bg-purple-50 transition-colors cursor-pointer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        Info del grupo
                      </button>
                    )}
                    <div className="border-t border-slate-100 my-1"></div>
                    <button
                      onClick={() => { setShowDeleteConfirm(true); setShowDropdown(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      Eliminar chat
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CHAT CUSTOMIZER DRAWER */}
      <ChatCustomizer
        showCustomizer={showCustomizer}
        setShowCustomizer={setShowCustomizer}
        selectedBgId={selectedBgId}
        setSelectedBgId={setSelectedBgId}
        bubbleColorMeId={bubbleColorMeId}
        setBubbleColorMeId={setBubbleColorMeId}
        bubbleColorThemId={bubbleColorThemId}
        setBubbleColorThemId={setBubbleColorThemId}
        chatName={chat.name}
      />

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-lg w-[280px] p-5 text-center animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-slate-800 mb-1">
              {chat.isGroup ? "Eliminar grupo" : "Eliminar chat"}
            </h3>
            <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
              {chat.isGroup
                ? "Se eliminarán todos los mensajes y el grupo desaparecerá de tu lista."
                : "Se eliminarán todos los mensajes. Esta acción no se puede deshacer."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  try {
                    if (user?.id) {
                      await apiDeleteChat(chat.id, user.id);
                    }
                    onChatDeleted?.(chat.id);
                    onBack();
                  } catch (e) {
                    console.error("[CHAT] deleteChat error:", e);
                  }
                }}
                className="flex-1 py-2 text-[11px] font-semibold text-white bg-rose-500 rounded-xl hover:bg-rose-600 transition-colors cursor-pointer"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GROUP INFO PANEL */}
      {showGroupInfo && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-[420px] rounded-t-3xl shadow-lg animate-slide-up max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
              <h3 className="text-sm font-bold text-slate-800">Info del grupo</h3>
              <button
                onClick={() => setShowGroupInfo(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            {/* Group avatar + name */}
            <div className="flex flex-col items-center py-5 border-b border-slate-100 shrink-0">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p className="text-sm font-bold text-slate-800">{chat.name}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{groupMembers.length} miembros</p>
            </div>
            {/* Members list */}
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Miembros</p>
              <div className="space-y-2">
                {groupMembers.map(m => (
                  <div key={m.profile_id} className="flex items-center gap-3 py-1.5">
                    {m.avatar ? (
                      <img src={m.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                        <span className="text-white font-bold text-[10px]">
                          {m.name ? m.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2) : "?"}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-slate-800 truncate">{m.name || "Usuario"}</p>
                      <p className="text-[9px] text-slate-400">
                        {m.profile_id === uid ? "Tú" : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {groupMembers.length === 0 && (
                  <p className="text-[11px] text-slate-400 text-center py-4">Cargando miembros...</p>
                )}
              </div>
            </div>
            {/* Delete group button (visible to all) */}
            <div className="p-4 border-t border-slate-100 shrink-0">
              <button
                onClick={() => { setShowGroupInfo(false); setShowDeleteConfirm(true); }}
                className="w-full py-2.5 text-[11px] font-bold text-rose-500 bg-rose-50 rounded-xl hover:bg-rose-100 transition-colors cursor-pointer"
              >
                Eliminar grupo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEARCH BAR */}
      {showSearch && (
        <div className="relative z-10 px-3 py-2 bg-white/90 backdrop-blur-sm border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar mensajes..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0); }}
                className="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-white outline-none focus:border-teal-400 transition-colors"
                autoFocus
              />
            </div>
            {searchQuery.trim() && (
              <div className="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
                {filteredMessages.length > 0 ? (
                  <>
                    <span>{searchIndex + 1} de {filteredMessages.length}</span>
                    <button
                      onClick={() => setSearchIndex(i => Math.max(0, i - 1))}
                      className="p-0.5 hover:bg-slate-100 rounded cursor-pointer"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setSearchIndex(i => Math.min(filteredMessages.length - 1, i + 1))}
                      className="p-0.5 hover:bg-slate-100 rounded cursor-pointer"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-slate-400">Sin resultados</span>
                )}
                <button
                  onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchIndex(0); }}
                  className="p-0.5 hover:bg-slate-100 rounded cursor-pointer ml-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MESSAGES LIST AREA */}
      <div 
        className="flex-1 p-4 overflow-y-auto space-y-3.5 relative transition-all duration-300 bg-transparent"
        ref={messagesRef}
        onScroll={handleScroll}
      >
        <div className="relative z-10 space-y-3.5">
          {loadingOlder && (
            <div className="flex justify-center py-3">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
                Cargando mensajes anteriores...
              </div>
            </div>
          )}
          {(showSearch && searchQuery.trim() ? filteredMessages : messages).map((msg, idx) => {
            const isMe = msg.sender === "me";
            const isHighlighted = showSearch && searchQuery.trim() && idx === searchIndex;
            return (
              <div
                key={msg.id}
                ref={isHighlighted ? el => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined}
                className={isHighlighted ? "ring-2 ring-teal-400 rounded-xl transition-all duration-300" : ""}
              >
                <MessageBubble
                  msg={msg}
                  isMe={isMe}
                  activeReactionMenu={activeReactionMenu}
                  setActiveReactionMenu={setActiveReactionMenu}
                  isPlayingAudio={isPlayingAudio}
                  setIsPlayingAudio={setIsPlayingAudio}
                  handleVote={handleVote}
                  handleAddReaction={handleAddReaction}
                  handleDeleteMessage={handleDeleteMessage}
                  handleForwardMessage={(m) => onForwardMessage?.(m)}
                  handleReplyMessage={handleReplyMessage}
                  bubbleColorMeId={bubbleColorMeId}
                  bubbleColorThemId={bubbleColorThemId}
                  isPending={isPending}
                  onEdit={(m) => setEditingMessage({ id: m.id, text: m.text || "" })}
                  onUpdatePrice={handleUpdatePrice}
                />
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
            onClick={() => { setShowAttachments(false); triggerFilePick("image/*", "image"); }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform shadow-sm">
              <Image className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Fotos</span>
          </button>

          <button 
            onClick={() => { setShowAttachments(false); triggerFilePick("video/*", "video"); }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-600 group-hover:scale-110 transition-transform shadow-sm">
              <VideoIcon className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Video</span>
          </button>

          <button 
            onClick={() => { setShowAttachments(false); triggerFilePick("*/*", "file"); }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform shadow-sm">
              <File className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Documento</span>
          </button>

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
            onClick={() => { setShowAttachments(false); triggerFilePick("audio/*", "audio"); }}
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

          <button
            onClick={() => { setShowAttachments(false); triggerFilePick("image/*", "image"); }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform shadow-sm">
              <CameraIcon className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Cámara</span>
          </button>

          <button
            onClick={() => { setShowAttachments(false); handleSendLocation(); }}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 group-hover:scale-110 transition-transform shadow-sm">
              <MapPin className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-semibold text-slate-600">Ubicación</span>
          </button>
        </div>
      )}

      {/* POLL FORM SCREEN OVERLAY */}
      {showPollForm && (
        <div className="absolute inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
          <form onSubmit={handleCreatePoll} className="bg-white rounded-2xl p-4 w-full max-w-xs space-y-3 shadow-lg">
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

      {/* REPLY PREVIEW BAR */}
      {replyTo && (
        <div className="px-3 pb-1 bg-transparent relative z-10 shrink-0">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl px-3 py-2 border border-slate-200 shadow-sm flex items-center gap-2">
            <div className="w-0.5 h-8 bg-teal-500 rounded-full shrink-0"></div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-teal-700 truncate">
                {replyTo.sender === "me" ? "Tú" : chat.name}
              </p>
              <p className="text-[9px] text-slate-500 truncate">{replyTo.text || "Multimedia"}</p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="p-1 hover:bg-slate-100 rounded-full transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      )}

      {/* FLOATING CHAT INPUT AREA */}
      <div className="px-3 pb-4 pt-2 bg-transparent relative z-10 shrink-0 flex items-center gap-1.5 overflow-hidden">
        {recordingType ? (
          // ACTIVE RECORDING MODE
          <div className="flex-1 bg-teal-900/95 backdrop-blur-md rounded-2xl border border-teal-800/80 shadow-[0_8px_30px_rgba(0,0,0,0.25)] text-white animate-fade-in overflow-hidden">
            {recordingType === "video" && (
              <div className="w-full aspect-square max-h-[200px] bg-black flex items-center justify-center overflow-hidden rounded-t-2xl">
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>
                <span className="text-[10px] font-bold tracking-wide">
                  {recordingType === "voice" ? "Grabando voz" : "Grabando video"} • <span className="text-teal-300 font-mono">{recordingSeconds}s</span>
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
          </div>
        ) : (
          // STANDARD INPUT MODE - WHATSAPP/TELEGRAM-LIKE DUAL FLOATING SYSTEM
          <>
            {/* 1. Main Input Pill (Always solid white, no dark style overrides) */}
            <div className="flex-1 min-w-0 bg-white rounded-full pl-3 pr-1.5 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-100/50 flex items-center gap-1 transition-all duration-300 overflow-hidden">
              {/* Emoji/Smile button */}
              <button 
                onClick={() => { setShowGifPicker(true); }}
                className="p-1 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer shrink-0"
                title="GIFs y Stickers"
              >
                <Smile className="w-4 h-4" />
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
                className="flex-1 min-w-0 bg-transparent text-xs py-1.5 outline-none border-none text-slate-800 placeholder-slate-400 font-medium"
              />

              {/* Attachment Clip Button */}
              <button 
                onClick={() => setShowAttachments(!showAttachments)}
                className={`p-1 rounded-full transition-all cursor-pointer shrink-0 ${
                  showAttachments 
                    ? "bg-[#0a4d52] text-white rotate-45 shadow-inner scale-105" 
                    : "text-slate-400 hover:text-[#0a4d52]"
                }`}
                title="Adjuntar multimedia o encuestas"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Circular Video Note trigger inside pill when text is empty */}
              {!inputText.trim() && (
                <button 
                  onClick={() => setRecordingType("video")}
                  className="p-1 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer shrink-0"
                  title="Grabar Nota de video circular"
                >
                  <VideoIcon className="w-4 h-4" />
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

      {/* EDIT MESSAGE MODAL */}
      {editingMessage && (
        <EditMessageOverlay
          initialText={editingMessage.text}
          onSave={(newText) => handleEditMessage(editingMessage.id, newText)}
          onCancel={() => setEditingMessage(null)}
        />
      )}
    </div>
  );
}

function EditMessageOverlay({ initialText, onSave, onCancel }: { initialText: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initialText);
  return (
    <div className="absolute inset-0 bg-black/60 z-40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-4 w-full max-w-xs space-y-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-xs font-bold text-slate-800">✏️ Editar mensaje</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full text-xs border border-slate-200 rounded-xl p-2.5 outline-none focus:border-[#0a4d52] resize-none"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 rounded-lg">
            Cancelar
          </button>
          <button
            onClick={() => { if (text.trim() && text.trim() !== initialText) onSave(text.trim()); }}
            disabled={!text.trim() || text.trim() === initialText}
            className="px-3 py-1.5 text-[10px] font-bold text-white bg-[#0a4d52] hover:bg-[#10646a] rounded-lg disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

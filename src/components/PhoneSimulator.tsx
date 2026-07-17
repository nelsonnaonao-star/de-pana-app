import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Check, AlertTriangle, Info, Search, Plus, 
  QrCode, LogOut, CheckCheck, Shield, Bell, Database, Type, 
  HelpCircle, Lock, Cloud, RefreshCw, FileText, ChevronRight, 
  Smartphone, EyeOff, UserCheck, CircleUser, Camera, Forward, ArrowRight, ArrowLeft
} from "lucide-react";
import { Chat, Message, ActiveCall } from "../types";
import WelcomeScreen from "./WelcomeScreen";
import ChatRoom from "./ChatRoom";
import CallOverlay from "./CallOverlay";
import QrScanner from "./QrScanner";
import MyQrCode from "./MyQrCode";
import AddContact from "./AddContact";
import AddContactManual from "./AddContactManual";
import SyncedContacts from "./SyncedContacts";
import ContactsList from "./ContactsList";
import BusinessPanel, { BusinessFlyer } from "./BusinessPanel";
import RatesPanel from "./RatesPanel";
import StatesPanel from "./StatesPanel";
import ChannelsPanel from "./ChannelsPanel";
import CallLog from "./CallLog";
import BottomTabBar from "./phone/BottomTabBar";
import FabMenu from "./phone/FabMenu";
import { supabase } from "../lib/supabase";
import { useSupabase } from "../contexts/SupabaseContext";
import { clearForMe, sendMessage as apiSendMessage } from "../services/messages";
import { createChat as createChatInSupabase, createGroupChat, deleteChat as apiDeleteChat } from "../services/chats";
import { getMyFlyers, createFlyer, incrementFlyerView, incrementFlyerClick, deleteFlyer } from "../services/contentService";
import { WebRTCService } from "../services/webrtc";
import { startCall as apiStartCall } from "../services/calls";
import { sendFcmPush } from "../services/pushCapacitor";
import { uploadAvatar } from "../services/storage";
import { updateProfile } from "../services/auth";
interface PhoneSimulatorProps {
  isCorrected?: boolean;
  onToggle?: (val: boolean) => void;
  externalCallTrigger?: ActiveCall | null;
  onClearExternalCallTrigger?: () => void;
  externalMessageTrigger?: Message | null;
  onClearExternalMessageTrigger?: () => void;
  onBackPress?: (handler: () => boolean) => void;
  onSetShouldExit?: (shouldExit: boolean) => void;
}

export default function PhoneSimulator({
  isCorrected,
  onToggle,
  externalCallTrigger = null,
  onClearExternalCallTrigger = () => {},
  externalMessageTrigger = null,
  onClearExternalMessageTrigger = () => {},
  onBackPress,
  onSetShouldExit,
}: PhoneSimulatorProps) {
  const { user, profile, contacts: appContacts, chats: supabaseChats, refreshChats, refreshContacts, refreshProfile } = useSupabase();

  // Deduplicate contacts by contact_user_id (prefer entry with phone) or by name+phone
  const dedupedContacts = useMemo(() => {
    const seen = new Map<string, typeof appContacts[0]>();
    for (const c of appContacts) {
      const key = c.contact_user_id || `${c.name}|${c.phone || ''}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, c);
      } else if (c.phone && !existing.phone) {
        seen.set(key, c);
      }
    }
    return Array.from(seen.values());
  }, [appContacts]);

  // Application Screen State
  const [currentScreen, setCurrentScreen] = useState<
    "welcome" | "chats" | "chat_room" | "qr_scanner" | "synced_contacts" | "contacts" | "states" | "channels" | "rates" | "business" | "profile" | "my_qr" | "add_contact" | "add_contact_manual" | "create_group" | "calls"
  >("chats");
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;

  // Floating action menu
  const [showActionMenu, setShowActionMenu] = useState(false);
  const showActionMenuRef = useRef(false);
  const shouldExitRef = useRef(false);

  // App User state
  const [registeredUser, setRegisteredUser] = useState<{
    name: string;
    phone: string;
    avatar: string;
  } | null>(null);

  useEffect(() => {
    if (user && profile) {
      setRegisteredUser({
        name: profile.name,
        phone: profile.phone_number,
        avatar: profile.avatar || profile.avatar_url || "",
      });
    } else if (user) {
      const fallbackName = user.email?.split("@")[0] || "Usuario";
      setRegisteredUser({
        name: fallbackName,
        phone: "",
        avatar: "",
      });
    }
  }, [user, profile]);

  // Android back button handler — registered ONCE, reads state from refs (no race condition)
  useEffect(() => {
    if (!onBackPress) return;

    const backScreens: Record<string, string> = {
      chat_room: "chats",
      rates: "chats",
      business: "chats",
      profile: "chats",
      states: "chats",
      channels: "chats",
      contacts: "chats",
      calls: "chats",
      qr_scanner: "chats",
      my_qr: "chats",
      add_contact: "chats",
      add_contact_manual: "chats",
      create_group: "chats",
      synced_contacts: "chats",
    };

    onBackPress(() => {
      if (activeCallRef.current) {
        console.log("[BACK] Active call — ending call");
        cleanupCallRef.current?.();
        return true;
      }
      if (contextMenuChatRef.current) {
        console.log("[BACK] Context menu open — closing");
        setContextMenuChat(null);
        setContextMenuPos(null);
        return true;
      }
      if (showActionMenuRef.current) {
        console.log("[BACK] Action menu open — closing");
        setShowActionMenu(false);
        return true;
      }
      const screen = currentScreenRef.current;
      if (screen === "chat_room" && chatRoomBackHandlerRef.current) {
        if (chatRoomBackHandlerRef.current()) {
          console.log("[BACK] ChatRoom consumed back (reply/edit/attachment/search)");
          return true;
        }
      }
      const target = backScreens[screen];
      if (target) {
        console.log("[BACK] Navigating from", screen, "->", target);
        if (screen === "chat_room") {
          setSelectedChatId(null);
        }
        setCurrentScreen(target as any);
        return true;
      }
      console.log("[BACK] Root screen — should exit app");
      onSetShouldExit?.(true);
      return false;
    });

    onSetShouldExit?.(shouldExitRef.current);
  }, [onBackPress, onSetShouldExit]);

  useEffect(() => {
    const isOnMainScreen = currentScreen === "chats" || currentScreen === "welcome";
    shouldExitRef.current = !isOnMainScreen;
    onSetShouldExit?.(!isOnMainScreen);
  }, [currentScreen, onSetShouldExit]);

  // Active Chats & Selected Chat
  const [chats, setChats] = useState<Chat[]>([]);
  const [clearedAtMap, setClearAtMap] = useState<Record<string, string>>({});
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const deletedChatIdsRef = useRef<Set<string>>(new Set());

  // Active Call Screen Overlay
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  // WebRTC streams for real calls
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const webrtcRef = useRef<WebRTCService | null>(null);

  // Ringback tone for outgoing calls (synthesized via Web Audio API)
  const ringbackCtxRef = useRef<AudioContext | null>(null);
  const ringbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ringtone for incoming calls (looped playback of ringtone.mp3)
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);

  const playIncomingRingtone = useCallback(() => {
    try {
      stopIncomingRingtone();
      const audio = new Audio('/sounds/ringtone.mp3');
      audio.loop = true;
      audio.volume = 0.8;
      ringtoneAudioRef.current = audio;
      audio.play().catch(() => {});
      console.log('[APP] 🔊 Incoming ringtone started');
    } catch (e) {
      console.warn('[APP] Failed to play incoming ringtone:', e);
    }
  }, []);

  const stopIncomingRingtone = useCallback(() => {
    if (ringtoneAudioRef.current) {
      try { ringtoneAudioRef.current.pause(); ringtoneAudioRef.current.currentTime = 0; } catch {}
      ringtoneAudioRef.current = null;
      console.log('[APP] 🔇 Incoming ringtone stopped');
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    try {
      if (notificationAudioRef.current) {
        try { notificationAudioRef.current.pause(); notificationAudioRef.current.currentTime = 0; } catch {}
      }
      const audio = new Audio('/sounds/notificacion.mp3');
      audio.volume = 0.7;
      notificationAudioRef.current = audio;
      audio.play().catch(() => {});
      console.log('[APP] 🔊 Notification sound played');
    } catch (e) {
      console.warn('[APP] Failed to play notification sound:', e);
    }
  }, []);

  const playRingbackTone = useCallback(() => {
    try {
      stopRingbackTone();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ringbackCtxRef.current = ctx;
      const playBeep = () => {
        if (!ringbackCtxRef.current) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 440;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.stop(ctx.currentTime + 0.4);
      };
      playBeep();
      ringbackIntervalRef.current = setInterval(playBeep, 1000);
      console.log('[WEBRTC SIGNALING] 🔊 Ringback tone started');
    } catch (e) {
      console.warn('[WEBRTC SIGNALING] Failed to play ringback tone:', e);
    }
  }, []);

  const stopRingbackTone = useCallback(() => {
    if (ringbackIntervalRef.current) {
      clearInterval(ringbackIntervalRef.current);
      ringbackIntervalRef.current = null;
    }
    if (ringbackCtxRef.current) {
      try { ringbackCtxRef.current.close(); } catch {}
      ringbackCtxRef.current = null;
      console.log('[WEBRTC SIGNALING] 🔇 Ringback tone stopped');
    }
  }, []);

  // Swipe-to-delete state
  const [swipedChatId, setSwipedChatId] = useState<string | null>(null);

  // Long-press context menu state
  const [contextMenuChat, setContextMenuChat] = useState<Chat | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const contextMenuChatRef = useRef<Chat | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forward message state
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const forwardingSearchRef = useRef<HTMLInputElement>(null);
  const [forwardSearchQuery, setForwardSearchQuery] = useState("");

  // Group creation state
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupMuted, setGroupMuted] = useState(false);
  const [groupAdminOnly, setGroupAdminOnly] = useState(false);

  // Search input filter
  const [searchQuery, setSearchQuery] = useState("");

  // Media editor state to hide navigation and maximize vertical screen space
  const [isEditingMedia, setIsEditingMedia] = useState(false);

  // RED ON Settings & Profile States
  const [userId, setUserId] = useState("");
  const [hideNumber, setHideNumber] = useState(false);
  const [doubleCheck, setDoubleCheck] = useState(true);
  const [blockedCount, setBlockedCount] = useState(0);
  const [twoStepVerification, setTwoStepVerification] = useState(false);
  const [twoStepPin, setTwoStepPin] = useState("");
  const [muteChats, setMuteChats] = useState(false);
  const [unreadBadges, setUnreadBadges] = useState(true);
  const [mobileDataUsage, setMobileDataUsage] = useState("Ahorro");
  const [autoDownloadPhotos, setAutoDownloadPhotos] = useState(true);
  const [appFont, setAppFont] = useState<"Clásico" | "Mono" | "Elegante" | "Moderno">("Clásico");
  const [backupDate, setBackupDate] = useState("");
  const [backupChatsCount, setBackupChatsCount] = useState(0);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Modal displays inside profile screen
  const [activeSettingsModal, setActiveSettingsModal] = useState<
    null | "cuenta" | "seguridad" | "notificaciones" | "datos" | "fuentes" | "ayuda" | "legal"
  >(null);

  // Toast notifications for user feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Profile editing
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Auto-reset editing state if screen changes
  useEffect(() => {
    if (currentScreen !== "business") {
      setIsEditingMedia(false);
    }
  }, [currentScreen]);

  const [flyers, setFlyers] = useState<BusinessFlyer[]>([]);

  // Load flyers from API on mount
  useEffect(() => {
    if (!user) return;
    getMyFlyers(user.id).then(apiFlyers => {
      if (!apiFlyers || apiFlyers.length === 0) return;
      const mapped: BusinessFlyer[] = apiFlyers.map((f: any) => ({
        id: f.id,
        businessName: f.business_name,
        description: f.description || '',
        location: f.location || '',
        flyerUrl: f.flyer_url || '',
        isGenerated: !!f.template_id,
        templateId: f.template_id || undefined,
        productName: f.product_name || undefined,
        price: f.price || undefined,
        musicUrl: f.music_url || '',
        musicName: f.music_name || '',
        views: f.views || 0,
        clicks: f.clicks || 0,
        ownerName: profile?.name || 'Usuario',
        ownerAvatar: profile?.avatar || profile?.avatar_url || '',
        ownerPhone: profile?.phone_number || '',
      }));
      setFlyers(mapped);
    }).catch(() => {});
  }, [user?.id]);

  const handleAddNewFlyer = async (newFlyer: BusinessFlyer) => {
    setFlyers(prev => [newFlyer, ...prev]);
    if (!user) return;
    try {
      await createFlyer({
        user_id: user.id,
        business_name: newFlyer.businessName,
        description: newFlyer.description,
        location: newFlyer.location,
        flyer_url: newFlyer.flyerUrl,
        template_id: newFlyer.templateId,
        product_name: newFlyer.productName,
        price: newFlyer.price,
        music_url: newFlyer.musicUrl,
        music_name: newFlyer.musicName,
      });
    } catch {}
  };

  const handleIncrementView = (flyerId: string) => {
    setFlyers(prev => prev.map(f => f.id === flyerId ? { ...f, views: f.views + 1 } : f));
    incrementFlyerView(flyerId).catch(() => {});
  };

  const handleIncrementClick = (flyerId: string) => {
    setFlyers(prev => prev.map(f => f.id === flyerId ? { ...f, clicks: f.clicks + 1 } : f));
    incrementFlyerClick(flyerId).catch(() => {});
  };

  const handleStartBusinessChat = (businessName: string, avatar: string, initialText: string, flyerId: string) => {
    const existing = chats.find(c => c.name.toLowerCase() === businessName.toLowerCase());
    let targetId = "";

    if (existing) {
      targetId = existing.id;
      const newMsg: Message = {
        id: "msg_biz_" + Date.now(),
        sender: "me",
        text: initialText,
        timestamp: "Ahora mismo",
        type: "text"
      };
      setChats(prev => prev.map(c => {
        if (c.id === targetId) {
          return {
            ...c,
            lastMessage: initialText,
            lastMessageTime: "Ahora mismo",
            messages: [...c.messages, newMsg]
          };
        }
        return c;
      }));
    } else {
      targetId = "chat_biz_" + Date.now();
      const newChat: Chat = {
        id: targetId,
        name: businessName,
        avatar: avatar,
        status: "online",
        lastMessage: initialText,
        lastMessageTime: "Ahora mismo",
        unreadCount: 0,
        messages: [
          {
            id: "msg_biz_" + Date.now(),
            sender: "me",
            text: initialText,
            timestamp: "Ahora mismo",
            type: "text"
          }
        ]
      };
      setChats(prev => [newChat, ...prev]);
    }

    setSelectedChatId(targetId);
    setCurrentScreen("chat_room");
  };

  const handleStartChatFromState = (name: string, avatar: string, initialText: string) => {
    const existing = chats.find(c => c.name.toLowerCase() === name.toLowerCase());
    let targetId = "";

    if (existing) {
      targetId = existing.id;
      const newMsg: Message = {
        id: "msg_state_reply_" + Date.now(),
        sender: "me",
        text: initialText,
        timestamp: "Ahora mismo",
        type: "text"
      };
      setChats(prev => prev.map(c => {
        if (c.id === targetId) {
          return {
            ...c,
            lastMessage: initialText,
            lastMessageTime: "Ahora mismo",
            messages: [...c.messages, newMsg]
          };
        }
        return c;
      }));
    } else {
      targetId = "chat_state_reply_" + Date.now();
      const newChat: Chat = {
        id: targetId,
        name: name,
        avatar: avatar,
        status: "online",
        lastMessage: initialText,
        lastMessageTime: "Ahora mismo",
        unreadCount: 0,
        messages: [
          {
            id: "msg_state_reply_" + Date.now(),
            sender: "me",
            text: initialText,
            timestamp: "Ahora mismo",
            type: "text"
          }
        ]
      };
      setChats(prev => [newChat, ...prev]);
    }

    setSelectedChatId(targetId);
    setCurrentScreen("chat_room");
  };

  const handleRegister = (name: string, phone: string, avatar: string) => {
    setRegisteredUser({ name, phone, avatar });
    setCurrentScreen("chats");
  };

  // Load Supabase chats when available (dedup already done in getChats service)
  useEffect(() => {
    if (supabaseChats.length > 0 && user) {
      const mapped = supabaseChats
        .filter((sc: any) => !deletedChatIdsRef.current.has(sc.id))
        .map((sc: any) => ({
        id: sc.id,
        name: sc.name,
        avatar: sc.avatar || "",
        status: sc.is_online ? "online" : "offline",
        lastMessage: (() => {
          const clearedAt = clearedAtMap[sc.id];
          if (clearedAt && sc.last_message_time && sc.last_message_time <= clearedAt) return "";
          return sc.last_message || "";
        })(),
        lastMessageTime: (() => {
          const clearedAt = clearedAtMap[sc.id];
          if (clearedAt && sc.last_message_time && sc.last_message_time <= clearedAt) return "";
          return sc.last_message_time
            ? (() => {
                const d = new Date(sc.last_message_time);
                const now = new Date();
                const isToday = d.toDateString() === now.toDateString();
                return isToday
                  ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : d.toLocaleDateString([], { day: "numeric", month: "short" });
              })()
            : "";
        })(),
        unreadCount: sc.unread_count || 0,
        partnerUserId: sc.profile_id === user.id ? sc.admin_id : sc.profile_id,
        isGroup: sc.is_group || false,
        messages: [],
      }));
      setChats(mapped);
    }
  }, [supabaseChats, user, clearedAtMap]);

  // Cargar TODOS los chat_clears del usuario de una sola vez (sin N+1)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("chat_clears")
          .select("chat_id, cleared_at")
          .eq("user_id", user.id);
        if (!data) return;
        const map: Record<string, string> = {};
        for (const row of data) {
          map[row.chat_id] = row.cleared_at;
        }
        setClearAtMap(map);
      } catch {}
    })();
  }, [user?.id]);

  const handleCloudBackup = () => {
    setIsBackingUp(true);
    setTimeout(() => {
      const now = new Date();
      const formattedDate = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
      setBackupDate(formattedDate);
      setBackupChatsCount(chats.length);
      setIsBackingUp(false);
      showToast("Copia de seguridad guardada con éxito ☁️");
    }, 1500);
  };

  const handleCloudRestore = () => {
    setIsRestoring(true);
    setTimeout(async () => {
      if (user) {
        try {
          await refreshChats();
        } catch {}
      }
      setIsRestoring(false);
      showToast("Mensajes restaurados con éxito 🔄");
    }, 1500);
  };

  const handleOpenSupportChat = async () => {
    const existing = chats.find(c =>
      c.name.toLowerCase().includes("soporte") && c.name.toLowerCase().includes("red on")
    );
    if (existing) {
      setSelectedChatId(existing.id);
      setCurrentScreen("chat_room");
    } else if (user) {
      try {
        const newChat = await createChatInSupabase({
          name: "Soporte RED ON 🛡️",
          avatar: "",
          profile_id: user.id,
          admin_id: user.id,
        });
        await refreshChats();
        if (newChat?.id) {
          setSelectedChatId(newChat.id);
          setCurrentScreen("chat_room");
        }
      } catch {}
    }
  };

  useEffect(() => {
    if (externalCallTrigger) {
      setActiveCall(externalCallTrigger);
      onClearExternalCallTrigger();
    }
  }, [externalCallTrigger, onClearExternalCallTrigger]);

  // Realtime subscription for incoming messages — update unreadCount badge
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const clearedAtMapRef = useRef(clearedAtMap);
  clearedAtMapRef.current = clearedAtMap;

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`messages-unread-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload: any) => {
        const msg = payload.new;
        if (!msg || msg.sender_id === user.id) return;
        const isCurrentChat = currentScreen === "chat_room" && selectedChatId === msg.chat_id;
        if (isCurrentChat) return;
        setChats(prev => prev.map(c => {
          if (c.id !== msg.chat_id) return c;
          const clearedAt = clearedAtMapRef.current[msg.chat_id];
          if (clearedAt && msg.created_at && msg.created_at <= clearedAt) return c;
          return { ...c, unreadCount: c.unreadCount + 1, lastMessage: msg.text || c.lastMessage };
        }));
      })
      .subscribe((status) => {
        console.log('[UNREAD] 📡 Messages unread subscription:', status);
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, currentScreen, selectedChatId]);

  // Realtime subscription for incoming calls from other users
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;
  contextMenuChatRef.current = contextMenuChat;
  showActionMenuRef.current = showActionMenu;

  // ChatRoom internal back handler (replyTo, editingMessage, etc.)
  const chatRoomBackHandlerRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    if (!user) return;
    console.log('[WEBRTC SIGNALING] 📡 Subscribing to Supabase Realtime calls for user:', user.id);
    const channel = supabase
      .channel(`calls-realtime-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `callee_id=eq.${user.id}`,
      }, async (payload: any) => {
        const call = payload.new;
        console.log('[WEBRTC SIGNALING] 📩 Realtime INSERT received:', JSON.stringify({ id: call.id, status: call.status, caller_id: call.caller_id, callee_id: call.callee_id, type: call.type }));
        if (call.status !== 'ringing') {
          console.log('[WEBRTC SIGNALING] ❌ Ignoring call with status:', call.status);
          return;
        }
        if (activeCallRef.current) {
          console.log('[WEBRTC SIGNALING] ❌ Already in a call, ignoring incoming call');
          return;
        }
        let callerName = "Desconocido";
        let callerAvatar = "";
        try {
          const { data } = await supabase
            .from("profiles")
            .select("name, avatar, avatar_url")
            .eq("id", call.caller_id)
            .single();
          if (data) {
            callerName = data.name || "Desconocido";
            callerAvatar = data.avatar || data.avatar_url || "";
          }
        } catch {}
        if (activeCallRef.current) return;
        console.log('[WEBRTC SIGNALING] ✅ Setting activeCall from Realtime — caller:', callerName, 'status: incoming');
        playIncomingRingtone();
        setActiveCall({
          id: call.id,
          contactName: callerName,
          contactAvatar: callerAvatar,
          type: call.type || "audio",
          status: "incoming",
          durationSeconds: 0,
          isMuted: false,
          isVideoOff: false,
          isGroup: false,
          targetUserId: call.caller_id,
        });
      })
      .subscribe((status) => {
        console.log('[WEBRTC SIGNALING] 📡 Realtime subscription status:', status);
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // ─── CALLER: Listen for call status UPDATE (callee accepted the call) ───
  // Replaced by onCalleeReady broadcast signal in webrtc.ts — no DB dependency needed.

  useEffect(() => {
    if (!user) return;
    const handleIncomingCall = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const d = typeof detail === 'string' ? JSON.parse(detail) : detail;
      const chatId = d?.chatId || d?.roomId || '';
      const incomingCallId = d?.callId;
      console.log('[WEBRTC SIGNALING] 📱 FCM incoming-call event received:', JSON.stringify(d));
      if (chatId && d?.callerId && !activeCallRef.current) {
        console.log('[WEBRTC SIGNALING] ✅ Setting activeCall from FCM — caller:', d.callerName, 'status: incoming, callId:', incomingCallId);
        playIncomingRingtone();
        setActiveCall({
          id: incomingCallId || ('call_' + Date.now()),
          contactName: d.callerName || 'Llamada entrante',
          contactAvatar: d.callerAvatar || '',
          type: d.callType || 'audio',
          status: 'incoming',
          durationSeconds: 0,
          isMuted: false,
          isVideoOff: false,
          isGroup: false,
          targetUserId: d.callerId,
        });
      } else if (chatId && d?.callerId && activeCallRef.current && activeCallRef.current.status === 'incoming') {
        const currentId = activeCallRef.current.id;
        if (incomingCallId && incomingCallId !== currentId && !incomingCallId.startsWith('call_')) {
          console.log('[WEBRTC SIGNALING] 📱 Updating callId from', currentId, 'to', incomingCallId);
          setActiveCall(prev => prev ? { ...prev, id: incomingCallId } : null);
        }
      } else {
        console.log('[WEBRTC SIGNALING] ❌ FCM incoming-call ignored:', { chatId, callerId: d?.callerId, hasActiveCall: !!activeCallRef.current });
      }
    };
    const handleOpenChat = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const d = typeof detail === 'string' ? JSON.parse(detail) : detail;
      if (d?.chatId) {
        setSelectedChatId(d.chatId);
        setCurrentScreen('chat_room');
      }
    };
    const handleNewMessage = (e: Event) => {
      console.log('[EVENT] ═══════ new-message-received DISPARADO ═══════');
      const detail = (e as CustomEvent).detail;
      console.log('[EVENT] raw detail:', typeof detail === 'string' ? detail : JSON.stringify(detail));
      const d = typeof detail === 'string' ? JSON.parse(detail) : detail;
      console.log('[EVENT] parsed chatId:', d?.chatId, 'contactId:', d?.contactId, 'body:', d?.body?.substring(0, 50));
      if (!d?.chatId) {
        console.log('[EVENT] ❌ No chatId, abortando');
        return;
      }
      console.log('[EVENT] selectedChatId:', selectedChatId, 'currentScreen:', currentScreen);
      setChats(prev => prev.map(chat => {
        if (chat.id === d.chatId) {
          const updated = { ...chat, unreadCount: chat.unreadCount + 1 };
          if (d.body) updated.lastMessage = d.body;
          return updated;
        }
        return chat;
      }));
      if (selectedChatId === d.chatId && currentScreen === 'chat_room') {
        setRefetchTrigger(n => n + 1);
      }
    };
    window.addEventListener('incoming-call', handleIncomingCall);
    window.addEventListener('open-chat', handleOpenChat);
    window.addEventListener('new-message-received', handleNewMessage);
    return () => {
      window.removeEventListener('incoming-call', handleIncomingCall);
      window.removeEventListener('open-chat', handleOpenChat);
      window.removeEventListener('new-message-received', handleNewMessage);
    };
  }, [user?.id, selectedChatId, currentScreen]);

  useEffect(() => {
    if (externalMessageTrigger) {
      const chatTarget = "nelson"; // Default target
      setChats((prevChats) =>
        prevChats.map((c) => {
          if (c.id === chatTarget) {
            return {
              ...c,
              unreadCount: currentScreen !== "chat_room" || selectedChatId !== chatTarget ? c.unreadCount + 1 : 0,
              lastMessage: externalMessageTrigger.text || "¡Archivo recibido!",
              lastMessageTime: externalMessageTrigger.timestamp,
              messages: [...c.messages, externalMessageTrigger]
            };
          }
          return c;
        })
      );
      onClearExternalMessageTrigger();
    }
  }, [externalMessageTrigger, currentScreen, selectedChatId, onClearExternalMessageTrigger]);

  const activeChat = chats.find((c) => c.id === selectedChatId);

  // Safety guard: if we're on chat_room but no activeChat, revert to chats
  useEffect(() => {
    if (currentScreen === "chat_room" && !activeChat) {
      setCurrentScreen("chats");
      setSelectedChatId(null);
    }
  }, [currentScreen, activeChat]);

  const handleSendMessageInRoom = (newMsg: Message) => {
    if (!selectedChatId) return;

    setChats((prevChats) =>
      prevChats.map((c) => {
        if (c.id === selectedChatId) {
          return {
            ...c,
            lastMessage: newMsg.text || "Archivo multimedia",
            lastMessageTime: newMsg.timestamp,
            messages: [...c.messages, newMsg]
          };
        }
        return c;
      })
    );
  };

  const cleanupCall = useCallback(() => {
    stopRingbackTone();
    stopIncomingRingtone();
    webrtcRef.current?.cleanup();
    webrtcRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
  }, [stopRingbackTone, stopIncomingRingtone]);

  const cleanupCallRef = useRef<(() => void) | null>(null);
  cleanupCallRef.current = cleanupCall;

  const handleTriggerCallFromChat = async (type: "audio" | "video") => {
    if (!activeChat || !user) return;
    console.log('[WEBRTC SIGNALING] 📞 Starting outgoing call to:', activeChat.name, 'type:', type);

    const partnerId = activeChat.partnerUserId || "";

    // Persist call in DB first to get a stable callId for WebRTC signaling
    let callId = "call_" + Date.now();
    if (partnerId) {
      try {
        console.log('[WEBRTC SIGNALING] 📞 Inserting call into DB...');
        const dbCall = await apiStartCall({
          caller_id: user.id,
          callee_id: partnerId,
          type,
          chat_id: activeChat.id,
        });
        if (dbCall?.id) callId = dbCall.id;
        console.log('[WEBRTC SIGNALING] ✅ Call inserted, id:', callId);
      } catch (e) { console.warn('[WEBRTC SIGNALING] apiStartCall error:', e); }
    }

    // Show call overlay IMMEDIATELY so the caller always sees "Llamando..."
    setActiveCall({
      id: callId,
      contactName: activeChat.name,
      contactAvatar: activeChat.avatar,
      type: type,
      status: "outgoing",
      durationSeconds: 0,
      isMuted: false,
      isVideoOff: false,
      isGroup: activeChat.id === "grupo_redon",
      targetUserId: partnerId
    });

    try {
      const webrtc = new WebRTCService(callId, user.id);
      webrtcRef.current = webrtc;

      webrtc.onRemoteStream = (stream) => {
        console.log('[WEBRTC CRÍTICO] 🎉 Emisor recibió remote stream — LLAMADA CONECTADA');
        setRemoteStream(stream);
        setActiveCall((prev) => prev ? { ...prev, status: "connected" } : null);
        stopRingbackTone();
      };

      webrtc.onConnectionStateChange = (state) => {
        console.log('[WEBRTC SIGNALING] 🔗 ICE state:', state);
      };

      webrtc.onCallEnded = () => {
        console.log('[WEBRTC SIGNALING] 📞 Call ended');
        stopRingbackTone();
        cleanupCall();
      };

      console.log('[WEBRTC SIGNALING] 📞 Getting local stream...');
      const local = await webrtc.startLocalStream(true, type === "video");
      setLocalStream(local);

      console.log('[WEBRTC SIGNALING] 📞 Creating peer connection...');
      await webrtc.createPeerConnection();
      console.log('[WEBRTC SIGNALING] 📞 Subscribing to signals...');
      await webrtc.subscribeToSignals();
      console.log('[WEBRTC SIGNALING] 📞 Creating offer...');
      await webrtc.createOffer();
      console.log('[WEBRTC SIGNALING] ✅ Offer sent — waiting for answer');

      playRingbackTone();

      if (partnerId) {
        console.log('[WEBRTC SIGNALING] 📞 Sending FCM push to:', partnerId);
        sendFcmPush(partnerId, profile?.name || 'RED ON', 'Llamada entrante...', {
          type: 'call', chatId: activeChat.id, callerId: user.id,
          callerName: profile?.name || 'RED ON', callType: type, callId: callId,
        });
      }

      // ICE connection timeout: auto-cleanup after 45s
      const iceTimeoutRef = { current: setTimeout(() => {
        if (webrtcRef.current && activeCallRef.current?.status === "outgoing") {
          console.warn('[WEBRTC SIGNALING] ⏰ ICE timeout — no connection after 45s');
          stopRingbackTone();
          cleanupCall();
        }
      }, 45000) };

      // When callee-ready signal arrives: cancel timeout + only resend if not yet connected
      webrtc.onCalleeReady = async () => {
        console.log('[WEBRTC SIGNALING] ✅ Callee is ready');
        clearTimeout(iceTimeoutRef.current);
        const remoteTracks = webrtcRef.current?.getRemoteStream()?.getTracks().length ?? 0;
        if (remoteTracks > 0) {
          console.log('[WEBRTC SIGNALING] ℹ️ Remote stream already has tracks, skipping resendOffer');
          return;
        }
        stopRingbackTone();
        try {
          await webrtc.resendOffer();
          console.log('[WEBRTC SIGNALING] ✅ Offer re-sent after callee-ready');
        } catch (e) {
          console.error('[WEBRTC SIGNALING] ❌ Failed to re-send offer:', e);
        }
      };

      // Clear timeout when remote stream arrives
      const origOnRemoteStream = webrtc.onRemoteStream;
      webrtc.onRemoteStream = (stream) => {
        clearTimeout(iceTimeoutRef.current);
        origOnRemoteStream?.(stream);
      };
    } catch (err) {
      console.error('[WEBRTC SIGNALING] ❌ Failed to start call:', err);
      stopRingbackTone();
      webrtcRef.current?.cleanup();
      webrtcRef.current = null;
      setLocalStream(null);
      setTimeout(() => cleanupCall(), 3000);
    }
  };

  const handleContactAddedByQr = async (name: string, avatar: string) => {
    if (user) {
      try {
        await refreshChats();
        await refreshContacts();
      } catch {}
    }
    setCurrentScreen("chats");
    showToast("Contacto agregado por QR ✅");
  };

  const getChatByPartnerId = useCallback((partnerId: string) => {
    return chats.find(c => {
      const otherId = "partnerUserId" in c ? (c as any).partnerUserId : null;
      if (otherId) return otherId === partnerId;
      return c.profile_id === partnerId || c.admin_id === partnerId;
    });
  }, [chats]);

  const handleStartChatFromSynced = async (profile: { id: string; name: string; contactName?: string; avatar_url?: string; phone_number?: string }) => {
    const displayName = profile.contactName || profile.name;
    const existing = getChatByPartnerId(profile.id);
    if (existing) {
      setSelectedChatId(existing.id);
      setCurrentScreen("chat_room");
    } else {
      try {
        const chat = await createChatInSupabase({
          name: displayName,
          avatar: profile.avatar_url || "",
          profile_id: profile.id,
          admin_id: user?.id || "",
        });
        refreshChats();
        if (chat?.id) {
          setChats(prev => {
            if (prev.some(c => c.id === chat.id)) return prev;
            return [{
              id: chat.id,
              name: displayName,
              avatar: profile.avatar_url || "",
              status: "online" as const,
              lastMessage: "",
              lastMessageTime: "",
              unreadCount: 0,
              partnerUserId: profile.id,
              messages: [],
            }, ...prev];
          });
          setSelectedChatId(chat.id);
          setCurrentScreen("chat_room");
        }
      } catch (e) {
        console.warn("Error starting chat:", e);
      }
    }
  };

  const handleStartChatFromCall = async (partnerId: string, name: string, avatar: string) => {
    const existing = getChatByPartnerId(partnerId);
    if (existing) {
      setSelectedChatId(existing.id);
      setCurrentScreen("chat_room");
    } else {
      try {
        const chat = await createChatInSupabase({
          name,
          avatar,
          profile_id: partnerId,
          admin_id: user?.id || "",
        });
        refreshChats();
        if (chat?.id) {
          setChats(prev => {
            if (prev.some(c => c.id === chat.id)) return prev;
            return [{
              id: chat.id,
              name,
              avatar,
              status: "online" as const,
              lastMessage: "",
              lastMessageTime: "",
              unreadCount: 0,
              partnerUserId: partnerId,
              messages: [],
            }, ...prev];
          });
          setSelectedChatId(chat.id);
          setCurrentScreen("chat_room");
        }
      } catch (e) {
        console.warn("Error starting chat from calls:", e);
      }
    }
  };

  const handleCreateGroup = async () => {
    if (!user || selectedGroupMembers.length < 1) return;
    try {
      const memberProfiles = appContacts
        .filter(c => selectedGroupMembers.includes(c.id || c.contact_user_id || ""))
        .map(c => ({
          name: c.name || "Usuario",
          id: c.contact_user_id || c.id || "",
        }));
      const finalGroupName = groupNameInput.trim() || 
        memberProfiles.map(m => m.name.split(" ")[0]).slice(0, 5).join(", ") + (memberProfiles.length > 5 ? "..." : "");
      const groupChat = await createGroupChat(finalGroupName, user.id, selectedGroupMembers, groupAdminOnly);
      refreshChats();
      setSelectedGroupMembers([]);
      setGroupSearchQuery("");
      setGroupNameInput("");
      setGroupMuted(false);
      setGroupAdminOnly(false);
      if (groupChat?.id) {
        setChats(prev => {
          if (prev.some(c => c.id === groupChat.id)) return prev;
          return [{
            id: groupChat.id,
            name: finalGroupName,
            avatar: "",
            status: "online" as const,
            lastMessage: "",
            lastMessageTime: "",
            unreadCount: 0,
            messages: [],
            isGroup: true,
          }, ...prev];
        });
        setSelectedChatId(groupChat.id);
        setCurrentScreen("chat_room");
      }
    } catch (e) {
      console.error("[GROUP] Error creating group:", e);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    setSwipedChatId(null);
    setContextMenuChat(null);
    setContextMenuPos(null);
    if (user?.id && !chatId.startsWith("chat_biz_") && !chatId.startsWith("chat_state_")) {
      try {
        await apiDeleteChat(chatId, user.id);
        deletedChatIdsRef.current.add(chatId);
        setChats(prev => prev.filter(c => c.id !== chatId));
        if (selectedChatId === chatId) {
          setSelectedChatId(null);
          setCurrentScreen("chats");
        }
      } catch (e) {
        console.warn("[CHAT] Delete chat API error:", e);
        showToast("Error al eliminar chat");
      }
    } else {
      deletedChatIdsRef.current.add(chatId);
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        setCurrentScreen("chats");
      }
    }
  };

  const handleClearMessages = async (chat: Chat) => {
    setChats(prev => prev.map(c =>
      c.id === chat.id
        ? { ...c, lastMessage: "", lastMessageTime: "", unreadCount: 0, messages: [] }
        : c
    ));
    setContextMenuChat(null);
    setContextMenuPos(null);
    try {
      const isLocalChat = chat.id.startsWith("chat_biz_") || chat.id.startsWith("chat_state_reply_");
      if (!isLocalChat) {
        const now = new Date().toISOString();
        await clearForMe(chat.id);
        setClearAtMap(prev => ({ ...prev, [chat.id]: now }));
      }
      showToast("Mensajes eliminados");
    } catch (e) {
      console.error("[CHAT] clearForMe error:", e);
      showToast("Error al eliminar mensajes");
    }
  };

  const handleLongPress = (chat: Chat, clientX: number, clientY: number) => {
    setSwipedChatId(null);
    setContextMenuChat(chat);
    setContextMenuPos({ x: clientX, y: clientY });
  };

  const startLongPressTimer = (chat: Chat, clientX: number, clientY: number) => {
    longPressTimer.current = setTimeout(() => {
      handleLongPress(chat, clientX, clientY);
      longPressTimer.current = null;
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const closeContextMenu = () => {
    setContextMenuChat(null);
    setContextMenuPos(null);
  };

  const filteredChats = chats.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative w-screen h-screen bg-white flex flex-col overflow-hidden select-none">
      {/* Toast Alert Notification */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] bg-slate-950/90 backdrop-blur-md text-white text-[10px] font-black px-4 py-2 rounded-2xl border border-teal-500/30 flex items-center gap-2 shadow-lg animate-fade-in pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping"></span>
          {toastMessage}
        </div>
      )}

      
      {/* ACTIVE CALL OVERLAY */}
      {activeCall && (
        <CallOverlay
          call={activeCall}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={async () => {
            if (!user) return;
            const callId = activeCall.id;
            const callType = activeCall.type;
            console.log('[WEBRTC SIGNALING] ✅ Call accepted by receiver, callId:', callId);
            stopIncomingRingtone();

            try {
              const webrtc = new WebRTCService(callId, user.id);
              webrtcRef.current = webrtc;

              webrtc.onRemoteStream = (stream) => {
                console.log('[WEBRTC SIGNALING] 📹 Remote stream received on callee side — call CONNECTED');
                setRemoteStream(stream);
                setActiveCall((prev) => prev ? { ...prev, status: "connected" } : null);
              };

              webrtc.onConnectionStateChange = (state) => {
                console.log('[WEBRTC SIGNALING] 🔗 Callee ICE state:', state);
              };

              webrtc.onCallEnded = () => {
                console.log('[WEBRTC SIGNALING] 📞 Call ended (callee)');
                cleanupCall();
              };

              console.log('[WEBRTC SIGNALING] 📞 Callee: getting local stream...');
              const local = await webrtc.startLocalStream(true, callType === "video");
              setLocalStream(local);
              console.log('[WEBRTC SIGNALING] ✅ Callee: getUserMedia done');

              console.log('[WEBRTC SIGNALING] 📞 Callee: creating PeerConnection FIRST (before subscribe)...');
              await webrtc.createPeerConnection();
              console.log('[WEBRTC SIGNALING] ✅ Callee: PeerConnection created, this.pc is ready');

              console.log('[WEBRTC SIGNALING] 📞 Callee: subscribing to signals...');
              await webrtc.subscribeToSignals();
              console.log('[WEBRTC SIGNALING] ✅ Callee: subscribed to signals');

              webrtc.signalCalleeReady()
                .then(() => console.log('[WEBRTC SIGNALING] ✅ Callee-ready signal sent'))
                .catch((e) => console.warn('[WEBRTC SIGNALING] ⚠️ Callee-ready signal failed:', e?.message));

              setActiveCall((prev) => prev ? { ...prev, status: "connecting" } : null);
            } catch (err) {
              console.error('[WEBRTC SIGNALING] ❌ Failed to accept call:', err);
            }
          }}
          onDecline={() => {
            console.log('[WEBRTC SIGNALING] ❌ Call declined');
            stopIncomingRingtone();
            cleanupCall();
          }}
          onToggleMute={() => {
            setActiveCall((prev) => {
              const next = prev ? { ...prev, isMuted: !prev.isMuted } : null;
              if (next) webrtcRef.current?.setMuted(next.isMuted);
              return next;
            });
          }}
          onToggleVideo={() => {
            setActiveCall((prev) => {
              const next = prev ? { ...prev, isVideoOff: !prev.isVideoOff } : null;
              if (next) webrtcRef.current?.setVideoEnabled(!next.isVideoOff);
              return next;
            });
          }}
          onEndCall={async () => {
            console.log('[WEBRTC SIGNALING] 📞 Ending call');
            stopRingbackTone();
            await webrtcRef.current?.endCall();
            cleanupCall();
          }}
        />
      )}

      {/* 1. WELCOME SCREEN / REGISTER WINDOW */}
      {!registeredUser || currentScreen === "welcome" ? (
        <WelcomeScreen onRegister={handleRegister} />
      ) : (
        // 2. SINGLE SCREEN MOBILE LAYOUT
        <div className={`flex-1 flex flex-col overflow-hidden bg-white text-slate-800 relative h-full ${
          appFont === "Mono" ? "font-mono" : 
          appFont === "Elegante" ? "font-serif" : 
          appFont === "Moderno" ? "font-sans tracking-tight font-semibold" : 
          "font-sans"
        }`}>
          
          {currentScreen === "chat_room" && activeChat ? (
            <ChatRoom
              chat={activeChat}
              onBack={() => {
                setSelectedChatId(null);
                setCurrentScreen("chats");
              }}
              onSendMessage={handleSendMessageInRoom}
              onTriggerCall={handleTriggerCallFromChat}
              onForwardMessage={setForwardingMessage}
              onChatDeleted={(chatId) => {
                deletedChatIdsRef.current.add(chatId);
                setChats(prev => prev.filter(c => c.id !== chatId));
                setSelectedChatId(null);
                setCurrentScreen("chats");
              }}
              onMessageDeleted={(chatId, messageId) => {
                setChats(prev => prev.map(c => {
                  if (c.id !== chatId) return c;
                  const remaining = c.messages.filter(m => m.id !== messageId);
                  const last = remaining.length > 0 ? remaining[remaining.length - 1] : null;
                  const newLastMsg = last ? (last.text || "Archivo multimedia") : "";
                  const newLastTime = last ? last.timestamp : "";
                  return { ...c, lastMessage: newLastMsg, lastMessageTime: newLastTime, messages: remaining };
                }));
              }}
              onChatCleared={(chatId) => {
                const now = new Date().toISOString();
                setClearAtMap(prev => ({ ...prev, [chatId]: now }));
              }}
              currentUserId={user?.id}
              currentUserName={profile?.name}
              refetchTrigger={refetchTrigger}
              onRegisterBackHandler={(handler) => { chatRoomBackHandlerRef.current = handler; }}
            />
          ) : currentScreen === "qr_scanner" ? (
            <QrScanner
              userName={registeredUser?.name || "Nelson Castro"}
              userPhone={registeredUser?.phone || "+58 412 1234567"}
              onBack={() => setCurrentScreen("chats")}
              onContactAdded={handleContactAddedByQr}
            />
          ) : currentScreen === "my_qr" ? (
            <MyQrCode
              userId={user?.id || ""}
              name={registeredUser?.name || ""}
              phone={registeredUser?.phone || ""}
              avatar={registeredUser?.avatar || ""}
              onBack={() => setCurrentScreen("chats")}
            />
          ) : currentScreen === "add_contact" ? (
            <AddContact
              currentUserId={user?.id || ""}
              onBack={() => setCurrentScreen("chats")}
              onContactAdded={handleContactAddedByQr}
            />
          ) : currentScreen === "add_contact_manual" ? (
            <AddContactManual
              currentUserId={user?.id || ""}
              currentUserPhone={profile?.phone_number || registeredUser?.phone || ""}
              onBack={() => setCurrentScreen("chats")}
            />
          ) : currentScreen === "synced_contacts" ? (
            <SyncedContacts
              currentUserId={user?.id || ""}
              onBack={() => setCurrentScreen("chats")}
              onStartChat={handleStartChatFromSynced}
            />
          ) : currentScreen === "create_group" ? (
            // GROUP CREATION SCREEN
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              <div className="bg-[#0a4d52] px-4 pt-5 pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <button onClick={() => setCurrentScreen("chats")} className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
                    <ArrowLeft className="w-5 h-5 text-teal-100" />
                  </button>
                  <div>
                    <h3 className="text-sm font-bold text-white">Nuevo Grupo</h3>
                    <p className="text-[10px] text-teal-200">{selectedGroupMembers.length} participantes</p>
                  </div>
                </div>
              </div>

              {/* Group name input */}
              <div className="px-4 py-3 border-b border-slate-100">
                <input
                  type="text"
                  placeholder="Nombre del grupo (opcional)"
                  value={groupNameInput}
                  onChange={e => setGroupNameInput(e.target.value)}
                  className="w-full bg-slate-100 text-slate-800 placeholder-slate-400 text-xs px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
                />
              </div>

              {/* Search contacts */}
              <div className="px-4 py-2 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar contactos..."
                    value={groupSearchQuery}
                    onChange={e => setGroupSearchQuery(e.target.value)}
                    className="w-full bg-slate-100 text-slate-800 placeholder-slate-400 text-xs pl-9 pr-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
                  />
                </div>
              </div>

              {/* Contact list */}
              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5">
                {appContacts
                  .filter(c => c.name?.toLowerCase().includes(groupSearchQuery.toLowerCase()) || c.phone?.toLowerCase().includes(groupSearchQuery.toLowerCase()))
                  .map(contact => {
                    const isSelected = selectedGroupMembers.includes(contact.id || contact.contact_user_id || "");
                    const contactId = contact.id || contact.contact_user_id || "";
                    return (
                      <button
                        key={contactId}
                        onClick={() => {
                          setSelectedGroupMembers(prev =>
                            isSelected ? prev.filter(id => id !== contactId) : [...prev, contactId]
                          );
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? "bg-teal-500 border-teal-500" : "border-slate-300"
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        {contact.avatar ? (
                          <img src={contact.avatar} alt={contact.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                            <span className="text-white font-bold text-[10px]">
                              {(contact.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                            </span>
                          </div>
                        )}
                        <div className="text-left">
                          <p className="text-[11px] font-bold text-slate-800">{contact.name}</p>
                          <p className="text-[9px] text-slate-400">{contact.phone || "Sin teléfono"}</p>
                        </div>
                      </button>
                    );
                  })}
                {appContacts.length === 0 && (
                  <p className="text-[10px] text-slate-400 text-center py-8">No hay contactos disponibles</p>
                )}
              </div>

              {selectedGroupMembers.length >= 1 && (
                <div className="px-4 py-3 border-t border-slate-100 bg-white space-y-2.5">
                  {/* Mute toggle */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      <span className="text-[11px] font-semibold text-slate-700">Silenciar grupo</span>
                    </div>
                    <button
                      onClick={() => setGroupMuted(!groupMuted)}
                      className={`w-9 h-5 rounded-full transition-colors relative ${groupMuted ? "bg-teal-500" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${groupMuted ? "translate-x-4.5 left-0.5" : "left-0.5"}`}></span>
                    </button>
                  </label>

                  {/* Admin-only posting toggle */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span className="text-[11px] font-semibold text-slate-700">Solo admins pueden escribir</span>
                    </div>
                    <button
                      onClick={() => setGroupAdminOnly(!groupAdminOnly)}
                      className={`w-9 h-5 rounded-full transition-colors relative ${groupAdminOnly ? "bg-teal-500" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${groupAdminOnly ? "translate-x-4.5 left-0.5" : "left-0.5"}`}></span>
                    </button>
                  </label>

                  <button
                    onClick={handleCreateGroup}
                    className="w-full py-2.5 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-xl text-xs font-bold transition-colors"
                  >
                    Crear Grupo
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Tab screen (Chats, Contacts, States, Channels, Rates, Business, Profile)
            <div className="flex-1 flex flex-col overflow-hidden h-full relative">
              
              {/* Header section based on selected tab */}
              {currentScreen === "chats" && (
                <div className="absolute top-0 left-0 right-0 text-white px-5 pt-6 pb-12 overflow-hidden z-20 h-[170px] pointer-events-none">
                  <svg
                    viewBox="0 0 320 180"
                    className="absolute inset-0 w-full h-full z-0 select-none"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="headerGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#14b8a6" />
                        <stop offset="50%" stopColor="#197a82" />
                        <stop offset="100%" stopColor="#3ab3b8" />
                      </linearGradient>
                      <linearGradient id="headerGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#0a4c51" />
                        <stop offset="50%" stopColor="#10646a" />
                        <stop offset="100%" stopColor="#188c94" />
                      </linearGradient>
                      <linearGradient id="headerGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#073337" />
                        <stop offset="50%" stopColor="#0a4d52" />
                        <stop offset="100%" stopColor="#116b72" />
                      </linearGradient>
                    </defs>
                    <path d="M0,0 L0,150 C80,210 200,90 320,165 L320,0 Z" fill="url(#headerGrad1)" opacity="0.3" />
                    <path d="M0,0 L0,135 C100,195 220,105 320,145 L320,0 Z" fill="url(#headerGrad2)" opacity="0.55" />
                    <path d="M0,0 L0,115 C80,165 180,75 320,120 L320,0 Z" fill="url(#headerGrad3)" />
                  </svg>

                  <div className="relative z-10 flex justify-between items-center mb-3.5 pointer-events-auto">
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-md">Messages</h1>
                    </div>
                    
                    <div className="flex items-center gap-2.5">
                      <button 
                        onClick={() => setCurrentScreen("qr_scanner")}
                        className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/10 text-white transition-all cursor-pointer"
                        title="Escanear QR"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setCurrentScreen("profile")}
                        className="w-8 h-8 rounded-full border border-white/20 overflow-hidden transition-all cursor-pointer hover:scale-110 shadow-sm"
                        title="Tu Perfil"
                      >
                        <img 
                          src={registeredUser?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80"} 
                          alt="Profile" 
                          className="w-full h-full object-cover" 
                        />
                      </button>
                    </div>
                  </div>

                  <div className="relative z-10 pointer-events-auto">
                    <Search className="absolute left-4 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white text-slate-800 placeholder-slate-400 text-xs pl-10 pr-4 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-100 outline-none transition-all focus:ring-2 focus:ring-teal-400/20"
                    />
                  </div>
                </div>
              )}

              {currentScreen === "states" && (
                <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Estados Red On</h3>
                  <p className="text-[10px] text-teal-100/85">Visualiza y responde a estados</p>
                </div>
              )}

              {currentScreen === "channels" && (
                <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Canales Informativos</h3>
                  <p className="text-[10px] text-teal-100/85">Sigue canales seguros y oficiales</p>
                </div>
              )}

              {currentScreen === "calls" && (
                <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Historial de Llamadas</h3>
                  <p className="text-[10px] text-teal-100/85">Llamadas recientes de audio y video</p>
                </div>
              )}

              {currentScreen === "rates" && (
                <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Tasas de Cambio</h3>
                  <p className="text-[10px] text-teal-100/85">Calculadora de divisas oficial</p>
                </div>
              )}

              {currentScreen === "business" && (
                <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Modo Emprendedor</h3>
                  <p className="text-[10px] text-teal-100/85">Folletería digital interactiva</p>
                </div>
              )}

              {currentScreen === "profile" && (
                <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Tu Perfil Seguro</h3>
                  <p className="text-[10px] text-teal-100/85">Datos e información de sesión</p>
                </div>
              )}

              {/* Main Tab Content Body */}
              <div className={`flex-1 overflow-y-auto bg-white relative flex flex-col h-full ${
                currentScreen === "chats" ? "pt-[170px]" : ""
              }`}>
                
                {/* CHATS LIST */}
                {currentScreen === "chats" && (
                  <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3.5">
                    {/* Recent Section Header */}
                    <div className="flex justify-between items-center px-1 mb-1">
                      <h2 className="text-sm font-extrabold text-slate-950 tracking-tight">Recent</h2>
                      <button className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                        <span className="text-lg font-bold leading-none">•••</span>
                      </button>
                    </div>

                    {filteredChats.map((chat) => {
                      const isSwiped = swipedChatId === chat.id;
                      let touchStartX = 0;
                      let touchStartY = 0;
                      let currentTranslate = 0;
                      let isDragging = false;

                      const onTouchStart = (e: React.TouchEvent) => {
                        cancelLongPress();
                        touchStartX = e.touches[0].clientX;
                        touchStartY = e.touches[0].clientY;
                        currentTranslate = isSwiped ? 80 : 0;
                        isDragging = false;
                        startLongPressTimer(chat, e.touches[0].clientX, e.touches[0].clientY);
                      };

                      const onTouchMove = (e: React.TouchEvent) => {
                        const dx = e.touches[0].clientX - touchStartX;
                        const dy = e.touches[0].clientY - touchStartY;
                        if (!isDragging && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                        cancelLongPress();
                        if (Math.abs(dy) > Math.abs(dx)) return;
                        isDragging = true;
                        if (dx > 0) {
                          const el = e.currentTarget as HTMLElement;
                          currentTranslate = Math.max(0, Math.min(80, dx));
                          el.style.transform = `translateX(${currentTranslate}px)`;
                          el.style.transition = 'none';
                        }
                      };

                      const onTouchEnd = (e: React.TouchEvent) => {
                        cancelLongPress();
                        const el = e.currentTarget as HTMLElement;
                        el.style.transition = 'transform 0.2s ease';
                        if (isDragging && currentTranslate >= 50) {
                          el.style.transform = 'translateX(80px)';
                          setSwipedChatId(chat.id);
                        } else {
                          el.style.transform = 'translateX(0px)';
                          if (swipedChatId === chat.id) setSwipedChatId(null);
                        }
                        currentTranslate = 0;
                        isDragging = false;
                      };

                      return (
                        <div key={chat.id} className="relative overflow-hidden rounded-2xl">
                          {/* Delete button behind */}
                          <div className="absolute inset-0 flex items-center justify-end bg-rose-500 rounded-2xl pr-4">
                            <button
                              onClick={() => handleDeleteChat(chat.id)}
                              className="text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              Eliminar
                            </button>
                          </div>

                          {/* Foreground content */}
                          <div
                            onClick={() => {
                              if (contextMenuChat) { closeContextMenu(); return; }
                              if (swipedChatId) {
                                setSwipedChatId(null);
                                return;
                              }
                              setSelectedChatId(chat.id);
                              setCurrentScreen("chat_room");
                              setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unreadCount: 0 } : c));
                            }}
                            onTouchStart={onTouchStart}
                            onTouchMove={onTouchMove}
                            onTouchEnd={onTouchEnd}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handleLongPress(chat, e.clientX, e.clientY);
                            }}
                            onMouseDown={(e) => {
                              if (contextMenuChat) { closeContextMenu(); return; }
                              if (swipedChatId) {
                                const startX = e.clientX;
                                const onMouseMove = (ev: MouseEvent) => {
                                  const dx = ev.clientX - startX;
                                  if (dx > 20 || dx < -20) {
                                    setSwipedChatId(null);
                                  }
                                };
                                const onMouseUp = () => {
                                  document.removeEventListener('mousemove', onMouseMove);
                                  document.removeEventListener('mouseup', onMouseUp);
                                };
                                document.addEventListener('mousemove', onMouseMove);
                                document.addEventListener('mouseup', onMouseUp);
                              }
                            }}
                            className={`relative flex items-start gap-3.5 p-2.5 border border-transparent hover:border-slate-100 hover:bg-slate-50 rounded-2xl transition-all cursor-pointer animate-fade-in bg-white z-10 ${
                              isSwiped ? 'shadow-lg' : ''
                            }`}
                            style={isSwiped ? { transform: 'translateX(80px)' } : undefined}
                          >
                            <div className="relative shrink-0">
                              <div className={`p-[2px] rounded-full border-2 border-dashed ${chat.isGroup ? "border-purple-500/90" : "border-rose-500/90"} transition-transform hover:rotate-12 duration-500`}>
                                {chat.isGroup ? (
                                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                      <circle cx="9" cy="7" r="4" />
                                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                    </svg>
                                  </div>
                                ) : chat.avatar ? (
                                  <img src={chat.avatar} alt={chat.name} className="w-11 h-11 rounded-full object-cover" />
                                ) : (
                                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                                    <span className="text-white font-black text-sm">
                                      {chat.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {!chat.isGroup && chat.status === "online" && (
                                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white z-10"></span>
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex justify-between items-baseline mb-0.5">
                                <h4 className="text-sm font-bold text-slate-950 truncate">{chat.name}</h4>
                                <span className="text-[10px] text-slate-400 font-medium">{chat.lastMessageTime}</span>
                              </div>
                              <div className="flex items-center justify-between gap-1">
                                <p className="text-xs text-slate-500 truncate max-w-[180px]">{chat.lastMessage}</p>
                                
                                {chat.unreadCount > 0 ? (
                                  <span className="bg-[#25D366] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shadow-sm shrink-0">
                                    {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                                  </span>
                                ) : (
                                  <CheckCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {filteredChats.length === 0 && (
                      <div className="text-center py-12 text-slate-400 space-y-1">
                        <p className="text-xs font-semibold">No se encontraron chats</p>
                        <p className="text-[10px]">Prueba escribiendo otro nombre</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Context menu overlay */}
                {contextMenuChat && contextMenuPos && (
                  <>
                    <div className="fixed inset-0 z-50" onClick={closeContextMenu} />
                    <div
                      className="fixed z-50 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[200px] animate-fade-in"
                      style={{
                        top: Math.min(contextMenuPos.y, window.innerHeight - 160),
                        left: Math.min(contextMenuPos.x, window.innerWidth - 220),
                      }}
                    >
                      <div className="px-3 py-2 border-b border-slate-100">
                        <p className="text-[11px] font-bold text-slate-800 truncate">{contextMenuChat.name}</p>
                      </div>
                      <button
                        onClick={() => handleClearMessages(contextMenuChat)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <rect x="4" y="6" width="16" height="14" rx="1" />
                        </svg>
                        Borrar mensajes
                      </button>
                      <button
                        onClick={() => handleDeleteChat(contextMenuChat.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Eliminar chat
                      </button>
                    </div>
                  </>
                )}

                {/* STATES TAB */}
                {currentScreen === "states" && (
                  <StatesPanel onStartChat={handleStartChatFromState} />
                )}

                {/* CHANNELS TAB */}
                {currentScreen === "channels" && (
                  <ChannelsPanel />
                )}

                {/* CONTACTS TAB */}
                {currentScreen === "contacts" && (
                  <ContactsList
                    contacts={dedupedContacts}
                    onSelectContact={(contact) => {
                      if (!contact.contact_user_id) return;
                      const existing = getChatByPartnerId(contact.contact_user_id);
                      if (existing) {
                        setSelectedChatId(existing.id);
                        setCurrentScreen("chat_room");
                      } else {
                        handleStartChatFromSynced({
                          id: contact.contact_user_id,
                          name: contact.name,
                          contactName: contact.name,
                          avatar_url: contact.avatar || "",
                          phone_number: contact.phone || "",
                        });
                      }
                    }}
                    onAddContact={() => setCurrentScreen("add_contact_manual")}
                  />
                )}

                {/* CALLS TAB */}
                {currentScreen === "calls" && user && (
                  <CallLog
                    userId={user.id}
                    onBack={() => setCurrentScreen("chats")}
                    onStartChat={handleStartChatFromCall}
                  />
                )}

                {/* RATES TAB */}
                {currentScreen === "rates" && (
                  <RatesPanel />
                )}

                {/* BUSINESS TAB */}
                {currentScreen === "business" && (
                  <BusinessPanel
                    onStartBusinessChat={handleStartBusinessChat}
                    flyers={flyers}
                    onAddFlyer={handleAddNewFlyer}
                    onIncrementView={handleIncrementView}
                    onIncrementClick={handleIncrementClick}
                    onEditingChange={setIsEditingMedia}
                  />
                )}

                {/* PROFILE TAB */}
                {currentScreen === "profile" && registeredUser && (
                  <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 h-full relative">
                    {/* Top User Profile Header */}
                    <div className="bg-gradient-to-b from-[#0a4d52] to-[#10646a] text-white p-5 text-center relative shrink-0 shadow-md">
                      <div className="absolute top-4 right-4 bg-white/10 backdrop-blur-md px-2 py-0.5 rounded-full text-[8px] font-bold tracking-widest text-teal-200">
                        VERSIÓN PRO
                      </div>
                      <div className="relative inline-block mt-2 group">
                        <img 
                          src={registeredUser.avatar} 
                          alt="Profile" 
                          className="w-14 h-14 rounded-full mx-auto object-cover border-4 border-white/20 shadow-lg" 
                        />
                        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full"></span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !user) return;
                            try {
                              const blob = new Blob([await file.arrayBuffer()], { type: file.type });
                              const url = await uploadAvatar(blob, user.id);
                              await updateProfile(user.id, { avatar_url: url, avatar: url });
                              await refreshProfile();
                              setRegisteredUser(prev => prev ? { ...prev, avatar: url } : prev);
                              showToast("Foto de perfil actualizada ✅");
                            } catch (err) {
                              console.error("Avatar upload failed:", err);
                              showToast("Error al subir la foto ❌");
                            }
                          }}
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="absolute inset-0 bg-black/0 group-hover:bg-black/40 rounded-full transition-all flex items-center justify-center cursor-pointer"
                        >
                          <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                        </button>
                      </div>
                      {isEditingProfile ? (
                        <div className="mt-3 flex flex-col items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="bg-white/15 text-white text-sm font-black text-center px-3 py-1.5 rounded-xl border border-white/30 outline-none w-48"
                            placeholder="Tu nombre"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                if (!editName.trim() || !user) return;
                                try {
                                  await updateProfile(user.id, { name: editName.trim() });
                                  await refreshProfile();
                                  setRegisteredUser(prev => prev ? { ...prev, name: editName.trim() } : prev);
                                  setIsEditingProfile(false);
                                  showToast("Nombre actualizado ✅");
                                } catch (err) {
                                  console.error("Name update failed:", err);
                                  showToast("Error al actualizar nombre ❌");
                                }
                              }}
                              className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-white font-black text-[10px] rounded-xl transition-colors cursor-pointer"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={() => setIsEditingProfile(false)}
                              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white font-black text-[10px] rounded-xl transition-colors cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h4 className="text-sm font-black mt-2 tracking-tight">{registeredUser.name}</h4>
                          <p className="text-[10px] text-teal-200 font-mono mt-0.5">{registeredUser.phone}</p>
                          <div className="flex items-center justify-center gap-2 mt-1">
                            <button
                              onClick={() => {
                                setEditName(registeredUser.name);
                                setIsEditingProfile(true);
                              }}
                              className="px-2.5 py-0.5 bg-white/10 hover:bg-white/20 text-[9px] font-bold rounded-lg transition-colors cursor-pointer"
                            >
                              Editar perfil
                            </button>
                          </div>
                        </>
                      )}
                      <div className="bg-black/15 py-0.5 px-3 rounded-full inline-block mt-2 text-[9px] font-bold text-teal-100">
                        {userId}
                      </div>
                    </div>

                    {/* Scrollable Settings Panel */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 pb-20 scrollbar-thin">
                      
                      <div className="text-[10px] font-black text-slate-400 tracking-wider uppercase px-1">
                        Ajustes de RED ON
                      </div>

                      {/* Settings Cards list */}
                      <div className="space-y-2.5">
                        
                        {/* 1. CUENTA */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                          <div className="p-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-600">
                                <CircleUser className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="text-[11px] font-black text-slate-800">Cuenta</div>
                                <div className="text-[9px] text-slate-400">Privacidad de número, cambio de ID</div>
                              </div>
                            </div>
                            <button
                              onClick={() => setActiveSettingsModal("cuenta")}
                              className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-[#0a4d52] font-extrabold text-[9px] rounded-lg transition-colors cursor-pointer"
                            >
                              Cambiar
                            </button>
                          </div>
                        </div>

                        {/* 2. PRIVACIDAD Y SEGURIDAD */}
                        <button
                          onClick={() => setActiveSettingsModal("seguridad")}
                          className="w-full text-left bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 active:scale-[0.99] transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-600">
                              <Shield className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-800">Privacidad y Seguridad</div>
                              <div className="text-[9px] text-slate-400">Doble check, bloqueos, verificación en 2 pasos</div>
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                        </button>

                        {/* 3. NOTIFICACIONES */}
                        <button
                          onClick={() => setActiveSettingsModal("notificaciones")}
                          className="w-full text-left bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 active:scale-[0.99] transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-600">
                              <Bell className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-800">Notificaciones</div>
                              <div className="text-[9px] text-slate-400">Silenciar chats, globos en icono de app</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {muteChats && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>}
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </button>

                        {/* 4. DATOS Y ALMACENAMIENTO */}
                        <button
                          onClick={() => setActiveSettingsModal("datos")}
                          className="w-full text-left bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 active:scale-[0.99] transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600">
                              <Database className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-800">Datos y Almacenamiento</div>
                              <div className="text-[9px] text-slate-400">Uso de red móvil, autodescarga de fotos</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[8px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{mobileDataUsage}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </button>

                        {/* 5. FUENTES */}
                        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-600">
                                <Type className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="text-[11px] font-black text-slate-800">Fuentes</div>
                                <div className="text-[9px] text-slate-400">Personaliza el estilo de letra de la app</div>
                              </div>
                            </div>
                            <span className="text-[8px] font-black text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">Desactivado</span>
                          </div>
                          
                          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-100/50">
                            <span className="text-[10px] font-bold text-slate-600">A</span>
                            <button
                              onClick={() => setActiveSettingsModal("fuentes")}
                              className="px-2.5 py-1 bg-violet-50 hover:bg-violet-100 text-violet-600 font-black text-[9px] rounded-lg transition-colors cursor-pointer"
                            >
                              {appFont} (Cambiar)
                            </button>
                          </div>
                        </div>

                        {/* 6. COPIA DE SEGURIDAD SECTION */}
                        <div className="bg-white p-3.5 rounded-2xl border border-slate-100 shadow-sm space-y-3 text-left">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-600">
                              <Cloud className="w-4 h-4" />
                            </div>
                            <div>
                              <h5 className="text-[11px] font-black text-slate-800">Copia de seguridad</h5>
                              <p className="text-[8px] text-slate-400 font-mono">Última copia: {backupDate} • {backupChatsCount} chats</p>
                            </div>
                          </div>

                          <div className="space-y-2 pt-1">
                            {/* Guardar Copia */}
                            <button
                              disabled={isBackingUp || isRestoring}
                              onClick={handleCloudBackup}
                              className="w-full py-2.5 px-3 bg-[#0a4d52] hover:bg-[#10646a] text-white font-extrabold text-[9px] rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {isBackingUp ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Guardando copia...
                                </>
                              ) : (
                                "Guardar copia en la nube"
                              )}
                            </button>

                            {/* Restaurar Copia */}
                            <button
                              disabled={isBackingUp || isRestoring}
                              onClick={handleCloudRestore}
                              className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-[9px] rounded-xl border border-slate-200/50 transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-50"
                            >
                              {isRestoring ? (
                                <span className="flex items-center gap-1">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-600" /> Restaurando chats...
                                </span>
                              ) : (
                                <>
                                  <span className="text-slate-800 font-bold">Restaurar desde copia</span>
                                  <span className="text-[7.5px] text-slate-400 font-normal">Reemplaza chats locales con la nube</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* 7. AYUDA Y PREGUNTAS */}
                        <button
                          onClick={() => setActiveSettingsModal("ayuda")}
                          className="w-full text-left bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 active:scale-[0.99] transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                              <HelpCircle className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-800">Ayuda y Preguntas</div>
                              <div className="text-[9px] text-slate-400">RED ON FAQ, soporte en directo</div>
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                        </button>

                        {/* 8. LEGAL */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-3.5 space-y-3 text-left">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-500/10 flex items-center justify-center text-slate-600">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-800">Legal</div>
                              <div className="text-[9px] text-slate-400 font-medium">Condiciones legales oficiales</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button
                              onClick={() => setActiveSettingsModal("legal")}
                              className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-slate-700 font-bold text-[8.5px] rounded-lg text-center transition-all cursor-pointer"
                            >
                              <div className="font-extrabold">Política de Privacidad</div>
                              <div className="text-[7px] text-slate-400 font-normal mt-0.5">Cómo manejamos tus datos</div>
                            </button>
                            <button
                              onClick={() => setActiveSettingsModal("legal")}
                              className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-slate-700 font-bold text-[8.5px] rounded-lg text-center transition-all cursor-pointer"
                            >
                              <div className="font-extrabold">Términos de Servicio</div>
                              <div className="text-[7px] text-slate-400 font-normal mt-0.5">Condiciones de uso de RED ON</div>
                            </button>
                          </div>
                        </div>

                        {/* 9. LOGOUT */}
                        <button
                          onClick={async () => {
                            setRegisteredUser(null);
                            setCurrentScreen("welcome");
                            if (user) {
                              const { signOut } = await import("../services/auth");
                              signOut();
                            }
                          }}
                          className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-black rounded-xl flex items-center justify-center gap-1.5 transition-colors border border-rose-100 cursor-pointer mt-4"
                        >
                          <LogOut className="w-4 h-4 stroke-[2.5]" /> Cerrar Sesión
                        </button>

                      </div>
                    </div>

                    {/* MODAL / DRAWER INTERACTIVE OVERLAYS */}
                    {activeSettingsModal && (
                      <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm z-30 flex flex-col justify-end animate-fade-in">
                        <div className="bg-white rounded-t-3xl p-5 space-y-4 max-h-[85%] overflow-y-auto border-t border-slate-100 shadow-lg text-left animate-slide-up">
                          {/* Header of Modal */}
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h4 className="text-[10px] font-black text-[#0a4d52] uppercase tracking-wider">
                              {activeSettingsModal === "cuenta" && "Configuración de Cuenta"}
                              {activeSettingsModal === "seguridad" && "Privacidad y Seguridad"}
                              {activeSettingsModal === "notificaciones" && "Notificaciones"}
                              {activeSettingsModal === "datos" && "Datos y Almacenamiento"}
                              {activeSettingsModal === "fuentes" && "Tipografías de RED ON"}
                              {activeSettingsModal === "ayuda" && "Ayuda & FAQ"}
                              {activeSettingsModal === "legal" && "Acuerdos Legales"}
                            </h4>
                            <button
                              onClick={() => setActiveSettingsModal(null)}
                              className="px-2.5 py-1 bg-teal-500 hover:bg-teal-600 text-white font-extrabold text-[8px] rounded-lg cursor-pointer"
                            >
                              Listo
                            </button>
                          </div>

                          {/* 1. CUENTA OVERLAY */}
                          {activeSettingsModal === "cuenta" && (
                            <div className="space-y-4 animate-fade-in">
                              <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Cambiar ID de RED ON</label>
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={userId}
                                    onChange={(e) => setUserId(e.target.value)}
                                    placeholder="@id_de_usuario"
                                    className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono"
                                  />
                                  <button
                                    onClick={() => {
                                      showToast("ID de usuario actualizado ✨");
                                      setActiveSettingsModal(null);
                                    }}
                                    className="px-3.5 bg-[#0a4d52] text-white font-black text-[9px] rounded-xl hover:bg-teal-800 transition-colors cursor-pointer"
                                  >
                                    Guardar
                                  </button>
                                </div>
                                <p className="text-[8px] text-slate-400 leading-normal">Este ID te identifica de forma única dentro de la red móvil de RED ON sin necesidad de exponer tu número de teléfono real.</p>
                              </div>

                              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                                <div>
                                  <div className="text-[10.5px] font-black text-slate-800">Privacidad de número</div>
                                  <div className="text-[8px] text-slate-400">Ocultar número a desconocidos en chats de campaña</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={hideNumber} 
                                    onChange={() => {
                                      setHideNumber(!hideNumber);
                                      showToast(hideNumber ? "Número visible para todos 👁️" : "Número configurado como Privado 🛡️");
                                    }} 
                                    className="sr-only peer" 
                                  />
                                  <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-teal-500"></div>
                                </label>
                              </div>
                            </div>
                          )}

                          {/* 2. SEGURIDAD OVERLAY */}
                          {activeSettingsModal === "seguridad" && (
                            <div className="space-y-4 animate-fade-in">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-[10.5px] font-black text-slate-800">Doble check de lectura</div>
                                  <div className="text-[8px] text-slate-400">Ver confirmación azul de lectura de mensajes</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={doubleCheck} 
                                    onChange={() => {
                                      setDoubleCheck(!doubleCheck);
                                      showToast(`Doble check ${!doubleCheck ? "activado ✓✓" : "desactivado"}`);
                                    }} 
                                    className="sr-only peer" 
                                  />
                                  <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-teal-500"></div>
                                </label>
                              </div>

                              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                                <div>
                                  <div className="text-[10.5px] font-black text-slate-800">Bloqueos</div>
                                  <div className="text-[8px] text-slate-400">Restringir llamadas y mensajes directos</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={() => {
                                      if(blockedCount > 0) {
                                        setBlockedCount(blockedCount - 1);
                                        showToast("Desbloqueado");
                                      }
                                    }}
                                    className="w-5.5 h-5.5 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600 text-xs cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <span className="text-[10px] font-mono font-black text-slate-800">{blockedCount}</span>
                                  <button 
                                    onClick={() => {
                                      setBlockedCount(blockedCount + 1);
                                      showToast("Contacto bloqueado");
                                    }}
                                    className="w-5.5 h-5.5 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600 text-xs cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              <div className="border-t border-slate-100 pt-3 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-[10.5px] font-black text-slate-800">Verificación en dos pasos</div>
                                    <div className="text-[8px] text-slate-400">PIN extra para iniciar sesión en otros teléfonos</div>
                                  </div>
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                      type="checkbox" 
                                      checked={twoStepVerification} 
                                      onChange={() => {
                                        setTwoStepVerification(!twoStepVerification);
                                        if(!twoStepVerification) setTwoStepPin("");
                                        showToast(twoStepVerification ? "Verificación en 2 pasos desactivada 🔓" : "Configura tu código de seguridad");
                                      }} 
                                      className="sr-only peer" 
                                    />
                                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-teal-500"></div>
                                  </label>
                                </div>

                                {twoStepVerification && (
                                  <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-100 animate-fade-in">
                                    <label className="text-[8.5px] font-bold text-slate-500">PIN de Seguridad de RED ON (6 dígitos)</label>
                                    <div className="flex gap-1.5">
                                      <input
                                        type="password"
                                        maxLength={6}
                                        value={twoStepPin}
                                        onChange={(e) => {
                                          const val = e.target.value.replace(/\D/g, "");
                                          setTwoStepPin(val);
                                        }}
                                        placeholder="******"
                                        className="flex-1 px-3 py-1 text-center text-xs tracking-widest font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      />
                                      <button
                                        onClick={() => {
                                          if (twoStepPin.length < 6) {
                                            showToast("⚠️ El PIN debe ser de 6 dígitos");
                                          } else {
                                            showToast("¡Verificación en dos pasos habilitada! 🔒");
                                            setActiveSettingsModal(null);
                                          }
                                        }}
                                        className="px-3 bg-indigo-600 text-white font-extrabold text-[8px] rounded-lg hover:bg-indigo-700 cursor-pointer"
                                      >
                                        Activar PIN
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 3. NOTIFICACIONES OVERLAY */}
                          {activeSettingsModal === "notificaciones" && (
                            <div className="space-y-4 animate-fade-in">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-[10.5px] font-black text-slate-800">Silenciar chats</div>
                                  <div className="text-[8px] text-slate-400">Desactiva sonidos globales de mensajes</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={muteChats} 
                                    onChange={() => {
                                      setMuteChats(!muteChats);
                                      showToast(muteChats ? "Alertas sonoras activadas" : "Todo el audio de chats silenciado 🔇");
                                    }} 
                                    className="sr-only peer" 
                                  />
                                  <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-teal-500"></div>
                                </label>
                              </div>

                              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                                <div>
                                  <div className="text-[10.5px] font-black text-slate-800">Globos en icono de app</div>
                                  <div className="text-[8px] text-slate-400">Mostrar contador rojo de no leídos</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={unreadBadges} 
                                    onChange={() => {
                                      setUnreadBadges(!unreadBadges);
                                      showToast(unreadBadges ? "Contador desactivado" : "Contadores activos en el icono 🔴");
                                    }} 
                                    className="sr-only peer" 
                                  />
                                  <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-teal-500"></div>
                                </label>
                              </div>
                            </div>
                          )}

                          {/* 4. DATOS OVERLAY */}
                          {activeSettingsModal === "datos" && (
                            <div className="space-y-4 animate-fade-in">
                              <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Uso de red móvil</label>
                                <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
                                  {["Ahorro", "Estándar", "Ilimitado"].map((opt) => (
                                    <button
                                      key={opt}
                                      onClick={() => {
                                        setMobileDataUsage(opt);
                                        showToast(`Consumo móvil configurado en ${opt}`);
                                      }}
                                      className={`py-1 text-[8px] font-black rounded-lg transition-all cursor-pointer ${
                                        mobileDataUsage === opt 
                                          ? "bg-white text-[#0a4d52] shadow-sm" 
                                          : "text-slate-500 hover:text-slate-800"
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                                <div>
                                  <div className="text-[10.5px] font-black text-slate-800">Autodescarga de fotos</div>
                                  <div className="text-[8px] text-slate-400">Guardar multimedia con datos de celular</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={autoDownloadPhotos} 
                                    onChange={() => {
                                      setAutoDownloadPhotos(!autoDownloadPhotos);
                                      showToast(autoDownloadPhotos ? "Multimedia manual" : "Autodescarga activada 📲");
                                    }} 
                                    className="sr-only peer" 
                                  />
                                  <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-teal-500"></div>
                                </label>
                              </div>
                            </div>
                          )}

                          {/* 5. FUENTES OVERLAY */}
                          {activeSettingsModal === "fuentes" && (
                            <div className="space-y-4 animate-fade-in">
                              <p className="text-[9px] text-slate-500 leading-normal font-medium">
                                Personaliza el estilo de letra de toda la interfaz de la app. Selecciona una opción:
                              </p>
                              
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { id: "Clásico", name: "Clásico (Inter)", desc: "Predeterminado limpio y compacto" },
                                  { id: "Mono", name: "Monoespacio (Mono)", desc: "Aspecto industrial y técnico" },
                                  { id: "Elegante", name: "Elegante (Serif)", desc: "Sofisticado con remates clásicos" },
                                  { id: "Moderno", name: "Moderno (Grotesk)", desc: "Negrita de alta intensidad" }
                                ].map((f) => (
                                  <button
                                    key={f.id}
                                    onClick={() => {
                                      setAppFont(f.id as any);
                                      showToast(`Estilo de letra: ${f.name} ✨`);
                                    }}
                                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between h-[75px] ${
                                      appFont === f.id 
                                        ? "border-teal-500 bg-teal-50/20 text-[#0a4d52]" 
                                        : "border-slate-100 hover:bg-slate-50 text-slate-700"
                                    }`}
                                  >
                                    <div className="text-[9.5px] font-black">{f.name}</div>
                                    <div className="text-[7.5px] text-slate-400 font-medium leading-tight mt-1">{f.desc}</div>
                                  </button>
                                ))}
                              </div>

                              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                                <div className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Previsualización:</div>
                                <p className={`text-[11px] text-slate-800 ${
                                  appFont === "Mono" ? "font-mono" : 
                                  appFont === "Elegante" ? "font-serif" : 
                                  appFont === "Moderno" ? "font-sans tracking-tight font-semibold" : 
                                  "font-sans"
                                }`}>
                                  El estilo de letra se aplica a todos los chats, canales, tarifas y configuraciones en tiempo real.
                                </p>
                              </div>
                            </div>
                          )}

                          {/* 6. AYUDA OVERLAY */}
                          {activeSettingsModal === "ayuda" && (
                            <div className="space-y-4 animate-fade-in">
                              <div className="bg-gradient-to-r from-teal-500 to-indigo-600 text-white p-3 rounded-2xl flex items-center justify-between shadow-md">
                                <div className="text-left">
                                  <div className="text-[10px] font-black">Soporte en directo 24/7</div>
                                  <div className="text-[8px] text-teal-100">Resuelve dudas sobre tus catálogos</div>
                                </div>
                                <button
                                  onClick={handleOpenSupportChat}
                                  className="px-2.5 py-1.5 bg-white text-[#0a4d52] hover:bg-teal-50 transition-all font-black text-[8px] rounded-lg shadow-sm cursor-pointer"
                                >
                                  Chatear ahora
                                </button>
                              </div>

                              <div className="space-y-2">
                                <div className="text-[9.5px] font-black text-slate-400 uppercase tracking-wide">RED ON FAQ</div>
                                
                                <div className="space-y-1.5 text-[8.5px] text-slate-700 leading-relaxed">
                                  <details className="bg-slate-50 rounded-xl border border-slate-100 p-2 cursor-pointer group text-left">
                                    <summary className="font-bold text-slate-800 flex justify-between items-center outline-none">
                                      <span>¿Qué es la difusión de flyers?</span>
                                      <span className="text-[#0a4d52] font-mono group-open:rotate-45 transition-transform">+</span>
                                    </summary>
                                    <p className="mt-1 text-slate-500">Es el sistema que envía de manera programada tus diseños a todos los contactos e interesados en tus canales asignados sin costo.</p>
                                  </details>

                                  <details className="bg-slate-50 rounded-xl border border-slate-100 p-2 cursor-pointer group text-left">
                                    <summary className="font-bold text-slate-800 flex justify-between items-center outline-none">
                                      <span>¿Cómo asocio mi ID?</span>
                                      <span className="text-[#0a4d52] font-mono group-open:rotate-45 transition-transform">+</span>
                                    </summary>
                                    <p className="mt-1 text-slate-500">Ve a Cuenta, escribe un identificador y haz clic en Guardar. Tu ID ocultará tu número de teléfono en los canales públicos.</p>
                                  </details>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 7. LEGAL OVERLAY */}
                          {activeSettingsModal === "legal" && (
                            <div className="space-y-4 text-[8.5px] text-slate-600 leading-relaxed max-h-[300px] overflow-y-auto pr-1 animate-fade-in text-left scrollbar-thin">
                              {/* PRIVACY POLICY */}
                              <div>
                                <h5 className="font-black text-slate-800 text-[10px] tracking-tight">Política de Privacidad</h5>
                                <p className="text-slate-500 mt-1.5 leading-relaxed">
                                  En <strong className="text-slate-700">RED ON</strong>, el control de tus datos personales es nuestra prioridad fundamental. Esta política describe cómo recopilamos, usamos, almacenamos y protegemos tu información cuando utilizas nuestra plataforma de mensajería, difusión de catálogos y servicios de emprendimiento.
                                </p>
                                <ul className="mt-2 space-y-1.5 list-none">
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Información que recopilamos:</strong> Nombre, número telefónico, URL de avatar, identificador único de RED ON, datos de uso de la aplicación (chats, flyers creados, estados vistos) e información del dispositivo para garantizar la seguridad de la sesión.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Uso de la información:</strong> Tus datos se utilizan exclusivamente para facilitar la comunicación entre usuarios, mostrar tu perfil dentro de la red, generar copias de seguridad en la nube y mejorar la experiencia general de la aplicación. No utilizamos tus conversaciones ni catálogos para entrenar modelos de inteligencia artificial ni para publicidad comportamental.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Almacenamiento y encriptación:</strong> Todos los mensajes y datos de perfil se transmiten mediante conexiones cifradas (TLS 1.3). Los mensajes se almacenan en servidores seguros con replicación geográfica. Puedes solicitar la eliminación total de tus datos en cualquier momento contactando al soporte oficial.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Compartición con terceros:</strong> RED ON no vende, alquila ni comparte tu información personal con terceros con fines comerciales. Podemos divulgar información cuando la ley lo exija o para proteger la integridad de la plataforma y la seguridad de nuestros usuarios.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Privacidad de número:</strong> La función de ocultación de número (ID de RED ON) reemplaza tu línea telefónica real por un identificador público, protegiendo tu privacidad frente a contactos desconocidos en difusiones comerciales y canales públicos.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Retención y eliminación:</strong> Conservamos tus datos mientras mantengas una cuenta activa. Al eliminar tu cuenta, todos los mensajes, flyers y datos asociados se borran de forma irreversible en un plazo máximo de 30 días hábiles.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">•</span>
                                    <span><strong className="text-slate-700">Tus derechos:</strong> Puedes acceder, rectificar, cancelar u oponerte al tratamiento de tus datos personales en cualquier momento desde la sección de ajustes de cuenta o escribiendo a privacidad@redon.app.</span>
                                  </li>
                                </ul>
                                <p className="text-slate-400 mt-2 text-[7.5px] italic">Última actualización: Julio 2026.</p>
                              </div>

                              {/* TERMS OF SERVICE */}
                              <div className="border-t border-slate-100 pt-3.5">
                                <h5 className="font-black text-slate-800 text-[10px] tracking-tight">Términos de Servicio</h5>
                                <p className="text-slate-500 mt-1.5 leading-relaxed">
                                  Al acceder o utilizar <strong className="text-slate-700">RED ON</strong> (la "Plataforma"), aceptas cumplir con estos Términos de Servicio. Si no estás de acuerdo con alguna parte de los términos, no podrás usar la Plataforma.
                                </p>
                                <ul className="mt-2 space-y-1.5 list-none">
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">1.</span>
                                    <span><strong className="text-slate-700">Aceptación de los términos:</strong> Al registrarte y usar RED ON, confirmas que eres mayor de 13 años (o la edad de consentimiento digital en tu país) y que aceptas estar legalmente vinculado por estos términos.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">2.</span>
                                    <span><strong className="text-slate-700">Uso permitido:</strong> La Plataforma está diseñada para comunicación personal, difusión de catálogos comerciales legítimos, intercambio de archivos multimedia y herramientas de emprendimiento. No está permitido: (a) enviar spam masivo no solicitado, (b) publicar contenido ilegal, violento, pornográfico o que infrinja derechos de autor, (c) realizar actividades fraudulentas o de suplantación de identidad, (d) intentar vulnerar la seguridad de otros usuarios o de los servidores.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">3.</span>
                                    <span><strong className="text-slate-700">Contenido generado por el usuario:</strong> Eres el único responsable de los mensajes, flyers, estados y cualquier contenido que publiques en RED ON. Al publicar, otorgas a la Plataforma una licencia limitada para almacenar y mostrar dicho contenido dentro de la aplicación. Conservas todos los derechos de propiedad intelectual sobre tu contenido.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">4.</span>
                                    <span><strong className="text-slate-700">Flyers y catálogos comerciales:</strong> Los emprendedores pueden crear y difundir flyers digitales. RED ON no garantiza resultados comerciales ni se hace responsable por transacciones realizadas fuera de la plataforma. Los flyers deben cumplir con las leyes de publicidad del país de origen del usuario.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">5.</span>
                                    <span><strong className="text-slate-700">Moderación y suspensión:</strong> RED ON se reserva el derecho de revisar, eliminar o suspender cualquier cuenta o contenido que infrinja estos términos, sin previo aviso y sin responsabilidad. Las decisiones de moderación son definitivas y vinculantes.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">6.</span>
                                    <span><strong className="text-slate-700">Copias de seguridad:</strong> La función de copia de seguridad en la nube se proporciona "tal cual". RED ON no se hace responsable por la pérdida de datos debido a errores del servicio, eliminación accidental o modificaciones realizadas por el usuario. Recomendamos mantener copias locales periódicas.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">7.</span>
                                    <span><strong className="text-slate-700">Limitación de responsabilidad:</strong> RED ON no será responsable por daños indirectos, incidentales, especiales o consecuentes derivados del uso o la imposibilidad de uso de la Plataforma, incluyendo pérdida de datos, oportunidades comerciales o lucro cesante.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">8.</span>
                                    <span><strong className="text-slate-700">Modificaciones:</strong> Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios serán notificados dentro de la aplicación y entrarán en vigor 15 días después de su publicación. El uso continuado de RED ON después de ese período constituye la aceptación de los nuevos términos.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">9.</span>
                                    <span><strong className="text-slate-700">Ley aplicable:</strong> Estos términos se rigen por las leyes de la República Bolivariana de Venezuela. Cualquier disputa será resuelta ante los tribunales competentes de Caracas, Venezuela.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="text-teal-600 mt-0.5 shrink-0">10.</span>
                                    <span><strong className="text-slate-700">Contacto legal:</strong> Para consultas sobre estos términos, puedes escribir a legal@redon.app. Para soporte técnico general, utiliza la función "Soporte RED ON" disponible en la sección de Ayuda dentro de la aplicación.</span>
                                  </li>
                                </ul>
                                <p className="text-slate-400 mt-2 text-[7.5px] italic">Última actualización: Julio 2026.</p>
                              </div>
                            </div>
                          )}

                          <button
                            onClick={() => setActiveSettingsModal(null)}
                            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[9px] rounded-xl cursor-pointer text-center"
                          >
                            Cerrar Ajuste
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {/* Floating action button with menu */}
                {currentScreen === "chats" && (
                  <FabMenu
                    showActionMenu={showActionMenu}
                    setShowActionMenu={setShowActionMenu}
                    setCurrentScreen={setCurrentScreen}
                  />
                )}
              </div>

              {/* PERSISTENT BOTTOM TAB BAR */}
              <BottomTabBar
                currentScreen={currentScreen}
                setCurrentScreen={setCurrentScreen}
                isEditingMedia={isEditingMedia}
                totalUnread={chats.reduce((sum, c) => sum + c.unreadCount, 0)}
              />

            </div>
          )}

          {/* FORWARD MESSAGE MODAL */}
          {forwardingMessage && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setForwardingMessage(null)}>
              <div className="bg-white rounded-2xl p-4 w-[90vw] max-w-[360px] max-h-[80vh] overflow-y-auto shadow-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                  <Forward className="w-4 h-4 text-teal-600" />
                  <h3 className="text-sm font-extrabold text-slate-900">Reenviar mensaje</h3>
                </div>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    ref={forwardingSearchRef}
                    type="text"
                    placeholder="Buscar chat..."
                    value={forwardSearchQuery}
                    onChange={e => setForwardSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-[11px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:border-tele-400 transition-colors"
                    autoFocus
                  />
                </div>
                <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
                  {chats
                    .filter(c => c.name.toLowerCase().includes(forwardSearchQuery.toLowerCase()))
                    .map(chat => (
                      <button
                        key={chat.id}
                        onClick={async () => {
                          try {
                            await apiSendMessage({
                              chat_id: chat.id,
                              sender_id: user?.id,
                              text: forwardingMessage.text || "",
                              type: forwardingMessage.type as any,
                              image_url: forwardingMessage.type === "image" || forwardingMessage.type === "video" ? forwardingMessage.mediaUrl : undefined,
                              video_url: forwardingMessage.type === "video" ? forwardingMessage.mediaUrl : undefined,
                              audio_url: forwardingMessage.type === "audio" || forwardingMessage.type === "voice_note" ? forwardingMessage.mediaUrl : undefined,
                              document_name: forwardingMessage.type === "file" ? forwardingMessage.fileName : undefined,
                              forwarded: true,
                            });
                            setForwardingMessage(null);
                            setForwardSearchQuery("");
                          } catch (e) {
                            console.error("[FORWARD] Error:", e);
                          }
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors text-left"
                      >
                        {chat.avatar ? (
                          <img src={chat.avatar} alt={chat.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                            <span className="text-white font-bold text-[10px]">
                              {chat.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                            </span>
                          </div>
                        )}
                        <span className="flex-1 text-[11px] font-bold text-slate-800 truncate">{chat.name}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                      </button>
                    ))}
                  {chats.length === 0 && (
                    <p className="text-[10px] text-slate-400 text-center py-4">No hay chats para reenviar</p>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SplashScreen } from "@capacitor/splash-screen";
import { useDebounce } from "../hooks/useDebounce";
import CachedImage from "./CachedImage";
import ChatListSkeleton from "./ChatListSkeleton";
import { 
  Check, AlertTriangle, Info, Search, Plus, 
  QrCode, LogOut, CheckCheck, Shield, Bell, Database, Type, 
  HelpCircle, Lock, Cloud, RefreshCw, FileText, ChevronRight, 
  Smartphone, EyeOff, UserCheck, CircleUser, Camera, Forward, ArrowRight, ArrowLeft, Copy, User, Wifi
} from "lucide-react";
import toast from "react-hot-toast";
import { Chat, Message, ActiveCall } from "../types";
import WelcomeScreen from "./WelcomeScreen";
import ChatRoom from "./ChatRoom";
import CallOverlay from "./CallOverlay";
import type { BusinessFlyer } from "./BusinessPanel";
import BottomTabBar from "./phone/BottomTabBar";
import FabMenu from "./phone/FabMenu";
import { supabase } from "../lib/supabase";
import { getAllUserData } from "../services/server-api";
import { useSupabase } from "../contexts/SupabaseContext";
import { clearForMe, sendMessage as apiSendMessage } from "../services/messages";
import { createChat as createChatInSupabase, createGroupChat, deleteChat as apiDeleteChat, subscribeToChats, getChatWithPartner } from "../services/chats";
import { getAllFlyers, createFlyer, incrementFlyerView, incrementFlyerClick, deleteFlyer } from "../services/contentService";
import { deleteContact } from "../services/contacts";

import { WebRTCService } from "../services/webrtc";
import { startCall as apiStartCall, updateCallRating, updateCallStatus } from "../services/calls";
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { playSound, playSoundOption, getSoundId, setSoundId, stopSound } from "../services/soundService";
import { SOUND_LIBRARY } from "../data/sounds";
import { uploadAvatar, uploadChatMedia } from "../services/storage";
import { updateProfile } from "../services/auth";
import { db } from "../services/database/DatabaseService";
import CallRatingModal from "./CallRatingModal";
import SimulatorTabHeader from "./simulator/SimulatorTabHeader";
import SimulatorForwardModal from "./simulator/SimulatorForwardModal";
import ContactProfile, { type ContactProfileData } from "./chat/overlays/ContactProfile";
import ImageLightbox from "./chat/overlays/ImageLightbox";

// Module-level set of chat ids already animated this session — survives remounts
// so returning to the chats list doesn't replay the fade-in on seen items.
const animatedChatIds = new Set<string>();

const QrScanner = React.lazy(() => import("./QrScanner"));
const MyQrCode = React.lazy(() => import("./MyQrCode"));
const StatesPanel = React.lazy(() => import("./StatesPanel"));
const ChannelsPanel = React.lazy(() => import("./ChannelsPanel"));
const ContactsList = React.lazy(() => import("./ContactsList"));
const CallLog = React.lazy(() => import("./CallLog"));
const RatesPanel = React.lazy(() => import("./RatesPanel"));
const BusinessPanel = React.lazy(() => import("./BusinessPanel"));
const AddContact = React.lazy(() => import("./AddContact"));
const AddContactManual = React.lazy(() => import("./AddContactManual"));
const SyncedContacts = React.lazy(() => import("./SyncedContacts"));
const SimulatorCreateGroup = React.lazy(() => import("./simulator/SimulatorCreateGroup"));
const ShallowSpinner = ({ label }: { label: string }) => (
  <div className="flex items-center justify-center h-full w-full bg-white">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  </div>
);
const LazyPanel = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <React.Suspense fallback={<ShallowSpinner label={label} />}>{children}</React.Suspense>
);

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
  const { user, profile, contacts: appContacts, chats: supabaseChats, loading, refreshChats, refreshContacts, refreshProfile, logout } = useSupabase();

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
    bio: string;
  } | null>(null);
  const avatarManualRef = useRef(false);

  useEffect(() => {
    if (user && profile) {
      setRegisteredUser(prev => ({
        name: profile.name,
        phone: profile.phone_number,
        avatar: avatarManualRef.current ? (prev?.avatar || profile.avatar || profile.avatar_url || "") : (profile.avatar || profile.avatar_url || ""),
        bio: profile.bio || "",
      }));
    } else if (user) {
      const fallbackName = user.email?.split("@")[0] || "Usuario";
      setRegisteredUser({
        name: fallbackName,
        phone: "",
        avatar: "",
        bio: "",
      });
    }
  }, [user, profile]);

  // Hide native splash only after Supabase session resolves and DOM paints
  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(() => {
        SplashScreen.hide().catch(() => {});
      });
    }
  }, [loading]);

  // Fallback: force-hide splash after 10s max (problematic devices)
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hide().catch(() => {}), 10000);
    return () => clearTimeout(t);
  }, []);

  // Android back button handler — registered ONCE, reads state from refs (no race condition)
  useEffect(() => {
    const bp = onBackPressRef.current;
    const sse = onSetShouldExitRef.current;
    if (!bp) return;

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

    bp(() => {
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
      sse?.(true);
      return false;
    });

    sse?.(shouldExitRef.current);
  }, []);

  useEffect(() => {
    const isOnMainScreen = currentScreen === "chats" || currentScreen === "welcome";
    shouldExitRef.current = !isOnMainScreen;
    onSetShouldExitRef.current?.(!isOnMainScreen);
  }, [currentScreen]);

  // Active Chats & Selected Chat
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [clearedAtMap, setClearAtMap] = useState<Record<string, string>>({});
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const selectedChatIdRef = useRef(selectedChatId);
  selectedChatIdRef.current = selectedChatId;
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const deletedChatIdsRef = useRef<Set<string>>(new Set());

  // Active Call Screen Overlay
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);

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
  // Evita conectar dos veces la misma llamada (evento vivo + sticky pendiente).
  const answeredCallRef = useRef(false);
  // Referencia mutable al flujo de auto-respuesta (el effect que lo usa se declara antes).
  const runAnswerFlowRef = useRef<((detail: any) => Promise<void>) | null>(null);

  const playIncomingRingtone = useCallback(() => {
    try {
      stopIncomingRingtone();
      const audio = playSound("call", 0.8);
      ringtoneAudioRef.current = audio;
      if (audio) console.log('[APP] 🔊 Incoming ringtone started');
    } catch (e) {
      console.warn('[APP] Failed to play incoming ringtone:', e);
    }
  }, []);

  const stopIncomingRingtone = useCallback(() => {
    stopSound();
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
      const audio = playSound("message", 0.7);
      notificationAudioRef.current = audio;
      if (audio) console.log('[APP] 🔊 Notification sound played');
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

  // Java String.hashCode() polyfill — matches CallFcmService notification ID
  function javaHashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // Call rating after a connected call ends
  const [callRating, setCallRating] = useState<{ callId: string; contactName: string } | null>(null);
  const callWasConnectedRef = useRef(false);
  const callContactNameRef = useRef("");

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
  const [contactProfile, setContactProfile] = useState<ContactProfileData | null>(null);
  const [showMyAvatarLightbox, setShowMyAvatarLightbox] = useState(false);

  // Group creation state
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupMuted, setGroupMuted] = useState(false);
  const [groupAdminOnly, setGroupAdminOnly] = useState(false);

  // Search input filter
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 250);

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
  const [msgSoundId, setMsgSoundId] = useState(getSoundId("message"));
  const [callSoundId, setCallSoundId] = useState(getSoundId("call"));
  const [previewMsgSound, setPreviewMsgSound] = useState<string | null>(null);
  const [previewCallSound, setPreviewCallSound] = useState<string | null>(null);
  const [mobileDataUsage, setMobileDataUsage] = useState("Ahorro");
  const [autoDownloadPhotos, setAutoDownloadPhotos] = useState(true);
  const [appFont, setAppFont] = useState<"Clásico" | "Mono" | "Elegante" | "Moderno">("Clásico");
  const [hasUnseenStates, setHasUnseenStates] = useState(false);
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
  const [editBio, setEditBio] = useState("");
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

  // Load ALL public flyers (feed) from API on mount and when the tab opens
  const loadFlyers = useCallback(async () => {
    if (!user) return;
    try {
      const apiFlyers = await getAllFlyers();
      if (!apiFlyers) return;
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
        contactPhone: f.contact_phone || '',
        views: f.views || 0,
        clicks: f.clicks || 0,
        ownerId: f.user_id,
        ownerName: f.owner_name || 'Usuario',
        ownerAvatar: f.owner_avatar || '',
        ownerPhone: f.owner_phone || '',
      }));
      setFlyers(mapped);
    } catch (err) {
      console.error("[PhoneSimulator] fetch flyers failed:", err);
    }
  }, [user]);

  useEffect(() => {
    loadFlyers();
  }, [loadFlyers, currentScreen]);

  // Lightweight polling while the Business tab is open so new flyers appear live
  useEffect(() => {
    if (currentScreen !== "business") return;
    const timer = setInterval(loadFlyers, 30000);
    return () => clearInterval(timer);
  }, [currentScreen, loadFlyers]);

  const handleAddNewFlyer = async (newFlyer: BusinessFlyer) => {
    setFlyers(prev => [newFlyer, ...prev]);
    if (!user) return;
    try {
      const created = await createFlyer({
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
        contact_phone: newFlyer.contactPhone,
      });
      if (created?.id) {
        setFlyers(prev => prev.map(f => (f.id === newFlyer.id ? { ...f, id: created.id } : f)));
      }
    } catch {}
  };

  const handleDeleteFlyer = async (flyerId: string) => {
    setFlyers(prev => prev.filter(f => f.id !== flyerId));
    if (!user) return;
    try {
      await deleteFlyer(flyerId);
    } catch {}
  };

  const handleIncrementView = (flyerId: string) => {
    setFlyers(prev => prev.map(f => f.id === flyerId ? { ...f, views: f.views + 1 } : f));
    incrementFlyerView(flyerId).catch(err => console.error("[PhoneSimulator] incrementFlyerView failed:", err));
  };

  const handleForwardMessage = async (chatId: string) => {
    const msg = forwardingMessage;
    if (!msg || !user) return;
    const mediaTypes = ["image", "video", "audio", "voice_note", "video_note", "sticker", "file"];
    const needsMedia = mediaTypes.includes(msg.type);

    let resolvedUrl: string | undefined;
    if (needsMedia) {
      try {
        resolvedUrl = await resolveMediaUrl(msg);
      } catch {
        toast.error("No se pudo obtener la URL pública del archivo. Verificá tu conexión.");
        return;
      }
      if (!resolvedUrl) return;
    }

    try {
      await apiSendMessage({
        chat_id: chatId,
        sender_id: user.id,
        text: msg.text || "",
        type: msg.type as any,
        image_url: msg.type === "image" || msg.type === "video" ? resolvedUrl : undefined,
        video_url: msg.type === "video" ? resolvedUrl : undefined,
        audio_url: msg.type === "audio" || msg.type === "voice_note" ? resolvedUrl : undefined,
        sticker_url: msg.type === "sticker" ? resolvedUrl : undefined,
        document_name: msg.type === "file" ? msg.fileName : undefined,
        file_url: msg.type === "file" ? resolvedUrl : undefined,
        forwarded: true,
      });
      setForwardingMessage(null);
      setForwardSearchQuery("");
    } catch (e) {
      console.error("[FORWARD] Error:", e);
      toast.error("Error al reenviar mensaje");
    }
  };

  const handleIncrementClick = (flyerId: string) => {
    setFlyers(prev => prev.map(f => f.id === flyerId ? { ...f, clicks: f.clicks + 1 } : f));
    incrementFlyerClick(flyerId).catch(err => console.error("[PhoneSimulator] incrementFlyerClick failed:", err));
  };

  const handleStartBusinessChat = async (businessName: string, avatar: string, initialText: string, flyerId: string, contactPhone?: string) => {
    const businessDigits = contactPhone ? contactPhone.replace(/\D/g, "") : "";

    // Try to find the real app user by the flyer's contact phone number
    if (businessDigits.length >= 7 && user) {
      try {
        const { searchUsers } = await import("../services/contacts");
        const matches = await searchUsers(contactPhone || "", user.id);
        const match = matches.find(m => {
          const d = (m.phone || "").replace(/\D/g, "");
          if (!d) return false;
          return d === businessDigits || d.endsWith(businessDigits) || businessDigits.endsWith(d);
        }) || matches[0];

        if (match) {
          // Real chat with the business owner
          const existing = getChatByPartnerId(match.id);
          if (existing) {
            setSelectedChatId(existing.id);
            await apiSendMessage({
              chat_id: existing.id,
              sender_id: user.id,
              text: initialText,
              type: "text" as any,
              status: "sent" as any,
            }).catch(() => {});
            setCurrentScreen("chat_room");
            refreshChats().catch(() => {});
            return;
          }
          const chat = await createChatInSupabase({
            name: match.name || businessName,
            avatar: match.avatar || avatar,
            profile_id: match.id,
            admin_id: user.id,
          });
          if (chat?.id) {
            setChats(prev => {
              if (prev.some(c => c.id === chat.id)) return prev;
              return [{
                id: chat.id,
                name: match.name || businessName,
                avatar: match.avatar || avatar,
                status: "online" as const,
                lastMessage: initialText,
                lastMessageTime: "Ahora mismo",
                unreadCount: 0,
                partnerUserId: match.id,
                messages: [],
              }, ...prev];
            });
            setSelectedChatId(chat.id);
            await apiSendMessage({
              chat_id: chat.id,
              sender_id: user.id,
              text: initialText,
              type: "text" as any,
              status: "sent" as any,
            }).catch(() => {});
            setCurrentScreen("chat_room");
            refreshChats().catch(() => {});
            return;
          }
        }
      } catch (e) {
        console.warn("[BIZ] phone lookup failed:", e);
      }
    }

    // Fallback: local (offline) chat
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
    setRegisteredUser({ name, phone, avatar, bio: "" });
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
        lastMessageTimeRaw: sc.last_message_time || "",
        updated_at: sc.updated_at || sc.last_message_time || "",
        unreadCount: sc.unread_count || 0,
        partnerUserId: sc.profile_id === user.id ? sc.admin_id : sc.profile_id,
        isGroup: sc.is_group || false,
        messages: [],
      }));
      setChats(mapped as Chat[]);
      setChatsLoaded(true);
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

  const handleCloudBackup = async () => {
    if (!user) return;
    setIsBackingUp(true);
    try {
      const { count: chatCount, error: chatErr } = await supabase
        .from("chats")
        .select("*", { count: "exact", head: true })
        .or(`profile_id.eq.${user.id},admin_id.eq.${user.id}`);
      const { count: msgCount, error: msgErr } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", user.id);
      const { count: contactCount, error: contactErr } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (chatErr || msgErr || contactErr) throw new Error("Error al verificar datos");
      const now = new Date();
      const formattedDate = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
      setBackupDate(formattedDate);
      setBackupChatsCount(chatCount ?? 0);
      showToast(`☁️ ${chatCount} chats, ${msgCount} mensajes, ${contactCount} contactos — todo en la nube`);
    } catch (e) {
      showToast("No se pudo verificar la copia");
    }
    setIsBackingUp(false);
  };

  const handleCloudRestore = async () => {
    if (!user) return;
    setIsRestoring(true);
    try {
      const data = await getAllUserData(user.id);
      await refreshChats();
      const total = (data.chats?.length ?? 0) + (data.contacts?.length ?? 0);
      showToast(`🔄 ${total} elementos restaurados desde la nube`);
    } catch {
      showToast("No se pudo restaurar — revisa tu conexión");
    }
    setIsRestoring(false);
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
        if (newChat?.id) {
          setChats(prev => {
            if (prev.some(c => c.id === newChat.id)) return prev;
            return [{
              id: newChat.id,
              name: "Soporte RED ON 🛡️",
              avatar: "",
              status: "online" as const,
              lastMessage: "",
              lastMessageTime: "",
              unreadCount: 0,
              partnerUserId: user.id,
              messages: [],
            }, ...prev];
          });
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

  // Track when we send a message to avoid counting own messages as unread
  const lastSentAtRef = useRef<Record<string, number>>({});
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const clearedAtMapRef = useRef(clearedAtMap);
  clearedAtMapRef.current = clearedAtMap;

  // Realtime subscription for chats table (INSERT/UPDATE) — detects new chats from other users
  useEffect(() => {
    if (!user) return;
    const sub = subscribeToChats(user.id, async (event, chat) => {
      if (event === "INSERT") {
        // New chat — fetch full data
        const { data: full } = await supabase
          .from("chats")
          .select("*")
          .eq("id", chat.id)
          .single();
        if (!full) {
          const fetched = await getChatWithPartner(chat.id, user.id);
          if (!fetched) return;
          setChats(prev => {
            if (prev.some(c => c.id === fetched.id)) return prev;
            return [fetched as any, ...prev].sort(sortChats);
          });
          refreshChats();
          return;
        }
        setChats(prev => {
          if (prev.some(c => c.id === full.id)) return prev;
          return [full as any, ...prev].sort(sortChats);
        });
        // Also sync context
        refreshChats();
      } else if (event === "UPDATE") {
        setChats(prev => {
          const idx = prev.findIndex(c => c.id === chat.id);
          if (idx === -1) return prev;
          const existing = prev[idx];
          const newRawTime = chat.last_message_time || "";
          const isNewMessage = newRawTime && newRawTime !== (existing as any).lastMessageTimeRaw;

          if (!isNewMessage) {
            const updated = [...prev];
            updated[idx] = { ...existing, updated_at: chat.updated_at };
            return updated.sort(sortChats);
          }

          // New message detected — check if it's our own or if we're viewing this chat
          const isCurrentChat = currentScreenRef.current === "chat_room" && selectedChatIdRef.current === chat.id;
          const lastSent = lastSentAtRef.current[chat.id];
          const isOwnRecent = lastSent && (Date.now() - lastSent < 20000);

          if (isCurrentChat || isOwnRecent) {
            // Own message or currently viewing — update metadata only, no unread increment
            const updated = [...prev];
            updated[idx] = {
              ...existing,
              lastMessage: (chat.last_message || existing.lastMessage) as any,
              lastMessageTime: newRawTime
                ? (() => {
                    const d = new Date(newRawTime);
                    const now = new Date();
                    return d.toDateString() === now.toDateString()
                      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : d.toLocaleDateString([], { day: "numeric", month: "short" });
                  })()
                : existing.lastMessageTime,
              lastMessageTimeRaw: newRawTime,
              updated_at: chat.updated_at,
            };
            db.run("UPDATE chats SET updated_at = ? WHERE id = ?", [chat.updated_at, chat.id]);
            return updated.sort(sortChats);
          }

          // Someone else sent a message while we're not viewing — increment unread
          const clearedAt = clearedAtMapRef.current[chat.id];
          const isCleared = clearedAt && newRawTime && newRawTime <= clearedAt;
          const updated = [...prev];
          updated[idx] = {
            ...existing,
            lastMessage: isCleared ? "" : (chat.last_message || existing.lastMessage) as any,
            lastMessageTime: isCleared
              ? ""
              : newRawTime
                ? (() => {
                    const d = new Date(newRawTime);
                    const now = new Date();
                    return d.toDateString() === now.toDateString()
                      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : d.toLocaleDateString([], { day: "numeric", month: "short" });
                  })()
                : existing.lastMessageTime,
            lastMessageTimeRaw: newRawTime,
            unreadCount: isCleared ? 0 : (existing.unreadCount + 1),
            updated_at: chat.updated_at,
          };
          db.run("UPDATE chats SET updated_at = ? WHERE id = ?", [chat.updated_at, chat.id]);
          return updated.sort(sortChats);
        });
      }
    });
    return () => { sub.unsubscribe(); };
  }, [user?.id]);

  // Realtime subscription for incoming calls from other users
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;
  contextMenuChatRef.current = contextMenuChat;
  showActionMenuRef.current = showActionMenu;

  // ChatRoom internal back handler (replyTo, editingMessage, etc.)
  const chatRoomBackHandlerRef = useRef<(() => boolean) | null>(null);
  const onBackPressRef = useRef(onBackPress);
  const onSetShouldExitRef = useRef(onSetShouldExit);
  onBackPressRef.current = onBackPress;
  onSetShouldExitRef.current = onSetShouldExit;

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
        // Safety: verify call is still ringing in DB (may have been cancelled)
        try {
          const { data: freshCall } = await supabase
            .from("calls")
            .select("status")
            .eq("id", call.id)
            .single();
          if (freshCall && freshCall.status !== "ringing") {
            console.log('[WEBRTC SIGNALING] ❌ Call already ended, skipping incoming UI — status:', freshCall.status);
            return;
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
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `callee_id=eq.${user.id}`,
      }, async (payload: any) => {
        const call = payload.new;
        const prev = payload.old;
        const endedStatuses = ['missed', 'ended'];
        if (!endedStatuses.includes(call.status)) return;
        if (prev?.status === call.status) return;
        if (!activeCallRef.current || activeCallRef.current.id !== call.id) return;
        if (activeCallRef.current.status !== 'incoming') return;
        console.log('[WEBRTC SIGNALING] 📩 Call ended while incoming — auto-dismissing. Status:', call.status);
        stopIncomingRingtone();
        callWasConnectedRef.current = false;
        callContactNameRef.current = '';
        if (Capacitor.isNativePlatform()) {
          try {
            const notifId = javaHashCode("call-" + (call.chat_id || call.id || ""));
            await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
          } catch (e) {
            console.warn('[WEBRTC SIGNALING] Failed to cancel notification:', e);
          }
        }
        setActiveCall(null);
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
    const handleIncomingCall = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const d = typeof detail === 'string' ? JSON.parse(detail) : detail;
      const chatId = d?.chatId || d?.roomId || '';
      const incomingCallId = d?.callId;
      console.log('[WEBRTC SIGNALING] 📱 FCM incoming-call event received:', JSON.stringify(d));

      if (d?.type === 'call_dismissed') {
        console.log('[WEBRTC SIGNALING] 📱 FCM call_dismissed received — stopping ringing');
        if (activeCallRef.current && incomingCallId && activeCallRef.current.id === incomingCallId) {
          stopIncomingRingtone();
          setActiveCall(null);
        }
        return;
      }

      if (chatId && d?.callerId && !activeCallRef.current) {
        // Safety: verify call is still ringing in DB
        if (incomingCallId && !incomingCallId.startsWith('call_')) {
          try {
            const { data: freshCall } = await supabase
              .from("calls")
              .select("status")
              .eq("id", incomingCallId)
              .single();
            if (freshCall && freshCall.status !== "ringing") {
              console.log('[WEBRTC SIGNALING] ❌ FCM call already ended, skipping UI — status:', freshCall.status);
              return;
            }
          } catch {}
        }
        console.log('[WEBRTC SIGNALING] ✅ Setting activeCall from FCM — caller:', d.callerName, 'status: incoming, callId:', incomingCallId);
        answeredCallRef.current = false;
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
      setChats(prev => {
        const idx = prev.findIndex(chat => chat.id === d.chatId);
        if (idx === -1) {
          // Chat not found locally — fetch and insert
          getChatWithPartner(d.chatId, user!.id).then(full => {
            if (!full) return;
            setChats(later => {
              if (later.some(c => c.id === full.id)) return later;
              return [{ ...full, lastMessage: d.body || (full as any).last_message || "", lastMessageTime: (full as any).last_message_time || "", unreadCount: 1 } as any, ...later].sort(sortChats);
            });          });
          return prev;
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], unreadCount: updated[idx].unreadCount + 1 };
        if (d.body) updated[idx].lastMessage = d.body;
        return updated.sort(sortChats);
      });
      if (selectedChatId === d.chatId && currentScreen === 'chat_room') {
        setRefetchTrigger(n => n + 1);
      }
    };
    const handleAnswerCall = (e: Event) => {
      console.log('[WEBRTC SIGNALING] 📱 answer-call event received');
      runAnswerFlowRef.current?.((e as CustomEvent).detail);
    };
    window.addEventListener('incoming-call', handleIncomingCall);
    window.addEventListener('call_dismissed', handleIncomingCall);
    window.addEventListener('open-chat', handleOpenChat);
    window.addEventListener('new-message-received', handleNewMessage);
    window.addEventListener('answer-call', handleAnswerCall);

    // Sticky answer: si el usuario respondió desde la notificación mientras la app
    // estaba en segundo plano/arrancando en frío, MainActivity persiste el intent
    // en CapacitorStorage y lo restauramos acá (el evento answer-call se pierde).
    (async () => {
      if (!Capacitor.isNativePlatform()) return;
      try {
        const pending = await Preferences.get({ key: 'redon_pending_call' });
        if (pending?.value) {
          console.log('[WEBRTC SIGNALING] 📦 Pending call answer restored from storage');
          await runAnswerFlowRef.current?.(pending.value);
        }
      } catch (e) {
        console.warn('[WEBRTC SIGNALING] Pending answer read failed:', e);
      }
    })();

    return () => {
      window.removeEventListener('incoming-call', handleIncomingCall);
      window.removeEventListener('call_dismissed', handleIncomingCall);
      window.removeEventListener('open-chat', handleOpenChat);
      window.removeEventListener('new-message-received', handleNewMessage);
      window.removeEventListener('answer-call', handleAnswerCall);
    };
  }, [user?.id, selectedChatId, currentScreen]);

  useEffect(() => {
    if (externalMessageTrigger) {
      const chatTarget = "nelson"; // Default target
      const msgIso = new Date().toISOString();
      setChats((prevChats) =>
        prevChats.map((c) => {
          if (c.id === chatTarget) {
            return {
              ...c,
              unreadCount: currentScreen !== "chat_room" || selectedChatId !== chatTarget ? c.unreadCount + 1 : 0,
              lastMessage: externalMessageTrigger.text || "¡Archivo recibido!",
              lastMessageTime: externalMessageTrigger.timestamp,
              lastMessageTimeRaw: msgIso,
              updated_at: msgIso,
              messages: [...c.messages, externalMessageTrigger]
            };
          }
          return c;
        }).sort(sortChats)
      );
      onClearExternalMessageTrigger();
    }
  }, [externalMessageTrigger, currentScreen, selectedChatId, onClearExternalMessageTrigger]);

  // activeChat derived from chats + selectedChatId
  const activeChat = chats.find((c) => c.id === selectedChatId);

  const handleSendMessageInRoom = (newMsg: Message) => {
    if (!selectedChatId) return;

    // Mark this chat as "just sent to" so the chats subscription won't count it as unread
    lastSentAtRef.current[selectedChatId] = Date.now();
    const isoNow = new Date().toISOString();

    setChats((prevChats) => {
      const updated = prevChats.map((c) => {
        if (c.id === selectedChatId) {
          return {
            ...c,
            lastMessage: newMsg.text || "Archivo multimedia",
            lastMessageTime: newMsg.timestamp,
            lastMessageTimeRaw: isoNow,
            updated_at: isoNow,
            messages: [...c.messages, newMsg]
          };
        }
        return c;
      });
      updated.sort(sortChats);
      db.run("UPDATE chats SET updated_at = ?, last_message_time = ? WHERE id = ?", [isoNow, isoNow, selectedChatId]);
      return updated;
    });
  };

  const cleanupCall = useCallback(() => {
    const wasConnected = callWasConnectedRef.current;
    const callId = activeCallRef.current?.id;
    const contactName = callContactNameRef.current || activeCallRef.current?.contactName || '';
    stopRingbackTone();
    stopIncomingRingtone();
    stopSound();
    webrtcRef.current?.cleanup();
    webrtcRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    callWasConnectedRef.current = false;
    answeredCallRef.current = false;
    if (wasConnected && callId) {
      setCallRating({ callId, contactName });
    }
  }, [stopRingbackTone, stopIncomingRingtone]);

  // Conecta como callee la llamada ya aceptada (se usa al responder desde la
  // notificación con la app en segundo plano/minimizada).
  const connectToCallee = useCallback(async (callId: string, callerId: string, callerName: string, callType: string, avatar?: string) => {
    if (!user) return;
    stopIncomingRingtone();
    setActiveCall({
      id: callId,
      contactName: callerName || 'Llamada entrante',
      contactAvatar: avatar || '',
      type: callType as 'audio' | 'video',
      status: 'connecting',
      durationSeconds: 0,
      isMuted: false,
      isVideoOff: false,
      isGroup: false,
      targetUserId: callerId,
    });
    try {
      const webrtc = new WebRTCService(callId, user.id);
      webrtcRef.current = webrtc;
      webrtc.onRemoteStream = (stream) => {
        console.log('[WEBRTC SIGNALING] 📹 Remote stream received (answer-call) — CONNECTED');
        setRemoteStream(stream);
        setActiveCall((prev) => prev ? { ...prev, status: 'connected' } : null);
        callWasConnectedRef.current = true;
        callContactNameRef.current = activeCallRef.current?.contactName || callerName || '';
      };
      webrtc.onConnectionStateChange = (state) => {
        console.log('[WEBRTC SIGNALING] 🔗 Callee ICE state:', state);
      };
      webrtc.onCallEnded = () => {
        console.log('[WEBRTC SIGNALING] 📞 Call ended (auto-answered callee)');
        cleanupCall();
      };
      console.log('[WEBRTC SIGNALING] 📞 Callee (answer-call): getting local stream...');
      const local = await webrtc.startLocalStream(true, callType === 'video');
      setLocalStream(local);
      console.log('[WEBRTC SIGNALING] ✅ Callee (answer-call): getUserMedia done');
      await webrtc.createPeerConnection();
      await webrtc.subscribeToSignals();
      webrtc.signalCalleeReady()
        .then(() => console.log('[WEBRTC SIGNALING] ✅ Callee-ready signal sent'))
        .catch((e) => console.warn('[WEBRTC SIGNALING] ⚠️ Callee-ready signal failed:', e?.message));
    } catch (err) {
      console.error('[WEBRTC SIGNALING] ❌ Failed to answer call:', err);
      toast.error('No se pudo conectar la llamada');
      cleanupCall();
    }
  }, [user, stopIncomingRingtone, cleanupCall, callWasConnectedRef, callContactNameRef, activeCallRef, setLocalStream, setRemoteStream, setActiveCall]);

  // Flujo de "respuesta" desde la notificación (evento answer-call) o desde el
  // sticky persistido por MainActivity en arranques en frío.
  const runAnswerFlow = useCallback(async (detail: any) => {
    if (!user) return;
    if (answeredCallRef.current) {
      Preferences.remove({ key: 'redon_pending_call' }).catch(() => {});
      return;
    }
    const d = typeof detail === 'string'
      ? (() => { try { return JSON.parse(detail); } catch { return {}; } })()
      : detail;
    const chatId = d?.chatId || d?.roomId || '';
    const callerId = d?.callerId || '';
    const callType = d?.callType || 'audio';
    const callerName = d?.callerName || 'Llamada entrante';
    const callerAvatar = d?.callerAvatar || '';
    if (!chatId || !callerId) {
      console.warn('[WEBRTC SIGNALING] ❌ answer-call sin chatId/callerId:', { chatId, callerId });
      return;
    }
    answeredCallRef.current = true;
    console.log('[WEBRTC SIGNALING] ✅ answer-call — auto aceptando, caller:', callerName);
    try {
      const { data: rows, error } = await supabase
        .from('calls')
        .select('id, call_type, chat_id, caller_id')
        .eq('chat_id', chatId)
        .eq('callee_id', user.id)
        .order('started_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const call = rows?.[0];
      if (!call) {
        console.warn('[WEBRTC SIGNALING] ❌ No hay llamada para responder:', { chatId });
        throw new Error('Llamada no encontrada');
      }
      updateCallStatus(call.id, 'accepted').catch((e) => console.warn('[CALL] Failed to set accepted:', e));
      await connectToCallee(call.id, callerId, callerName, callType, callerAvatar);
    } catch (err: any) {
      console.error('[WEBRTC SIGNALING] ❌ answer-call failed:', err?.message || err);
      toast.error('No se pudo conectar la llamada');
    } finally {
      Preferences.remove({ key: 'redon_pending_call' }).catch(() => {});
    }
  }, [user, connectToCallee, updateCallStatus]);

  runAnswerFlowRef.current = runAnswerFlow;

  const cleanupCallRef = useRef<(() => void) | null>(null);
  cleanupCallRef.current = cleanupCall;

  const handleTriggerCallFromChat = async (type: "audio" | "video") => {
    if (!activeChat || !user || isInitiatingCall) return;
    setIsInitiatingCall(true);
    try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
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
        callWasConnectedRef.current = true;
        callContactNameRef.current = activeCallRef.current?.contactName || '';
        stopRingbackTone();
      };

      webrtc.onConnectionStateChange = (state) => {
        console.log('[WEBRTC SIGNALING] 🔗 ICE state:', state);
      };

      webrtc.onCallEnded = () => {
        console.log('[WEBRTC SIGNALING] 📞 Call ended');
        const endedCallId = activeCallRef.current?.id;
        if (endedCallId && !endedCallId.startsWith('call_')) {
          updateCallStatus(endedCallId, 'ended').catch(e => console.warn('[CALL] Failed to update call status on ended:', e));
        }
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
        console.log('[WEBRTC SIGNALING] 📞 Push handled by Supabase webhook — skip duplicate');
      }

      // ICE connection timeout: auto-cleanup after 45s
      const iceTimeoutRef = { current: setTimeout(() => {
        if (webrtcRef.current && activeCallRef.current?.status === "outgoing") {
          console.warn('[WEBRTC SIGNALING] ⏰ ICE timeout — no connection after 45s');
          if (callId && !callId.startsWith('call_')) {
            updateCallStatus(callId, 'missed').catch(e => console.warn('[CALL] Failed to update call status to missed:', e));
          }
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
    setIsInitiatingCall(false);
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
      const otherId = (c as any).partnerUserId;
      return otherId ? otherId === partnerId : false;
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
      // Map selected member ids to real profile ids (chat_participants.profile_id references profiles.id)
      const memberIds = selectedGroupMembers
        .map(id => {
          const c = appContacts.find(ct => (ct.id || ct.contact_user_id || "") === id);
          return c?.contact_user_id || c?.id || id;
        })
        .filter(Boolean);
      const groupChat = await createGroupChat(finalGroupName, user.id, memberIds, groupAdminOnly);
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

  const handleDeleteContact = async (contactId: string) => {
    if (!user?.id) return;
    try {
      await deleteContact(contactId);
      await refreshContacts();
      showToast("Contacto eliminado");
    } catch (e) {
      console.warn("[CONTACT] Delete error:", e);
      showToast("Error al eliminar contacto");
    }
  };

  const handleOpenProfile = useCallback(async () => {
    if (!activeChat?.partnerUserId || !user?.id) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, name, username, phone_number, avatar_url, bio")
        .eq("id", activeChat.partnerUserId)
        .single();
      if (data) {
        setContactProfile({
          id: data.id,
          name: data.name,
          phone: data.phone_number || "",
          avatar: data.avatar_url || "",
          bio: data.bio || "",
          username: data.username || "",
        });
      }
    } catch (e) {
      console.warn("[PROFILE] Error fetching contact profile:", e);
    }
  }, [activeChat, user?.id]);

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
    c.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
  );

  // Flag which chats are animating for the first time this session.
  const chatsWithAnimFlag = filteredChats.map((chat) => {
    const shouldAnimate = !animatedChatIds.has(chat.id);
    animatedChatIds.add(chat.id);
    return { chat, shouldAnimate };
  });

  console.log("[PHONESIM] Rendering:", { 
    currentScreen,
    registeredUser: !!registeredUser, 
    user: !!user, 
    filteredChats: filteredChats.length,
    chatsLoaded,
    supabaseChats: supabaseChats.length
  });
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
            setActiveCall((prev) => prev ? { ...prev, status: "connecting" } : null);

            try {
              const webrtc = new WebRTCService(callId, user.id);
              webrtcRef.current = webrtc;

              webrtc.onRemoteStream = (stream) => {
                console.log('[WEBRTC SIGNALING] 📹 Remote stream received on callee side — call CONNECTED');
                setRemoteStream(stream);
                setActiveCall((prev) => prev ? { ...prev, status: "connected" } : null);
                callWasConnectedRef.current = true;
                callContactNameRef.current = activeCallRef.current?.contactName || '';
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
            } catch (err) {
              console.error('[WEBRTC SIGNALING] ❌ Failed to accept call:', err);
            }
          }}
          onDecline={() => {
            console.log('[WEBRTC SIGNALING] ❌ Call declined');
            const callId = activeCallRef.current?.id;
            if (callId && !callId.startsWith('call_')) {
              updateCallStatus(callId, 'missed').catch(e => console.warn('[CALL] Failed to update call status to missed:', e));
            }
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
          onSwitchCamera={async () => {
            const newStream = await webrtcRef.current?.switchCamera();
            if (newStream) setLocalStream(newStream);
          }}
          onEndCall={async () => {
            console.log('[WEBRTC SIGNALING] 📞 Ending call');
            const endedCallId = activeCallRef.current?.id;
            if (endedCallId && !endedCallId.startsWith('call_')) {
              updateCallStatus(endedCallId, 'ended').catch(e => console.warn('[CALL] Failed to update call status on end:', e));
            }
            stopRingbackTone();
            await webrtcRef.current?.endCall();
            cleanupCall();
          }}
        />
      )}

      {/* CALL RATING MODAL */}
      {callRating && (
        <CallRatingModal
          contactName={callRating.contactName}
          onSend={async (rating: number) => {
            try {
              await updateCallRating(callRating.callId, rating);
              console.log('[CALL] Rating saved:', rating);
            } catch (e) {
              console.error('[CALL] Failed to save rating:', e);
            }
            setCallRating(null);
          }}
          onSkip={() => setCallRating(null)}
        />
      )}

      {/* 1. WELCOME SCREEN / REGISTER WINDOW */}
      {!user || currentScreen === "welcome" ? (
        <WelcomeScreen onRegister={handleRegister} />
      ) : (
        // 2. SINGLE SCREEN MOBILE LAYOUT
        <div className={`flex-1 flex flex-col overflow-hidden bg-white text-slate-800 relative h-full ${
          appFont === "Mono" ? "font-mono" : 
          appFont === "Elegante" ? "font-serif" : 
          appFont === "Moderno" ? "font-sans tracking-tight font-semibold" : 
          "font-sans"
        }`}>
          
          {/* FULL-SCREEN SCREENS (rendered as overlays so the tabs tree stays mounted) */}
          {currentScreen === "chat_room" && activeChat && (
            <div className="absolute inset-0 z-50 bg-white">
              <ChatRoom
                chat={activeChat}
                onBack={() => {
                  setSelectedChatId(null);
                  setCurrentScreen("chats");
                }}
                onSendMessage={handleSendMessageInRoom}
                onChatMessagesChanged={(chatId, msgs) => {
                  setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: msgs } : c));
                }}
                onTriggerCall={handleTriggerCallFromChat}
                callInProgress={isInitiatingCall}
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
                onChatUpdated={(chatId, updates) => {
                  setChats(prev => prev.map(c => (c.id === chatId ? { ...c, ...updates } : c)));
                }}
                currentUserId={user?.id}
                currentUserName={profile?.name}
                refetchTrigger={refetchTrigger}
                onRegisterBackHandler={(handler) => { chatRoomBackHandlerRef.current = handler; }}
                onOpenProfile={handleOpenProfile}
              />
            </div>
          )}
          {currentScreen === "qr_scanner" && (
            <div className="absolute inset-0 z-50 bg-white">
              <React.Suspense fallback={<ShallowSpinner label="Cargando escáner QR…" />}>
              <QrScanner
                userName={registeredUser?.name || "Nelson Castro"}
                userPhone={registeredUser?.phone || "+58 412 1234567"}
                onBack={() => setCurrentScreen("chats")}
                onContactAdded={handleContactAddedByQr}
              />
              </React.Suspense>
            </div>
          )}
          {currentScreen === "my_qr" && (
            <div className="absolute inset-0 z-50 bg-white">
              <React.Suspense fallback={<ShallowSpinner label="Cargando mi código" />}>
              <MyQrCode
              userId={user?.id || ""}
              name={registeredUser?.name || ""}
              phone={registeredUser?.phone || ""}
              avatar={registeredUser?.avatar || ""}
              onBack={() => setCurrentScreen("chats")}
            />
              </React.Suspense>
            </div>
          )}
          {currentScreen === "add_contact" && (
            <div className="absolute inset-0 z-50 bg-white">
              <LazyPanel label="Cargando contacto…">
              <AddContact
                currentUserId={user?.id || ""}
                onBack={() => setCurrentScreen("chats")}
                onContactAdded={handleContactAddedByQr}
              />
              </LazyPanel>
            </div>
          )}
          {currentScreen === "add_contact_manual" && (
            <div className="absolute inset-0 z-50 bg-white">
              <LazyPanel label="Cargando formulario…">
              <AddContactManual
                currentUserId={user?.id || ""}
                currentUserPhone={profile?.phone_number || registeredUser?.phone || ""}
                onBack={() => setCurrentScreen("chats")}
              />
              </LazyPanel>
            </div>
          )}
          {currentScreen === "synced_contacts" && (
            <div className="absolute inset-0 z-50 bg-white">
              <LazyPanel label="Sincronizando contactos…">
              <SyncedContacts
                currentUserId={user?.id || ""}
                onBack={() => setCurrentScreen("chats")}
                onStartChat={handleStartChatFromSynced}
              />
              </LazyPanel>
            </div>
          )}
          {currentScreen === "create_group" && (
            <div className="absolute inset-0 z-50 bg-white">
              <LazyPanel label="Cargando grupo…">
              <SimulatorCreateGroup
                onBack={() => setCurrentScreen("chats")}
                groupName={groupNameInput}
                onGroupNameChange={setGroupNameInput}
                searchQuery={groupSearchQuery}
                onSearchChange={setGroupSearchQuery}
                contacts={dedupedContacts}
                selectedMembers={selectedGroupMembers}
                onToggleMember={(id) =>
                  setSelectedGroupMembers(prev =>
                    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                  )
                }
                isMuted={groupMuted}
                onToggleMute={() => setGroupMuted(!groupMuted)}
                isAdminOnly={groupAdminOnly}
                onToggleAdminOnly={() => setGroupAdminOnly(!groupAdminOnly)}
                onCreateGroup={handleCreateGroup}
              />
              </LazyPanel>
            </div>
          )}

          {/* Tab screen (Chats, Contacts, States, Channels, Rates, Business, Profile) */}
          <div className={`flex-1 flex flex-col overflow-hidden h-full relative ${
            currentScreen === "chat_room" || currentScreen === "qr_scanner" || currentScreen === "my_qr" ||
            currentScreen === "add_contact" || currentScreen === "add_contact_manual" ||
            currentScreen === "synced_contacts" || currentScreen === "create_group"
              ? "hidden"
              : ""
          }`}>
              
              <SimulatorTabHeader
                currentScreen={currentScreen}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                registeredUserAvatar={registeredUser?.avatar}
                onNavigateToQr={() => setCurrentScreen("qr_scanner")}
                onNavigateToProfile={() => setCurrentScreen("profile")}
              />

              {/* STATES TAB — outside main content for stable flex layout */}
              <div className={currentScreen === "states" ? "flex flex-1" : "hidden"}>
                <LazyPanel label="Cargando historias…">
                  <StatesPanel onStartChat={handleStartChatFromState} onHasUnseen={(v) => setHasUnseenStates(v)} />
                </LazyPanel>
              </div>

              {/* Main Tab Content Body */}
              <div className={`flex-1 overflow-y-auto bg-white relative flex flex-col h-full ${
                currentScreen === "chats" ? "pt-[170px]" : ""
              } ${currentScreen === "states" ? "hidden" : ""}`}>
                
                {/* CHATS LIST */}
                <div className={`flex-1 overflow-y-auto px-4 py-3.5 space-y-3.5 ${currentScreen === "chats" ? "" : "hidden"}`}>
                    {/* Recent Section Header */}
                    <div className="flex justify-between items-center px-1 mb-1">
                      <h2 className="text-sm font-extrabold text-slate-950 tracking-tight">Recent</h2>
                      <button className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                        <span className="text-lg font-bold leading-none">•••</span>
                      </button>
                    </div>

                    {chatsWithAnimFlag.map(({ chat, shouldAnimate }) => {
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
                            className={`relative flex items-start gap-3.5 p-2.5 border border-transparent hover:border-slate-100 hover:bg-slate-50 rounded-2xl transition-all cursor-pointer ${shouldAnimate ? 'animate-fade-in' : ''} bg-white z-10 ${
                              isSwiped ? 'shadow-lg' : ''
                            }`}
                            style={isSwiped ? { transform: 'translateX(80px)' } : undefined}
                          >
                            <div className="relative shrink-0">
                              <div className={`p-[2px] rounded-full border-2 border-dashed ${chat.isGroup ? "border-purple-500/90" : "border-rose-500/90"} transition-transform hover:rotate-12 duration-500`}>
                                {chat.avatar ? (
                                  <CachedImage src={chat.avatar} alt={chat.name} className="w-14 h-14 rounded-full object-cover" loading="lazy" />
                                ) : chat.isGroup ? (
                                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                      <circle cx="9" cy="7" r="4" />
                                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                    </svg>
                                  </div>
                                ) : (
                                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
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

                    {filteredChats.length === 0 && !chatsLoaded && (
                      <ChatListSkeleton count={8} />
                    )}

                    {filteredChats.length === 0 && chatsLoaded && (
                      <div className="text-center py-12 text-slate-400 space-y-1">
                        <p className="text-xs font-semibold">No se encontraron chats</p>
                        <p className="text-[10px]">Prueba escribiendo otro nombre</p>
                      </div>
                    )}
                  </div>

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

                  {/* CHANNELS TAB */}
                {currentScreen === "channels" && (
                  <LazyPanel label="Cargando canales…">
                    <ChannelsPanel />
                  </LazyPanel>
                )}

                {/* CONTACTS TAB */}
                <div className={`flex-1 overflow-y-auto h-full ${currentScreen === "contacts" ? "" : "hidden"}`}>
                  <LazyPanel label="Cargando contactos…">
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
                    onDeleteContact={handleDeleteContact}
                  />
                  </LazyPanel>
                </div>

                {/* CALLS TAB */}
                {currentScreen === "calls" && user && (
                  <LazyPanel label="Cargando llamadas…">
                  <CallLog
                    userId={user.id}
                    onBack={() => setCurrentScreen("chats")}
                    onStartChat={handleStartChatFromCall}
                  />
                  </LazyPanel>
                )}

                {/* RATES TAB */}
                {currentScreen === "rates" && (
                  <LazyPanel label="Cargando tarifas…">
                  <RatesPanel />
                  </LazyPanel>
                )}

                {/* BUSINESS TAB */}
                {currentScreen === "business" && (
                  <LazyPanel label="Cargando negocios…">
                  <BusinessPanel
                    onStartBusinessChat={handleStartBusinessChat}
                    flyers={flyers}
                    onAddFlyer={handleAddNewFlyer}
                    onDeleteFlyer={handleDeleteFlyer}
                    onIncrementView={handleIncrementView}
                    onIncrementClick={handleIncrementClick}
                    onEditingChange={setIsEditingMedia}
                    currentUserId={user?.id}
                    currentUserName={registeredUser?.name}
                    currentUserAvatar={registeredUser?.avatar}
                    currentUserPhone={registeredUser?.phone}
                  />
                  </LazyPanel>
                )}

                {/* PROFILE TAB */}
                {currentScreen === "profile" && registeredUser && (
                  <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 h-full relative">
                    {/* Top User Profile Header */}
                    <div className="relative overflow-hidden bg-gradient-to-br from-[#041b1e] via-[#0a4d52] to-[#11806f] text-white p-5 text-center shrink-0 shadow-lg">
                      <div className="pointer-events-none absolute inset-0">
                        <div className="absolute -top-20 -right-14 w-72 h-72 rounded-full bg-white/5 blur-2xl"></div>
                        <div className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-teal-300/10 blur-3xl"></div>
                        <div className="absolute top-12 left-5 w-28 h-28 rounded-full border border-white/10"></div>
                        <div className="absolute -top-8 right-8 w-16 h-16 rounded-full border-2 border-white/5"></div>
                        <div className="absolute bottom-6 right-10 w-20 h-20 rounded-full border border-white/10"></div>
                        <div className="absolute top-1/3 left-1/2 w-2 h-2 rounded-full bg-teal-200/30"></div>
                        <div className="absolute bottom-14 left-10 w-1.5 h-1.5 rounded-full bg-teal-200/30"></div>
                        <div className="absolute top-6 left-1/3 w-1 h-1 rounded-full bg-white/25"></div>
                      </div>
                      <div className="absolute top-4 right-4 z-10 bg-white/10 backdrop-blur-md px-2 py-0.5 rounded-full text-[8px] font-bold tracking-widest text-teal-200">
                        VERSIÓN PRO
                      </div>
                      <div className="relative inline-block mt-2 group z-10">
                        {registeredUser.avatar ? (
                          <img 
                            src={registeredUser.avatar} 
                            alt="Profile" 
                            onClick={() => !isUploadingAvatar && setShowMyAvatarLightbox(true)}
                            className={`w-32 h-32 rounded-full mx-auto object-cover border-4 border-white/25 shadow-xl ring-4 ring-white/10 transition-opacity cursor-pointer ${isUploadingAvatar ? "opacity-50" : ""}`}
                          />
                        ) : (
                          <div className="w-32 h-32 rounded-full mx-auto bg-gradient-to-br from-teal-400 to-emerald-600 border-4 border-white/25 shadow-xl ring-4 ring-white/10 flex items-center justify-center">
                            <User className="w-14 h-14 text-white" />
                          </div>
                        )}
                        {isUploadingAvatar && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-8 h-8 border-[3px] border-white border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                        <span className="absolute bottom-1 right-1 w-6 h-6 bg-emerald-500 border-[3px] border-white rounded-full shadow-md"></span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !user) return;
                            try {
                              setIsUploadingAvatar(true);
                              const blob = new Blob([await file.arrayBuffer()], { type: file.type });
                              const url = await uploadAvatar(blob, user.id);
                              avatarManualRef.current = true;
                              await updateProfile(user.id, { avatar_url: url, avatar: url });
                              setRegisteredUser(prev => prev ? { ...prev, avatar: url } : prev);
                              refreshProfile().catch(err => console.error("[PhoneSimulator] refreshProfile failed:", err));
                              showToast("Foto de perfil actualizada ✅");
                            } catch (err) {
                              console.error("Avatar upload failed:", err);
                              showToast("Error al subir la foto ❌");
                            } finally {
                              setIsUploadingAvatar(false);
                            }
                          }}
                        />
                      </div>
                      <button
                        onClick={() => !isUploadingAvatar && fileInputRef.current?.click()}
                        className={`mt-3 mx-auto flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-[10px] font-semibold px-3.5 py-1.5 rounded-full backdrop-blur-md border border-white/20 shadow-md transition-all active:scale-95 ${isUploadingAvatar ? "cursor-wait opacity-60" : "cursor-pointer"}`}
                      >
                        <Camera className="w-3 h-3" />
                        {isUploadingAvatar ? "Subiendo..." : "Cambiar foto"}
                      </button>
                      {isEditingProfile ? (
                        <div className="mt-3 flex flex-col items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="bg-white/15 text-white text-sm font-black text-center px-3 py-1.5 rounded-xl border border-white/30 outline-none w-48"
                            placeholder="Tu nombre"
                          />
                          <input
                            type="text"
                            value={editBio}
                            onChange={(e) => setEditBio(e.target.value)}
                            className="bg-white/10 text-white text-[10px] text-center px-3 py-1 rounded-xl border border-white/20 outline-none w-48 placeholder-teal-300/50"
                            placeholder="Tu estado o bio"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                if (!editName.trim() || !user) return;
                                try {
                                  await updateProfile(user.id, { name: editName.trim(), bio: editBio.trim() });
                                  await refreshProfile();
                                  setRegisteredUser(prev => prev ? { ...prev, name: editName.trim(), bio: editBio.trim() } : prev);
                                  setIsEditingProfile(false);
                                  showToast("Perfil actualizado ✅");
                                } catch (err) {
                                  console.error("Profile update failed:", err);
                                  showToast("Error al actualizar perfil ❌");
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
                          <h4 className="text-base font-black mt-2 tracking-tight">{registeredUser.name}</h4>
                          <button
                            onClick={() => {
                              if (registeredUser?.phone) {
                                navigator.clipboard.writeText(registeredUser.phone).then(() => {
                                  showToast("Número copiado ✅");
                                }).catch(() => {});
                              }
                            }}
                            className="text-[11px] text-teal-200 font-mono mt-0.5 hover:text-white transition-colors cursor-pointer flex items-center gap-1 mx-auto"
                            title="Copiar número"
                          >
                            {registeredUser.phone}
                            <Copy className="w-3.5 h-3.5 inline opacity-60" />
                          </button>
                          {registeredUser.bio && (
                            <p className="text-[10px] text-teal-300/80 mt-0.5 italic max-w-[200px] mx-auto truncate">{registeredUser.bio}</p>
                          )}
                          <div className="flex items-center justify-center gap-2 mt-1">
                            <button
                              onClick={() => {
                                setEditName(registeredUser.name);
                                setEditBio(registeredUser.bio || "");
                                setIsEditingProfile(true);
                              }}
                              className="px-2.5 py-0.5 bg-white/10 hover:bg-white/20 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                            >
                              Editar perfil
                            </button>
                          </div>
                        </>
                      )}
                      <div className="bg-black/15 py-0.5 px-3 rounded-full inline-block mt-2 text-[10px] font-bold text-teal-100">
                        {userId}
                      </div>
                    </div>

                    {/* Scrollable Settings Panel */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 pb-20 scrollbar-thin">
                      
                      <div className="text-[11px] font-black text-slate-400 tracking-wider uppercase px-1">
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
                                <div className="text-[12px] font-black text-slate-800">Cuenta</div>
                                <div className="text-[10px] text-slate-400">Privacidad de número, cambio de ID</div>
                              </div>
                            </div>
                            <button
                              onClick={() => setActiveSettingsModal("cuenta")}
                              className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-[#0a4d52] font-extrabold text-[10px] rounded-lg transition-colors cursor-pointer"
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
                              <div className="text-[12px] font-black text-slate-800">Privacidad y Seguridad</div>
                              <div className="text-[10px] text-slate-400">Doble check, bloqueos, verificación en 2 pasos</div>
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
                              <div className="text-[12px] font-black text-slate-800">Notificaciones</div>
                              <div className="text-[10px] text-slate-400">Silenciar chats, globos en icono de app</div>
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
                              <div className="text-[12px] font-black text-slate-800">Datos y Almacenamiento</div>
                              <div className="text-[10px] text-slate-400">Uso de red móvil, autodescarga de fotos</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{mobileDataUsage}</span>
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
                                <div className="text-[12px] font-black text-slate-800">Fuentes</div>
                                <div className="text-[10px] text-slate-400">Personaliza el estilo de letra de la app</div>
                              </div>
                            </div>
                            <span className="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">Desactivado</span>
                          </div>
                          
                          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-100/50">
                            <span className="text-[11px] font-bold text-slate-600">A</span>
                            <button
                              onClick={() => setActiveSettingsModal("fuentes")}
                              className="px-2.5 py-1 bg-violet-50 hover:bg-violet-100 text-violet-600 font-black text-[10px] rounded-lg transition-colors cursor-pointer"
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
                              <h5 className="text-[12px] font-black text-slate-800">Copia de seguridad</h5>
                              <p className="text-[9px] text-slate-400 font-mono">Última copia: {backupDate} • {backupChatsCount} chats</p>
                            </div>
                          </div>

                          <div className="space-y-2 pt-1">
                            {/* Guardar Copia */}
                            <button
                              disabled={isBackingUp || isRestoring}
                              onClick={handleCloudBackup}
                              className="w-full py-2.5 px-3 bg-[#0a4d52] hover:bg-[#10646a] text-white font-extrabold text-[10px] rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
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
                              className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-[10px] rounded-xl border border-slate-200/50 transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-50"
                            >
                              {isRestoring ? (
                                <span className="flex items-center gap-1">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-600" /> Restaurando chats...
                                </span>
                              ) : (
                                <>
                                  <span className="text-slate-800 font-bold">Restaurar desde copia</span>
                                  <span className="text-[8.5px] text-slate-400 font-normal">Exporta todos tus datos como JSON</span>
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
                              <div className="text-[12px] font-black text-slate-800">Ayuda y Preguntas</div>
                              <div className="text-[10px] text-slate-400">RED ON FAQ, soporte en directo</div>
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
                              <div className="text-[12px] font-black text-slate-800">Legal</div>
                              <div className="text-[10px] text-slate-400 font-medium">Condiciones legales oficiales</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button
                              onClick={() => setActiveSettingsModal("legal")}
                              className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-slate-700 font-bold text-[9.5px] rounded-lg text-center transition-all cursor-pointer"
                            >
                              <div className="font-extrabold">Política de Privacidad</div>
                              <div className="text-[9px] text-slate-400 font-normal mt-0.5">Cómo manejamos tus datos</div>
                            </button>
                            <button
                              onClick={() => setActiveSettingsModal("legal")}
                              className="py-2 px-1 bg-slate-50 hover:bg-slate-100 border border-slate-100 text-slate-700 font-bold text-[9.5px] rounded-lg text-center transition-all cursor-pointer"
                            >
                              <div className="font-extrabold">Términos de Servicio</div>
                              <div className="text-[9px] text-slate-400 font-normal mt-0.5">Condiciones de uso de RED ON</div>
                            </button>
                          </div>
                        </div>

                        {/* 9. LOGOUT */}
                        <button
                          onClick={() => {
                            setRegisteredUser(null);
                            setCurrentScreen("welcome");
                            logout();
                          }}
                          className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[13px] font-black rounded-xl flex items-center justify-center gap-1.5 transition-colors border border-rose-100 cursor-pointer mt-4"
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
                            <h4 className="text-[11px] font-black text-[#0a4d52] uppercase tracking-wider">
                              {activeSettingsModal === "cuenta" && "Configuración de Cuenta"}
                              {activeSettingsModal === "seguridad" && "Privacidad y Seguridad"}
                              {activeSettingsModal === "notificaciones" && "Notificaciones"}
                              {activeSettingsModal === "datos" && "Datos y Almacenamiento"}
                              {activeSettingsModal === "fuentes" && "Tipografías de RED ON"}
                              {activeSettingsModal === "ayuda" && "Ayuda & FAQ"}
                              {activeSettingsModal === "legal" && "Acuerdos Legales"}
                            </h4>
                            <button
                              onClick={() => { stopSound(); setActiveSettingsModal(null); }}
                              className="px-2.5 py-1 bg-teal-500 hover:bg-teal-600 text-white font-extrabold text-[8px] rounded-lg cursor-pointer"
                            >
                              Listo
                            </button>
                          </div>

                          {/* 1. CUENTA OVERLAY */}
                          {activeSettingsModal === "cuenta" && (
                            <div className="space-y-4 animate-fade-in">
                              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                <div>
                                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Tu número</div>
                                  <div className="text-[13px] font-mono font-bold text-slate-800 mt-0.5">{registeredUser?.phone || profile?.phone_number || "No disponible"}</div>
                                </div>
                                <button
                                  onClick={() => {
                                    const num = registeredUser?.phone || profile?.phone_number || "";
                                    if (num) {
                                      navigator.clipboard.writeText(num).then(() => showToast("Número copiado ✅")).catch(() => {});
                                    }
                                  }}
                                  className="w-8 h-8 rounded-full bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 flex items-center justify-center transition-all cursor-pointer"
                                  title="Copiar número"
                                >
                                  <Copy className="w-4 h-4" />
                                </button>
                              </div>
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
                                    onClick={async () => {
                                      if (!user || !userId.trim()) return;
                                      try {
                                        await updateProfile(user.id, { username: userId.trim() });
                                        showToast("ID de usuario actualizado ✨");
                                        setActiveSettingsModal(null);
                                      } catch (err) {
                                        console.error("Username update failed:", err);
                                        showToast("Error al actualizar ID ❌");
                                      }
                                    }}
                                    className="px-3.5 bg-[#0a4d52] text-white font-black text-[9px] rounded-xl hover:bg-teal-800 transition-colors cursor-pointer"
                                  >
                                    Guardar
                                  </button>
                                </div>
                                <p className="text-[9px] text-slate-400 leading-normal">Este ID te identifica de forma única dentro de la red móvil de RED ON sin necesidad de exponer tu número de teléfono real.</p>
                              </div>

                              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                                <div>
                                  <div className="text-[11.5px] font-black text-slate-800">Privacidad de número</div>
                                  <div className="text-[9px] text-slate-400">Ocultar número a desconocidos en chats de campaña</div>
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
                                  <div className="text-[11.5px] font-black text-slate-800">Doble check de lectura</div>
                                  <div className="text-[9px] text-slate-400">Ver confirmación azul de lectura de mensajes</div>
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
                                  <div className="text-[11.5px] font-black text-slate-800">Bloqueos</div>
                                  <div className="text-[9px] text-slate-400">Restringir llamadas y mensajes directos</div>
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
                                    <div className="text-[11.5px] font-black text-slate-800">Verificación en dos pasos</div>
                                    <div className="text-[9px] text-slate-400">PIN extra para iniciar sesión en otros teléfonos</div>
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
                                        className="px-3 bg-indigo-600 text-white font-extrabold text-[9px] rounded-lg hover:bg-indigo-700 cursor-pointer"
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
                                  <div className="text-[11.5px] font-black text-slate-800">Silenciar chats</div>
                                  <div className="text-[9px] text-slate-400">Desactiva sonidos globales de mensajes</div>
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
<div className="text-[11.5px] font-black text-slate-800">Globos en icono de app</div>
                                  <div className="text-[9px] text-slate-400">Mostrar contador rojo de no leídos</div>
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

                              <div className="border-t border-slate-100 pt-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div>
                                    <div className="text-[11.5px] font-black text-slate-800">Sonido de mensaje</div>
                                    <div className="text-[9px] text-slate-400">Tono cuando llega una notificación</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                  {SOUND_LIBRARY.message.map((opt) => (
                                    <div key={opt.id} className="flex-1 flex flex-col gap-1">
                                      <button
                                        onClick={() => {
                                          setPreviewMsgSound(opt.id);
                                          playSoundOption("message", opt.id, 0.7);
                                        }}
                                        className={`py-1 text-[9px] font-black rounded-lg transition-all cursor-pointer ${
                                          previewMsgSound === opt.id
                                            ? "bg-white text-[#0a4d52] shadow-sm"
                                            : "bg-transparent text-slate-500 hover:text-slate-800"
                                        }`}
                                        title="Escuchar"
                                      >
                                        {opt.name} 👂
                                      </button>
                                      {previewMsgSound === opt.id && (
                                        <button
                                          onClick={() => {
                                            setSoundId("message", opt.id);
                                            setMsgSoundId(opt.id);
                                            setPreviewMsgSound(null);
                                            stopSound();
                                            showToast(`Sonido de mensaje: ${opt.name} ✅`);
                                          }}
                                          className="py-1 text-[8px] font-bold text-white bg-teal-500 hover:bg-teal-600 rounded-lg transition-colors cursor-pointer"
                                        >
                                          Guardar
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="border-t border-slate-100 pt-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div>
                                    <div className="text-[11.5px] font-black text-slate-800">Sonido de llamada</div>
                                    <div className="text-[9px] text-slate-400">Tono cuando llega una llamada</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                  {SOUND_LIBRARY.call.map((opt) => (
                                    <div key={opt.id} className="flex-1 flex flex-col gap-1">
                                      <button
                                        onClick={() => {
                                          setPreviewCallSound(opt.id);
                                          playSoundOption("call", opt.id, 0.8);
                                        }}
                                        className={`py-1 text-[10px] font-black rounded-lg transition-all cursor-pointer ${
                                          previewCallSound === opt.id
                                            ? "bg-white text-[#0a4d52] shadow-sm"
                                            : "bg-transparent text-slate-500 hover:text-slate-800"
                                        }`}
                                        title="Escuchar"
                                      >
                                        {opt.name} 👂
                                      </button>
                                      {previewCallSound === opt.id && (
                                        <button
                                          onClick={() => {
                                            setSoundId("call", opt.id);
                                            setCallSoundId(opt.id);
                                            setPreviewCallSound(null);
                                            stopSound();
                                            showToast(`Sonido de llamada: ${opt.name} ✅`);
                                          }}
                                          className="py-1 text-[8px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                                        >
                                          Guardar
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
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
                                      className={`py-1 text-[9px] font-black rounded-lg transition-all cursor-pointer ${
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
                                  <div className="text-[11.5px] font-black text-slate-800">Autodescarga de fotos</div>
                                  <div className="text-[9px] text-slate-400">Guardar multimedia con datos de celular</div>
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
                                  <div className="text-[9px] text-teal-100">Resuelve dudas sobre tus catálogos</div>
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
                                <h5 className="font-black text-slate-800 text-[11px] tracking-tight">Política de Privacidad</h5>
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
                                <h5 className="font-black text-slate-800 text-[11px] tracking-tight">Términos de Servicio</h5>
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
                            onClick={() => { stopSound(); setActiveSettingsModal(null); }}
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
                hasUnseenStates={hasUnseenStates}
              />

            </div>

          <SimulatorForwardModal
            message={forwardingMessage}
            onClose={() => { setForwardingMessage(null); setForwardSearchQuery(""); }}
            searchQuery={forwardSearchQuery}
            onSearchChange={setForwardSearchQuery}
            chats={chats}
            searchRef={forwardingSearchRef}
            onForwardMessage={handleForwardMessage}
          />

          <ContactProfile
            isOpen={contactProfile !== null}
            profile={contactProfile}
            onClose={() => setContactProfile(null)}
          />

          {showMyAvatarLightbox && registeredUser?.avatar && (
            <ImageLightbox
              src={registeredUser.avatar}
              alt={registeredUser.name || "Mi perfil"}
              onClose={() => setShowMyAvatarLightbox(false)}
            />
          )}

        </div>
      )}

    </div>
  );
}

async function resolveMediaUrl(msg: Message): Promise<string | undefined> {
  const url = msg.mediaUrl;
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("fetch failed");
    const blob = await resp.blob();
    const folder =
      msg.type === "video" || msg.type === "video_note" ? "video"
      : msg.type === "audio" || msg.type === "voice_note" ? "voice"
      : msg.type === "sticker" ? "stickers"
      : "uploads";
    return await uploadChatMedia(blob, folder);
  } catch (e) {
    console.warn("[FORWARD] resolveMediaUrl failed for", url, e);
    throw e;
  }
}

function getChatTime(x: any): number {
  return new Date(x.updated_at || x.lastMessageTimeRaw || 0).getTime();
}

function sortChats(a: any, b: any): number {
  return getChatTime(b) - getChatTime(a);
}

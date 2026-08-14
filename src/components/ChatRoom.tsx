import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { App as CapacitorApp } from '@capacitor/app';
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { X, Ban, Trash2, UserPlus, Check, ShieldCheck, CheckCircle } from "lucide-react";
import { Chat, Message } from "../types";
import GifPicker from "./GifPicker";
import MessageBubbleWithCache from "./chat/MessageBubbleWithCache";
import ChatCustomizer from "./chat/ChatCustomizer";
import ChatPatternBackground from "./chat/ChatPatternBackground";
import ChatHeader from "./chat/ChatHeader";
import ChatInputBar from "./chat/ChatInputBar";
import DeleteConfirmModal from "./chat/overlays/DeleteConfirmModal";
import GroupInfoPanel from "./chat/overlays/GroupInfoPanel";
import ChatSearchBar from "./chat/overlays/ChatSearchBar";
import AttachmentTray from "./chat/overlays/AttachmentTray";
import PollFormModal from "./chat/overlays/PollFormModal";
import { useSupabase } from "../contexts/SupabaseContext";
import { getMessages, markAsRead, clearForMe, setEphemeralTimer } from "../services/messages";
import { deleteChat as apiDeleteChat } from "../services/chats";
import { addContact } from "../services/contacts";
import { supabase } from "../lib/supabase";
import toast from "react-hot-toast";
import { CHAT_BACKGROUNDS } from "./chat/chatConstants";
import { useOfflineQueue } from "../hooks/useOfflineQueue";
import { useGroupManagement } from "../hooks/chat/useGroupManagement";
import { useChatRealtime, MessageEventPayload } from "../hooks/chat/useChatRealtime";
import { useMessageActions } from "../hooks/chat/useMessageActions";
import { messageRepo } from "../services/database/repositories/MessageRepository";
import { getReconciledSavedId, recordReconciledId } from "../lib/reconciledIds";
import { syncService } from "../services/sync/SyncService";

interface ChatRoomProps {
  chat: Chat;
  onBack: () => void;
  onSendMessage: (msg: Message) => void;
  onTriggerCall: (type: "audio" | "video") => void;
  callInProgress?: boolean;
  onForwardMessage?: (msg: Message) => void;
  onChatDeleted?: (chatId: string) => void;
  onMessageDeleted?: (chatId: string, messageId: string) => void;
  onChatCleared?: (chatId: string) => void;
  onChatUpdated?: (chatId: string, updates: Partial<Chat>) => void;
  onChatMessagesChanged?: (chatId: string, messages: Message[]) => void;
  currentUserId?: string;
  currentUserName?: string;
  refetchTrigger?: number;
  onRegisterBackHandler?: (handler: (() => boolean) | null) => void;
  onOpenProfile?: () => void;
}

export default function ChatRoom({ chat, onBack, onSendMessage, onTriggerCall, callInProgress, onForwardMessage, onChatDeleted, onMessageDeleted, onChatCleared, onChatUpdated, onChatMessagesChanged, currentUserId, currentUserName, refetchTrigger, onRegisterBackHandler, onOpenProfile }: ChatRoomProps) {
  const { user, profile, contacts, refreshContacts } = useSupabase();
  const uid = currentUserId ?? user?.id;
  const uname = currentUserName ?? profile?.name ?? user?.email;

  const { isOnline, queueMessage, isPending } = useOfflineQueue(
    chat.id,
    uid,
    (tempId, savedId) => {
      recordReconciledId(chat.id, tempId, savedId);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: savedId, status: "sent" as const, synced: true } : m));
    },
    (tempId) => {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "sending" as const } : m));
    }
  );

  const [inputText, setInputText] = useState("");
  const [showAttachments, setShowAttachments] = useState(false);
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null); // messageId
  const [recordingType, setRecordingType] = useState<"voice" | "video" | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>(chat.messages || []);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  // Red de seguridad anti-duplicado: un mismo id jamás se renderiza dos veces
  // (evita mensajes espejo cuando un refetch/merge coincide con el optimista).
  const dedupedMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: Message[] = [];
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [messages]);
  const filteredMessages = searchQuery.trim()
    ? dedupedMessages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
    : dedupedMessages;

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
      mediaUrl: m.image_url || m.sticker_url || m.gif_url || m.audio_url || m.video_url || m.file_url || undefined,
      duration: durStr,
      fileName: m.document_name || m.file_name || m.image_alt || undefined,
      fileSize: m.document_size || undefined,
      mimeType: m.mime_type || undefined,
      reactions: m.reactions,
      status: (m.status === "read" ? "read" : m.status === "delivered" ? "delivered" : m.sender_id === uid ? "sent" : undefined) as Message["status"],
      forwarded: m.forwarded || false,
      edited: m.edited || false,
      replyToId: m.reply_to_id,
      replyToText: m.reply_to_text,
      replyToSender: m.reply_to_sender,
      pollQuestion: m.poll_question,
      pollOptions: (() => {
        let opts = m.poll_options;
        if (typeof opts === "string") {
          try { opts = JSON.parse(opts); } catch { opts = []; }
        }
        if (!Array.isArray(opts)) return [];
        return opts.map((o: any) => ({
          id: o.id || String(Math.random()),
          text: o.text || "",
          votes: Number(o.votes) || 0,
          votedUsers: Array.isArray(o.votedUsers) ? o.votedUsers : [],
        }));
      })(),
      latitude: m.latitude,
      longitude: m.longitude,
      locationName: m.location_name,
      isEphemeral: m.is_ephemeral,
      ephemeralExpiresAt: m.ephemeral_expires_at,
    };
  };

  const sortAsc = (msgs: Message[]) => msgs.sort((a, b) => {
    const ta = a.rawCreatedAt || a.timestamp || "";
    const tb = b.rawCreatedAt || b.timestamp || "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  // Safe merge: UNICAMENTE por consistencia atómica de ID (tempId -> savedId),
  // nunca por contenido/duración (evita colisiones al enviar notas parecidas).
  // El optimista se convierte en su fila confirmada con el id REAL del servidor
  // porque SQLite ya lo sustituyó atómicamente (messageRepo.reconcileTemp) y el
  // mapa de IDs reconciliados lo resuelve también al re-entrar al chat.
  const safeMergeMessages = (prev: Message[], incoming: Message[]): Message[] => {
    if (incoming.length === 0) return prev;

    const incomingMap = new Map<string, Message>();
    for (const msg of incoming) {
      incomingMap.set(msg.id, msg);
    }

    let changed = false;
    const merged = prev.map(msg => {
      const serverMsg = incomingMap.get(msg.id);
      if (serverMsg) {
        incomingMap.delete(msg.id);
        if (
          serverMsg.status !== msg.status ||
          serverMsg.text !== msg.text ||
          serverMsg.edited !== msg.edited ||
          JSON.stringify(serverMsg.reactions) !== JSON.stringify(msg.reactions)
        ) {
          changed = true;
          return { ...msg, ...serverMsg };
        }
        return msg;
      }
      // Sustitución por ID reconciliado: si este temp ya fue confirmado antes
      // (mapa persistente tempId->savedId) y su fila real viene en `incoming`,
      // se funde en el mismo índice con su id atómico real.
      if (msg.sender === "me" && (msg.id?.startsWith("temp_") || msg.id?.startsWith("msg_"))) {
        const savedId = getReconciledSavedId(chat.id, msg.id);
        if (savedId) {
          const twin = incomingMap.get(savedId);
          if (twin) {
            incomingMap.delete(savedId);
            changed = true;
            return { ...msg, ...twin, id: twin.id, status: "sent" as const, synced: true };
          }
        }
      }
      return msg;
    });

    if (incomingMap.size > 0) {
      changed = true;
      for (const msg of incomingMap.values()) {
        merged.push(msg);
      }
    }

    if (changed) {
      merged.sort((a, b) => {
        const ta = a.rawCreatedAt || a.timestamp || "";
        const tb = b.rawCreatedAt || b.timestamp || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    }

    // Red final: jamás renderizar el mismo id dos veces.
    const seen = new Set<string>();
    let hadDuplicates = false;
    const deduped = merged.filter((m) => {
      if (seen.has(m.id)) { hadDuplicates = true; return false; }
      seen.add(m.id);
      return true;
    });

    if (changed || hadDuplicates) {
      if (hadDuplicates) {
        deduped.sort((a, b) => {
          const ta = a.rawCreatedAt || a.timestamp || "";
          const tb = b.rawCreatedAt || b.timestamp || "";
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        return deduped;
      }
      return merged;
    }
    return prev;
  };

  // Merge server messages with local pending (temp) messages to avoid wiping out in-flight sends
  const mergeServerMessages = useCallback((serverMessages: Message[]) => {
    setMessages(prev => safeMergeMessages(prev, serverMessages));
  }, []);

  // Fetch initial messages: cache-first, then network refresh
  useEffect(() => {
    console.log('[CHAT] useEffect [chat.id] — chat.id:', chat.id);
    if (chat.id) {
      setHasMoreOlder(true);

      // 1. Load cached messages immediately (offline-first)
      messageRepo.getMessages(chat.id).then(cached => {
        if (cached.length > 0) {
          // Merge consciente: elimina tems optimistas viejos (relojito) cuando la
          // caché ya tiene la fila confirmada, y no duplica por id.
          setMessages(prev => safeMergeMessages(prev, cached));
          setHasMoreOlder(true);
        }

        // 2. Fetch fresh messages from server in background
        getMessages(chat.id, { limit: 50 }).then(apiMessages => {
          console.log('[CHAT] getMessages result count:', apiMessages?.length);
          if (apiMessages && apiMessages.length > 0) {
            const mapped = apiMessages.map(mapApiMsg);
            mergeServerMessages(mapped);
            messageRepo.saveMessages(chat.id, mapped);
            const latest = mapped.reduce((max, m) => (m.rawCreatedAt && m.rawCreatedAt > max ? m.rawCreatedAt : max), '');
            if (latest) lastSyncTimestampRef.current = latest;
            if (apiMessages.length < 50) setHasMoreOlder(false);
            console.log('[CHAT] ✅ setMessages called with', mapped.length, 'messages');
          } else {
            if (cached.length === 0) setHasMoreOlder(false);
            console.log('[CHAT] ⚠️ getMessages returned 0 messages');
          }
        }).catch((err) => {
          console.error('[CHAT] ❌ getMessages error (using cache):', err);
          // Keep showing cached messages — offline-first UX
        });
      });
    }
  }, [chat.id]);

  // Reintentos en segundo plano (cola SyncService): cuando un mensaje que quedó
  // en "sending" se envía al recuperar la señal, marcar ✓ en este chat aunque
  // el eco de Realtime no llegue (red 3G con WebSocket caído).
  useEffect(() => {
    if (!chat.id) return;
    const onSynced = (tempId: string, savedId: string) => {
      recordReconciledId(chat.id, tempId, savedId);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: savedId, status: "sent" as const, synced: true } : m));
    };
    syncService.onSynced(onSynced);
    return () => syncService.offSynced(onSynced);
  }, [chat.id]);

  // Refetch only newer messages when refetchTrigger changes (FCM push received)
  useEffect(() => {
    if (chat.id && refetchTrigger && refetchTrigger > 0 && messages.length > 0) {
      getMessages(chat.id, { limit: 50 }).then(apiMessages => {
        if (apiMessages && apiMessages.length > 0) {
          const mapped = apiMessages.map(mapApiMsg);
          const latest = mapped.reduce((max, m) => (m.rawCreatedAt && m.rawCreatedAt > max ? m.rawCreatedAt : max), '');
          if (latest) lastSyncTimestampRef.current = latest;
          setMessages(prev => safeMergeMessages(prev, mapped));
        }
      }).catch(err => console.error("[ChatRoom] fetch messages failed:", err));
    }
  }, [chat.id, refetchTrigger]);

  // Refetch only newer messages when app comes back to foreground
  useEffect(() => {
    const handler = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && chat.id && messages.length > 0) {
        getMessages(chat.id, { limit: 50 }).then(apiMessages => {
          if (apiMessages && apiMessages.length > 0) {
            const mapped = apiMessages.map(mapApiMsg);
            const latest = mapped.reduce((max, m) => (m.rawCreatedAt && m.rawCreatedAt > max ? m.rawCreatedAt : max), '');
            if (latest) lastSyncTimestampRef.current = latest;
            setMessages(prev => safeMergeMessages(prev, mapped));
          }
        }).catch(err => console.error("[ChatRoom] refetch messages failed:", err));
      }
    });
    return () => { handler.then(h => h.remove()); };
  }, [chat.id]);

  // ── Infinite scroll: load older messages ────────────────────────
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || messagesRef.current.length === 0) return;
    const oldestTs = messagesRef.current[0]?.rawCreatedAt;
    if (!oldestTs) return;

    setLoadingOlder(true);
    try {
      const older = await getMessages(chat.id, { limit: 50, before: oldestTs });
      if (older && older.length > 0) {
        const mapped = older.map(mapApiMsg);
        messageRepo.saveMessages(chat.id, mapped);
        setMessages(prev => safeMergeMessages(prev, mapped));
        if (older.length < 50) setHasMoreOlder(false);
      } else {
        setHasMoreOlder(false);
      }
    } catch (err) {
      console.error('[CHAT] Error loading older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [chat.id, loadingOlder, hasMoreOlder]);

  // Save messages to cache whenever they change (immediate, no debounce)
  useEffect(() => {
    if (chat.id && messages.length > 0) {
      messageRepo.saveMessages(chat.id, messages);
    }
  }, [chat.id, messages]);

  // Fuente de verdad hacia el padre: cada cambio de mensajes real se propaga una
  // sola vez (sin re-diputar por la identidad del callback).
  const onChatMessagesChangedRef = useRef(onChatMessagesChanged);
  useEffect(() => { onChatMessagesChangedRef.current = onChatMessagesChanged; });
  useEffect(() => {
    if (chat.id && onChatMessagesChangedRef.current) {
      onChatMessagesChangedRef.current(chat.id, messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, messages]);

  // Live Chat Style states with localStorage caching
  const [selectedBgId, setSelectedBgId] = useState(() => {
    return localStorage.getItem("chat_bg_id") || "default";
  });
  const [customBgImage, setCustomBgImage] = useState<string | null>(() => {
    return localStorage.getItem("chat_bg_custom");
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
  const [ephemeralTimer, setEphemeralTimerState] = useState<number | null>(() => (chat as any)?.ephemeral_timer ?? null);

  // Synchronize style choices with localStorage
  useEffect(() => {
    localStorage.setItem("chat_bg_id", selectedBgId);
  }, [selectedBgId]);

  useEffect(() => {
    if (customBgImage) localStorage.setItem("chat_bg_custom", customBgImage);
    else localStorage.removeItem("chat_bg_custom");
  }, [customBgImage]);

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

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSyncTimestampRef = useRef<string | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const sendingRecordingRef = useRef(false);
  const pendingSendIdsRef = useRef<Set<string>>(new Set());
  const isSendingRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleMessageEvent = (payload: MessageEventPayload) => {
    if (payload.event === 'INSERT') {
      const raw = payload.raw;
      if (raw.is_deleted) return;
      const mapped: Message = mapApiMsg(raw);
      messageRepo.upsertMessage(chat.id, { ...mapped, synced: true, chatId: chat.id });
      if (raw.sender_id !== uid) {
        setMessages(prev => prev.map(m =>
          m.sender === "me" && m.status === "sent" ? { ...m, status: "delivered" as const } : m
        ));
        if (mapped.rawCreatedAt && mapped.rawCreatedAt > (lastSyncTimestampRef.current || '')) {
          lastSyncTimestampRef.current = mapped.rawCreatedAt;
        }
        setMessages(prev => {
          if (prev.some(m => m.id === mapped.id)) return prev;
          return [...prev, mapped];
        });
        markAsRead(chat.id, uid, uname).catch(err => console.error("[ChatRoom] markAsRead on new message failed:", err));
      } else {
        // Eco de un mensaje propio. Reconciliación INSTANTÁNEA por temp_id:
        // - El emisor guardó temp_id (su id local msg_*/temp_*) en la fila, y el
        //   evento INSERT lo trae en payload.new.temp_id (useChatRealtime pasa
        //   payload.new tal cual). Si existe en el estado, se sustituye EN CALIENTE
        //   por la fila real sin depender del orden HTTP-vs-WebSocket ni de
        //   matchear media_url (blob: vs https:), que era la carrera del relojito.
        // - Si el id real ya está en el estado, se ignora (no retrocede).
        // - Fallback: match por media_url exacta (notas/parecidos sin temp_id).
        setMessages(prev => {
          if (prev.some(m => m.id === raw.id)) {
            console.log("[EV] eco ignorado (id real ya presente)", { id: raw.id });
            return prev;
          }
          const rawTempId = raw.temp_id as string | undefined;
          if (rawTempId && prev.some(m => m.id === rawTempId)) {
            const replacement = { ...mapped, id: raw.id, status: "sent" as const, synced: true };
            // Re-escritura atómica en SQLite: sustituye temp_id por la fila real
            // simultáneamente (mismo ciclo que re-entrar al chat, sin demora).
            messageRepo.reconcileTemp(chat.id, rawTempId, replacement).catch((err) =>
              console.error("[EV] reconcileTemp por temp_id falló (UI ya marcó sent):", err)
            );
            recordReconciledId(chat.id, rawTempId, raw.id);
            console.log("[EV] eco reconcilió temp por temp_id", { tempId: rawTempId, savedId: raw.id });
            return prev.map(m => m.id === rawTempId ? replacement : m);
          }
          const rawMedia = mapped?.mediaUrl || "";
          const pendingIdx = prev.findIndex(m =>
            (m.id?.startsWith("temp_") || m.id?.startsWith("msg_")) &&
            (m.status === "sending" || m.status === "error") &&
            m.sender === "me" &&
            !!rawMedia &&
            m.mediaUrl === rawMedia
          );
          console.log("[EV] eco propio INSERT", { id: raw.id, media: rawMedia, pendingIdx, rawTempId });
          if (pendingIdx !== -1) {
            const pendingMsg = prev[pendingIdx];
            const reconciled = { ...pendingMsg, ...mapped, id: raw.id, status: "sent" as const, synced: true };
            messageRepo.deleteMessage(chat.id, pendingMsg.id).catch(() => {});
            recordReconciledId(chat.id, pendingMsg.id, raw.id);
            const updated = [...prev];
            updated[pendingIdx] = reconciled;
            console.log("[EV] eco reconcilió temp por media_url", { tempId: pendingMsg.id, savedId: raw.id });
            return updated;
          }
          console.log("[EV] eco propio SIN temp match → anexando fila real", { id: raw.id });
          return [...prev, { ...mapped, synced: true }];
        });
      }
    } else {
      const updated = payload.raw;
      setMessages(prev => {
        const exists = prev.some(m => m.id === updated.id);
        if (!exists) return prev;
        let changed = false;
        const next = prev.map(m => {
          if (m.id !== updated.id) return m;
          let copy = { ...m };
          if (updated.is_deleted) {
            changed = true;
            return null;
          }
          if (updated.status === "read" && m.status !== "read") {
            copy.status = "read"; changed = true;
          }
          if (updated.edited && updated.text !== m.text) {
            copy.text = updated.text; copy.edited = true; changed = true;
          }
          if (updated.reactions && JSON.stringify(updated.reactions) !== JSON.stringify(m.reactions)) {
            copy.reactions = updated.reactions; changed = true;
          }
          if (updated.poll_options !== undefined && updated.poll_options !== null) {
            let opts = updated.poll_options;
            if (typeof opts === "string") {
              try { opts = JSON.parse(opts); } catch { opts = []; }
            }
            if (Array.isArray(opts)) {
              const newPollOptions = opts.map((o: any) => ({
                id: o.id || String(Math.random()),
                text: o.text || "",
                votes: Number(o.votes) || 0,
                votedUsers: Array.isArray(o.votedUsers) ? o.votedUsers : [],
              }));
              if (JSON.stringify(newPollOptions) !== JSON.stringify(copy.pollOptions)) {
                copy.pollOptions = newPollOptions; changed = true;
              }
            }
          }
          return copy;
        }).filter(Boolean) as Message[];
        if (changed) {
          const updatedMsg = next.find(m => m.id === updated.id);
          if (updatedMsg) {
            messageRepo.upsertMessage(chat.id, updatedMsg);
          }
          return next;
        }
        return prev;
      });
    }
  };

  // Watchdog mínimo: red de seguridad final. La reconciliación ahora es
// instantánea por temp_id (payload.new.temp_id) en el eco INSERT de Realtime,
// sin timers. El reintento automático de SyncService drena la cola mientras
// tanto (idempotente por client_id), por eso el umbral es 5 min: solo se marca
// "error" un envío muerto tras darle tiempo a los reintentos — no hace refetch.
  useEffect(() => {
    const interval = setInterval(() => {
      setMessages(prev => {
        const now = Date.now();
        let changed = false;
        const next = prev.map(m => {
          if ((m.id?.startsWith('temp_') || m.id?.startsWith('msg_')) && m.status === 'sending') {
            const ts = Number(m.id.split('_')[1]);
            if (!isNaN(ts) && now - ts > 300000) {
              changed = true;
              console.warn("[WATCHDOG] temp marcado error (envío muerto)", { id: m.id, secs: Math.round((now - ts) / 1000) });
              return { ...m, status: "error" as const };
            }
          }
          return m;
        });
        return changed ? next : prev;
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleReconnect = (lastSyncTimestamp: string) => {
    getMessages(chat.id, { after: lastSyncTimestamp }).then(newMsgs => {
      if (newMsgs && newMsgs.length > 0) {
        const mapped = newMsgs.map(mapApiMsg);
        const latest = mapped.reduce((max, m) => (m.rawCreatedAt && m.rawCreatedAt > max ? m.rawCreatedAt : max), lastSyncTimestamp);
        if (latest) lastSyncTimestampRef.current = latest;
        mergeServerMessages(mapped);
      }
    }).catch(err => console.error("[ChatRoom] refetch newer messages failed:", err));
  };

  const {
    groupMembers, editingGroupName, groupNameDraft, localGroupName, groupAvatar,
    showAddMember, addMemberQuery, addMemberResults, addingMember,
    setEditingGroupName, setGroupNameDraft, setShowAddMember, setAddMemberQuery, setAddMemberResults,
    handleSaveGroupName, handleAddMember, handleRemoveMember, handleChangePhoto,
    handleLeaveGroup: hookHandleLeaveGroup,
    isGroupMuted, muteUntil, muting, handleMuteGroup, handleUnmuteGroup,
  } = useGroupManagement(chat.id, chat.name, uid, chat.isGroup ?? false, showGroupInfo);

  const handleGroupPhotoChange = useCallback(async (dataUrl: string) => {
    const url = await handleChangePhoto(dataUrl);
    if (url) onChatUpdated?.(chat.id, { avatar: url });
  }, [handleChangePhoto, onChatUpdated, chat.id]);

  const { partnerTyping, emitTyping } = useChatRealtime(
    chat.id, uid, uname, lastSyncTimestampRef, handleMessageEvent, handleReconnect
  );

  const handleLeaveGroup = async () => {
    if (await hookHandleLeaveGroup()) { onChatDeleted?.(chat.id); onBack(); }
  };

  // ── Solicitud de mensaje de un remitente desconocido ──
  // El mensaje se lee normal, pero si quien escribe NO es tu contacto, se muestra
  // la tarjeta con Rechazar / Eliminar / Guardar como contacto.
  const partnerUserId = chat.partnerUserId;
  const hasIncomingMsgFromOther = messages.some(m => m.sender === "other");
  const isUnknownSender = !chat.isGroup && !!partnerUserId && partnerUserId !== uid &&
    !contacts.some(c => c.contact_user_id === partnerUserId) &&
    hasIncomingMsgFromOther;
  const [reqView, setReqView] = useState<"actions" | "save" | "reject-confirm">("actions");
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedBar, setSavedBar] = useState(false);

  const handleSaveContact = async () => {
    if (!uid || !partnerUserId || !saveName.trim()) return;
    setSaving(true);
    try {
      const { data: partnerProfile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", partnerUserId)
        .maybeSingle();
      await addContact(uid, partnerUserId, saveName.trim(), partnerProfile?.avatar_url || "");
      await refreshContacts?.();
      setSavedBar(true);
      toast.success("Contacto guardado con éxito");
      setTimeout(() => setSavedBar(false), 2600);
    } catch (e) {
      console.error("[CHAT] save contact error:", e);
      toast.error("No se pudo guardar el contacto");
    }
    setSaving(false);
  };

  const handleRejectAndBlock = async () => {
    if (!uid || !partnerUserId) return;
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("blocks")
        .select("id")
        .eq("blocker_id", uid)
        .eq("blocked_id", partnerUserId)
        .maybeSingle();
      if (!existing) {
        await supabase.from("blocks").insert({ blocker_id: uid, blocked_id: partnerUserId });
      }
    } catch (e) {
      console.warn("[CHAT] block duplicate/insert:", e);
    }
    try {
      messageRepo.clearMessages(chat.id);
      await apiDeleteChat(chat.id, uid);
      onChatDeleted?.(chat.id);
    } catch (e) {
      console.error("[CHAT] delete on reject:", e);
    }
    setSaving(false);
    toast.success("Mensaje rechazado y remitente bloqueado");
    onBack();
  };

  // ── Auto-scroll to bottom on new messages or chat open ──
  const scrollToBottom = () => {
    if (virtuosoRef.current && messages.length > 0) {
      virtuosoRef.current.scrollToIndex({ index: messages.length - 1, behavior: "auto" });
    }
  };
  // Solo pega el scroll abajo si ya estás abajo; si estás leyendo hacia arriba,
  // no te brinca (evita el parpadeo de "desaparece y aparece").
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (messages.length > 0 && atBottomRef.current) {
      const timer = setTimeout(scrollToBottom, 50);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  // ── Scroll to highlighted search result ──
  useEffect(() => {
    if (showSearch && searchQuery.trim() && filteredMessages.length > 0) {
      virtuosoRef.current?.scrollToIndex({ index: searchIndex, behavior: "smooth", align: "center" });
    }
  }, [searchIndex, showSearch, searchQuery, filteredMessages.length]);

  const videoMimeTypeRef = useRef('video/webm');

  // Real MediaRecorder + timer
  useEffect(() => {
    if (recordingType) {
      setRecordingSeconds(0);
      setIsCameraReady(false);
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
          const recorderMimeType =
            recordingType === "video" && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
              ? 'video/webm;codecs=vp8,opus'
              : undefined;
          const recorder = new MediaRecorder(stream, {
            mimeType: recorderMimeType,
            audioBitsPerSecond: 128000,
            ...(recordingType === "video" ? { videoBitsPerSecond: 2500000 } : {}),
          });
          if (recordingType === "video") {
            videoMimeTypeRef.current = recorder.mimeType;
          }
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorder.onerror = (e: any) => {
            console.error("[CHAT] MediaRecorder error:", e?.error || e);
            setRecordingType(null);
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

  // Read receipts on mount and when new messages arrive
  useEffect(() => {
    if (chat.id && uid && uname) {
      markAsRead(chat.id, uid, uname).catch(err => console.error("[ChatRoom] markAsRead on mount failed:", err));
    }
  }, [chat.id, uid, uname]);


  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);

  const actions = useMessageActions({
    chatId: chat.id,
    uid,
    uname,
    chatName: chat.name,
    messageRepo,
    onSendMessage,
    onMessageDeleted,
    emitTyping,
    inputText,
    replyTo,
    recordingType,
    recordingSeconds,
    pollQuestion,
    pollOption1,
    pollOption2,
    messages,
    setInputText,
    setReplyTo,
    setRecordingType,
    setShowGifPicker,
    setShowAttachments,
    setShowPollForm,
    setPollQuestion,
    setPollOption1,
    setPollOption2,
    setActiveReactionMenu,
    setEditingMessage,
    setMessages,
    pendingSendIdsRef,
    isSendingRef,
    typingTimerRef,
    mediaRecorderRef,
    mediaStreamRef,
    chunksRef,
    sendingRecordingRef,
    recordingTimer,
    videoPreviewRef,
  });

  const handleSetEphemeralTimer = useCallback(async (timer: number) => {
    try {
      await setEphemeralTimer(chat.id, timer);
      setEphemeralTimerState(timer === 0 ? null : timer);
      onChatUpdated?.(chat.id, { ephemeral_timer: timer === 0 ? null : timer } as any);
      if (timer > 0) {
        const label = timer === 86400 ? "24 horas" : timer === 604800 ? "7 días" : timer === 7776000 ? "90 días" : `${Math.round(timer / 60)} min`;
        const now = new Date().toISOString();
        const sysMsg: Message = {
          id: `sys_ephemeral_${Date.now()}`,
          sender: "me",
          type: "text",
          text: `Los mensajes de este chat desaparecerán después de ${label}.`,
          timestamp: now,
          rawCreatedAt: now,
        };
        setMessages(prev => {
          const next = [...prev, sysMsg].sort((a, b) => {
            const ta = a.rawCreatedAt || a.timestamp || "";
            const tb = b.rawCreatedAt || b.timestamp || "";
            return ta < tb ? -1 : ta > tb ? 1 : 0;
          });
          return next;
        });
      }
      toast.success(timer === 0 ? "Mensajes temporales desactivados" : "Mensajes temporales activados");
    } catch (e: any) {
      console.error("[CHAT] setEphemeralTimer error:", e);
      toast.error(e?.message || "Error al configurar mensajes temporales");
    }
  }, [chat.id, onChatUpdated]);

  // Hide ephemeral messages locally once their expiry passes (countdown sweep)
  useEffect(() => {
    if (!messages.some(m => m.isEphemeral && m.ephemeralExpiresAt)) return;
    const sweep = () => {
      setMessages(prev => {
        const now = new Date().toISOString();
        const next = prev.filter(m => {
          if (m.isEphemeral && m.ephemeralExpiresAt) {
            return m.ephemeralExpiresAt > now;
          }
          return true;
        });
        return next.length === prev.length ? prev : next;
      });
    };
    sweep();
    const t = setInterval(sweep, 15000);
    return () => clearInterval(t);
  }, [messages]);

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


  const isCustomBg = selectedBgId === "custom" && !!customBgImage;
  const bgPreset = isCustomBg ? undefined : CHAT_BACKGROUNDS.find(bg => bg.id === selectedBgId);
  const rawBg = isCustomBg
    ? `url("${customBgImage}") center/cover no-repeat`
    : (bgPreset?.value || "#f8fafc");
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

      <ChatHeader
        chat={chat}
        onBack={onBack}
        partnerTyping={partnerTyping}
        onTriggerCall={onTriggerCall}
        callInProgress={callInProgress}
        showSearch={showSearch}
        onToggleSearch={() => { setShowSearch(!showSearch); setSearchQuery(""); setSearchIndex(0); }}
        showDropdown={showDropdown}
        setShowDropdown={setShowDropdown}
        onClearChat={async () => {
          setShowDropdown(false);
          try {
            messageRepo.clearMessages(chat.id);
            await clearForMe(chat.id);
            onChatCleared?.(chat.id);
            onBack();
          } catch (e) {
            console.error("[CHAT] clearForMe error:", e);
          }
        }}
        onOpenCustomizer={() => { setShowCustomizer(true); setShowDropdown(false); }}
        onOpenGroupInfo={() => { setShowGroupInfo(true); setShowDropdown(false); }}
        onOpenDeleteConfirm={() => { setShowDeleteConfirm(true); setShowDropdown(false); }}
        onOpenProfile={onOpenProfile}
        ephemeralTimer={ephemeralTimer}
        onSetEphemeralTimer={handleSetEphemeralTimer}
      />

      {/* ── Solicitud de mensaje de remitente desconocido ── (mensaje se lee igual) */}
      {(isUnknownSender || savedBar) && (
        <div className="relative z-20 mx-3 mb-2">
          <div className="rounded-2xl bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50 border border-teal-200 p-3 shadow-sm">
            <div className="flex items-center gap-2.5 mb-2.5">
                <img
                src={chat.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M12 14c-4 0-6 2-6 4v2h12v-2c0-2-2-4-6-4z'/%3E%3C/svg%3E"}
                alt={chat.name || "contacto"}
                className="w-9 h-9 rounded-full object-cover bg-slate-100 border border-teal-100"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-teal-900">Solicitud de mensaje</p>
                <p className="text-[10px] text-slate-500 truncate">{chat.name || "Nuevo colaborador"} no está en tus contactos</p>
              </div>
              <ShieldCheck className="w-4 h-4 text-teal-500" />
            </div>

            {reqView === "actions" && (
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => setReqView("reject-confirm")}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl bg-white/80 hover:bg-red-50 border border-red-100 text-red-700 transition-all cursor-pointer"
                >
                  <Ban className="w-4 h-4" />
                  <span className="text-[10px] font-semibold">Rechazar</span>
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl bg-white/80 hover:bg-slate-100 border border-slate-200 text-slate-700 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-[10px] font-semibold">Eliminar</span>
                </button>
                <button
                  onClick={() => setReqView("save")}
                  className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl bg-white/80 hover:bg-teal-50 border border-teal-200 text-teal-700 transition-all cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span className="text-[10px] font-semibold">Guardar</span>
                </button>
              </div>
            )}

            {reqView === "save" && (
              <div className="pt-1">
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder={chat.name || "Nombre del contacto"}
                  className="w-full text-[12px] px-2.5 py-1.5 rounded-lg border border-teal-200/50 focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white/90"
                  maxLength={40}
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  <button
                    onClick={() => { setReqView("actions"); setSaveName(""); }}
                    disabled={saving}
                    className="py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                  >
                    <span className="text-[11px] font-semibold">Cancelar</span>
                  </button>
                  <button
                    onClick={handleSaveContact}
                    disabled={saving || !saveName.trim()}
                    className="py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? (
                      <span className="text-[11px] font-semibold">Guardando…</span>
                    ) : (
                      <span className="text-[11px] font-semibold">Guardar</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {reqView === "reject-confirm" && (
              <div className="pt-1">
                <p className="text-[9px] text-slate-500 mb-2">
                  Bloquearás a {chat.name || "esta persona"} y eliminarás el chat. No volverán a escribirte.
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setReqView("actions")}
                    disabled={saving}
                    className="py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                  >
                    <span className="text-[11px] font-semibold">Cancelar</span>
                  </button>
                  <button
                    onClick={handleRejectAndBlock}
                    disabled={saving}
                    className="py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? (
                      <span className="text-[11px] font-semibold">Bloqueando…</span>
                    ) : (
                      <span className="text-[11px] font-semibold">Sí, bloquear y eliminar</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {savedBar && (
              <div className="flex items-center gap-1.5 mt-1 text-[11px] text-teal-800 font-semibold">
                <CheckCircle className="w-4 h-4 text-teal-600" />
                <span>Guardado con éxito</span>
              </div>
            )}
          </div>
        </div>
      )}

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
        customBgImage={customBgImage}
        onSetCustomBgImage={setCustomBgImage}
      />

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        isGroup={chat.isGroup ?? false}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          setShowDeleteConfirm(false);
          try {
            messageRepo.clearMessages(chat.id);
            if (user?.id) {
              await apiDeleteChat(chat.id, user.id);
            }
            onChatDeleted?.(chat.id);
            onBack();
          } catch (e) {
            console.error("[CHAT] deleteChat error:", e);
          }
        }}
      />

      <GroupInfoPanel
        isOpen={showGroupInfo}
        chatName={chat.name}
        groupAvatar={groupAvatar}
        currentUserId={uid}
        groupMembers={groupMembers}
        editingName={editingGroupName}
        groupNameDraft={groupNameDraft}
        showAddMember={showAddMember}
        addMemberQuery={addMemberQuery}
        addMemberResults={addMemberResults}
        addingMember={addingMember}
        onChangePhoto={handleGroupPhotoChange}
        onClose={() => setShowGroupInfo(false)}
        onCancelEditName={() => { setEditingGroupName(false); setShowAddMember(false); }}
        onStartEditName={() => { setGroupNameDraft(localGroupName); setEditingGroupName(true); }}
        onNameDraftChange={setGroupNameDraft}
        onSaveName={handleSaveGroupName}
        onToggleAddMember={() => setShowAddMember(!showAddMember)}
        onAddMemberQueryChange={setAddMemberQuery}
        onAddMember={handleAddMember}
        onRemoveMember={handleRemoveMember}
        onLeaveGroup={handleLeaveGroup}
        onOpenDeleteConfirm={() => { setShowGroupInfo(false); setShowDeleteConfirm(true); }}
        isMuted={isGroupMuted}
        muteUntil={muteUntil}
        muting={muting}
        onMute={handleMuteGroup}
        onUnmute={handleUnmuteGroup}
      />

      <ChatSearchBar
        isOpen={showSearch}
        query={searchQuery}
        resultCount={filteredMessages.length}
        currentIndex={searchIndex}
        onQueryChange={(v) => { setSearchQuery(v); setSearchIndex(0); }}
        onPrev={() => setSearchIndex(i => Math.max(0, i - 1))}
        onNext={() => setSearchIndex(i => Math.min(filteredMessages.length - 1, i + 1))}
        onClose={() => { setShowSearch(false); setSearchQuery(""); setSearchIndex(0); }}
      />

      {/* MESSAGES LIST AREA */}
      <div className="flex-1 relative bg-transparent">
        <Virtuoso
          ref={virtuosoRef}
          className="h-full"
          data={showSearch && searchQuery.trim() ? filteredMessages : dedupedMessages}
          followOutput="smooth"
          atBottomStateChange={(isAtBottom) => { atBottomRef.current = isAtBottom; }}
          startReached={() => {
            if (!loadingOlder && hasMoreOlder) loadOlderMessages();
          }}
          components={{
            Header: () =>
              loadingOlder ? (
                <div className="flex justify-center py-3">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
                    Cargando mensajes anteriores...
                  </div>
                </div>
              ) : null,
          }}
          style={{ paddingTop: "16px", paddingBottom: "16px" }}
          itemContent={(index, msg) => {
            const isMe = msg.sender === "me";
            const isHighlighted = showSearch && searchQuery.trim() && index === searchIndex;
            return (
              <div className={`px-4 pb-3.5 ${isHighlighted ? "ring-2 ring-teal-400 rounded-xl transition-all duration-300" : ""}`}>
              {msg.type === "text" && msg.id.startsWith("sys_ephemeral_") ? (
                <div className="flex justify-center">
                  <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 text-[11px] text-white/90 font-semibold text-center">
                    ⏳ {msg.text}
                  </div>
                </div>
              ) : (
                <MessageBubbleWithCache
                  msg={msg}
                  isMe={isMe}
                  activeReactionMenu={activeReactionMenu}
                  setActiveReactionMenu={setActiveReactionMenu}
                  handleVote={actions.handleVote}
                  handleAddReaction={actions.handleAddReaction}
                  handleDeleteMessage={actions.handleDeleteMessage}
                  handleDeleteForMe={actions.handleDeleteForMe}
                  handleForwardMessage={(m) => onForwardMessage?.(m)}
                  handleReplyMessage={actions.handleReplyMessage}
                  bubbleColorMeId={bubbleColorMeId}
                  bubbleColorThemId={bubbleColorThemId}
                  isPending={isPending}
                  onEdit={(m) => setEditingMessage({ id: m.id, text: m.text || "" })}
                  onUpdatePrice={actions.handleUpdatePrice}
                />
              )}
              </div>
            );
          }}
        />
          <div ref={messagesEndRef} />
      </div>

      {showAttachments && (
        <AttachmentTray
          onPickFile={(accept, type) => { setShowAttachments(false); actions.triggerFilePick(accept, type); }}
          onOpenGifPicker={() => { setShowGifPicker(true); setShowAttachments(false); }}
          onOpenPollForm={() => { setShowPollForm(true); }}
          onSendLocation={() => { setShowAttachments(false); actions.handleSendLocation(); }}
        />
      )}

      <PollFormModal
        isOpen={showPollForm}
        question={pollQuestion}
        option1={pollOption1}
        option2={pollOption2}
        onQuestionChange={setPollQuestion}
        onOption1Change={setPollOption1}
        onOption2Change={setPollOption2}
        onSubmit={actions.handleCreatePoll}
        onClose={() => setShowPollForm(false)}
      />

      {/* GIF / STICKER PICKER OVERLAY */}
      {showGifPicker && (
        <GifPicker
          onSelect={(url, type) => {
            if (type === "emoji") {
              actions.handleSendText(url);
              setShowGifPicker(false);
            } else {
              actions.handleSendSticker(url, type);
            }
          }}
          onClose={() => setShowGifPicker(false)}
        />
      )}

      <ChatInputBar
        inputText={inputText}
        setInputText={setInputText}
        showAttachments={showAttachments}
        setShowAttachments={setShowAttachments}
        replyTo={replyTo}
        setReplyTo={setReplyTo}
        recordingType={recordingType}
        setRecordingType={setRecordingType}
        recordingSeconds={recordingSeconds}
        isCameraReady={isCameraReady}
        setIsCameraReady={setIsCameraReady}
        showGifPicker={showGifPicker}
        setShowGifPicker={setShowGifPicker}
        onSendText={actions.handleSendText}
        onFinishVoiceNote={actions.handleFinishVoiceNote}
        triggerFilePick={actions.triggerFilePick}
        emitTyping={emitTyping}
        chatName={chat.name}
        videoPreviewRef={videoPreviewRef as React.RefObject<HTMLVideoElement | null>}
        typingTimerRef={typingTimerRef}
      />

      {/* EDIT MESSAGE MODAL */}
      {editingMessage && (
        <EditMessageOverlay
          initialText={editingMessage.text}
          onSave={(newText) => actions.handleEditMessage(editingMessage.id, newText)}
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
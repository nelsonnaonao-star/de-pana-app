import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { App as CapacitorApp } from '@capacitor/app';
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { X } from "lucide-react";
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
import toast from "react-hot-toast";
import { CHAT_BACKGROUNDS } from "./chat/chatConstants";
import { useOfflineQueue } from "../hooks/useOfflineQueue";
import { useGroupManagement } from "../hooks/chat/useGroupManagement";
import { useChatRealtime, MessageEventPayload } from "../hooks/chat/useChatRealtime";
import { useMessageActions } from "../hooks/chat/useMessageActions";
import { messageRepo } from "../services/database/repositories/MessageRepository";

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
  const { user, profile } = useSupabase();
  const uid = currentUserId ?? user?.id;
  const uname = currentUserName ?? profile?.name ?? user?.email;

  const { isOnline, queueMessage, isPending } = useOfflineQueue(
    chat.id,
    uid,
    (tempId, savedId) => {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: savedId, status: "sent", synced: true } : m));
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

  // Safe merge: deduplicates by id, preserves existing references when nothing changed.
  // Only creates new array/sorted if there are actual changes. NUNCA elimina una
  // fila legítima: un mensaje optimista (temp) se funde EN EL MISMO ÍNDICE con la
  // fila confirmada del servidor, nunca se descarta y se pierde.
  const safeMergeMessages = (prev: Message[], incoming: Message[]): Message[] => {
    if (incoming.length === 0) return prev;

    const incomingMap = new Map<string, Message>();
    for (const msg of incoming) {
      incomingMap.set(msg.id, msg);
    }

    // Cuenta mensajes "me" por contenido para no fusionar dos envíos distintos
    // que comparten el mismo texto (ej. "hola" enviado dos veces).
    const meByKeyCount = new Map<string, number>();
    for (const m of prev) {
      if (m.sender === "me") {
        const k = m.text || m.mediaUrl || "";
        if (k) meByKeyCount.set(k, (meByKeyCount.get(k) || 0) + 1);
      }
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
      // Reconciliación en el mismo lugar: un temp optimista (relojito) cuyo
      // contenido coincide con la fila confirmada se sustituye por ella en el
      // mismo índice → UNA sola fila, ni duplicado ni pérdida.
      if (
        msg.sender === "me" &&
        (msg.id?.startsWith("temp_") || msg.id?.startsWith("msg_"))
      ) {
        const key = msg.text || msg.mediaUrl || "";
        if (key && (meByKeyCount.get(key) || 0) <= 1) {
          for (const [id, srv] of incomingMap) {
            if (srv.sender === "me" && (srv.text || srv.mediaUrl || "") === key) {
              incomingMap.delete(id);
              changed = true;
              return { ...msg, ...srv, id: srv.id };
            }
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
        setMessages(prev => {
          const alreadyInState = prev.some(m => m.id === raw.id);
          if (alreadyInState) {
            // Un refetch ya metió la fila del servidor; si aún queda el optimista
            // colgado, fusionarlo y eliminar la copia repetida. Se empareja POR
            // CONTENIDO (no por orden) para no tocar un envío distinto.
            const pendingIndex = prev.findIndex(m =>
              (m.id?.startsWith('temp_') || m.id?.startsWith('msg_')) &&
              (m.status === 'sending' || m.status === 'error') &&
              ((raw?.type ?? 'text') === (m.type ?? 'text')) &&
              ((raw?.type ?? 'text') !== 'text' || (m.text ?? '') === (raw?.text ?? ''))
            );
            if (pendingIndex !== -1) {
              const reconciled = { ...mapped, id: raw.id, status: "sent" as const, synced: true };
              messageRepo.upsertMessage(chat.id, { ...reconciled, chatId: chat.id });
              const updated = [...prev];
              updated[pendingIndex] = reconciled;
              return updated.filter((m, i) => m.id !== raw.id || i === pendingIndex);
            }
            return prev;
          }
          const pendingIndex = prev.findIndex(m =>
            (m.id?.startsWith('temp_') || m.id?.startsWith('msg_')) &&
            (m.status === 'sending' || m.status === 'error') &&
            ((raw?.type ?? 'text') === (m.type ?? 'text')) &&
            ((raw?.type ?? 'text') !== 'text' || (m.text ?? '') === (raw?.text ?? ''))
          );
          if (pendingIndex !== -1) {
            const reconciled = { ...mapped, id: raw.id, status: "sent" as const, synced: true };
            messageRepo.upsertMessage(chat.id, { ...reconciled, chatId: chat.id });
            const updated = [...prev];
            updated[pendingIndex] = reconciled;
            return updated.filter((m, i) => m.id !== raw.id || i === pendingIndex);
          }
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

  // Watchdog: mark temp messages stuck in "sending" as "error" after 30s (no eternal clock)
  useEffect(() => {
    const interval = setInterval(() => {
      setMessages(prev => {
        const now = Date.now();
        let changed = false;
        const next = prev.map(m => {
          if ((m.id?.startsWith('temp_') || m.id?.startsWith('msg_')) && m.status === 'sending') {
            const ts = Number(m.id.split('_')[1]);
            if (!isNaN(ts) && now - ts > 30000) {
              changed = true;
              return { ...m, status: "error" as const };
            }
          }
          return m;
        });
        return changed ? next : prev;
      });
    }, 10000);
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
import { MutableRefObject, FormEvent, useRef } from "react";
import { App as CapacitorApp } from '@capacitor/app';
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Chat, Message } from "../../types";
import { sendMessage as apiSendMessage, deleteMessage as apiDeleteMessage, editMessage as apiEditMessage, addReaction } from "../../services/messages";
import { uploadChatMedia } from "../../services/storage";
import { compressVideo } from "../../services/videoCompression";
import { cacheVideoBlob } from "../../services/videoCache";
import { revokeCachedMedia } from "../../services/mediaCache";
import { supabase } from "../../lib/supabase";
import { recordReconciledId, getReconciledSavedId } from "../../lib/reconciledIds";
import { inFlightMessageIds } from "../../services/sync/SyncService";
import toast from "react-hot-toast";

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// UUID para idempotencia de envíos (el servidor lo usa como clave de reintento:
// un mismo envío reintentado jamás inserta duplicados).
function newClientId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface UseMessageActionsParams {
  chatId: string;
  uid: string;
  uname: string;
  chatName: string;
  messageRepo: any;
  onSendMessage: (msg: Message) => void;
  onMessageDeleted?: (chatId: string, messageId: string) => void;
  emitTyping: (isTyping: boolean) => void;
  inputText: string;
  replyTo: Message | null;
  recordingType: "voice" | "video" | null;
  recordingSeconds: number;
  pollQuestion: string;
  pollOption1: string;
  pollOption2: string;
  messages: Message[];
  setInputText: (v: string) => void;
  setReplyTo: (v: Message | null) => void;
  setRecordingType: (v: "voice" | "video" | null) => void;
  setShowGifPicker: (v: boolean) => void;
  setShowAttachments: (v: boolean) => void;
  setShowPollForm: (v: boolean) => void;
  setPollQuestion: (v: string) => void;
  setPollOption1: (v: string) => void;
  setPollOption2: (v: string) => void;
  setActiveReactionMenu: (v: string | null) => void;
  setEditingMessage: (v: { id: string; text: string } | null) => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  pendingSendIdsRef: MutableRefObject<Set<string>>;
  isSendingRef: MutableRefObject<boolean>;
  typingTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>;
  mediaStreamRef: MutableRefObject<MediaStream | null>;
  chunksRef: MutableRefObject<Blob[]>;
  sendingRecordingRef: MutableRefObject<boolean>;
  recordingTimer: MutableRefObject<number | null>;
  videoPreviewRef: MutableRefObject<HTMLVideoElement | null>;
}

export interface UseMessageActionsReturn {
  handleReplyMessage: (msg: Message) => void;
  handleSendLocation: () => Promise<void>;
  handleSendText: (textOverride?: string) => Promise<void>;
  handleSendSticker: (value: string, type: "gif" | "sticker" | "emoji") => Promise<void>;
  triggerFilePick: (accept: string, type: Message["type"]) => Promise<void>;
  handleCreatePoll: (e: FormEvent) => Promise<void>;
  handleVote: (messageId: string, optionId: string) => void;
  handleAddReaction: (messageId: string, emoji: string) => Promise<void>;
  handleDeleteMessage: (messageId: string) => Promise<void>;
  handleDeleteForMe: (messageId: string) => void;
  handleEditMessage: (messageId: string, newText: string) => Promise<void>;
  handleUpdatePrice: (messageId: string, price: string) => void;
  handleFinishVoiceNote: () => Promise<void>;
}

const generateVideoThumbnail = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.src = URL.createObjectURL(file);
    video.onloadeddata = () => { video.currentTime = 0.5; };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      let w = video.videoWidth || 320;
      let h = video.videoHeight || 180;

      if (w > 600) {
        h = Math.floor((600 / w) * h);
        w = 600;
      }

      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      URL.revokeObjectURL(video.src);
      resolve(dataUrl);
    };
    video.onerror = () => { URL.revokeObjectURL(video.src); reject(new Error("Error generando thumbnail")); };
  });
};

export function useMessageActions(params: UseMessageActionsParams): UseMessageActionsReturn {
  const {
    chatId, uid, uname, chatName, messageRepo,
    onSendMessage, onMessageDeleted, emitTyping,
    inputText, replyTo, recordingType, recordingSeconds,
    pollQuestion, pollOption1, pollOption2, messages,
    setInputText, setReplyTo, setRecordingType,
    setShowGifPicker, setShowAttachments, setShowPollForm,
    setPollQuestion, setPollOption1, setPollOption2,
    setActiveReactionMenu, setEditingMessage, setMessages,
    pendingSendIdsRef, isSendingRef, typingTimerRef,
    mediaRecorderRef, mediaStreamRef, chunksRef,
    sendingRecordingRef, recordingTimer, videoPreviewRef,
  } = params;

  const sendingLockRef = useRef<Promise<void>>(Promise.resolve());

  const handleReplyMessage = (msg: Message) => {
    setReplyTo(msg);
  };

  const handleSendLocation = async () => {
    if (isSendingRef.current) { console.warn('[CHAT] send blocked — already sending'); return; }
    isSendingRef.current = true;
    if (!navigator.geolocation) {
      isSendingRef.current = false;
      console.warn("[CHAT] Geolocation not available");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const tempId = `temp_${Date.now()}_loc`;
        const clientId = newClientId();
        const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const newMsg: Message = {
          id: tempId,
          sender: "me",
          timestamp,
          rawCreatedAt: new Date().toISOString(),
          type: "location",
          latitude,
          longitude,
          locationName: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          status: "sending",
          synced: false,
        };
        setMessages(prev => [...prev, newMsg]);
        onSendMessage(newMsg);
        pendingSendIdsRef.current.add(tempId);
        inFlightMessageIds.add(tempId);
        await messageRepo.upsertMessage(chatId, { ...newMsg, clientId, sender_id: uid });

        try {
          const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
          if (!isLocalChat) {
            const saved = await apiSendMessage({
              chat_id: chatId,
              client_id: clientId,
              temp_id: tempId,
              type: "location",
              sender_id: uid,
              text: `📍 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
              latitude,
              longitude,
              location_name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            });
            const savedRow = { ...newMsg, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
            recordReconciledId(chatId, tempId, saved.id);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
            messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
              console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
            );
          } else {
            const updated = { ...newMsg, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
            messageRepo.upsertMessage(chatId, updated);
            messageRepo.deleteMessage(chatId, tempId);
            setMessages(prev => {
              if (!prev.some(m => m.id === tempId)) return prev;
              return prev.map(m => m.id === tempId ? updated : m);
            });
          }
        } catch (e) {
          console.error("[CHAT] Error sending location:", e);
} finally {
          pendingSendIdsRef.current.delete(tempId);
          inFlightMessageIds.delete(tempId);
          isSendingRef.current = false;
        }
      },
      (err) => {
        isSendingRef.current = false;
        console.warn("[CHAT] Geolocation error:", err.message, err.code);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSendText = async (textOverride?: string) => {
    const text = typeof textOverride === "string" ? textOverride : (inputText ?? "");
    if (!text.trim()) return;
    if (isSendingRef.current) { console.warn('[CHAT] send blocked — already sending'); return; }
    isSendingRef.current = true;
        const tempId = `temp_${Date.now()}_txt`;
        const clientId = newClientId();
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      text,
      timestamp,
      rawCreatedAt: new Date().toISOString(),
      type: "text",
      status: "sending",
      synced: false,
      replyToId: replyTo?.id,
      replyToText: replyTo?.text,
      replyToSender: replyTo?.sender === "me" ? "Tú" : chatName,
    };

    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    if (!textOverride) {
      setInputText("");
      setReplyTo(null);
    }

    emitTyping(false);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    pendingSendIdsRef.current.add(tempId);
    inFlightMessageIds.add(tempId);
    await messageRepo.upsertMessage(chatId, { ...newMsg, clientId, sender_id: uid });

    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (isLocalChat) {
        const updated = { ...newMsg, id: `local_${Date.now()}`, status: "sent" as const, synced: true };
        messageRepo.upsertMessage(chatId, updated);
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => prev.map((m) => m.id === tempId ? updated : m));
      } else {
        const saved = await apiSendMessage({
          chat_id: chatId,
          client_id: clientId,
          temp_id: tempId,
          text,
          type: "text",
          sender_id: uid,
          reply_to_id: replyTo?.id,
          reply_to_text: replyTo?.text,
          reply_to_sender: replyTo?.sender === "me" ? "Tú" : chatName,
        });
        const savedRow = { ...newMsg, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
        recordReconciledId(chatId, tempId, saved.id);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
        messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
          console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
        );
      }
    } catch (e) {
      console.error("[CHAT] Error al enviar mensaje:", e);
    } finally {
      pendingSendIdsRef.current.delete(tempId);
      inFlightMessageIds.delete(tempId);
      isSendingRef.current = false;
    }
  };

  const handleSendSticker = async (value: string, type: "gif" | "sticker" | "emoji") => {
    if (isSendingRef.current) { console.warn('[CHAT] send blocked — already sending'); return; }
    isSendingRef.current = true;
    if (type === "emoji") {
      const tempId = `temp_${Date.now()}_emoji`;
      const clientId = newClientId();
      const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const newMsg: Message = {
        id: tempId,
        sender: "me",
        timestamp,
        rawCreatedAt: new Date().toISOString(),
        type: "sticker",
        mediaUrl: value,
        fileName: "Emoji.png",
        status: "sending",
        synced: false,
      };
setMessages(prev => [...prev, newMsg]);
      onSendMessage(newMsg);
      setShowGifPicker(false);
      setShowAttachments(false);
      pendingSendIdsRef.current.add(tempId);
      inFlightMessageIds.add(tempId);
      await messageRepo.upsertMessage(chatId, { ...newMsg, clientId, sender_id: uid });
      try {
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
        if (!isLocalChat) {
          const saved = await apiSendMessage({
            chat_id: chatId,
            client_id: clientId,
            temp_id: tempId,
            type: "sticker",
            sticker_url: value,
            image_url: value,
            sender_id: uid,
          });
          const savedRow = { ...newMsg, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
            recordReconciledId(chatId, tempId, saved.id);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
            messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
              console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
            );
        } else {
          const updated = { ...newMsg, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
          messageRepo.upsertMessage(chatId, updated);
          messageRepo.deleteMessage(chatId, tempId);
          setMessages(prev => prev.map(m => m.id === tempId ? updated : m));
        }
      } catch (e) {
        console.error("[CHAT] Error al enviar emoji:", e);
      } finally {
        pendingSendIdsRef.current.delete(tempId);
        inFlightMessageIds.delete(tempId);
        isSendingRef.current = false;
      }
      return;
    }
    const url = value;
    const tempId = `temp_${Date.now()}_stkr`;
    const clientId = newClientId();
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp,
      rawCreatedAt: new Date().toISOString(),
      type: type === "sticker" ? "sticker" : "image",
      mediaUrl: url,
      fileName: type === "gif" ? "GIF.gif" : "Sticker.png",
      status: "sending",
      synced: false,
    };

    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowGifPicker(false);
    setShowAttachments(false);
    pendingSendIdsRef.current.add(tempId);
    inFlightMessageIds.add(tempId);
    await messageRepo.upsertMessage(chatId, { ...newMsg, clientId, sender_id: uid });

    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (isLocalChat) {
        const updated = { ...newMsg, id: `local_${Date.now()}`, status: "sent" as const, synced: true };
        messageRepo.upsertMessage(chatId, updated);
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => prev.map((m) => m.id === tempId ? updated : m));
      } else {
const saved = await apiSendMessage({
           chat_id: chatId,
           client_id: clientId,
           temp_id: tempId,
           type: type === "sticker" ? "sticker" : "image",
           sender_id: uid,
           sticker_url: type === "sticker" ? url : undefined,
           gif_url: type === "gif" ? url : undefined,
           image_url: url,
         });
const savedRow: Message = { ...newMsg, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
           recordReconciledId(chatId, tempId, saved.id);
           setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
           messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
             console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
           );
       }
     } catch (e) {
       console.error("[CHAT] Error al enviar sticker:", e);
} finally {
        pendingSendIdsRef.current.delete(tempId);
        inFlightMessageIds.delete(tempId);
        isSendingRef.current = false;
      }
    };

   const triggerFilePick = async (accept: string, type: Message["type"]) => {
     if (isSendingRef.current) { console.warn('[CHAT] send blocked — already sending'); return; }
     isSendingRef.current = true;
     if (type === "image") {
       const isCapacitor = !!(window as any).Capacitor;
       if (isCapacitor) {
        const tempId = "msg_" + Date.now();
        const clientIdCamera = newClientId();
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);

        try {
          const photo = await CapacitorCamera.getPhoto({
            quality: 30,
            source: CameraSource.Photos,
            resultType: CameraResultType.DataUrl,
          });
          if (!photo.dataUrl) { isSendingRef.current = false; return; }

          const resp = await fetch(photo.dataUrl);
          const blob = await resp.blob();

          const ext = photo.format || "jpeg";
          const mimeType = "image/jpeg";
          const fileBlob = new Blob([blob], { type: mimeType });

          const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const localUrl = URL.createObjectURL(fileBlob);
          const sendingMsg: Message = {
            id: tempId, sender: "me", timestamp, rawCreatedAt: new Date().toISOString(), type, mediaUrl: localUrl,
            fileName: `${type}_${Date.now()}.${ext}`, fileSize: `${(fileBlob.size / 1024).toFixed(0)}KB`,
            status: "sending", synced: false,
          };
          setMessages(prev => [...prev, sendingMsg]);
          onSendMessage(sendingMsg);
          messageRepo.upsertMessage(chatId, sendingMsg);
pendingSendIdsRef.current.add(tempId);
    inFlightMessageIds.add(tempId);

          const url = await uploadChatMedia(fileBlob, "image");
          const mediaUpdated = { ...sendingMsg, mediaUrl: url };
          await messageRepo.upsertMessage(chatId, { ...mediaUpdated, clientId: clientIdCamera, sender_id: uid });
          setMessages(prev => {
            if (!prev.some(m => m.id === tempId)) return prev;
            return prev.map(m => m.id === tempId ? mediaUpdated : m);
          });

          if (!isLocalChat) {
            const payload: any = { chat_id: chatId, sender_id: uid, type, text: "Imagen", client_id: clientIdCamera, temp_id: tempId };
            payload.image_url = url;
            const saved = await apiSendMessage(payload);
            const savedRow = { ...mediaUpdated, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
            recordReconciledId(chatId, tempId, saved.id);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
            messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
              console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
            );
          } else {
            const final = { ...mediaUpdated, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
            messageRepo.upsertMessage(chatId, final);
            messageRepo.deleteMessage(chatId, tempId);
            setMessages(prev => prev.map(m => m.id === tempId ? final : m));
          }
          pendingSendIdsRef.current.delete(tempId);
        inFlightMessageIds.delete(tempId);
          isSendingRef.current = false;
          return;
        } catch (e: any) {
          if (e?.message?.includes("cancelled") || e?.message?.includes("User")) { isSendingRef.current = false; return; }
          console.error("[CHAT] Image send failed:", e);
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "error" } : m));
          toast.error(`Error al enviar imagen: ${e?.message || "Error desconocido"}`);
          pendingSendIdsRef.current.delete(tempId);
          inFlightMessageIds.delete(tempId);
          isSendingRef.current = false;
          return;
        }
      }
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        // Usuario canceló el picker: liberar el candado o quedaría bloqueado.
        isSendingRef.current = false;
        return;
      }

      const tempId = "msg_" + Date.now();
      let bubbleCreated = false;
      try {
        const clientIdFile = newClientId();
        const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        // El handle del archivo del picker en Android es de UN SOLO USO (stream
        // content:// que se consume): cualquier segunda lectura lanza
        // NotReadableError. Se leen los bytes UNA vez aquí y TODO lo demás
        // (preview, miniatura, compresión, subida) se construye desde memoria.
        let localBlob: Blob;
        try {
          console.log(`[VIDSEND] step=read-start name=${file.name} size=${(file.size / 1048576).toFixed(2)}MB type=${file.type || "?"}`);
          localBlob = new Blob([await file.arrayBuffer()], { type: file.type || "video/mp4" });
          console.log(`[VIDSEND] step=read-ok ${(localBlob.size / 1048576).toFixed(2)}MB`);
        } catch (e: any) {
          console.log(`[VIDSEND] step=read FAIL ${e?.message}`);
          throw new Error("No se pudo leer el video desde la galería. Inténtalo de nuevo.");
        }
        const localFile = new File([localBlob], file.name || "video.mp4", { type: localBlob.type });

        const shouldCompress = type === "video" && localBlob.size > 5 * 1024 * 1024;
        // Tope duro para videos: el WebView no puede recomprimirlos si falla la
        // decodificación, y subir crudos muy grandes suele abortar. Mejor fallar
        // temprano con un mensaje claro que colgarse o romper en silencio.
        if (type === "video" && localBlob.size > 500 * 1024 * 1024) {
          console.log(`[VIDSEND] step=too-large ${(localBlob.size / 1048576).toFixed(1)}MB > 500MB`);
          throw new Error(`El video pesa ${(localBlob.size / 1048576).toFixed(0)}MB y el máximo para enviar es 500MB`);
        }

        let posterUrl: string | undefined;
        if (type === "video") {
          try { posterUrl = await generateVideoThumbnail(localFile); console.log(`[VIDSEND] step=poster ok=${!!posterUrl}`); } catch (e: any) { console.log(`[VIDSEND] step=poster FAIL ${e?.message}`); }
        }

        const blobUrl = URL.createObjectURL(localBlob);
        const sendingMsg: Message = {
          id: tempId, sender: "me", timestamp, rawCreatedAt: new Date().toISOString(), type,
          mediaUrl: blobUrl,
          fileName: localFile.name,
          fileSize: shouldCompress ? "Comprimiendo…" : formatFileSize(localBlob.size),
          status: "sending",
          synced: false,
          posterUrl,
        };
        setMessages(prev => [...prev, sendingMsg]);
        onSendMessage(sendingMsg);
        messageRepo.upsertMessage(chatId, sendingMsg);
        pendingSendIdsRef.current.add(tempId);
        inFlightMessageIds.add(tempId);
        bubbleCreated = true;

        let fileToUpload: Blob = localFile;
        try {
          if (shouldCompress) {
            console.log(`[VIDSEND] step=compress start (${(localBlob.size / 1048576).toFixed(2)}MB > 5MB)`);
            const compressed = await compressVideo(localFile);
            fileToUpload = compressed instanceof Blob ? new File([compressed], localFile.name, { type: compressed.type }) : localFile;
            console.log(`[VIDSEND] step=compress done -> ${(fileToUpload.size / 1048576).toFixed(2)}MB type=${fileToUpload.type}`);
            const newSize = formatFileSize(fileToUpload.size);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, fileSize: newSize } : m));
          } else {
            console.log(`[VIDSEND] step=compress skipped (${(localBlob.size / 1048576).toFixed(2)}MB <= 5MB o no-video)`);
          }
        } catch (e: any) {
          console.warn(`[VIDSEND] step=compress FAIL fallback-original: ${e?.message}`);
          // Si ni la compresión pudo (video largo/decodificación fallida) Y además
          // el original excede el tope, no intentar la subida cruda imposible.
          if (localBlob.size > 500 * 1024 * 1024) {
            throw new Error(`No se pudo comprimir el video (${(localBlob.size / 1048576).toFixed(0)}MB) y el máximo para enviar es 500MB`);
          }
          fileToUpload = localFile;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, fileSize: formatFileSize(localBlob.size) } : m));
        }

        try {
          const blob = new Blob([fileToUpload], { type: fileToUpload.type });
          console.log(`[VIDSEND] step=upload-start ${(blob.size / 1048576).toFixed(2)}MB contentType=${blob.type} folder=${type === "video" ? "video" : "files"}`);
          const url = await uploadChatMedia(blob, type === "video" ? "video" : "files");
          console.log(`[VIDSEND] step=upload-ok url=${url.slice(0, 90)}`);
          if (type === "video") {
            cacheVideoBlob(url, localBlob).catch(() => {});
          }
          const mediaUpdated = { ...sendingMsg, mediaUrl: url, posterUrl };
          await messageRepo.upsertMessage(chatId, { ...mediaUpdated, clientId: clientIdFile, sender_id: uid });
          setMessages(prev => {
            if (!prev.some(m => m.id === tempId)) return prev;
            return prev.map(m => m.id === tempId ? mediaUpdated : m);
          });
          const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
          if (!isLocalChat) {
            const payload: any = { chat_id: chatId, sender_id: uid, type, text: file.name, client_id: clientIdFile, temp_id: tempId };
            if (type === "image") { payload.image_url = url; payload.text = "Imagen"; }
            else if (type === "video") { payload.video_url = url; payload.text = "Video"; }
            else if (type === "audio") { payload.audio_url = url; payload.text = "Audio"; }
            else {
              payload.file_url = url;
              payload.document_name = file.name;
              payload.document_size = file.size ? formatFileSize(file.size) : null;
              payload.document_type = file.type || null;
              payload.mime_type = file.type || null;
            }
            const saved = await apiSendMessage(payload);
            const savedRow = { ...mediaUpdated, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
            recordReconciledId(chatId, tempId, saved.id);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
            messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
              console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
            );
          } else {
            const final = { ...mediaUpdated, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
            messageRepo.upsertMessage(chatId, final);
            messageRepo.deleteMessage(chatId, tempId);
            setMessages(prev => prev.map(m => m.id === tempId ? final : m));
          }
        } catch (err: any) {
          console.error("[CHAT] File upload error:", err);
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "error" as const } : m));
          toast.error(`Error al enviar archivo: ${err?.message || "Error desconocido"}`);
        }
      } catch (err: any) {
        // Fallo FUERA de las etapas cubiertas (lectura del archivo, creación del
        // preview, etc.). Mismo patrón que el resto de errores de envío.
        console.error("[CHAT] Send failed:", err);
        if (bubbleCreated) {
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "error" as const } : m));
        }
        toast.error(`Error al enviar archivo: ${err?.message || "Error desconocido"}`);
      } finally {
        pendingSendIdsRef.current.delete(tempId);
        inFlightMessageIds.delete(tempId);
        isSendingRef.current = false;
      }
    };
    input.click();
  };

  const handleCreatePoll = async (e: FormEvent) => {
    e.preventDefault();
    if (!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim()) return;

    const pollOpts = [
      { id: "o1_" + Date.now(), text: pollOption1, votes: 0, votedUsers: [] },
      { id: "o2_" + Date.now(), text: pollOption2, votes: 0, votedUsers: [] }
    ];

    const tempId = "msg_" + Date.now();
    const clientIdPoll = newClientId();
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      rawCreatedAt: new Date().toISOString(),
      type: "poll",
      pollQuestion: pollQuestion,
      pollOptions: pollOpts,
      status: "sending",
      synced: false,
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowPollForm(false);
    setPollQuestion("");
    setPollOption1("");
    setPollOption2("");
    setShowAttachments(false);
    pendingSendIdsRef.current.add(tempId);
    inFlightMessageIds.add(tempId);
    await messageRepo.upsertMessage(chatId, { ...newMsg, clientId: clientIdPoll, sender_id: uid });

    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (!isLocalChat) {
        const saved = await apiSendMessage({
          chat_id: chatId,
          client_id: clientIdPoll,
          temp_id: tempId,
          type: "poll",
          sender_id: uid,
          text: pollQuestion,
          poll_question: pollQuestion,
          poll_options: pollOpts,
        });
        const savedRow = { ...newMsg, id: saved.id, status: "sent" as const, synced: true, rawCreatedAt: saved.created_at };
        recordReconciledId(chatId, tempId, saved.id);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
        messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
          console.error("[SEND] reconcileTemp falló (UI ya marcó sent):", err)
        );
      } else {
        const final = { ...newMsg, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
        messageRepo.upsertMessage(chatId, final);
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => prev.map(m => m.id === tempId ? final : m));
      }
    } catch (e) {
      console.error("[CHAT] Error saving poll:", e);
    } finally {
      pendingSendIdsRef.current.delete(tempId);
      inFlightMessageIds.delete(tempId);
    }
  };

  const handleVote = (messageId: string, optionId: string) => {
    let updatedPollOptions: { id: string; text: string; votes: number; votedUsers: string[] }[] | null = null;

    setMessages(prev => {
      const next = prev.map((m) => {
        if (m.id === messageId && m.pollOptions) {
          const options = m.pollOptions.map((o) => {
            const votedUsers = Array.isArray(o.votedUsers) ? o.votedUsers : [];
            const alreadyVoted = votedUsers.includes("me");
            const currentVotes = Number(o.votes) || 0;
            if (o.id === optionId) {
              return {
                ...o,
                votes: alreadyVoted ? Math.max(0, currentVotes - 1) : currentVotes + 1,
                votedUsers: alreadyVoted ? votedUsers.filter((u) => u !== "me") : [...votedUsers, "me"]
              };
            } else {
              return {
                ...o,
                votes: alreadyVoted ? Math.max(0, currentVotes - 1) : currentVotes,
                votedUsers: votedUsers.filter((u) => u !== "me")
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
        .update({ poll_options: JSON.stringify(updatedPollOptions) })
        .eq("id", messageId)
      ).then(() => {}).catch(err => console.error("[ChatRoom] update poll options failed:", err));
    }
  };

  const handleAddReaction = async (messageId: string, emoji: string) => {
    setMessages(prev => prev.map((m) => {
      if (m.id === messageId) {
        const reactions = { ...(m.reactions || {}) };
        reactions[emoji] = (reactions[emoji] || 0) + 1;
        return { ...m, reactions };
      }
      return m;
    }));
    setActiveReactionMenu(null);
    try {
      await addReaction(messageId, emoji);
    } catch (e: any) {
      console.error("[CHAT] Reaction save failed:", e);
      setMessages(prev => prev.map((m) => {
        if (m.id === messageId && m.reactions) {
          const reactions = { ...m.reactions };
          reactions[emoji] = (reactions[emoji] || 1) - 1;
          if (reactions[emoji] <= 0) delete reactions[emoji];
          return { ...m, reactions: Object.keys(reactions).length ? reactions : undefined };
        }
        return m;
      }));
      toast.error("Error al guardar reacción");
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    setActiveReactionMenu(null);
    try {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.mediaUrl) revokeCachedMedia(msg.mediaUrl);
      if (msg?.posterUrl) revokeCachedMedia(msg.posterUrl);
      await apiDeleteMessage(messageId);
      setMessages(prev => prev.filter((m) => m.id !== messageId));
      messageRepo.deleteMessage(chatId, messageId).catch(() => {});
      onMessageDeleted?.(chatId, messageId);
    } catch (e) {
      console.error("[CHAT] Delete error:", e);
    }
  };

  const handleDeleteForMe = (messageId: string) => {
    setActiveReactionMenu(null);
    const msg = messages.find(m => m.id === messageId);
    if (msg?.mediaUrl) revokeCachedMedia(msg.mediaUrl);
    if (msg?.posterUrl) revokeCachedMedia(msg.posterUrl);
    setMessages(prev => prev.filter((m) => m.id !== messageId));
    messageRepo.deleteMessage(chatId, messageId).catch(() => {});
    onMessageDeleted?.(chatId, messageId);
  };

  const handleEditMessage = async (messageId: string, newText: string) => {
    setActiveReactionMenu(null);
    setEditingMessage(null);

    const existing = messages.find(m => m.id === messageId);
    const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
    const isTemp = messageId.startsWith("temp_") || messageId.startsWith("msg_");

    // 1) UI optimista + persistencia local durable: la edición sobrevive al
    // reload aunque el eco de Realtime no llegue (red caída/3G), que era el
    // bug "edito pero no se guarda".
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: newText, edited: true } : m));
    if (existing) {
      messageRepo.upsertMessage(chatId, { ...existing, text: newText, edited: true }).catch((err) =>
        console.error("[CHAT] Edit persist local falló:", err)
      );
    }

    if (isLocalChat || !existing) return;

    try {
      let serverId = messageId;
      if (isTemp) {
        // Si el mensaje recién enviado aún no se reconcilió con su id real,
        // el servidor rechaza (404) un edit con temp_id. Resolver primero.
        serverId = getReconciledSavedId(chatId, messageId) || "";
        if (!serverId) {
          // Envío aún en curso: encolar el edit para que se aplique en cuanto
          // el temp se confirme con su id real (ver MessageRepository.reconcileTemp).
          messageRepo.registerPendingEdit(chatId, messageId, newText).catch(() => {});
          console.log("[CHAT] Edit encolado para temp pendiente", { tempId: messageId });
          return;
        }
      }
      await apiEditMessage(serverId, newText);
      if (serverId !== messageId) {
        // El temp se reconcilió entre tanto: re-aplicar sobre la fila confirmada
        // para que ni la UI ni la BD local retrocedan al texto viejo.
        setMessages(prev => prev.map(m => m.id === serverId ? { ...m, text: newText, edited: true } : m));
        messageRepo.upsertMessage(chatId, { ...existing, id: serverId, text: newText, edited: true }).catch(() => {});
      }
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
    console.log("[VOICE] finishVoiceNote inicio", { type: recordingType, secs: recordingSeconds });
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
    console.log("[VOICE] blob listo", { chunks: buffers.length, bytes: blob.size, type: blob.type });
    const durStr = `${Math.floor(currentDuration / 60)}:${(currentDuration % 60).toString().padStart(2, "0")}`;
    const tempId = "msg_" + Date.now();
    const clientId = newClientId();
    const localUrl = URL.createObjectURL(blob);
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      rawCreatedAt: new Date().toISOString(),
      type: currentRecordingType === "voice" ? "voice_note" : "video_note",
      duration: durStr,
      mediaUrl: localUrl,
      localVideoUrl: currentRecordingType === "video" ? localUrl : undefined,
      status: "sending",
      synced: false,
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    pendingSendIdsRef.current.add(tempId);
    inFlightMessageIds.add(tempId);
    await messageRepo.upsertMessage(chatId, newMsg);

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    // La grabación ya quedó cautiva; libera el candado de captura para que la
    // siguiente nota pueda grabarse/cerrarse aunque esta siga subiendo.
    sendingRecordingRef.current = false;

    // Serializa SOLO la subida/envío: nunca se descarta ni se pierde una nota.
    const prevSending = sendingLockRef.current;
    let releaseSending: (() => void) | null = null;
    sendingLockRef.current = new Promise<void>((resolve) => { releaseSending = resolve; });
    await prevSending;

    try {
      const uploadTimeout = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("upload voz/video timeout (25s)")), 25000)
      );
      const url = await Promise.race([uploadChatMedia(blob, currentRecordingType === "voice" ? "voice" : "video"), uploadTimeout]);
      console.log("[VOICE] upload OK", { url });
      const mediaUpdated = { ...newMsg, mediaUrl: url };
      await messageRepo.upsertMessage(chatId, { ...mediaUpdated, clientId, sender_id: uid }).catch(() => {});
      setMessages(prev => {
        if (!prev.some(m => m.id === tempId)) return prev;
        return prev.map(m => m.id === tempId ? mediaUpdated : m);
      });

      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (!isLocalChat) {
        // Reintento automático con idempotencia: con red móvil inestable el POST
        // puede fallar/timeoutear; se reintenta con el MISMO client_id (fila única
        // en el servidor) para que la nota nunca se pierda ni se duplique.
        let saved: any = null;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
          try {
            saved = await apiSendMessage({
              chat_id: chatId,
              sender_id: uid,
              type: currentRecordingType === "voice" ? "voice_note" : "video_note",
              client_id: clientId,
              temp_id: tempId,
              audio_url: currentRecordingType === "voice" ? url : undefined,
              video_url: currentRecordingType === "video" ? url : undefined,
              audio_duration: String(currentDuration),
              text: currentRecordingType === "voice" ? "Nota de voz" : "Nota de video",
            });
          } catch (e) {
            lastErr = e;
            console.warn(`[CHAT] Voice send attempt ${attempt}/3 failed, retrying`, { tempId, error: e });
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }
        if (!saved?.id) throw lastErr || new Error("send failed");
        console.log("[VOICE] apiSendMessage OK", { tempId, savedId: saved.id });
        const savedRow: Message = { ...mediaUpdated, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at };
        // 1º Marcar ✓ en la UI INMEDIATAMENTE (lo primero que confirme gana:
        // el HTTP aquí, o el eco de Realtime en el fallback por media_url).
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...savedRow } : m));
        // 2º Mapa persistente tempId->savedId (cubre re-entrada al chat).
        recordReconciledId(chatId, tempId, saved.id);
        // 3º SUSTITUCIÓN ATÓMICA EN SQLite SIN bloquear la UI: nunca debe colgar
        // la promesa ni cancelar el ✓; si falla, SQLite converge solo.
        messageRepo.reconcileTemp(chatId, tempId, savedRow).catch((err) =>
          console.error("[VOICE] reconcileTemp falló (UI ya marcó sent):", err)
        );
      }
      if (isLocalChat) {
        const final = { ...mediaUpdated, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
        messageRepo.upsertMessage(chatId, final);
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => prev.map(m => m.id === tempId ? final : m));
      }
    } catch (err) {
      console.error("[CHAT] Upload recording error:", err);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "error" as const } : m));
    } finally {
      console.log("[VOICE] finishVoiceNote finalizado", { tempId, quedaSending: false });
      pendingSendIdsRef.current.delete(tempId);
      inFlightMessageIds.delete(tempId);
      releaseSending?.();
    }
  };

  return {
    handleReplyMessage,
    handleSendLocation,
    handleSendText,
    handleSendSticker,
    triggerFilePick,
    handleCreatePoll,
    handleVote,
    handleAddReaction,
    handleDeleteMessage,
    handleDeleteForMe,
    handleEditMessage,
    handleUpdatePrice,
    handleFinishVoiceNote,
  };
}

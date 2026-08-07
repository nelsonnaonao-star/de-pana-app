import { MutableRefObject, FormEvent } from "react";
import { App as CapacitorApp } from '@capacitor/app';
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Chat, Message } from "../../types";
import { sendMessage as apiSendMessage, deleteMessage as apiDeleteMessage, editMessage as apiEditMessage, addReaction } from "../../services/messages";
import { uploadChatMedia } from "../../services/storage";
import { compressVideo } from "../../services/videoCompression";
import { revokeCachedMedia } from "../../services/mediaCache";
import { supabase } from "../../lib/supabase";
import toast from "react-hot-toast";

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
          synced: false,
        };
        setMessages(prev => [...prev, newMsg]);
        onSendMessage(newMsg);
        messageRepo.upsertMessage(chatId, newMsg);
        pendingSendIdsRef.current.add(tempId);

        try {
          const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
          if (!isLocalChat) {
            const saved = await apiSendMessage({
              chat_id: chatId,
              type: "location",
              sender_id: uid,
              text: `📍 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
              latitude,
              longitude,
              location_name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            });
            messageRepo.upsertMessage(chatId, { ...newMsg, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
            messageRepo.deleteMessage(chatId, tempId);
            setMessages(prev => {
              const found = prev.some(m => m.id === tempId);
              console.log("🛠️ RECONCILIACIÓN EN CURSO:", { tempId, loEncontro: found, serverId: saved.id });
              if (!found) return prev;
              return prev.map(m => m.id === tempId ? { ...m, ...saved, status: "sent", synced: true, id: saved.id } : m);
            });
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
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      text,
      timestamp,
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

    messageRepo.upsertMessage(chatId, newMsg);
    pendingSendIdsRef.current.add(tempId);

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
          text,
          type: "text",
          sender_id: uid,
          reply_to_id: replyTo?.id,
          reply_to_text: replyTo?.text,
          reply_to_sender: replyTo?.sender === "me" ? "Tú" : chatName,
        });
        messageRepo.upsertMessage(chatId, { ...newMsg, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => {
          const found = prev.some(m => m.id === tempId);
          console.log("🛠️ RECONCILIACIÓN EN CURSO:", { tempId, loEncontro: found, serverId: saved.id });
          if (!found) return prev;
          return prev.map(m => m.id === tempId ? { ...m, ...saved, status: "sent", synced: true, id: saved.id } : m);
        });
      }
    } catch (e) {
      console.error("[CHAT] Error al enviar mensaje:", e);
    } finally {
      pendingSendIdsRef.current.delete(tempId);
      isSendingRef.current = false;
    }
  };

  const handleSendSticker = async (value: string, type: "gif" | "sticker" | "emoji") => {
    if (isSendingRef.current) { console.warn('[CHAT] send blocked — already sending'); return; }
    isSendingRef.current = true;
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
        status: "sending",
        synced: false,
      };
      setMessages(prev => [...prev, newMsg]);
      onSendMessage(newMsg);
      setShowGifPicker(false);
      setShowAttachments(false);
      messageRepo.upsertMessage(chatId, newMsg);
      pendingSendIdsRef.current.add(tempId);
      try {
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
        if (!isLocalChat) {
          const saved = await apiSendMessage({
            chat_id: chatId,
            type: "sticker",
            sticker_url: value,
            image_url: value,
            sender_id: uid,
          });
          messageRepo.upsertMessage(chatId, { ...newMsg, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
          messageRepo.deleteMessage(chatId, tempId);
          setMessages(prev => prev.map(m =>
            m.id === tempId ? { ...m, ...saved, id: saved.id, status: "sent", is_pending: false, synced: true } : m
          ));
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
        isSendingRef.current = false;
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
      status: "sending",
      synced: false,
    };

    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    setShowGifPicker(false);
    setShowAttachments(false);
    messageRepo.upsertMessage(chatId, newMsg);
    pendingSendIdsRef.current.add(tempId);

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
           type: type === "sticker" ? "sticker" : "image",
           sender_id: uid,
           sticker_url: type === "sticker" ? url : undefined,
           gif_url: type === "gif" ? url : undefined,
           image_url: url,
         });
messageRepo.upsertMessage(chatId, { ...newMsg, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
messageRepo.deleteMessage(chatId, tempId);
           setMessages(prev => {
             const found = prev.some(m => m.id === tempId);
             console.log("🛠️ RECONCILIACIÓN EN CURSO:", { tempId, loEncontro: found, serverId: saved.id });
             if (!found) return prev;
             return prev.map(m => m.id === tempId ? { ...m, ...saved, status: "sent", synced: true, id: saved.id } : m);
           });
       }
     } catch (e) {
       console.error("[CHAT] Error al enviar sticker:", e);
     } finally {
       pendingSendIdsRef.current.delete(tempId);
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
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);

        try {
          const photo = await CapacitorCamera.getPhoto({
            quality: 30,
            source: CameraSource.Photos,
            resultType: CameraResultType.DataUrl,
          });
          if (!photo.dataUrl) return;

          const resp = await fetch(photo.dataUrl);
          const blob = await resp.blob();

          const ext = photo.format || "jpeg";
          const mimeType = "image/jpeg";
          const fileBlob = new Blob([blob], { type: mimeType });

          const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const localUrl = URL.createObjectURL(fileBlob);
          const sendingMsg: Message = {
            id: tempId, sender: "me", timestamp, type, mediaUrl: localUrl,
            fileName: `${type}_${Date.now()}.${ext}`, fileSize: `${(fileBlob.size / 1024).toFixed(0)}KB`,
            status: "sending", synced: false,
          };
          setMessages(prev => [...prev, sendingMsg]);
          onSendMessage(sendingMsg);
          messageRepo.upsertMessage(chatId, sendingMsg);
          pendingSendIdsRef.current.add(tempId);

          const url = await uploadChatMedia(fileBlob, "image");
          const mediaUpdated = { ...sendingMsg, mediaUrl: url };
          messageRepo.upsertMessage(chatId, mediaUpdated);
          setMessages(prev => {
            if (!prev.some(m => m.id === tempId)) return prev;
            return prev.map(m => m.id === tempId ? mediaUpdated : m);
          });

          if (!isLocalChat) {
            const payload: any = { chat_id: chatId, sender_id: uid, type, text: "Imagen" };
            payload.image_url = url;
            const saved = await apiSendMessage(payload);
messageRepo.upsertMessage(chatId, { ...mediaUpdated, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => {
              const found = prev.some(m => m.id === tempId);
              console.log("🛠️ RECONCILIACIÓN EN CURSO:", { tempId, loEncontro: found, serverId: saved.id });
              if (!found) return prev;
              return prev.map(m => m.id === tempId ? { ...m, ...saved, status: "sent", synced: true, id: saved.id } : m);
            });
          } else {
            const final = { ...mediaUpdated, id: `local_${Date.now()}`, status: "sent" as const, synced: true, rawCreatedAt: new Date().toISOString() };
            messageRepo.upsertMessage(chatId, final);
            messageRepo.deleteMessage(chatId, tempId);
            setMessages(prev => prev.map(m => m.id === tempId ? final : m));
          }
          pendingSendIdsRef.current.delete(tempId);
          isSendingRef.current = false;
          return;
        } catch (e: any) {
          if (e?.message?.includes("cancelled") || e?.message?.includes("User")) { isSendingRef.current = false; return; }
          console.error("[CHAT] Image send failed:", e);
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "error" } : m));
          toast.error(`Error al enviar imagen: ${e?.message || "Error desconocido"}`);
          pendingSendIdsRef.current.delete(tempId);
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
      if (!file) return;

      const tempId = "msg_" + Date.now();
      const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      let posterUrl: string | undefined;
      if (type === "video") {
        try { posterUrl = await generateVideoThumbnail(file); } catch { }
      }

      const shouldCompress = type === "video" && file.size > 5 * 1024 * 1024;
      const blobUrl = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: file.type }));
      const sendingMsg: Message = {
        id: tempId, sender: "me", timestamp, type,
        mediaUrl: blobUrl,
        fileName: file.name,
        fileSize: shouldCompress ? "Comprimiendo…" : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        status: "sending",
        synced: false,
        posterUrl,
      };
      setMessages(prev => [...prev, sendingMsg]);
      onSendMessage(sendingMsg);
      messageRepo.upsertMessage(chatId, sendingMsg);
      pendingSendIdsRef.current.add(tempId);

      let fileToUpload = file;
      try {
        if (shouldCompress) {
          const compressed = await compressVideo(file);
          fileToUpload = compressed instanceof Blob ? new File([compressed], file.name, { type: compressed.type }) : file;
          const newSize = `${(fileToUpload.size / 1024 / 1024).toFixed(1)} MB`;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, fileSize: newSize } : m));
        }
      } catch (e: any) {
        console.warn("[CHAT] Compression failed, using original:", e?.message);
        fileToUpload = file;
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, fileSize: `${(file.size / 1024 / 1024).toFixed(1)} MB` } : m));
      }

      try {
        const blob = new Blob([fileToUpload], { type: fileToUpload.type });
        const url = await uploadChatMedia(blob, type === "video" ? "video" : "files");
        const mediaUpdated = { ...sendingMsg, mediaUrl: url, posterUrl };
        messageRepo.upsertMessage(chatId, mediaUpdated);
        setMessages(prev => {
          if (!prev.some(m => m.id === tempId)) return prev;
          return prev.map(m => m.id === tempId ? mediaUpdated : m);
        });
        const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
        if (!isLocalChat) {
          const payload: any = { chat_id: chatId, sender_id: uid, type, text: file.name };
          if (type === "image") { payload.image_url = url; payload.text = "Imagen"; }
          else if (type === "video") { payload.video_url = url; payload.text = "Video"; }
          else if (type === "audio") { payload.audio_url = url; payload.text = "Audio"; }
          else {
            payload.file_url = url;
            payload.document_name = file.name;
            payload.document_size = file.size ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : null;
            payload.document_type = file.type || null;
            payload.mime_type = file.type || null;
          }
          const saved = await apiSendMessage(payload);
          messageRepo.upsertMessage(chatId, { ...mediaUpdated, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
          messageRepo.deleteMessage(chatId, tempId);
          setMessages(prev => {
            const found = prev.some(m => m.id === tempId);
            console.log("🛠️ RECONCILIACIÓN EN CURSO:", { tempId, loEncontro: found, serverId: saved.id });
            if (!found) return prev;
            return prev.map(m => m.id === tempId ? { ...m, ...saved, status: "sent", synced: true, id: saved.id } : m);
          });
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
      } finally {
        pendingSendIdsRef.current.delete(tempId);
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
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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

    try {
      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (!isLocalChat) {
        const saved = await apiSendMessage({
          chat_id: chatId,
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
    onMessageDeleted?.(chatId, messageId);
  };

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
    const localUrl = URL.createObjectURL(blob);
    const newMsg: Message = {
      id: tempId,
      sender: "me",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: currentRecordingType === "voice" ? "voice_note" : "video_note",
      duration: durStr,
      mediaUrl: localUrl,
      localVideoUrl: currentRecordingType === "video" ? localUrl : undefined,
      status: "sending",
      synced: false,
    };
    setMessages(prev => [...prev, newMsg]);
    onSendMessage(newMsg);
    messageRepo.upsertMessage(chatId, newMsg);
    pendingSendIdsRef.current.add(tempId);

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    try {
      const url = await uploadChatMedia(blob, currentRecordingType === "voice" ? "voice" : "video");
      const mediaUpdated = { ...newMsg, mediaUrl: url };
      messageRepo.upsertMessage(chatId, mediaUpdated);
      setMessages(prev => {
        if (!prev.some(m => m.id === tempId)) return prev;
        return prev.map(m => m.id === tempId ? mediaUpdated : m);
      });

      const isLocalChat = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (!isLocalChat) {
        const saved = await apiSendMessage({
          chat_id: chatId,
          sender_id: uid,
          type: currentRecordingType === "voice" ? "voice_note" : "video_note",
          audio_url: currentRecordingType === "voice" ? url : undefined,
          video_url: currentRecordingType === "video" ? url : undefined,
          audio_duration: String(currentDuration),
          text: currentRecordingType === "voice" ? "Nota de voz" : "Nota de video",
        });
        messageRepo.upsertMessage(chatId, { ...mediaUpdated, id: saved.id, status: "sent", synced: true, rawCreatedAt: saved.created_at });
        messageRepo.deleteMessage(chatId, tempId);
        setMessages(prev => {
          const found = prev.some(m => m.id === tempId);
          console.log("🛠️ RECONCILIACIÓN EN CURSO:", { tempId, loEncontro: found, serverId: saved.id });
          if (!found) return prev;
          return prev.map(m => m.id === tempId ? { ...m, ...saved, status: "sent", synced: true, id: saved.id } : m);
        });
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
      pendingSendIdsRef.current.delete(tempId);
    }
    sendingRecordingRef.current = false;
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

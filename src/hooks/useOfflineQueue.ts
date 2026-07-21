import { useState, useEffect, useCallback, useRef } from "react";
import { Message } from "../types";
import { sendMessage as apiSendMessage } from "../services/messages";
import { getItem, setItem } from "../services/storageService";

const STORAGE_KEY = "redon_pending_messages";

async function loadQueue(): Promise<Message[]> {
  try {
    return await getItem<Message[]>(STORAGE_KEY) || [];
  } catch {
    return [];
  }
}

function saveQueue(queue: Message[]) {
  setItem(STORAGE_KEY, queue);
}

export function useOfflineQueue(
  chatId: string,
  uid?: string,
  onMessageSent?: (tempId: string, savedId: string) => void,
  onMessageSending?: (tempId: string) => void
) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const queueLoadedRef = useRef(false);
  const retryingRef = useRef(false);

  // Load queue from IndexedDB on mount
  useEffect(() => {
    loadQueue().then(q => {
      setPendingMessages(q);
      queueLoadedRef.current = true;
    });
  }, []);

  // Listen for online/offline events
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Persist queue changes (fire-and-forget)
  useEffect(() => {
    if (queueLoadedRef.current) {
      saveQueue(pendingMessages);
    }
  }, [pendingMessages]);

  // Retry queue when coming back online
  useEffect(() => {
    if (!isOnline || retryingRef.current || pendingMessages.length === 0) return;
    retryingRef.current = true;

    const retryAll = async () => {
      const queue = [...pendingMessages];
      const remaining: Message[] = [];

      for (const msg of queue) {
        onMessageSending?.(msg.id);
        try {
          const saved = await apiSendMessage({
            chat_id: chatId,
            text: msg.text,
            type: msg.type,
            sender_id: uid,
            audio_url: msg.mediaUrl,
            reply_to_id: msg.replyToId,
            reply_to_text: msg.replyToText,
            reply_to_sender: msg.replyToSender,
          });
          if (onMessageSent && saved?.id) {
            onMessageSent(msg.id, saved.id);
          }
        } catch {
          remaining.push(msg);
        }
      }

      setPendingMessages(remaining);
      retryingRef.current = false;
    };

    retryAll();
  }, [isOnline, chatId, uid]);

  const queueMessage = useCallback((msg: Message) => {
    setPendingMessages(prev => [...prev, { ...msg, status: "sending" as const }]);
  }, []);

  const removePending = useCallback((tempId: string) => {
    setPendingMessages(prev => prev.filter(m => m.id !== tempId));
  }, []);

  const isPending = useCallback((msgId: string) => {
    return pendingMessages.some(m => m.id === msgId);
  }, [pendingMessages]);

  return { isOnline, pendingMessages, queueMessage, removePending, isPending };
}

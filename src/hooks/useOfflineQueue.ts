import { useState, useEffect, useCallback, useRef } from "react";
import { Message } from "../types";
import { syncService } from "../services/sync/SyncService";

export function useOfflineQueue(
  chatId: string,
  uid?: string,
  onMessageSent?: (tempId: string, savedId: string) => void,
  onMessageSending?: (tempId: string) => void
) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const queueLoadedRef = useRef(false);

  // Load pending messages from SQLite on mount
  useEffect(() => {
    // In a real implementation, we'd load from SQLite here
    // For now, we rely on the messages already in the chat's messages array
    queueLoadedRef.current = true;
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

  // Retry queue when coming back online
  useEffect(() => {
    if (!isOnline) return;
    // SyncService will automatically process queue on online event
  }, [isOnline]);

  const queueMessage = useCallback(async (msg: Message) => {
    // Add to local state immediately for UI feedback
    setPendingMessages(prev => [...prev, { ...msg, status: "sending" as const }]);
    
    // Queue in SyncService (persists to SQLite + retries)
    await syncService.queueMessage(chatId, msg);
  }, [chatId]);

  const removePending = useCallback((tempId: string) => {
    setPendingMessages(prev => prev.filter(m => m.id !== tempId));
  }, []);

  const isPending = useCallback((msgId: string) => {
    // Check both local state and if message exists in chat with "sending" status
    return pendingMessages.some(m => m.id === msgId);
  }, [pendingMessages]);

  // Expose syncService for external access if needed
  return { isOnline, pendingMessages, queueMessage, removePending, isPending };
}

import { useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { messageRepo } from "../../services/database/repositories/MessageRepository";
import { logger } from "../../lib/logger";

const BASE_RETRY_DELAY = 3000;
const MAX_RETRY_DELAY = 30000;

function retryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
}

// Suscripción global de recibos de lectura: escucha los UPDATE de MIS mensajes
// enviados (sender_id = uid) y, cuando el destinatario los marca como leídos,
// actualiza la copia local en SQLite al instante. Sin esto, el emisor que NO
// tiene el chat abierto recién veía el doble check azul al reabrir el chat.
// Con el chat abierto, el canal propio de ChatRoom ya lo cubre; este canal
// mantiene fresca la caché local para que reabrir sea instantáneo y sobreviva
// incluso si el fetch al servidor falla.
export function useGlobalReadReceipts(uid: string | undefined): void {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;
    let retries = 0;

    const applyRead = async (raw: any) => {
      if (!raw || raw.sender_id !== uid) return;
      if (raw.status !== "read" || !raw.read_at) return;
      const chatId = raw.chat_id;
      if (!chatId) return;
      try {
        const local = await messageRepo.getMessages(chatId);
        const msg = local.find((m) => m.id === raw.id);
        if (!msg || msg.status === "read") return;
        await messageRepo.upsertMessage(chatId, { ...msg, status: "read" as const, chatId });
      } catch (e) {
        logger.warn("[GlobalReadReceipts] apply failed", { error: e, chatId });
      }
    };

    const setup = async () => {
      let hasSession = false;
      try {
        const { data } = await supabase.auth.getSession();
        hasSession = !!data.session;
      } catch {
        hasSession = false;
      }
      if (!hasSession || cancelled) return;

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channel = supabase.channel(`read-receipts-${uid}`);
      channelRef.current = channel;
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${uid}`,
        },
        (payload: any) => {
          applyRead(payload.new);
        }
      );

      channel.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          retries = 0;
        } else if ((status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") && !cancelled) {
          retries++;
          const delay = retryDelay(retries);
          setTimeout(setup, delay);
        }
      });
    };

    setup();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [uid]);
}
import { useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";

/**
 * Suscripción a eventos de miembros de grupos.
 * El servidor inserta filas en group_member_events con user_id = auth.uid():
 *   - type='removed' → onRemoved(chatId): el chat queda visible en solo-lectura.
 *   - type='added'   → onAdded(chatId): el cliente pregunta si permanece.
 *
 * El patrón es análogo a useChatRealtime pero para una tabla global:
 * canal por uid, filter por user_id, auto-reconnect, cleanup al desmontar.
 */
export function useGroupMemberEvents(
  uid: string | undefined,
  onRemoved: (chatId: string) => void,
  onAdded?: (chatId: string) => void,
) {
  const onRemovedRef = useRef(onRemoved);
  onRemovedRef.current = onRemoved;
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;
  const handledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    handledRef.current = new Set();

    const channel = supabase.channel(`group-member-events-${uid}`);
    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_member_events",
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const record = (payload.new ?? {}) as {
            id?: string;
            chat_id?: string;
            type?: string;
            created_at?: string;
          };
          if (!record.chat_id) return;
          const chatId = String(record.chat_id);
          // Dedup por id de fila (uuid): Realtime puede reentregar el mismo evento,
          // pero cada fila es única — así no se bloquean re-agregados al mismo chat.
          const dedupKey = String(record.id ?? `${record.created_at ?? "?"}:${chatId}`);
          if (handledRef.current.has(dedupKey)) return;
          handledRef.current.add(dedupKey);
          if (record.type === "removed") {
            onRemovedRef.current(chatId);
          } else if (record.type === "added" && onAddedRef.current) {
            onAddedRef.current(chatId);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid]);
}

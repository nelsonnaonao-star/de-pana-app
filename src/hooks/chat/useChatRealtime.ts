import { useEffect, useRef, useState, MutableRefObject } from "react";
import { supabase } from "../../lib/supabase";

export interface MessageEventPayload {
  event: 'INSERT' | 'UPDATE';
  raw: Record<string, any>;
}

const MAX_RETRY_DELAY = 30000;
const BASE_RETRY_DELAY = 3000;

function retryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
}

function ensureSession(): Promise<boolean> {
  return supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) return false;
    if (session.access_token) return true;
    return supabase.auth.refreshSession().then(({ data: { session: refreshed } }) => !!refreshed);
  }).catch(() => false);
}

export function useChatRealtime(
  chatId: string,
  uid: string,
  uname: string,
  lastSyncTimestampRef: MutableRefObject<string | null>,
  onMessageEvent: (payload: MessageEventPayload) => void,
  onReconnect: (lastSyncTimestamp: string) => void,
) {
  const [partnerTyping, setPartnerTyping] = useState(false);
  const messagesChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRetryRef = useRef(0);
  const typingRetryRef = useRef(0);

  const onMessageEventRef = useRef(onMessageEvent);
  onMessageEventRef.current = onMessageEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!chatId || !uid) return;

    let cancelled = false;

    const setup = async () => {
      const hasSession = await ensureSession();
      if (!hasSession || cancelled) return;

      if (messagesChannelRef.current) {
        supabase.removeChannel(messagesChannelRef.current);
        messagesChannelRef.current = null;
      }

      const channel = supabase.channel(`messages-${chatId}`);
      messagesChannelRef.current = channel;
      channel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      }, (payload: any) => {
        const raw = payload.new;
        if (raw.is_deleted) return;
        onMessageEventRef.current({ event: 'INSERT', raw });
      });

      channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      }, (payload: any) => {
        onMessageEventRef.current({ event: 'UPDATE', raw: payload.new });
      });

      let firstSubscribeDone = false;
      channel.subscribe((status: string) => {
        console.log('[REALTIME] channel subscribe status:', status, 'for chat.id:', chatId);
        if (status === 'SUBSCRIBED') {
          messagesChannelRef.current = channel;
          if (firstSubscribeDone || lastSyncTimestampRef.current) {
            firstSubscribeDone = true;
            if (lastSyncTimestampRef.current) {
              onReconnectRef.current(lastSyncTimestampRef.current);
            }
          } else {
            firstSubscribeDone = true;
          }
        } else if ((status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') && !cancelled) {
          messagesRetryRef.current++;
          const delay = retryDelay(messagesRetryRef.current);
          console.log(`[REALTIME] messages channel retry ${messagesRetryRef.current} in ${delay}ms`);
          setTimeout(setup, delay);
        }
      });
    };

    setup();

    return () => {
      cancelled = true;
      messagesRetryRef.current = 0;
      if (messagesChannelRef.current) {
        supabase.removeChannel(messagesChannelRef.current);
        messagesChannelRef.current = null;
      }
    };
  }, [chatId, uid, uname]);

  useEffect(() => {
    if (!chatId || !uid) return;

    let cancelled = false;

    const setup = async () => {
      const hasSession = await ensureSession();
      if (!hasSession || cancelled) return;

      if (typingChannelRef.current) {
        supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }

      const channel = supabase.channel(`typing-${chatId}`, {
        config: { broadcast: { self: false, ack: false } },
      });
      typingChannelRef.current = channel;

      channel.on('broadcast', { event: 'typing' }, (payload: any) => {
        const data = payload.payload || payload;
        if (data.userId && data.userId !== uid) {
          setPartnerTyping(!!data.isTyping);
          if (data.isTyping) {
            if (typingIndicatorTimerRef.current) clearTimeout(typingIndicatorTimerRef.current);
            typingIndicatorTimerRef.current = setTimeout(() => setPartnerTyping(false), 4000);
          }
        }
      });

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          typingRetryRef.current = 0;
          typingChannelRef.current = channel;
        } else if ((status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') && !cancelled) {
          typingRetryRef.current++;
          const delay = retryDelay(typingRetryRef.current);
          console.log(`[REALTIME] typing channel retry ${typingRetryRef.current} in ${delay}ms`);
          setTimeout(setup, delay);
        }
      });
    };

    setup();

    return () => {
      cancelled = true;
      typingRetryRef.current = 0;
      if (typingChannelRef.current) {
        supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
      if (typingIndicatorTimerRef.current) clearTimeout(typingIndicatorTimerRef.current);
    };
  }, [chatId, uid]);

  const emitTyping = (isTyping: boolean) => {
    if (!typingChannelRef.current || !uid) return;
    try {
      (typingChannelRef.current as any).send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: uid, isTyping },
      });
    } catch (e) {
      console.warn('[REALTIME] emitTyping failed:', e);
    }
  };

  return {
    partnerTyping,
    emitTyping,
  };
}

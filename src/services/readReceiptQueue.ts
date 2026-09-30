import { markAsRead } from "./messages";
import { logger } from "../lib/logger";

// Cola con reintento para los recibos de lectura. Antes, ChatRoom disparaba
// markAsRead en modo fire-and-forget: si la red del LECTOR fallaba en ese
// instante (POST + RPC fallback), el "visto" se perdía para siempre y el check
// del EMISOR quedaba intacto hasta la próxima vez que se abriera el chat.
// Ahora el intento queda en cola con backoff y se vuelve a intentar también
// cuando el SyncService detecta que la señal volvió (requestFlush).
type PendingRead = {
  chatId: string;
  userId: string;
  name: string;
  retries: number;
  nextAt: number;
};

const pending = new Map<string, PendingRead>();
const MAX_RETRIES = 4;
const BACKOFF_MS = [3000, 6000, 12000, 24000];
const FLUSH_INTERVAL = 5000;

let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function schedule(): void {
  if (timer) return;
  timer = setInterval(() => {
    flushPendingReadReceipts();
  }, FLUSH_INTERVAL);
}

function stopIfIdle(): void {
  if (pending.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function enqueueReadReceipt(chatId: string | undefined, userId: string | undefined, name: string | undefined): void {
  if (!chatId || !userId || !name) return;
  const existing = pending.get(chatId);
  pending.set(chatId, {
    chatId,
    userId,
    name,
    retries: existing?.retries ?? 0,
    nextAt: 0,
  });
  schedule();
  flushPendingReadReceipts();
}

export async function flushPendingReadReceipts(): Promise<void> {
  if (flushing) return;
  if (pending.size === 0) return;
  flushing = true;
  const now = Date.now();
  try {
    for (const [chatId, entry] of [...pending]) {
      if (entry.nextAt > now) continue;
      try {
        await markAsRead(entry.chatId, entry.userId, entry.name);
        pending.delete(chatId);
      } catch (err) {
        const nextRetries = entry.retries + 1;
        if (nextRetries > MAX_RETRIES) {
          pending.delete(chatId);
          logger.warn("[ReadReceipts] recibido descartado tras reintentos", { chatId, error: (err as Error)?.message });
        } else {
          pending.set(chatId, {
            ...entry,
            retries: nextRetries,
            nextAt: now + BACKOFF_MS[nextRetries - 1],
          });
        }
      }
    }
  } finally {
    flushing = false;
    stopIfIdle();
  }
}
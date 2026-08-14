import { Network } from "@capacitor/network";
import type { PluginListenerHandle } from "@capacitor/core";
import { messageRepo } from "../database/repositories/MessageRepository";
import { recordReconciledId } from "../../lib/reconciledIds";
import { sendMessage as apiSendMessage } from "../messages";
import { uploadChatMedia } from "../storage";
import { Capacitor } from "@capacitor/core";
import { logger } from "../../lib/logger";

export type SyncedCallback = (
  tempId: string,
  chatId: string,
  savedId: string
) => void;

export interface QueuedMessage {
  tempId: string;
  chatId: string;
  message: any;
  retries: number;
  createdAt: number;
}

class SyncService {
  private listeners: SyncedCallback[] = [];
  private processing = false;
  private networkHandler: PluginListenerHandle | null = null;
  private started = false;
  private messageQueue: QueuedMessage[] = [];
  private processingQueue = false;
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY = 2000; // 2s base
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  // Evita martillar el servidor en redes muertas: por mensaje solo se reintenta
  // una vez cada 60s (en memoria; se resetea al reiniciar la app).
  private lastAttemptAt = new Map<string, number>();
  private readonly RETRY_GAP_MS = 60000;

  onSynced(cb: SyncedCallback): void {
    this.listeners.push(cb);
  }

  offSynced(cb: SyncedCallback): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (Capacitor.getPlatform() !== "web") {
      try {
        const status = await Network.getStatus();
        if (status.connected) {
          this.processQueue();
        }
      } catch (e) {
        logger.warn("[SyncService] Network.getStatus failed", { error: e });
      }

      try {
        this.networkHandler = await Network.addListener(
          "networkStatusChange",
          (status) => {
            if (status.connected) {
              this.processQueue();
            }
          }
        );
      } catch (e) {
        logger.warn("[SyncService] Network.addListener failed", { error: e });
      }
    }

    window.addEventListener("online", this.onBrowserOnline);

    // Drenaje periódico: reintenta mensajes sin sincronizar aunque no llegue
    // el evento "online" (red 3G inestable donde el socket va y viene).
    if (!this.retryTimer) {
      this.retryTimer = setInterval(() => {
        if (navigator.onLine && !this.processing) {
          this.processQueue();
        }
      }, 15000);
    }
  }

  stop(): void {
    if (this.networkHandler) {
      try {
        this.networkHandler.remove();
      } catch (e) {
        logger.warn("[SyncService] networkHandler.remove failed", { error: e });
      }
      this.networkHandler = null;
    }
    window.removeEventListener("online", this.onBrowserOnline);
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private onBrowserOnline = (): void => {
    this.processQueue();
    this.processMessageQueue();
  };

  /**
   * Encola un mensaje para envío inmediato con persistencia en SQLite.
   * Si falla, queda en cola local con retries y se reintenta automáticamente al volver la red.
   */
  async queueMessage(chatId: string, message: any): Promise<void> {
    const tempId = message.id;
    const queued: QueuedMessage = {
      tempId,
      chatId,
      message: { ...message, status: "sending", synced: false },
      retries: 0,
      createdAt: Date.now(),
    };

    // 1. Persistir inmediatamente en SQLite (synced = false)
    await messageRepo.upsertMessage(chatId, { ...message, status: "sending", synced: false });
    
    // 2. Añadir a cola en memoria para reintento rápido
    this.messageQueue.push(queued);

    // 3. Intentar enviar inmediatamente
    await this.trySend(queued);
  }

  private async trySend(queued: QueuedMessage): Promise<boolean> {
    const { chatId, message, retries } = queued;
    
    try {
      const saved = await this.sendSingle(queued.chatId, queued.message);
      if (saved?.id) {
        // Éxito: notificar YA (marca ✓ en la UI montada) y luego sustituir de
        // forma atómica tempId -> savedId en SQLite sin bloquear el ✓.
        const updated = { ...message, id: saved.id, status: "sent", synced: true };
        recordReconciledId(chatId, message.id as string, saved.id);
        this.removeFromQueue(queued.tempId);
        this.notifyListeners(queued.tempId, chatId, saved.id);
        this.reconcileQuietly(chatId, message.id as string, updated);
        logger.info("[SyncService] queued message sent", { tempId: queued.tempId, savedId: saved.id });
        return true;
      }
    } catch (err) {
      logger.warn("[SyncService] queue send failed, will retry", { 
        tempId: queued.tempId, 
        attempt: retries + 1, 
        error: err 
      });
    }
    return false;
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;
    this.processingQueue = true;

    const queue = [...this.messageQueue];
    
    for (const queued of queue) {
      if (queued.retries >= 5) {
        logger.error("[SyncService] Max retries reached, keeping in queue", { tempId: queued.tempId });
        continue;
      }
      
      queued.retries++;
      const delay = Math.min(2000 * Math.pow(2, queued.retries - 1), 30000);
      
      logger.info("[SyncService] Retrying queued message", { tempId: queued.tempId, attempt: queued.retries });
      await new Promise(r => setTimeout(r, delay));
      
      await this.trySend(queued);
    }
    
    this.processingQueue = false;
  }

  private removeFromQueue(tempId: string): void {
    this.messageQueue = this.messageQueue.filter(m => m.tempId !== tempId);
  }

  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      // 1. Procesar mensajes no sincronizados de SQLite (cola legacy)
      const pending = await messageRepo.getAllUnsynced();
      if (pending.length > 0) {
        logger.info(`[SyncService] processing ${pending.length} legacy pending messages`);
        for (const item of pending) {
          try {
            // Saltar media blob: no existe fuera de la sesión y su reintento
            // corrompería el mensaje (envío sin audio/imagen).
            const blobField = item.message.mediaUrl || item.message.localVideoUrl || item.message.posterUrl;
            if (typeof blobField === "string" && blobField.startsWith("blob:")) continue;
            // Throttle: no reintentar el mismo mensaje más de una vez por minuto.
            const prev = this.lastAttemptAt.get(item.message.id) ?? 0;
            if (Date.now() - prev < this.RETRY_GAP_MS) continue;
            this.lastAttemptAt.set(item.message.id, Date.now());
            await this.sendSingle(item.chatId, item.message);
          } catch (err) {
            logger.warn("[SyncService] failed for legacy message", { messageId: item.message.id, error: err });
          }
        }
      }

      // 2. Procesar cola en memoria (nuevos mensajes encolados vía queueMessage)
      if (this.messageQueue.length > 0) {
        logger.info(`[SyncService] processing ${this.messageQueue.length} queued messages`);
        await this.processMessageQueue();
      }
    } catch (err) {
      logger.error("[SyncService] processQueue error", { error: err });
    }

    this.processing = false;
  }

  private async sendSingle(
    chatId: string,
    msg: any
  ): Promise<any> {
    let imageUrl: string | undefined;
    let audioUrl: string | undefined;
    let videoUrl: string | undefined;
    let stickerUrl: string | undefined;
    let gifUrl: string | undefined;

    const mediaUrl = msg.mediaUrl as string | undefined;
    const localVideoUrl = msg.localVideoUrl as string | undefined;
    const type = msg.type as string;

    if (mediaUrl && !mediaUrl.startsWith("blob:")) {
      const uploaded = await this.uploadIfNeeded(mediaUrl, type);
      if (uploaded) {
        if (type === "image") imageUrl = uploaded;
        else if (type === "video") videoUrl = uploaded;
        else if (type === "audio" || type === "voice_note") audioUrl = uploaded;
        else if (type === "sticker") stickerUrl = uploaded;
        else imageUrl = uploaded;
      } else {
        if (type === "image") imageUrl = mediaUrl;
        else if (type === "video") videoUrl = mediaUrl;
        else if (type === "audio" || type === "voice_note") audioUrl = mediaUrl;
        else if (type === "sticker") stickerUrl = mediaUrl;
        else imageUrl = mediaUrl;
      }
    }

    if (localVideoUrl && !localVideoUrl.startsWith("blob:")) {
      const uploaded = await this.uploadIfNeeded(localVideoUrl, "video");
      if (uploaded) videoUrl = uploaded;
    }

    const replyToId = msg.replyToId as string | undefined;
    const replyToText = msg.replyToText as string | undefined;
    const replyToSender = msg.replyToSender as string | undefined;

    const MAX_RETRIES = 3;
    let lastError: unknown;
    let saved: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        saved = await apiSendMessage({
          chat_id: chatId,
          sender_id: (msg.sender_id as string) || undefined,
          text: (msg.text as string) || undefined,
          type: type as any,
          image_url: imageUrl,
          audio_url: audioUrl,
          video_url: videoUrl,
          sticker_url: stickerUrl,
          gif_url: gifUrl,
          forwarded: (msg.forwarded as boolean) || undefined,
          // Idempotencia: si el mensaje ya llegó al servidor en un intento
          // anterior, reenviar con el MISMO client_id devuelve el mismo id
          // (no duplica). Enviar sin client_id crearía una fila nueva en cada retry.
          client_id: (msg.clientId as string) || (msg.client_id as string) || undefined,
          temp_id: (msg.id as string) || undefined,
          latitude: (msg.latitude as number) ?? undefined,
          longitude: (msg.longitude as number) ?? undefined,
          location_name: (msg.locationName as string) || (msg.location_name as string) || undefined,
          audio_duration: (msg.duration as string) || undefined,
          reply_to_id: replyToId,
          reply_to_text: replyToText,
          reply_to_sender: replyToSender,
          poll_question: (msg.pollQuestion as string) || (msg.poll_question as string) || undefined,
          poll_options:
            (Array.isArray(msg.pollOptions)
              ? msg.pollOptions
              : typeof msg.poll_options === "string"
                ? JSON.parse(msg.poll_options)
                : undefined) as any,
        });
        if (saved?.id) break;
      } catch (err) {
        lastError = err;
        logger.warn(`[SyncService] attempt ${attempt}/${MAX_RETRIES} failed`, { messageId: msg.id, error: err });
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }

    if (!saved?.id) {
      logger.error(`[SyncService] all ${MAX_RETRIES} attempts failed`, { messageId: msg.id, error: lastError });
      return;
    }

    if (saved?.id) {
      const updated = { ...(msg as any), id: saved.id, status: "sent", synced: true };
      recordReconciledId(chatId, msg.id as string, saved.id);
      this.notifyListeners(msg.id as string, chatId, saved.id);
      this.reconcileQuietly(chatId, msg.id as string, updated);
      logger.info("[SyncService] synced", { tempId: msg.id, savedId: saved.id });
    }
    return saved;
  }

  // Sustitución atómica tempId -> savedId en SQLite SIN bloquear ni rechazar:
  // la UI ya se marcó "sent" vía notifyListeners; aquí solo se deja persistida
  // la fila real para que las re-lecturas (cache-first) devuelvan el id real.
  private reconcileQuietly(chatId: string, tempId: string, saved: any): void {
    messageRepo.reconcileTemp(chatId, tempId, saved).catch((err: unknown) => {
      logger.warn("[SyncService] reconcileTemp falló (UI ya marcó sent)", {
        tempId,
        error: err,
      });
    });
  }

  private async uploadIfNeeded(
    url: string,
    type: string
  ): Promise<string | null> {
    if (url.startsWith("blob:")) return null;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;

    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const folder =
        type === "video" || type === "video_note"
          ? "video"
          : type === "audio" || type === "voice_note"
            ? "voice"
            : type === "sticker"
              ? "stickers"
              : "uploads";
      return await uploadChatMedia(blob, folder);
    } catch {
      return null;
    }
  }

  private notifyListeners(tempId: string, chatId: string, savedId: string): void {
    for (const cb of this.listeners) {
      try {
        cb(tempId, chatId, savedId);
      } catch (e) {
        logger.warn("[SyncService] listener callback failed", { error: e });
      }
    }
  }
}

export const syncService = new SyncService();

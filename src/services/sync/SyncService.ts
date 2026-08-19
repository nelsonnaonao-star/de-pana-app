import { Network } from "@capacitor/network";
import { App as CapacitorApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { supabase } from "../../lib/supabase";
import { messageRepo } from "../database/repositories/MessageRepository";
import { recordReconciledId, getReconciledSavedId } from "../../lib/reconciledIds";
import { sendMessage as apiSendMessage } from "../messages";
import { uploadChatMedia } from "../storage";
import { Capacitor } from "@capacitor/core";
import { logger } from "../../lib/logger";

// Instrumentación de diagnóstico SIEMPRE visible en logcat (producción).
// console.log directo: el logger no escribe en producción.
function dbg(...args: any[]): void {
  try {
    console.log("[SYNC-DBG]", ...args);
  } catch {
    // sin op
  }
}

export type SyncedCallback = (
  tempId: string,
  chatId: string,
  savedId: string
) => void;

// IDs de mensajes que la UI está enviando AHORA MISMO (temp_id/msg_*). El
// SyncService los OMITE: si la UI ya lanzó el POST, reintentarlo crearía un
// duplicado cuando el servidor no deduplica por client_id (versión desplegada).
export const inFlightMessageIds = new Set<string>();

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
  private flushRequested = false;
  // Aborta el intento en vuelo (fetch colgado en red muerta) cuando vuelve la
  // señal, para que el drenaje termine YA y el relanzamiento use la red viva.
  private activeAbort: AbortController | null = null;
  private networkHandler: PluginListenerHandle | null = null;
  private appStateHandler: PluginListenerHandle | null = null;
  private started = false;
  private messageQueue: QueuedMessage[] = [];
  private processingQueue = false;
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY = 2000; // 2s base
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  // Evita martillar el servidor en redes muertas: por mensaje solo se reintenta
  // una vez cada 15s (en memoria; se resetea al reiniciar la app). Al recuperar
  // la señal, el siguiente ciclo drena la cola sin esperar 60s.
  private lastAttemptAt = new Map<string, number>();
  private readonly RETRY_GAP_MS = 15000;
  // Señal real recuperada (red/foreground/online): el próximo drenaje se salta
  // el throttle de 15s y el backoff para enviar YA.
  private isNetworkRecovery = false;
  // Sleep de backoff en curso (cancelable): guarda el timer y su resolve por
  // separado para poder romperlo al recuperar la señal en vez de esperar a que
  // termine el backoff. Sin el resolve guardado, clearTimeout dejaría el await
  // colgado para siempre (Event Loop roto).
  private currentTimeout: ReturnType<typeof setTimeout> | null = null;
  private sleepResolve: (() => void) | null = null;
  // Oráculo del socket: ref del callback de "open" del WebSocket de Supabase.
  // Se registra en start() y se retira en stop().
  private realtimeOracleRef: string | null = null;

  onSynced(cb: SyncedCallback): void {
    this.listeners.push(cb);
  }

  offSynced(cb: SyncedCallback): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  async start(): Promise<void> {
    // Reentrante y robusto: si ya está vivo (started + timer), no-op. Si el
    // timer fue limpiado por stop() (desmontaje, logout, cambio de user), se
    // recrea aunque started siga true.
    if (this.started && this.retryTimer) return;
    this.started = true;
    dbg("start() invoked; platform=", Capacitor.getPlatform(), "started=", this.started, "hasTimer=", !!this.retryTimer);

    // Timer ANTES de cualquier await: si un plugin (Network) cuelga, el drenaje
    // periódico ya existe y la cola igual se reenvía.
    // Drenaje periódico: reintenta mensajes sin sincronizar aunque no llegue
    // el evento "online" (red 3G inestable donde el socket va y viene). No se
    // condiciona a navigator.onLine porque en el WebView de Android puede
    // quedarse en false aunque ya haya señal; processQueue es barato cuando
    // no hay pendientes.
    if (!this.retryTimer) {
      this.retryTimer = setInterval(() => {
        // Fallback: poll activo ligero + drenaje periódico. El disparador REAL de
        // "volvió la señal" es el oráculo del socket Realtime; este timer solo
        // cubre casos donde ningún evento llega (WebView dormido, socket nunca
        // conectado, etc.).
        dbg("timer tick");
        this.periodicCheck();
      }, 15000);
    }

    window.addEventListener("online", this.onBrowserOnline);
    this.setupRealtimeOracle();

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
            dbg("EVENT networkStatusChange:", status);
            if (status.connected) {
              this.requestFlush(true);
            }
          }
        );
      } catch (e) {
        logger.warn("[SyncService] Network.addListener failed", { error: e });
        dbg("networkStatusChange listener FAILED:", e);
      }

      try {
        this.appStateHandler = await CapacitorApp.addListener(
          "appStateChange",
          ({ isActive }) => {
            dbg("EVENT appStateChange isActive=", isActive);
            // Al volver al primer plano, el OS nativo puede haber congelado los
            // timers: disparar el drenaje inmediatamente para no depender de que
            // el setInterval despierte solo.
            if (isActive) {
              this.requestFlush(true);
            }
          }
        );
      } catch (e) {
        logger.warn("[SyncService] App.addListener failed", { error: e });
      }
    }
  }

  stop(): void {
    // Resetear el flag para que un posterior start() vuelva a levantar el timer.
    this.started = false;
    if (this.networkHandler) {
      try {
        this.networkHandler.remove();
      } catch (e) {
        logger.warn("[SyncService] networkHandler.remove failed", { error: e });
      }
      this.networkHandler = null;
    }
    window.removeEventListener("online", this.onBrowserOnline);
    if (this.appStateHandler) {
      try {
        this.appStateHandler.remove();
      } catch (e) {
        logger.warn("[SyncService] appStateHandler.remove failed", { error: e });
      }
      this.appStateHandler = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.teardownRealtimeOracle();
  }

  /**
   * Oráculo de conectividad: cuando el WebSocket de Supabase (Realtime) se REabre,
   * el internet es 100% real. En pérdida de cobertura celular, networkStatusChange
   * y navigator.onLine NO se disparan (la interfaz sigue "connected"), pero el
   * socket sí se cae; su "open" es la señal fiable para abortar los intentos
   * colgados y drenar la cola al instante.
   */
  private setupRealtimeOracle(): void {
    if (this.realtimeOracleRef) return;
    try {
      const openCallbacks = supabase.realtime.stateChangeCallbacks.open;
      if (!Array.isArray(openCallbacks)) return;
      this.realtimeOracleRef = "depana-sync-oracle";
      openCallbacks.push([
        this.realtimeOracleRef,
        () => {
          dbg("ORACLE FIRED (socket open): requestFlush(true)");
          this.requestFlush(true);
        },
      ]);
      logger.info("[SyncService] realtime oracle armed");
      dbg("oracle armed on socket open callbacks; count=", openCallbacks.length);
    } catch (e) {
      logger.warn("[SyncService] realtime oracle setup failed", { error: e });
    }
  }

  private teardownRealtimeOracle(): void {
    if (!this.realtimeOracleRef) return;
    try {
      const openCallbacks = supabase.realtime.stateChangeCallbacks.open;
      const i = openCallbacks.findIndex(([ref]) => ref === this.realtimeOracleRef);
      if (i >= 0) openCallbacks.splice(i, 1);
    } catch {
      // sin op: el oráculo simplemente no se retira
    }
    this.realtimeOracleRef = null;
  }

  /**
   * Poll activo ligero (fallback): al inicio de cada ciclo confirma con
   * Network.getStatus() si vale la pena intentar el POST. Si el dispositivo está
   * claramente sin interfaz (avión/WiFi off), salta el turno y ahorra batería.
   */
  private async periodicCheck(): Promise<void> {
    try {
      // NUNCA dejar que el plugin cuelgue el timer: si Network.getStatus() no
      // responde en 2s, asumir conectado y drenar igual. En el WebView de
      // Android un await colgado aquí mataría el ÚNICO trigger vivo (el socket
      // Realtime no siempre se cae/reabre en pérdida de cobertura celular).
      const status = await Promise.race([
        Network.getStatus(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Network.getStatus timeout")), 2000)
        ),
      ]);
      dbg("periodicCheck: Network.getStatus resolved:", status);
      if (status && !status.connected) {
        logger.info("[SyncService] periodic poll: no connectivity, skipping turn");
        dbg("periodicCheck: NOT connected, skipping turn");
        return;
      }
    } catch (e) {
      // plugin no disponible o timeout: continuar con el drenaje normal
      dbg("periodicCheck: getStatus failed/timeout, continuing anyway:", (e as Error)?.message);
    }
    dbg("periodicCheck -> requestFlush()");
    this.requestFlush();
  }

  private onBrowserOnline = (): void => {
    dbg("EVENT window online");
    this.requestFlush(true);
    this.processMessageQueue();
  };

  /**
   * Dispara un drenaje de la cola. Si ya hay uno en curso (processing), marca
   * flushRequested para que el drenaje activo, al terminar, vuelva a ejecutarse.
   * Así un evento de red/foreground que llega durante un flush lento (red muerta)
   * NO se pierde: al terminar el actual, se relanza con la señal ya recuperada.
   * Con abortActive=true (evento de señal/foreground real) además se aborta el
   * intento en vuelo: si el fetch está colgado esperando su timeout, cortarlo
   * hace que este drenaje termine en milisegundos y el relanzamiento envíe ya.
   */
  requestFlush(abortActive = false): void {
    dbg("requestFlush called; abortActive=", abortActive, "processing=", this.processing, "flushRequested=", this.flushRequested);
    if (abortActive) {
      // Señal real recuperada: romper el sleep de backoff en curso (clearTimeout
      // inmediato), resetear throttle y marcar isNetworkRecovery para que el
      // siguiente drenaje se salte TODAS las reglas de espera y envíe YA.
      this.wakeSleep();
      this.lastAttemptAt.clear();
      this.isNetworkRecovery = true;
      for (const q of this.messageQueue) {
        q.retries = 0;
      }
    }
    if (this.processing) {
      this.flushRequested = true;
      if (abortActive && this.activeAbort) {
        try {
          this.activeAbort.abort();
        } catch {
          // sin op: el intento ya terminó
        }
      }
      return;
    }
    this.processQueue();
  }

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
      if (this.isNetworkRecovery) {
        // Señal real recuperada: NO dormir, enviar en el milisegundo uno.
        logger.info("[SyncService] network recovery, skipping backoff sleep", { tempId: queued.tempId });
      } else {
        await this.sleep(delay);
      }
      
      await this.trySend(queued);
    }
    
    this.processingQueue = false;
  }

  private removeFromQueue(tempId: string): void {
    this.messageQueue = this.messageQueue.filter(m => m.tempId !== tempId);
  }

  /**
   * Sleep cancelable: guarda el timer y su resolve por separado para que
   * wakeSleep() pueda cortarlo al recuperar la señal SIN esperar a que termine
   * (el Event Loop no queda bloqueado durante todo el backoff).
   */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.currentTimeout === timer) {
          this.currentTimeout = null;
          this.sleepResolve = null;
        }
        resolve();
      }, ms);
      this.currentTimeout = timer;
      this.sleepResolve = resolve;
    });
  }

  private wakeSleep(): void {
    // Cortar el timer Y resolver la promesa: si solo hiciéramos clearTimeout,
    // el await sleep(ms) jamás se resolvería y la cola moriría para siempre.
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }
  }

  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    dbg("processQueue START; isNetworkRecovery=", this.isNetworkRecovery);

    try {
      // 1. Procesar mensajes no sincronizados de SQLite (cola legacy)
      const pending = await messageRepo.getAllUnsynced();
      const recovery = this.isNetworkRecovery;
      dbg("processQueue: pending unsynced count=", pending.length);
      if (pending.length > 0) {
        logger.info(`[SyncService] processing ${pending.length} legacy pending messages`);
        for (const item of pending) {
          try {
            // Saltar media blob: no existe fuera de la sesión y su reintento
            // corrompería el mensaje (envío sin audio/imagen).
            const blobField = item.message.mediaUrl || item.message.localVideoUrl || item.message.posterUrl;
            if (typeof blobField === "string" && blobField.startsWith("blob:")) continue;
            // La UI YA está enviando este mensaje ahora mismo: reintentarlo
            // crearía un duplicado (el servidor desplegado no deduplica).
            if (inFlightMessageIds.has(item.message.id)) {
              dbg("processQueue: skip in-flight", item.message.id);
              continue;
            }
            // El temp ya fue CONFIRMADO en el servidor (tempId->savedId registrado
            // al triunfar el POST o al reconciliar su eco de Realtime). Es un
            // "temp fantasma" que quedó synced:false por una carrera de caché:
            // reenviarlo crearía una fila NUEVA (duplicado). Jamás reenviar.
            if (getReconciledSavedId(item.chatId, item.message.id)) {
              dbg("processQueue: skip ya reconciliado (no reenviar)", item.message.id);
              continue;
            }
            // Throttle: no reintentar el mismo mensaje más de una vez por minuto.
            // Con señal real recuperada (recovery) se salta el throttle: enviar YA.
            const prev = this.lastAttemptAt.get(item.message.id) ?? 0;
            if (!recovery && Date.now() - prev < this.RETRY_GAP_MS) {
              dbg("processQueue: throttling", item.message.id, "since last attempt", Date.now() - prev, "ms ago");
              continue;
            }
            this.lastAttemptAt.set(item.message.id, Date.now());
            dbg("processQueue: sending pending", item.message.id, "chat=", item.chatId, "synced=", item.message.synced);
            const r = await this.sendSingle(item.chatId, item.message);
            dbg("processQueue: sendSingle result for", item.message.id, "=", r ? "OK(" + r.id + ")" : "FAILED");
          } catch (err) {
            logger.warn("[SyncService] failed for legacy message", { messageId: item.message.id, error: err });
          }
        }
      }

      // 2. Procesar cola en memoria (nuevos mensajes encolados vía queueMessage)
      if (this.messageQueue.length > 0) {
        dbg("processQueue: memory queue length=", this.messageQueue.length);
        logger.info(`[SyncService] processing ${this.messageQueue.length} queued messages`);
        await this.processMessageQueue();
      }
    } catch (err) {
      logger.error("[SyncService] processQueue error", { error: err });
      dbg("processQueue ERROR:", err);
    }

    this.processing = false;
    dbg("processQueue END; processing=", this.processing, "flushRequested=", this.flushRequested);

    // Si durante el flush llegó una petición de red/foreground (porque el flush
    // estaba ocupado cuando la señal volvió), relanzar de inmediato. Mantener
    // isNetworkRecovery activo para que este relanzamiento TAMBIÉN se salte el
    // throttle/backoff y envíe YA (si lo reseteáramos antes, el relanzamiento
    // dormiría backoff de nuevo y la cola parecería muerta).
    if (this.flushRequested) {
      this.flushRequested = false;
      this.processQueue();
      return;
    }
    this.isNetworkRecovery = false;
  }

  private async sendSingle(
    chatId: string,
    msg: any
  ): Promise<any> {
    // Red de seguridad anti-duplicado: si este temp ya fue confirmado en el
    // servidor (tempId->savedId registrado al triunfar el POST o al reconciliar
    // su eco), jamás reenviarlo — reintentarlo crearía una fila NUEVA.
    const alreadySent = getReconciledSavedId(chatId, msg.id as string);
    if (alreadySent) {
      dbg("sendSingle: ya reconciliado -> no reenviar", msg.id, "->", alreadySent);
      return { id: alreadySent };
    }
    // Los mensajes pendientes en cola pueden haberse guardado sin sender_id
    // (payloads de builds anteriores o caché idb desactualizada). El servidor
    // rechaza con "chat_id y sender_id requeridos" y la cola queda muerta.
    // El mensaje local SIEMPRE es del usuario actual: completar con su uid.
    const senderId =
      (msg.sender_id as string) ||
      (msg.senderId as string) ||
      (await this.getCurrentUid());
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
    // Acota cada intento para que una red muerta/lenta no bloquee el drenaje
    // de la cola durante minutos (authFetch ya aborta a 60s; aquí cortamos antes
    // y dejamos que el siguiente ciclo reintente cuando vuelva la señal).
    const ATTEMPT_TIMEOUT_MS = 12000;
    let lastError: unknown;
    let saved: any = null;

    const attemptWithTimeout = (timeoutMs: number, fn: () => Promise<any>): Promise<any> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`sync attempt timeout (${timeoutMs}ms)`)), timeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      this.activeAbort = controller;
      try {
        dbg("sendSingle: attempt", attempt, "for", msg.id, "chat=", chatId, "text=", (msg.text || "").slice(0, 20));
        saved = await attemptWithTimeout(ATTEMPT_TIMEOUT_MS, () => apiSendMessage({
          chat_id: chatId,
          sender_id: senderId,
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
        }, controller.signal));
        if (saved?.id) break;
      } catch (err) {
        lastError = err;
        logger.warn(`[SyncService] attempt ${attempt}/${MAX_RETRIES} failed`, { messageId: msg.id, error: err });
        dbg("sendSingle: attempt", attempt, "FAILED:", (err as Error)?.message || err, "aborted=", controller.signal.aborted);
        // Errores 4xx de auth/membresía/validación (403, 404, 400...) son
        // PERMANENTES, no transitorios: reintentar 3 veces seguido y luego cada
        // 15s solo martilla el servidor sin resultado (el 403 "No eres miembro
        // de este chat"). Cortar aquí; el ciclo siguiente aún lo reevalúa.
        const errStatus = (err as any)?.status;
        if (typeof errStatus === "number" && errStatus >= 400 && errStatus < 500 && errStatus !== 429) {
          dbg("sendSingle: error permanente 4xx, sin reintentos", msg.id, errStatus);
          break;
        }
        // Abortado porque volvió la señal/foreground: NO seguir reintentando en
        // este ciclo. requestFlush ya marcó flushRequested y el relanzamiento
        // enviará de inmediato con la red ya viva.
        if (controller.signal.aborted) break;
        if (attempt < MAX_RETRIES) {
          await this.sleep(2000 * attempt);
        }
      } finally {
        if (this.activeAbort === controller) this.activeAbort = null;
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
      dbg("sendSingle: SYNCED", msg.id, "->", saved.id);
    } else {
      dbg("sendSingle: ALL ATTEMPTS FAILED for", msg.id);
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

  private cachedUid: string | null = null;

  /**
   * Uid del usuario actual (cacheado en memoria). Fuente de verdad para el
   * sender_id de mensajes pendientes que se guardaron sin él.
   */
  private async getCurrentUid(): Promise<string | undefined> {
    if (this.cachedUid) return this.cachedUid;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        this.cachedUid = user.id;
        return user.id;
      }
    } catch {
      // sin op: devolver undefined
    }
    return undefined;
  }
}

export const syncService = new SyncService();

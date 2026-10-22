import { db } from "../DatabaseService";
import { getItem, setItem, removeItem, getKeys } from "../../storageService";
import type { Message } from "../../../types";
import { logger } from "../../../lib/logger";
import { getReconciledSavedId } from "../../../lib/reconciledIds";
import { editMessage as apiEditMessage } from "../../messages";
import { isEphemeralMessageExpired } from "../../messageExpiry";

const CACHE_PREFIX = "redon_cache_msgs_";
const MAX_CACHED = 200;

// One-time cleanup flag: mark legacy messages without owner_user_id as synced
// so they don't block the queue forever. Runs once per session.
let legacyCleanupDone = false;

// Edits encolados para mensajes cuyo temp aún no se reconcilió (se aplican en
// reconcileTemp). Caché en memoria (fuente de verdad del proceso) + respaldo en
// idb para sobrevivir a un reload entre medias. La caché elimina la carrera:
// registerPendingEdit agrega de forma síncrona antes de persistir, así un
// reconcileTemp concurrente SIEMPRE ve el edit.
const PENDING_EDIT_KEY = "redon_pending_edits_v1";
type PendingEdit = { chatId: string; tempId: string; newText: string };
let pendingEditsCache: PendingEdit[] | null = null;

async function getPendingEdits(): Promise<PendingEdit[]> {
  if (pendingEditsCache) return pendingEditsCache;
  try {
    const raw = await getItem<PendingEdit[]>(PENDING_EDIT_KEY);
    pendingEditsCache = Array.isArray(raw) ? raw : [];
  } catch {
    pendingEditsCache = [];
  }
  return pendingEditsCache;
}

// ── Frontera local de chat_clears ────────────────────────────────────────
// Persiste una copia LOCAL de la frontera de borrado por chat. Se usa al reabrir
// para filtrar el historial cacheado ANTES del primer pintado (evita que los
// mensajes borrados remotos parpadeen) y para saber si el servidor tiene una
// marca más reciente que aplicar. Es un complemento aditivo: getMessages() NO
// filtra, para no cambiar el comportamiento de sus otros llamadores.
const CLEARED_PREFIX = "redon_cleared_at_";

function toRow(msg: Message, chatId: string): Record<string, unknown> {
  return {
    id: msg.id,
    sender: msg.sender,
    text: msg.text || null,
    timestamp: msg.timestamp,
    raw_created_at: msg.rawCreatedAt || null,
    type: msg.type,
    media_url: msg.mediaUrl || null,
    file_name: msg.fileName || null,
    file_size: msg.fileSize || null,
    duration: msg.duration || null,
    reactions: msg.reactions ? JSON.stringify(msg.reactions) : null,
    poll_question: msg.pollQuestion || null,
    poll_options: msg.pollOptions ? JSON.stringify(msg.pollOptions) : null,
    latitude: msg.latitude ?? null,
    longitude: msg.longitude ?? null,
    location_name: msg.locationName || null,
    status: msg.status || null,
    forwarded: msg.forwarded ? 1 : 0,
    edited: msg.edited ? 1 : 0,
    synced: msg.synced === false ? 0 : 1,
    reply_to_id: msg.replyToId || null,
    reply_to_text: msg.replyToText || null,
    reply_to_sender: msg.replyToSender || null,
    price: msg.price || null,
    poster_url: msg.posterUrl || null,
    local_video_url: msg.localVideoUrl || null,
    chat_id: chatId,
    sender_id: msg.sender_id || msg.senderId || null,
    client_id: msg.client_id || msg.clientId || null,
    owner_user_id: (msg as any).owner_user_id || null,
    payload: JSON.stringify(msg),
  };
}

function fromRow(row: Record<string, unknown>): Message | null {
  const rowSenderId = (row.sender_id as string) || undefined;
  const rowClientId = (row.client_id as string) || undefined;
  if (row.payload && typeof row.payload === "string") {
    try {
      const parsed = JSON.parse(row.payload) as any;
      // Hidratar desde las columnas (fuente de verdad del DTO): si el payload
      // quedó desactualizado (p. ej. un saveMessages sin sender_id), las
      // columnas garantizan que el envío no pierda datos críticos.
      if (rowSenderId) parsed.sender_id = rowSenderId;
      if (rowClientId) {
        parsed.client_id = rowClientId;
        parsed.clientId = rowClientId;
      }
      return parsed as Message;
    } catch (e) {
      logger.warn("[MessageRepo] Failed to parse payload", { error: e });
    }
  }
  return {
    id: row.id as string,
    sender: row.sender as "me" | "other",
    text: (row.text as string) || undefined,
    timestamp: row.timestamp as string,
    rawCreatedAt: (row.raw_created_at as string) || undefined,
    type: row.type as Message["type"],
    mediaUrl: (row.media_url as string) || undefined,
    fileName: (row.file_name as string) || undefined,
    fileSize: (row.file_size as string) || undefined,
    duration: (row.duration as string) || undefined,
    reactions: row.reactions
      ? JSON.parse(row.reactions as string)
      : undefined,
    pollQuestion: (row.poll_question as string) || undefined,
    pollOptions: row.poll_options
      ? JSON.parse(row.poll_options as string)
      : undefined,
    latitude: (row.latitude as number) ?? undefined,
    longitude: (row.longitude as number) ?? undefined,
    locationName: (row.location_name as string) || undefined,
    status: (row.status as Message["status"]) || undefined,
    forwarded: row.forwarded === 1,
    edited: row.edited === 1,
    synced: row.synced !== 0,
    chatId: (row.chat_id as string) || undefined,
    replyToId: (row.reply_to_id as string) || undefined,
    replyToText: (row.reply_to_text as string) || undefined,
    replyToSender: (row.reply_to_sender as string) || undefined,
    price: (row.price as string) || undefined,
    posterUrl: (row.poster_url as string) || undefined,
    localVideoUrl: (row.local_video_url as string) || undefined,
  };
}

const INSERT_COLS = [
  "id","sender","text","timestamp","raw_created_at","type",
  "media_url","file_name","file_size","duration","reactions",
  "poll_question","poll_options","latitude","longitude","location_name",
  "status","forwarded","edited","synced","reply_to_id","reply_to_text",
  "reply_to_sender","price","poster_url","local_video_url","chat_id","sender_id","client_id","owner_user_id","payload",
];

const INSERT_PLACEHOLDERS = INSERT_COLS.map(() => "?").join(",");
const INSERT_SQL = `INSERT OR REPLACE INTO messages (${INSERT_COLS.join(",")}) VALUES (${INSERT_PLACEHOLDERS})`;

function rowValues(msg: Message, chatId: string): unknown[] {
  const row = toRow(msg, chatId);
  return INSERT_COLS.map((c) => row[c]);
}

export class MessageRepository {
  /**
   * Una temp (id con prefijo temp_ o msg_, pendiente, synced=false) solo se descarta del resultado
   * cuando hay EVIDENCIA de que ya corresponde a un mensaje confirmado:
   *   (A) una fila confirmada que referencia explícitamente este temp
   *       (clientTempId/temp_id devuelto por el servidor), o
   *   (B) el mapa tempId->savedId resolvió a una fila confirmada presente.
   * Los pendientes legítimos SIN confirmación jamás se eliminan de la vista.
   */
  private isResolvedTemp(chatId: string, m: Message, all: Message[]): boolean {
    if (m.synced !== false) return false;
    if (m.sender !== "me") return false;
    const id = m.id;
    if (!id || !(id.startsWith("temp_") || id.startsWith("msg_"))) return false;
    if (all.some((x) => x.id !== id && x.clientTempId === id && x.synced !== false)) return true;
    const savedId = getReconciledSavedId(chatId, id);
    if (savedId && all.some((x) => x.id === savedId && x.synced !== false)) return true;
    return false;
  }

  async getMessages(chatId: string): Promise<Message[]> {
    const now = Date.now();
    let sqliteRows: Message[] | null = null;
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM messages WHERE chat_id = ? ORDER BY raw_created_at ASC",
          [chatId]
        );
        sqliteRows = rows
          .map(fromRow)
          .filter((m): m is Message => m !== null && !isEphemeralMessageExpired(m, now));
      } catch (e) {
        logger.warn("[MessageRepo] SQLite error, fallback", { error: e });
      }
    }
    // Caché local (idb): fuente secundaria SIEMPRE escrita por upsertMessage.
    // SQLite puede no tener los pendientes si no estaba listo al enviar (o si
    // executeSet falló de forma transitoria). Fusionar garantiza que un mensaje
    // local/pendiente jamás desaparezca al reabrir la app.
    let cache: Message[] = [];
    try {
      const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
      cache = Array.isArray(raw)
        ? raw.filter((m) => !isEphemeralMessageExpired(m, now))
        : [];
    } catch (e) {
      logger.warn("[MessageRepo] getMessages cache read error", { error: e });
    }
    // Evidencia combinada (SQLite + idb): idéntico criterio conservador en ambos
    // almacenes para no devolver una temp con confirmación verificable.
    const evidence = [...(sqliteRows ?? []), ...cache];
    if (sqliteRows !== null) {
      const canonical = sqliteRows.filter((m) => !this.isResolvedTemp(chatId, m, evidence));
      const seen = new Set(canonical.map((m) => m.id));
      const pendientes = cache.filter(
        (m) =>
          !seen.has(m.id) &&
          (m.synced === false ||
            m.status === "sending" ||
            m.status === "error") &&
          !this.isResolvedTemp(chatId, m, evidence)
      );
      const merged = [...canonical, ...pendientes];
      merged.sort((a, b) => {
        const ta = a.rawCreatedAt || a.timestamp || "";
        const tb = b.rawCreatedAt || b.timestamp || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      return merged;
    }
    return cache.filter((m) => !this.isResolvedTemp(chatId, m, evidence));
  }

  async saveMessages(chatId: string, messages: Message[]): Promise<void> {
    // Persistir también mensajes pendientes/optimistas (temp/msg) para que un
    // mensaje no confirmado siga visible al salir y volver a entrar al chat.
    const now = Date.now();
    const batch = messages
      .filter((message) => !isEphemeralMessageExpired(message, now))
      .slice(-MAX_CACHED);
    if (batch.length === 0) return;

    if (db.ready) {
      try {
        // Preservar sender_id/client_id de filas pendientes ya guardadas: el
        // estado React que llega aquí NO incluye sender_id, y un INSERT OR
        // REPLACE lo reemplazaría por NULL → el flush perdería el DTO.
        await this.mergePendingMetadata(chatId, batch);
        await db.executeSet(
          batch.map((msg) => ({
            statement: INSERT_SQL,
            values: rowValues(msg, chatId),
          }))
        );
      } catch (e) {
        logger.warn("[MessageRepo] SQLite error, fallback", { error: e });
      }
    }
    // Restaurar metadatos desde la caché idb también en plataformas sin SQLite
    // (web): sin esto el estado React (sin clientId) pisaba la fila y el envío
    // perdía su client_id → el reintento iba sin idempotencia → duplicados.
    await this.restoreMetadataFromCache(chatId, batch);
    // Mezclar con los pendientes ya guardados (temp/msg) que el nuevo lote NO
    // incluye (ej. refresco del servidor): un envío en cola jamás se borra de
    // la caché local por sobrescritura.
    try {
      const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
      const existing = Array.isArray(raw)
        ? raw.filter((r) => !batch.some((b) => b.id === r.id))
        : [];
      const merged = [...existing, ...batch];
      merged.sort((a, b) => {
        const ta = a.rawCreatedAt || a.timestamp || "";
        const tb = b.rawCreatedAt || b.timestamp || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      await setItem(`${CACHE_PREFIX}${chatId}`, merged.slice(-MAX_CACHED));
    } catch (e) {
      logger.warn("[MessageRepo] saveMessages cache error", { error: e });
    }
  }

  async upsertMessage(chatId: string, message: Message, ownerUserId?: string): Promise<void> {
    if (isEphemeralMessageExpired(message)) return;

    if (db.ready) {
      try {
        const msgWithOwner = ownerUserId ? { ...message, owner_user_id: ownerUserId } : message;
        await db.executeSet([
          {
            statement: INSERT_SQL,
            values: rowValues(msgWithOwner, chatId),
          },
        ]);
      } catch (e) {
        logger.warn("[MessageRepo] upsert SQLite error, fallback", { error: e });
      }
    }
    // Fallback local (idb): aunque SQLite no esté listo o la app se cierre
    // justo después de enviar, el mensaje no confirmado queda persistido y
    // visible al reabrir (envío en cola estilo WhatsApp).
    const msgForCache = ownerUserId ? { ...message, owner_user_id: ownerUserId } : message;
    await this.upsertLocal(chatId, msgForCache);
  }

  private async upsertLocal(chatId: string, message: Message): Promise<void> {
    try {
      const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
      const list = Array.isArray(raw) ? raw : [];
      const idx = list.findIndex((r) => r.id === message.id);
      if (idx !== -1) list[idx] = message;
      else list.push(message);
      list.sort((a, b) => {
        const ta = a.rawCreatedAt || a.timestamp || "";
        const tb = b.rawCreatedAt || b.timestamp || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      await setItem(`${CACHE_PREFIX}${chatId}`, list.slice(-MAX_CACHED));
    } catch (e) {
      logger.warn("[MessageRepo] upsert cache error", { error: e });
    }
  }

  /**
   * Re-inyecta sender_id/client_id a los mensajes del lote que los hayan perdido
   * (el estado React no los incluye), leyendo las filas pendientes ya guardadas
   * en SQLite. Evita que un INSERT OR REPLACE borre el DTO de un envío en cola.
   */
  private async mergePendingMetadata(chatId: string, batch: Message[]): Promise<void> {
    const tempIds = batch
      .filter((m) => m.id && (!m.sender_id || !m.clientId))
      .map((m) => m.id as string);
    if (tempIds.length === 0) return;
    try {
      const rows = await db.query(
        `SELECT id, sender_id, client_id FROM messages WHERE chat_id = ? AND id IN (${tempIds.map(() => "?").join(",")})`,
        [chatId, ...tempIds]
      );
      const meta = new Map(rows.map((r) => [r.id, r]));
      for (const m of batch) {
        if (!m.id) continue;
        const row = meta.get(m.id);
        if (!row) continue;
        if (!m.sender_id && row.sender_id) m.sender_id = row.sender_id as string;
        if (!m.clientId && row.client_id) {
          m.clientId = row.client_id as string;
          m.client_id = row.client_id as string;
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] mergePendingMetadata error", { error: e });
    }
  }

  /**
   * Restaura client_id/sender_id en el lote leyendo la caché idb (última fuente
   * con metadatos, independiente de SQLite). Sin esto, saveMessages sobreescribía
   * la fila de un envío en cola con una copia del estado React SIN client_id.
   */
  private async restoreMetadataFromCache(chatId: string, batch: Message[]): Promise<void> {
    const missing = batch.filter((m) => m.id && (!m.clientId || !m.sender_id));
    if (missing.length === 0) return;
    try {
      const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
      if (!Array.isArray(raw)) return;
      const byId = new Map<string, Message>();
      for (const c of raw) {
        if (c && c.id) byId.set(c.id, c);
      }
      for (const m of missing) {
        const cached = m.id ? byId.get(m.id) : undefined;
        if (!cached) continue;
        if (!m.sender_id && cached.sender_id) m.sender_id = cached.sender_id;
        if (!m.clientId && cached.clientId) {
          m.clientId = cached.clientId;
          m.client_id = cached.client_id;
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] restoreMetadataFromCache error", { error: e });
    }
  }

  /**
   * Auto-reparación idempotente: mensajes pendientes SIN sender_id que quedaron
   * atascados (builds previos que guardaban sin él) y ya no son elegibles para
   * sendSingle. Se les asigna el sender_id del usuario actual SOLO si son
   * salientes (sender='me'), pendientes (synced=0) y propiedad de esta cuenta.
   * Nunca toca mensajes recibidos ('other'), ya sincronizados ni contenido.
   */
  private async repairMissingSenderId(ownerUserId: string): Promise<void> {
    // Caché idb: es la fuente que usa getAllUnsynced cuando SQLite no está
    // listo (el caso del dispositivo con el relojito eterno).
    try {
      const cacheKeys = await getKeys();
      for (const key of cacheKeys) {
        if (typeof key !== "string" || !key.startsWith(CACHE_PREFIX)) continue;
        const raw = await getItem<Message[]>(key);
        if (!Array.isArray(raw)) continue;
        let changed = false;
        for (const m of raw) {
          if (m && m.synced === false && m.sender === "me" && !m.sender_id) {
            m.sender_id = ownerUserId;
            (m as any).owner_user_id = ownerUserId;
            changed = true;
          }
        }
        if (changed) await setItem(key, raw);
      }
    } catch (e) {
      logger.warn("[MessageRepo] auto-repair idb error", { error: e });
    }
    // SQLite: solo si el esquema lo permite. Fallo de catch = esquema viejo sin
    // owner_user_id (el dispositivo usa la red de idb) → se ignora.
    if (db.ready) {
      try {
        await db.run(
          `UPDATE messages SET sender_id = ?, owner_user_id = ?
           WHERE synced = 0 AND sender = 'me'
             AND (sender_id IS NULL OR sender_id = '')
             AND (owner_user_id IS NULL OR owner_user_id = '')`,
          [ownerUserId, ownerUserId]
        );
      } catch (e) {
        logger.warn("[MessageRepo] auto-repair sqlite error", { error: e });
      }
    }
  }

  async getAllUnsynced(ownerUserId?: string): Promise<{ chatId: string; message: Message }[]> {
    if (ownerUserId) {
      await this.repairMissingSenderId(ownerUserId);
    }
    let fromSqlite: { chatId: string; message: Message }[] | null = null;
    if (db.ready) {
      try {
        const query = ownerUserId
          ? "SELECT * FROM messages WHERE synced = 0 AND owner_user_id = ? ORDER BY raw_created_at ASC"
          : "SELECT * FROM messages WHERE synced = 0 ORDER BY raw_created_at ASC";
        const params = ownerUserId ? [ownerUserId] : [];
        const rows = await db.query(query, params);
        fromSqlite = rows.map((r) => ({
          chatId: (r.chat_id as string) || "",
          message: fromRow(r),
        })).filter((item): item is { chatId: string; message: Message } => item.message !== null);
      } catch (e) {
        logger.warn("[MessageRepo] getAllUnsynced SQLite error", { error: e });
      }
    }

    // One-time cleanup: mark legacy messages without owner_user_id as synced
    // so they don't block the queue forever. These are messages from before the
    // owner_user_id field was added — they can't be sent safely.
    if (db.ready && ownerUserId && !legacyCleanupDone) {
      legacyCleanupDone = true;
      try {
        await db.run(
          "UPDATE messages SET synced = 1 WHERE synced = 0 AND (owner_user_id IS NULL OR owner_user_id = '')"
        );
      } catch { /* ignore */ }
    }
    // Barrer los cachés locales (idb) buscando synced = false. Es la red de
    // seguridad: si el temp solo llegó a idb (SQLite no listo al enviar), el
    // flush igual lo sube al recuperar la señal. Dedupe por id contra SQLite.
    const fromIdb: { chatId: string; message: Message }[] = [];
    try {
      const cacheKeys = await getKeys();
      for (const key of cacheKeys) {
        if (typeof key !== "string" || !key.startsWith(CACHE_PREFIX)) continue;
        const raw = await getItem<Message[]>(key);
        if (!Array.isArray(raw)) continue;
        for (const m of raw) {
          if (m && m.synced === false) {
            if (ownerUserId && (m as any).owner_user_id && (m as any).owner_user_id !== ownerUserId) continue;
            fromIdb.push({ chatId: key.slice(CACHE_PREFIX.length), message: m });
          }
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] getAllUnsynced fallback error", { error: e });
    }

    if (fromSqlite !== null) {
      const seen = new Set(fromSqlite.map((r) => r.message.id));
      for (const item of fromIdb) {
        if (!seen.has(item.message.id)) {
          fromSqlite.push(item);
        }
      }
      return fromSqlite;
    }
    return fromIdb;
  }

  async markSynced(msgId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("UPDATE messages SET synced = 1 WHERE id = ?", [msgId]);
        return;
      } catch (e) {
        logger.warn("[MessageRepo] markSynced error", { error: e });
      }
    }
  }

  // ─── Audio blob persistence for offline voice note retries ─────────
  private static AUDIO_BLOB_PREFIX = "redon_audio_";

  async saveAudioBlob(msgId: string, blob: Blob): Promise<void> {
    try {
      await setItem(`${MessageRepository.AUDIO_BLOB_PREFIX}${msgId}`, blob);
    } catch (e) {
      logger.warn("[MessageRepo] saveAudioBlob error", { error: e });
    }
  }

  async getAudioBlob(msgId: string): Promise<Blob | null> {
    try {
      return await getItem<Blob>(`${MessageRepository.AUDIO_BLOB_PREFIX}${msgId}`) ?? null;
    } catch (e) {
      logger.warn("[MessageRepo] getAudioBlob error", { error: e });
      return null;
    }
  }

  async deleteAudioBlob(msgId: string): Promise<void> {
    try {
      await removeItem(`${MessageRepository.AUDIO_BLOB_PREFIX}${msgId}`);
    } catch (e) {
      logger.warn("[MessageRepo] deleteAudioBlob error", { error: e });
    }
  }

  /**
   * Espera a que SQLite esté listo (si no lo está) con un tope acotado. Evita
   * la carrera de "la BD aún no arrancó al confirmar el envío".
   */
  private async waitForDbReady(maxMs = 8000): Promise<boolean> {
    if (db.ready) return true;
    await db.whenReady(maxMs);
    return db.ready;
  }

  /**
   * Sustitución tempId -> savedId en SQLite, atómica e idempotente:
   * - Captura el rowid de la fila temp ANTES del UPDATE; tras mover a savedId
   *   borra cualquier gemela (eco previo / delta de caché) conservando la fila
   *   recién reconciliada, no la más vieja.
   * - Sí la fila temp ya no existe (instancia ya reconciliada), solo deduplica
   *   gemelas de savedId. Ejecutarla N veces es seguro (idempotente).
   * - Reintenta ante fallos transitorios (carrera de escrituras / busy).
   * - NO calles errores técnicos: si tras los reintentos falla, lanza para que
   *   el llamador (que hace .catch y log) lo vea.
   */
  private async reconcileSqlite(chatId: string, tempId: string, saved: Message): Promise<void> {
    const row = toRow(saved, chatId);
    const cols = INSERT_COLS.filter((c) => c !== "id");
    const values = cols.map((c) => row[c]);
    const UPDATE_SQL = `UPDATE messages SET id = ?, ${cols.map((c) => `${c} = ?`).join(", ")} WHERE chat_id = ? AND id = ?`;
    const DEDUPE_SQL =
      "DELETE FROM messages WHERE chat_id = ? AND id = ? AND rowid NOT IN (SELECT MIN(rowid) FROM messages WHERE chat_id = ? AND id = ?)";
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const found = await db.query(
          "SELECT rowid FROM messages WHERE chat_id = ? AND id = ? LIMIT 1",
          [chatId, tempId]
        );
        const movedRowid = found.length > 0 && found[0].rowid != null ? Number(found[0].rowid) : null;
        const ok = await db.run(UPDATE_SQL, [saved.id, ...values, chatId, tempId]);
        if (!ok) throw new Error(`reconcileTemp UPDATE falló (intento ${attempt}/3)`);
        const dedupeOk = movedRowid !== null
          ? await db.run("DELETE FROM messages WHERE chat_id = ? AND id = ? AND rowid != ?", [chatId, saved.id, movedRowid])
          : await db.run(DEDUPE_SQL, [chatId, saved.id, chatId, saved.id]);
        if (!dedupeOk) throw new Error("reconcileTemp dedupe falló");
        return;
      } catch (e) {
        lastError = e;
        logger.warn("[MessageRepo] reconcileSqlite intento fallido", { attempt, error: e });
        if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    throw lastError;
  }

  /**
   * Refleja la reconciliación en la caché idb eliminando la temp y dejando UNA
   * sola entrada canónica (dedupe por id dentro de la caché).
   */
  private async reconcileCache(chatId: string, tempId: string, saved: Message): Promise<void> {
    const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
    if (!Array.isArray(raw)) return;
    const next = raw.filter((r) => r.id !== tempId && r.id !== saved.id);
    next.push(saved);
    next.sort((a, b) => {
      const ta = a.rawCreatedAt || a.timestamp || "";
      const tb = b.rawCreatedAt || b.timestamp || "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    await setItem(`${CACHE_PREFIX}${chatId}`, next.slice(-MAX_CACHED));
  }

  /**
   * SUSTITUCIÓN ATÓMICA DE ID: reemplaza en el MISMO STATEMENT el tempId por el
   * savedId de Supabase (estado sent, synced = 1). Cualquier re-lectura de SQLite
   * a partir de entonces devuelve el id REAL y sent, sin ventana donde el registro
   * "retroceda" a tempId/synced=false. Se elimina además cualquier fila gemela
   * (un eco previo pudo insertar el savedId mientras el temp aún existía).
   *
   * La caché idb SIEMPRE se reconcilia aunque SQLite falle (es la red de fallback).
   * El SQLite guarda su fallo técnico hasta el final: si tras reintentos sigue
   * fallando, se lanza para visibilidad real (los llamadores hacen .catch + log).
   */
  async reconcileTemp(chatId: string, tempId: string, saved: Message): Promise<void> {
    const ready = await this.waitForDbReady();
    let sqliteError: unknown = null;
    if (ready) {
      try {
        await this.reconcileSqlite(chatId, tempId, saved);
      } catch (e) {
        sqliteError = e;
        logger.warn("[MessageRepo] reconcileTemp SQLite falló tras reintentos", {
          error: e,
          chatId,
          tempId,
          savedId: saved.id,
        });
      }
    } else {
      logger.warn("[MessageRepo] reconcileTemp sin SQLite listo (solo caché)", { chatId, tempId });
    }
    try {
      await this.reconcileCache(chatId, tempId, saved);
    } catch (e) {
      logger.warn("[MessageRepo] reconcileTemp cache error", { error: e });
    }
    // Si el usuario editó el mensaje mientras su envío seguía en curso (temp sin
    // reconciliar), aplicar el edit pendiente sobre la fila ya confirmada.
    await this.consumePendingEdit(chatId, tempId, saved);
    if (sqliteError) throw sqliteError;
  }

  private isPendingTemp(m: Message): boolean {
    if (m.synced !== false) return false;
    if (m.sender !== "me") return false;
    const id = m.id;
    return !!id && (id.startsWith("temp_") || id.startsWith("msg_"));
  }

  /**
   * Barrido de huérfanas al REABRIR el chat, ANTES del primer pintado local.
   * Solo se reconcilia/elimina una temp pendiente cuando existe evidencia de
   * confirmación:
   *   - una fila confirmada que referencia este temp (clientTempId/temp_id), o
   *   - el mapa tempId->savedId resolvió a una fila confirmada presente, o
   *   - el mapa tempId->savedId registrado (POST confirmado) sin twin local ->
   *     se CONVIERTE la temp en la identidad canónica (id=savedId, synced=true).
   * Los pendientes legítimos sin evidencia se conservan intactos.
   * Devuelve la lista canónica (mismo resultado consistente que getMessages).
   */
  async reconcileResolvedOrphans(chatId: string): Promise<Message[]> {
    if (!db.ready) await db.whenReady(1500);

    try {
      let sqlite: Message[] = [];
      if (db.ready) {
        try {
          const rows = await db.query("SELECT * FROM messages WHERE chat_id = ?", [chatId]);
          sqlite = rows.map(fromRow).filter((m): m is Message => m !== null);
        } catch (e) {
          logger.warn("[MessageRepo] reconcileResolvedOrphans sqlite read error", { error: e });
        }
      }
      let cache: Message[] = [];
      try {
        const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
        cache = Array.isArray(raw) ? raw : [];
      } catch (e) {
        logger.warn("[MessageRepo] reconcileResolvedOrphans cache read error", { error: e });
      }
      // Evidencia combinada (SQLite + idb) sin duplicados por id (prioridad SQLite).
      const byId = new Map<string, Message>();
      for (const m of [...sqlite, ...cache]) {
        if (m && m.id && !byId.has(m.id)) byId.set(m.id, m);
      }
      const all = Array.from(byId.values());

      for (const temp of all) {
        if (!this.isPendingTemp(temp)) continue;
        const savedId = getReconciledSavedId(chatId, temp.id as string);
        const twin = all.find(
          (x) =>
            x.id !== temp.id &&
            ((savedId && x.id === savedId) || x.clientTempId === temp.id)
        );
        const confirmedTwin = twin && twin.synced !== false ? twin : undefined;
        if (confirmedTwin) {
          // Evidencia inequívoca: la temp ya corresponde a una fila confirmada.
          await this.deleteMessage(chatId, temp.id as string);
          if (db.ready) await this.upsertMessage(chatId, confirmedTwin);
        } else if (savedId) {
          // POST confirmado (mapa tempId->savedId) sin twin local: convertir la
          // fila pendiente en la identidad canónica (idempotente).
          const canonical: Message = { ...temp, id: savedId, status: "sent" as const, synced: true };
          try {
            await this.reconcileTemp(chatId, temp.id as string, canonical);
          } catch (e) {
            logger.warn("[MessageRepo] reconcileResolvedOrphans convert error", { error: e, tempId: temp.id });
          }
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] reconcileResolvedOrphans error", { error: e });
    }

    return this.getMessages(chatId);
  }

  /**
   * Encola un edit de texto para un mensaje que aún no tiene id real (temp en
   * cola de envío). Se aplica automáticamente en reconcileTemp cuando el temp
   * se confirma, tanto localmente como en el servidor.
   */
  async registerPendingEdit(chatId: string, tempId: string, newText: string): Promise<void> {
    try {
      const list = await getPendingEdits();
      if (!list.some((e) => e.chatId === chatId && e.tempId === tempId)) {
        list.push({ chatId, tempId, newText });
        await setItem(PENDING_EDIT_KEY, list);
      }
    } catch (e) {
      logger.warn("[MessageRepo] registerPendingEdit error", { error: e });
    }
  }

  /**
   * Aplica (y descarta) el edit pendiente de un temp recién reconciliado:
   * reescribe text/edited en la fila confirmada (SQLite + idb) y dispara el
   * edit en el servidor para que el destinatario también vea el texto corregido.
   */
  private async consumePendingEdit(chatId: string, tempId: string, saved: Message): Promise<void> {
    let newText: string | undefined;
    try {
      const list = await getPendingEdits();
      const idx = list.findIndex((e) => e.chatId === chatId && e.tempId === tempId);
      if (idx === -1) return;
      newText = list[idx].newText;
      list.splice(idx, 1);
      await setItem(PENDING_EDIT_KEY, list);
    } catch (e) {
      logger.warn("[MessageRepo] consumePendingEdit read error", { error: e });
      return;
    }
    if (!newText || !saved?.id) return;
    const edited: Message = { ...saved, text: newText, edited: true };
    await this.upsertMessage(chatId, edited);
    try {
      await apiEditMessage(saved.id, newText);
    } catch (e) {
      logger.warn("[MessageRepo] consumePendingEdit server error", { error: e });
    }
  }

  async deleteMessage(chatId: string, msgId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("DELETE FROM messages WHERE chat_id = ? AND id = ?", [chatId, msgId]);
      } catch (e) {
        logger.warn("[MessageRepo] deleteMessage error", { error: e });
      }
    }
    try {
      const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
      if (raw && raw.length > 0) {
        const next = raw.filter((r) => r.id !== msgId);
        if (next.length !== raw.length) {
          await setItem(`${CACHE_PREFIX}${chatId}`, next);
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] deleteMessage cache error", { error: e });
    }
  }

  async clearMessages(chatId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("DELETE FROM messages WHERE chat_id = ?", [chatId]);
        return;
      } catch (e) {
        logger.warn("[MessageRepo] clear SQLite error, fallback", { error: e });
      }
    }
    await removeItem(`${CACHE_PREFIX}${chatId}`);
  }

  async getLocalClearedAt(chatId: string): Promise<string | undefined> {
    try {
      const val = await getItem<string>(CLEARED_PREFIX + chatId);
      return typeof val === "string" && val.length > 0 ? val : undefined;
    } catch {
      return undefined;
    }
  }

  async setLocalClearedAt(chatId: string, clearedAt: string | undefined): Promise<void> {
    try {
      if (clearedAt) {
        await setItem(CLEARED_PREFIX + chatId, clearedAt);
      } else {
        await removeItem(CLEARED_PREFIX + chatId);
      }
    } catch {
      // Best effort: sin frontera local el historial simplemente se muestra completo.
    }
  }
}

export const messageRepo = new MessageRepository();

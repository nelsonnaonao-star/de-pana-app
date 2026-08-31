import { db } from "../DatabaseService";
import { getItem, setItem, removeItem, getKeys } from "../../storageService";
import type { Message } from "../../../types";
import { logger } from "../../../lib/logger";
import { editMessage as apiEditMessage } from "../../messages";

const CACHE_PREFIX = "redon_cache_msgs_";
const MAX_CACHED = 200;

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
  "reply_to_sender","price","poster_url","local_video_url","chat_id","sender_id","client_id","payload",
];

const INSERT_PLACEHOLDERS = INSERT_COLS.map(() => "?").join(",");
const INSERT_SQL = `INSERT OR REPLACE INTO messages (${INSERT_COLS.join(",")}) VALUES (${INSERT_PLACEHOLDERS})`;

function rowValues(msg: Message, chatId: string): unknown[] {
  const row = toRow(msg, chatId);
  return INSERT_COLS.map((c) => row[c]);
}

export class MessageRepository {
  async getMessages(chatId: string): Promise<Message[]> {
    let sqliteRows: Message[] | null = null;
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM messages WHERE chat_id = ? ORDER BY raw_created_at ASC",
          [chatId]
        );
        sqliteRows = rows.map(fromRow).filter((m): m is Message => m !== null);
      } catch (e) {
        logger.warn("[MessageRepo] SQLite error, fallback", { error: e });
      }
    }
    // Caché local (idb): fuente secundaria SIEMPRE escrita por upsertMessage.
    // SQLite puede no tener los pendientes si no estaba listo al enviar (o si
    // executeSet falló de forma transitoria). Fusionar garantiza que un mensaje
    // local/pendiente jamás desaparezca al reabrir la app.
    const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
    const cache = Array.isArray(raw) ? raw : [];
    if (sqliteRows !== null) {
      const seen = new Set(sqliteRows.map((m) => m.id));
      const pendientes = cache.filter(
        (m) =>
          !seen.has(m.id) &&
          (m.synced === false ||
            m.status === "sending" ||
            m.status === "error")
      );
      const merged = [...sqliteRows, ...pendientes];
      merged.sort((a, b) => {
        const ta = a.rawCreatedAt || a.timestamp || "";
        const tb = b.rawCreatedAt || b.timestamp || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      return merged;
    }
    return cache;
  }

  async saveMessages(chatId: string, messages: Message[]): Promise<void> {
    // Persistir también mensajes pendientes/optimistas (temp/msg) para que un
    // mensaje no confirmado siga visible al salir y volver a entrar al chat.
    const batch = messages.slice(-MAX_CACHED);
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

  async upsertMessage(chatId: string, message: Message): Promise<void> {
    if (db.ready) {
      try {
        await db.executeSet([
          {
            statement: INSERT_SQL,
            values: rowValues(message, chatId),
          },
        ]);
      } catch (e) {
        logger.warn("[MessageRepo] upsert SQLite error, fallback", { error: e });
      }
    }
    // Fallback local (idb): aunque SQLite no esté listo o la app se cierre
    // justo después de enviar, el mensaje no confirmado queda persistido y
    // visible al reabrir (envío en cola estilo WhatsApp).
    await this.upsertLocal(chatId, message);
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

  async getAllUnsynced(): Promise<{ chatId: string; message: Message }[]> {
    let fromSqlite: { chatId: string; message: Message }[] | null = null;
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM messages WHERE synced = 0 ORDER BY raw_created_at ASC"
        );
        fromSqlite = rows.map((r) => ({
          chatId: (r.chat_id as string) || "",
          message: fromRow(r),
        })).filter((item): item is { chatId: string; message: Message } => item.message !== null);
      } catch (e) {
        logger.warn("[MessageRepo] getAllUnsynced SQLite error", { error: e });
      }
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

  /**
   * SUSTITUCIÓN ATÓMICA DE ID: reemplaza en el MISMO STATEMENT el tempId por el
   * savedId de Supabase (estado sent, synced = 1). Cualquier re-lectura de SQLite
   * a partir de entonces devuelve el id REAL y sent, sin ventana donde el registro
   * "retroceda" a tempId/synced=false. Se elimina además cualquier fila gemela
   * (un eco previo pudo insertar el savedId mientras el temp aún existía).
   */
  async reconcileTemp(chatId: string, tempId: string, saved: Message): Promise<void> {
    // NUNCA debe rechazar ni bloquear al llamador (si el UPDATE falla, la UI ya se
    // marcó sent vía React; SQLite converge con la siguiente escritura/lectura).
    if (db.ready) {
      try {
        const row = toRow(saved, chatId);
        const cols = INSERT_COLS.filter((c) => c !== "id").map((c) => `${c} = ?`);
        const values = INSERT_COLS.filter((c) => c !== "id").map((c) => row[c]);
        await db.run(
          `UPDATE messages SET id = ?, ${cols.join(", ")} WHERE chat_id = ? AND id = ?`,
          [saved.id, ...values, chatId, tempId]
        );
      } catch (e) {
        logger.warn("[MessageRepo] reconcileTemp UPDATE error", { error: e });
      }
      // Dedupe de filas gemelas: si Realtime ya insertó el savedId mientras el
      // temp existía, se conserva UNA sola fila. Si el UPDATE no afectó filas
      // (temp ya favorecido), solo nos aseguramos de no dejar duplicados.
      try {
        await db.run(
          `DELETE FROM messages WHERE id = ? AND chat_id = ? AND rowid NOT IN (SELECT MIN(rowid) FROM messages WHERE id = ? AND chat_id = ?)`,
          [saved.id, chatId, saved.id, chatId]
        );
      } catch (e) {
        logger.warn("[MessageRepo] reconcileTemp dedupe error", { error: e });
      }
    }
    try {
      const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
      if (raw && raw.length > 0) {
        const idx = raw.findIndex((r) => r.id === tempId);
        if (idx !== -1) {
          raw[idx] = saved;
          await setItem(`${CACHE_PREFIX}${chatId}`, raw);
        } else {
          await setItem(`${CACHE_PREFIX}${chatId}`, raw.filter((r) => r.id !== tempId));
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] reconcileTemp cache error", { error: e });
    }
    // Si el usuario editó el mensaje mientras su envío seguía en curso (temp sin
    // reconciliar), aplicar el edit pendiente sobre la fila ya confirmada.
    await this.consumePendingEdit(chatId, tempId, saved);
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
}

export const messageRepo = new MessageRepository();

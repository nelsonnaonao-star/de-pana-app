import { db } from "../DatabaseService";
import { getItem, setItem, removeItem, getKeys } from "../../storageService";
import type { Message } from "../../../types";
import { logger } from "../../../lib/logger";

const CACHE_PREFIX = "redon_cache_msgs_";
const MAX_CACHED = 200;

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
    payload: JSON.stringify(msg),
  };
}

function fromRow(row: Record<string, unknown>): Message {
  if (row.payload && typeof row.payload === "string") {
    try {
      const parsed = JSON.parse(row.payload) as Message;
      return parsed;
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
  "reply_to_sender","price","poster_url","local_video_url","chat_id","payload",
];

const INSERT_PLACEHOLDERS = INSERT_COLS.map(() => "?").join(",");
const INSERT_SQL = `INSERT OR REPLACE INTO messages (${INSERT_COLS.join(",")}) VALUES (${INSERT_PLACEHOLDERS})`;

function rowValues(msg: Message, chatId: string): unknown[] {
  const row = toRow(msg, chatId);
  return INSERT_COLS.map((c) => row[c]);
}

export class MessageRepository {
  async getMessages(chatId: string): Promise<Message[]> {
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM messages WHERE chat_id = ? ORDER BY raw_created_at ASC",
          [chatId]
        );
        return rows.map(fromRow);
      } catch (e) {
        logger.warn("[MessageRepo] SQLite error, fallback", { error: e });
      }
    }
    const raw = await getItem<Message[]>(`${CACHE_PREFIX}${chatId}`);
    return raw || [];
  }

  async saveMessages(chatId: string, messages: Message[]): Promise<void> {
    // Persistir también mensajes pendientes/optimistas (temp/msg) para que un
    // mensaje no confirmado siga visible al salir y volver a entrar al chat.
    const batch = messages.slice(-MAX_CACHED);
    if (batch.length === 0) return;

    if (db.ready) {
      try {
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

  async getAllUnsynced(): Promise<{ chatId: string; message: Message }[]> {
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM messages WHERE synced = 0 ORDER BY raw_created_at ASC"
        );
        return rows.map((r) => ({
          chatId: (r.chat_id as string) || "",
          message: fromRow(r),
        }));
      } catch (e) {
        logger.warn("[MessageRepo] getAllUnsynced SQLite error", { error: e });
      }
    }
    // Fallback sin SQLite: barrer los cachés locales (idb) buscando synced = false.
    const unsynced: { chatId: string; message: Message }[] = [];
    try {
      const cacheKeys = await getKeys();
      for (const key of cacheKeys) {
        if (typeof key !== "string" || !key.startsWith(CACHE_PREFIX)) continue;
        const raw = await getItem<Message[]>(key);
        if (!Array.isArray(raw)) continue;
        for (const m of raw) {
          if (m && m.synced === false) {
            unsynced.push({ chatId: key.slice(CACHE_PREFIX.length), message: m });
          }
        }
      }
    } catch (e) {
      logger.warn("[MessageRepo] getAllUnsynced fallback error", { error: e });
    }
    return unsynced;
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

import { db } from "../DatabaseService";
import { getItem, setItem, removeItem } from "../../storageService";
import type { Message } from "../../../types";

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
    } catch {}
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
        console.warn("[MessageRepo] SQLite error, fallback", e);
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
        console.warn("[MessageRepo] SQLite error, fallback", e);
      }
    }
    await setItem(`${CACHE_PREFIX}${chatId}`, batch);
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
        console.warn("[MessageRepo] upsert SQLite error, fallback", e);
      }
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
        console.warn("[MessageRepo] getAllUnsynced SQLite error", e);
      }
    }
    return [];
  }

  async markSynced(msgId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("UPDATE messages SET synced = 1 WHERE id = ?", [msgId]);
        return;
      } catch (e) {
        console.warn("[MessageRepo] markSynced error", e);
      }
    }
  }

  async deleteMessage(chatId: string, msgId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("DELETE FROM messages WHERE chat_id = ? AND id = ?", [chatId, msgId]);
      } catch (e) {
        console.warn("[MessageRepo] deleteMessage error", e);
      }
    }
  }

  async clearMessages(chatId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("DELETE FROM messages WHERE chat_id = ?", [chatId]);
        return;
      } catch (e) {
        console.warn("[MessageRepo] clear SQLite error, fallback", e);
      }
    }
    await removeItem(`${CACHE_PREFIX}${chatId}`);
  }
}

export const messageRepo = new MessageRepository();

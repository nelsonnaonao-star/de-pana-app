import { db } from "../DatabaseService";
import type { Chat } from "../../../services/chats";

const LOCALSTORAGE_PREFIX = "redon_cache_chats_";

function toRow(chat: Chat, userId: string): Record<string, unknown> {
  return {
    id: chat.id,
    user_id: userId,
    name: chat.name,
    is_group: chat.is_group ? 1 : 0,
    avatar: chat.avatar || null,
    avatar_color: chat.avatar_color || null,
    last_message: chat.last_message || null,
    last_message_time: chat.last_message_time || null,
    unread_count: chat.unread_count ?? 0,
    is_online: chat.is_online ? 1 : 0,
    phone: chat.phone || null,
    username: chat.username || null,
    bio: chat.bio || null,
    profile_id: chat.profile_id || null,
    admin_id: chat.admin_id || null,
    partner_user_id: null,
    last_message_time_raw: null,
    updated_at: chat.updated_at || null,
    payload: JSON.stringify(chat),
  };
}

function fromRow(row: Record<string, unknown>): Chat {
  if (row.payload && typeof row.payload === "string") {
    try {
      return JSON.parse(row.payload) as Chat;
    } catch {}
  }
  return {
    id: row.id as string,
    name: row.name as string,
    is_group: row.is_group === 1,
    avatar: (row.avatar as string) || undefined,
    avatar_color: (row.avatar_color as string) || undefined,
    last_message: (row.last_message as string) || undefined,
    last_message_time: (row.last_message_time as string) || undefined,
    unread_count: (row.unread_count as number) ?? 0,
    is_online: row.is_online === 1,
    phone: (row.phone as string) || undefined,
    username: (row.username as string) || undefined,
    bio: (row.bio as string) || undefined,
    profile_id: (row.profile_id as string) || undefined,
    admin_id: (row.admin_id as string) || undefined,
    updated_at: (row.updated_at as string) || "",
    created_at: (row.created_at as string) || "",
  };
}

const INSERT_COLS = [
  "id","user_id","name","is_group","avatar","avatar_color",
  "last_message","last_message_time","unread_count","is_online",
  "phone","username","bio","profile_id","admin_id",
  "partner_user_id","last_message_time_raw","updated_at","payload",
];

const INSERT_PLACEHOLDERS = INSERT_COLS.map(() => "?").join(",");
const INSERT_SQL = `INSERT OR REPLACE INTO chats (${INSERT_COLS.join(",")}) VALUES (${INSERT_PLACEHOLDERS})`;

function rowValues(chat: Chat, userId: string): unknown[] {
  const row = toRow(chat, userId);
  return INSERT_COLS.map((c) => row[c]);
}

export class ChatRepository {
  async getChats(userId: string): Promise<Chat[]> {
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC, last_message_time DESC",
          [userId]
        );
        return rows.map(fromRow);
      } catch (e) {
        console.warn("[ChatRepo] SQLite error, fallback", e);
      }
    }
    try {
      const stored = localStorage.getItem(`${LOCALSTORAGE_PREFIX}${userId}`);
      if (stored) return JSON.parse(stored) as Chat[];
    } catch {}
    return [];
  }

  async saveChats(userId: string, chats: Chat[]): Promise<void> {
    if (db.ready) {
      try {
        const set = [
          {
            statement: "DELETE FROM chats WHERE user_id = ?",
            values: [userId],
          },
          ...chats.map((chat) => ({
            statement: INSERT_SQL,
            values: rowValues(chat, userId),
          })),
        ];
        await db.executeSet(set);
      } catch (e) {
        console.warn("[ChatRepo] save SQLite error, fallback", e);
      }
    }
    try {
      localStorage.setItem(`${LOCALSTORAGE_PREFIX}${userId}`, JSON.stringify(chats));
    } catch {}
  }

  async upsertChat(chat: Chat): Promise<void> {
    if (db.ready) {
      try {
        await db.executeSet([
          { statement: INSERT_SQL, values: rowValues(chat, chat.profile_id || chat.admin_id || "") },
        ]);
      } catch (e) {
        console.warn("[ChatRepo] upsert SQLite error, fallback", e);
      }
    }
    const key = `${LOCALSTORAGE_PREFIX}`;
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(key));
      for (const lsKey of keys) {
        const stored = localStorage.getItem(lsKey);
        if (stored) {
          const arr = JSON.parse(stored) as Chat[];
          const idx = arr.findIndex((c) => c.id === chat.id);
          if (idx >= 0) {
            arr[idx] = chat;
            localStorage.setItem(lsKey, JSON.stringify(arr));
            return;
          }
        }
      }
    } catch {}
  }

  async clearChats(userId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("DELETE FROM chats WHERE user_id = ?", [userId]);
        return;
      } catch (e) {
        console.warn("[ChatRepo] clear SQLite error, fallback", e);
      }
    }
    try {
      localStorage.removeItem(`${LOCALSTORAGE_PREFIX}${userId}`);
    } catch {}
  }
}

export const chatRepo = new ChatRepository();

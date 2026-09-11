import { db } from "../DatabaseService";
import type { Chat } from "../../../types";
import { logger } from "../../../lib/logger";

// Almacén local de chats grupales de los que el usuario fue expulsado.
// Permite conservar el chat + historial en solo-lectura incluso después de
// refreshChats() (que sobrescribe la tabla chats solo con lo que devuelve
// get_user_chats, y el expulsado ya no aparece como miembro).
function fromRow(row: Record<string, unknown>): Chat | null {
  if (!row.payload || typeof row.payload !== "string") return null;
  try {
    return JSON.parse(row.payload) as Chat;
  } catch (e) {
    logger.warn("[ExpelledRepo] Failed to parse payload", { error: e });
    return null;
  }
}

export const ExpelledChatRepository = {
  async get(userId: string): Promise<Chat[]> {
    const rows = await db.query(
      `SELECT payload FROM expelled_chats WHERE user_id = ? ORDER BY expelled_at DESC`,
      [userId]
    );
    return rows.map(fromRow).filter((c): c is Chat => c !== null);
  },

  async save(userId: string, chat: Chat): Promise<void> {
    await db.run(
      `INSERT OR REPLACE INTO expelled_chats (id, user_id, payload, expelled_at) VALUES (?, ?, ?, datetime('now'))`,
      [chat.id, userId, JSON.stringify(chat)]
    );
  },

  async remove(userId: string, chatId: string): Promise<void> {
    await db.run(`DELETE FROM expelled_chats WHERE user_id = ? AND id = ?`, [
      userId,
      chatId,
    ]);
  },

  async clear(userId: string): Promise<void> {
    await db.run(`DELETE FROM expelled_chats WHERE user_id = ?`, [userId]);
  },
};
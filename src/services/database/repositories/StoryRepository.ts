import { db } from "../DatabaseService";

interface StoryRow {
  id: string;
  user_id: string;
  type: string;
  content: string;
  caption?: string;
  background?: string;
  created_at?: string;
  profiles_name?: string;
  profiles_avatar_url?: string;
  payload?: string;
}

const SELECT_COLS = [
  "id","user_id","type","content","caption","background",
  "created_at","profiles_name","profiles_avatar_url","payload",
];

const INSERT_SQL = `INSERT OR REPLACE INTO stories (${SELECT_COLS.join(",")}, synced, updated_at) VALUES (${SELECT_COLS.map(() => "?").join(",")}, 1, datetime('now'))`;

function toRow(story: any): unknown[] {
  return SELECT_COLS.map((c) => {
    if (c === "profiles_name") return story.profiles?.name || story.profiles_name || null;
    if (c === "profiles_avatar_url") return story.profiles?.avatar_url || story.profiles_avatar_url || null;
    return story[c] ?? null;
  });
}

function fromRow(row: StoryRow): any {
  if (row.payload) {
    try { return JSON.parse(row.payload); } catch {}
  }
  return {
    ...row,
    profiles: row.profiles_name || row.profiles_avatar_url
      ? { name: row.profiles_name, avatar_url: row.profiles_avatar_url }
      : undefined,
  };
}

export class StoryRepository {
  async getAllStories(): Promise<any[]> {
    if (db.ready) {
      try {
        const rows = await db.query<StoryRow>(
          "SELECT * FROM stories ORDER BY created_at DESC"
        );
        return rows.map(fromRow);
      } catch (e) {
        console.warn("[StoryRepo] SQLite error", e);
      }
    }
    return [];
  }

  async saveStories(stories: any[]): Promise<void> {
    if (!db.ready || stories.length === 0) return;
    try {
      await db.executeSet(
        stories.map((s) => ({
          statement: INSERT_SQL,
          values: toRow(s),
        }))
      );
    } catch (e) {
      console.warn("[StoryRepo] save error", e);
    }
  }

  async clearExpired(): Promise<void> {
    if (!db.ready) return;
    try {
      await db.run(
        "DELETE FROM stories WHERE created_at < datetime('now', '-48 hours')"
      );
    } catch (e) {
      console.warn("[StoryRepo] clearExpired error", e);
    }
  }
}

export const storyRepo = new StoryRepository();

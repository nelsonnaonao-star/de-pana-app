import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { Capacitor } from "@capacitor/core";
import { SCHEMA_SQL } from "./schema";

const DB_NAME = "redon_db";
const DB_VERSION = 1;

class DatabaseService {
  private static instance: DatabaseService;
  private _ready = false;
  private _readyWaiters: (() => void)[] = [];

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  get ready(): boolean {
    return this._ready;
  }

  // Resuelve cuando initialize() terminó (con éxito o fallo). Evita que las
  // lecturas de caché arranquen antes de tiempo y se caigan al fallback vacío.
  whenReady(timeoutMs = 3000): Promise<void> {
    if (this._ready) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this._readyWaiters = this._readyWaiters.filter((w) => w !== waiter);
        resolve();
      }, timeoutMs);
      this._readyWaiters.push(waiter);
    });
  }

  private notifyReady() {
    const waiters = [...this._readyWaiters];
    this._readyWaiters = [];
    for (const w of waiters) w();
  }

  async initialize(): Promise<void> {
    if (this._ready) return;

    try {
      const platform = Capacitor.getPlatform();

      if (platform === "web") {
        await CapacitorSQLite.initWebStore();
      }

      await CapacitorSQLite.createConnection({
        database: DB_NAME,
        version: DB_VERSION,
        encrypted: false,
      });

      await CapacitorSQLite.open({ database: DB_NAME });

      await CapacitorSQLite.execute({
        database: DB_NAME,
        statements: SCHEMA_SQL,
      });

      await this.migrate();

      this._ready = true;
      console.log("[DatabaseService] SQLite initialized");
    } catch (err) {
      console.error("[DatabaseService] initialization failed:", err);
    } finally {
      this.notifyReady();
    }
  }

  async close(): Promise<void> {
    if (!this._ready) return;
    try {
      await CapacitorSQLite.close({ database: DB_NAME });
      await CapacitorSQLite.closeConnection({ database: DB_NAME });
      this._ready = false;
    } catch (err) {
      console.error("[DatabaseService] close error:", err);
    }
  }

  private async migrate(): Promise<void> {
    const migrations = [
      `ALTER TABLE messages ADD COLUMN payload TEXT`,
      `ALTER TABLE messages ADD COLUMN sender_id TEXT`,
      `ALTER TABLE messages ADD COLUMN client_id TEXT`,
      `ALTER TABLE chats ADD COLUMN user_id TEXT`,
      `ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`,
      `ALTER TABLE chats ADD COLUMN avatar_color TEXT`,
      `ALTER TABLE chats ADD COLUMN is_online INTEGER DEFAULT 0`,
      `ALTER TABLE chats ADD COLUMN phone TEXT`,
      `ALTER TABLE chats ADD COLUMN username TEXT`,
      `ALTER TABLE chats ADD COLUMN bio TEXT`,
      `ALTER TABLE chats ADD COLUMN profile_id TEXT`,
      `ALTER TABLE chats ADD COLUMN admin_id TEXT`,
      `ALTER TABLE chats ADD COLUMN payload TEXT`,
      `ALTER TABLE contacts ADD COLUMN user_id TEXT`,
      `ALTER TABLE contacts ADD COLUMN contact_user_id TEXT`,
      `ALTER TABLE contacts ADD COLUMN bio TEXT`,
      `ALTER TABLE contacts ADD COLUMN type TEXT DEFAULT 'human'`,
      `ALTER TABLE contacts ADD COLUMN color_theme TEXT`,
      `ALTER TABLE contacts ADD COLUMN is_group INTEGER DEFAULT 0`,
      `ALTER TABLE contacts ADD COLUMN is_favorite INTEGER DEFAULT 0`,
      `ALTER TABLE contacts ADD COLUMN payload TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(raw_created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_synced ON messages(synced)`,
      `CREATE TABLE IF NOT EXISTS call_rooms (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        participant_count INTEGER DEFAULT 1,
        is_group_call INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_call_rooms_chat_id ON call_rooms(chat_id)`,
    ];
    for (const sql of migrations) {
      try {
        await CapacitorSQLite.execute({ database: DB_NAME, statements: sql });
      } catch {
        // Column already exists – ignore
      }
    }
  }

  async cleanupOldData(): Promise<void> {
    if (!this._ready) return;
    try {
      const result = await CapacitorSQLite.execute({
        database: DB_NAME,
        statements: `DELETE FROM messages WHERE created_at < datetime('now', '-30 days') AND synced = 1`,
      });
      console.log("[DatabaseService] cleanupOldData completed");
    } catch (err) {
      console.warn("[DatabaseService] cleanupOldData error:", err);
    }
  }

  async query<T = Record<string, unknown>>(
    statement: string,
    values?: unknown[]
  ): Promise<T[]> {
    if (!this._ready) return [];
    try {
      const res = await CapacitorSQLite.query({
        database: DB_NAME,
        statement,
        values: values || [],
      });
      return (res.values as T[]) || [];
    } catch (err) {
      console.warn("[DatabaseService] query error:", err);
      return [];
    }
  }

  async execute(statements: string): Promise<void> {
    if (!this._ready) return;
    try {
      await CapacitorSQLite.execute({
        database: DB_NAME,
        statements,
      });
    } catch (err) {
      console.warn("[DatabaseService] execute error:", err);
    }
  }

  async run(statement: string, values?: unknown[]): Promise<void> {
    if (!this._ready) return;
    try {
      await CapacitorSQLite.executeSet({
        database: DB_NAME,
        set: [{ statement, values: values || [] }],
      });
    } catch (err) {
      console.warn("[DatabaseService] run error:", err);
    }
  }

  async executeSet(
    set: { statement: string; values?: unknown[] }[]
  ): Promise<void> {
    if (!this._ready) return;
    try {
      await CapacitorSQLite.executeSet({
        database: DB_NAME,
        set: set.map((s) => ({ statement: s.statement, values: s.values || [] })),
      });
    } catch (err) {
      console.warn("[DatabaseService] executeSet error:", err);
    }
  }
}

export const db = DatabaseService.getInstance();

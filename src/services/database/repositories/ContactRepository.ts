import { db } from "../DatabaseService";
import type { Contact } from "../../../services/contacts";

const LOCALSTORAGE_PREFIX = "redon_cache_contacts_";

function toRow(contact: Contact, userId: string): Record<string, unknown> {
  return {
    id: contact.id,
    user_id: userId,
    contact_user_id: contact.contact_user_id || null,
    name: contact.name,
    phone: contact.phone || null,
    avatar: contact.avatar || null,
    bio: contact.bio || null,
    type: contact.type || "human",
    color_theme: contact.color_theme || null,
    is_group: contact.is_group ? 1 : 0,
    is_favorite: contact.is_favorite ? 1 : 0,
    payload: JSON.stringify(contact),
  };
}

function fromRow(row: Record<string, unknown>): Contact {
  if (row.payload && typeof row.payload === "string") {
    try {
      return JSON.parse(row.payload) as Contact;
    } catch {}
  }
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    contact_user_id: (row.contact_user_id as string) || undefined,
    name: row.name as string,
    phone: (row.phone as string) || undefined,
    avatar: (row.avatar as string) || undefined,
    bio: (row.bio as string) || undefined,
    type: (row.type as "human" | "business") || "human",
    color_theme: (row.color_theme as string) || undefined,
    is_group: row.is_group === 1,
    is_favorite: row.is_favorite === 1,
    created_at: "",
  };
}

const INSERT_COLS = [
  "id","user_id","contact_user_id","name","phone","avatar",
  "bio","type","color_theme","is_group","is_favorite","payload",
];

const INSERT_PLACEHOLDERS = INSERT_COLS.map(() => "?").join(",");
const INSERT_SQL = `INSERT OR REPLACE INTO contacts (${INSERT_COLS.join(",")}) VALUES (${INSERT_PLACEHOLDERS})`;

function rowValues(contact: Contact, userId: string): unknown[] {
  const row = toRow(contact, userId);
  return INSERT_COLS.map((c) => row[c]);
}

export class ContactRepository {
  async getContacts(userId: string): Promise<Contact[]> {
    if (db.ready) {
      try {
        const rows = await db.query(
          "SELECT * FROM contacts WHERE user_id = ? ORDER BY name ASC",
          [userId]
        );
        return rows.map(fromRow);
      } catch (e) {
        console.warn("[ContactRepo] SQLite error, fallback", e);
      }
    }
    try {
      const stored = localStorage.getItem(`${LOCALSTORAGE_PREFIX}${userId}`);
      if (stored) return JSON.parse(stored) as Contact[];
    } catch {}
    return [];
  }

  async saveContacts(userId: string, contacts: Contact[]): Promise<void> {
    if (db.ready) {
      try {
        const set = [
          {
            statement: "DELETE FROM contacts WHERE user_id = ?",
            values: [userId],
          },
          ...contacts.map((contact) => ({
            statement: INSERT_SQL,
            values: rowValues(contact, userId),
          })),
        ];
        await db.executeSet(set);
        return;
      } catch (e) {
        console.warn("[ContactRepo] save SQLite error, fallback", e);
      }
    }
    try {
      localStorage.setItem(
        `${LOCALSTORAGE_PREFIX}${userId}`,
        JSON.stringify(contacts)
      );
    } catch {}
  }

  async upsertContact(contact: Contact): Promise<void> {
    if (db.ready) {
      try {
        await db.executeSet([
          {
            statement: INSERT_SQL,
            values: rowValues(contact, contact.user_id),
          },
        ]);
        return;
      } catch (e) {
        console.warn("[ContactRepo] upsert SQLite error, fallback", e);
      }
    }
    const key = `${LOCALSTORAGE_PREFIX}`;
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(key));
      for (const lsKey of keys) {
        const stored = localStorage.getItem(lsKey);
        if (stored) {
          const arr = JSON.parse(stored) as Contact[];
          const idx = arr.findIndex((c) => c.id === contact.id);
          if (idx >= 0) {
            arr[idx] = contact;
            localStorage.setItem(lsKey, JSON.stringify(arr));
            return;
          }
        }
      }
    } catch {}
  }

  async clearContacts(userId: string): Promise<void> {
    if (db.ready) {
      try {
        await db.run("DELETE FROM contacts WHERE user_id = ?", [userId]);
        return;
      } catch (e) {
        console.warn("[ContactRepo] clear SQLite error, fallback", e);
      }
    }
    try {
      localStorage.removeItem(`${LOCALSTORAGE_PREFIX}${userId}`);
    } catch {}
  }
}

export const contactRepo = new ContactRepository();

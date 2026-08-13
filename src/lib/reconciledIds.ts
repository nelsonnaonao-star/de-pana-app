const KEY = "redon_reconciled_ids_v1";
const MAX_PER_CHAT = 500;
export const MAX_TOTAL = 5000;

type Entry = { chatId: string; tempId: string; savedId: string; ts: number };

let cache: Map<string, Map<string, string>> | null = null;

function load(): Map<string, Map<string, string>> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as Entry[];
      const now = Date.now();
      for (const e of arr) {
        if (now - e.ts > 7 * 24 * 60 * 60 * 1000) continue;
        if (!cache.has(e.chatId)) cache.set(e.chatId, new Map());
        cache.get(e.chatId)!.set(e.tempId, e.savedId);
      }
    }
  } catch {
    /* ignore */
  }
  return cache;
}

function save(): void {
  try {
    const arr: Entry[] = [];
    const m = load();
    for (const [chatId, inner] of m) {
      for (const [tempId, savedId] of inner) {
        arr.push({ chatId, tempId, savedId, ts: Date.now() });
      }
    }
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX_TOTAL)));
  } catch {
    /* ignore */
  }
}

export function recordReconciledId(chatId: string, tempId: string, savedId: string): void {
  const m = load();
  if (!m.has(chatId)) m.set(chatId, new Map());
  m.get(chatId)!.set(tempId, savedId);
  const inner = m.get(chatId)!;
  if (inner.size > MAX_PER_CHAT) {
    const keys = Array.from(inner.keys());
    for (const k of keys.slice(0, inner.size - MAX_PER_CHAT)) inner.delete(k);
  }
  save();
}

export function getReconciledSavedId(chatId: string, tempId: string): string | undefined {
  return load().get(chatId)?.get(tempId);
}
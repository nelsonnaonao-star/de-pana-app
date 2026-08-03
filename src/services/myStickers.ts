const STORAGE_KEY = "my_created_stickers";

export interface MySticker {
  url: string;
  createdAt: number;
}

export function getMyStickers(): MySticker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addMySticker(url: string): MySticker[] {
  const current = getMyStickers();
  const existing = current.some((s) => s.url === url);
  if (existing) return current;
  const next = [...current, { url, createdAt: Date.now() }].slice(-100);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage may be full or unavailable */
  }
  return next;
}

export function removeMySticker(url: string): MySticker[] {
  const next = getMyStickers().filter((s) => s.url !== url);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

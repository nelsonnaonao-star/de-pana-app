const CACHE_NAME = "chat-media-cache";
const blobUrlMap = new Map<string, string>();

import { storageBaseUrl } from "./mediaResolution";

// Identidad ESTABLE del objeto (public base y signed URL normalizan igual),
// para que una signed URL que expira cada 3600s no inutilice la cache.
function cacheKey(url: string): string {
  return storageBaseUrl(url) ?? url;
}

// Dedupe de descargas EN VUELO: si dos mensajes con la misma URL se resuelven a
// la vez (p.ej. GIF/sticker recién enviado en un chat con muchos mensajes), solo
// un fetch/cache.put ocurre; el resto espera la misma promesa y comparte el blob.
const inflightMap = new Map<string, Promise<string>>();

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

async function ensureCacheSize(maxEntries = 100): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    if (requests.length > maxEntries) {
      const toDelete = requests.slice(0, requests.length - maxEntries);
      await Promise.all(toDelete.map(r => cache.delete(r)));
    }
  } catch {
    // Best-effort cleanup
  }
}

export async function getCachedMedia(url: string): Promise<string> {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;

  const key = cacheKey(url);
  const existing = blobUrlMap.get(key);
  if (existing) return existing;

  const inflight = inflightMap.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<string> => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(key);

      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobUrlMap.set(key, blobUrl);
        ensureCacheSize();
        return blobUrl;
      }

      const fetchResponse = await fetchWithTimeout(url, { cache: "force-cache" });
      if (!fetchResponse.ok) return url;

      const cacheClone = fetchResponse.clone();
      cache.put(key, cacheClone);

      const blob = await fetchResponse.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlMap.set(key, blobUrl);
      ensureCacheSize();
      return blobUrl;
    } catch {
      return url;
    } finally {
      inflightMap.delete(key);
    }
  })();

  inflightMap.set(key, promise);
  return promise;
}

export function getCachedMediaSync(url: string): string | null {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return blobUrlMap.get(cacheKey(url)) ?? null;
}

export function revokeCachedMedia(url: string): void {
  const key = cacheKey(url);
  const blobUrl = blobUrlMap.get(key);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrlMap.delete(key);
  }
}

const CACHE_NAME = "chat-media-cache";
const blobUrlMap = new Map<string, string>();

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
  if (!url || url.startsWith("blob:")) return url;

  const existing = blobUrlMap.get(url);
  if (existing) return existing;

  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(url);

    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlMap.set(url, blobUrl);
      ensureCacheSize();
      return blobUrl;
    }

    const fetchResponse = await fetch(url, { cache: "force-cache" });
    if (!fetchResponse.ok) return url;

    const cacheClone = fetchResponse.clone();
    cache.put(url, cacheClone);

    const blob = await fetchResponse.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlMap.set(url, blobUrl);
    ensureCacheSize();
    return blobUrl;
  } catch {
    return url;
  }
}

export function getCachedMediaSync(url: string): string | null {
  if (!url || url.startsWith("blob:")) return url;
  return blobUrlMap.get(url) ?? null;
}

export function revokeCachedMedia(url: string): void {
  const blobUrl = blobUrlMap.get(url);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrlMap.delete(url);
  }
}

// Núcleo PURO del resolutor de media (sin Supabase/red). La obtención real de la
// URL firmada se inyecta como dependencia (`sign`), de modo que la caché, el
// dedupe en vuelo y la expiración son verificables de forma aislada.

import {
  isSignableStorageUrl,
  storageBaseUrl,
} from "./storageRefs";

export interface SignedRequest {
  url: string;
  expiresIn: number;
}

export type SignFn = (
  key: string,
  opts?: { messageId?: string },
) => Promise<SignedRequest>;

interface Entry {
  url: string;
  expiresAt: number;
}

// El server firma por 3600s; margen de seguridad para renovar antes de que
// expire la firma servida a un <img>/<video> ya montado.
const TTL_MARGIN_SECONDS = 300;

export function createMediaResolver(sign: SignFn) {
  // Clave: base URL normalizada = object path (estable, nunca la signed URL).
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<string>>();

  const keyFor = (url: string): string => storageBaseUrl(url) ?? url;

  // Resuelve una referencia canónica propia a una signed URL.
  // - blob:/data: y externos → passthrough (nada que firmar).
  // - Cache por base URL (object path): antiexpiración, sin re-descargas.
  // - Dedupe en vuelo: N referencias a la misma URL comparten una sola petición.
  // - Fallo (401/403/400/500) → lanza; nunca degrada a una URL sin firmar.
  async function resolveMediaUrl(
    url: string,
    opts?: { messageId?: string },
  ): Promise<string> {
    if (!url) return url;
    if (/^(blob:|data:)/i.test(url)) return url;
    if (!isSignableStorageUrl(url)) return url;

    const key = keyFor(url);
    const now = Date.now();

    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.url;

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = (async (): Promise<string> => {
      try {
        const { url: signedUrl, expiresIn } = await sign(key, opts);
        const ttlMs = Math.max(60, Math.min(expiresIn, 3600) - TTL_MARGIN_SECONDS) * 1000;
        cache.set(key, { url: signedUrl, expiresAt: Date.now() + ttlMs });
        return signedUrl;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }

  // Acceso síncrono a la resolución ya cacheada (para render sin await).
  function getResolvedMediaUrlSync(url: string): string | null {
    if (!isSignableStorageUrl(url)) return null;
    const key = keyFor(url);
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    return entry.url;
  }

  function clearResolvedMediaUrl(url: string): void {
    if (!url) return;
    const key = keyFor(url);
    cache.delete(key);
    inflight.delete(key);
  }

  function clearAllResolvedMedia(): void {
    cache.clear();
    inflight.clear();
  }

  return {
    resolveMediaUrl,
    getResolvedMediaUrlSync,
    clearResolvedMediaUrl,
    clearAllResolvedMedia,
  };
}

export type MediaResolver = ReturnType<typeof createMediaResolver>;

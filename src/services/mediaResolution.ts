import { authFetch, apiUrl } from "../lib/api";
import { createMediaResolver } from "./mediaResolver";

// Resolución de media propia (chat-images / chat-media) mediante signed URLs.
//
// CONTRATO:
//   URL canónica almacenada → POST /api/media/signed-url → signed URL
//   (JWT + autorización de membresía en el server) → cache estable por
//   object path (no por la URL firmada, que expira).
//
// El servidor sigue siendo la ÚNICA fuente de verdad para extraer/validar el
// object path. Este módulo sólo detecta pertenencia a un bucket propio para
// decidir "firmar" vs "passthrough", y usa la URL base normalizada como clave
// de cache estable. La clasificación/normalización pura vive en `storageRefs` y
// el núcleo de caché en `mediaResolver`.

export {
  SUPABASE_HOST,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  KNOWN_BUCKETS,
  parseStorageRef,
  parseSignedStorageRef,
  isSignableStorageUrl,
  isStorageSignedUrl,
  isChatImagesUrl,
  isChatImagesSignedUrl,
  storageBaseUrl,
} from "./storageRefs";
export type { StorageRef } from "./storageRefs";

async function requestSignedUrl(
  key: string,
  opts?: { messageId?: string },
): Promise<{ url: string; expiresIn: number }> {
  const messageId = opts?.messageId;
  const response = await authFetch(apiUrl("/api/media/signed-url"), {
    method: "POST",
    body: JSON.stringify(messageId ? { messageId } : { urls: [key] }),
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(`signed-url ${response.status}${body?.error ? `: ${body.error}` : ""}`);
  }

  if (messageId) {
    const chosen = body?.image ?? body?.audio ?? body?.video ?? body?.file;
    if (!chosen) throw new Error("media sin URL firmada");
    return { url: chosen, expiresIn: body?.expiresIn ?? 3600 };
  }

  const chosen = body?.signedUrls?.[key];
  if (!chosen) throw new Error("media sin URL firmada");
  return { url: chosen, expiresIn: body?.expiresIn ?? 3600 };
}

const resolver = createMediaResolver(requestSignedUrl);

export const resolveMediaUrl = resolver.resolveMediaUrl;
export const getResolvedMediaUrlSync = resolver.getResolvedMediaUrlSync;
export const clearResolvedMediaUrl = resolver.clearResolvedMediaUrl;
export const clearAllResolvedMedia = resolver.clearAllResolvedMedia;

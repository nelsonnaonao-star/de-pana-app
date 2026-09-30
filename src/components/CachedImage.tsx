import React, { useState, useEffect, useRef, useMemo } from "react";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Network } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";
import { logger } from "../lib/logger";

interface CachedImageProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  onLoad?: () => void;
  onError?: () => void;
  onClick?: () => void;
}

// Memory cache (session-level) keyed by `src` — survives remounts so avatars
// never show a placeholder when the same URL was already resolved this session.
// ACOTADA: las URLs de chats recientes caben de sobra y el evict (LRU + tope de
// bytes) impide que el mapa crezca sin límite en sesiones largas.
const MEMORY_CACHE_MAX_ENTRIES = 60;
const MEMORY_CACHE_MAX_BYTES = 32 * 1024 * 1024; // 32 MB de data URLs en memoria
const memoryCache = new Map<string, string>();
let memoryCacheBytes = 0;

function memoryCacheSet(key: string, value: string): void {
  const prev = memoryCache.get(key);
  if (prev !== undefined) memoryCacheBytes -= prev.length;
  memoryCache.delete(key);
  memoryCache.set(key, value); // refresca la posición LRU (más reciente al final)
  memoryCacheBytes += value.length;
  while (
    memoryCache.size > MEMORY_CACHE_MAX_ENTRIES ||
    memoryCacheBytes > MEMORY_CACHE_MAX_BYTES
  ) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const old = memoryCache.get(oldest);
    if (old !== undefined) memoryCacheBytes -= old.length;
    memoryCache.delete(oldest);
  }
}

function memoryCacheDelete(key: string): void {
  const prev = memoryCache.get(key);
  if (prev !== undefined) memoryCacheBytes -= prev.length;
  memoryCache.delete(key);
}

// URLs que fallaron al cargar en esta sesión. Se muestran directamente como
// fallback de iniciales (verdes) en lugar de intentar una y otra vez, que era
// lo que producía el parpadeo del avatar cuando el contacto no tiene foto o la
// URL quedó rota (foto borrada/token expirado).
const brokenSet = new Set<string>();

export function isCachedImageReady(url?: string): boolean {
  return !!url && !brokenSet.has(url) && memoryCache.has(url);
}
// Timestamp del último error por URL para throttle de reintentos silenciosos.
const lastErrorAt = new Map<string, number>();
// Intentos silenciosos ya consumidos por URL (timer). Pasado el tope, la URL
// solo reintenta ante un evento de red real (online/networkStatusChange).
const retryCountMap = new Map<string, number>();
const MAX_SILENT_RETRIES = 3;
// Mínima separación entre reintentos de una misma URL rota.
const RETRY_GAP_MS = 15000;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getExtension(url: string): string {
  const match = url.match(/\.(\w{3,4})(\?|$)/);
  if (match) return match[1].toLowerCase();
  if (url.includes("gif")) return "gif";
  if (url.includes("webp")) return "webp";
  if (url.includes("png")) return "png";
  return "jpg";
}

// Lee el archivo cacheado y devuelve su data URL base64. Si el archivo no
// existe/falla, devuelve null (el llamador cae a fetchAsDataUrl).
// NOTA: se usan data URLs (no blob URLs) por compatibilidad: los blob: URLs con
// <img> en el WebView Android hicieron que los stickers oficiales de WEPA
// entraran en ciclos de reintento sin estabilizarse.
async function getCachedFile(fileName: string): Promise<string | null> {
  const ext = fileName.split(".").pop() || "jpg";
  const mime = ext === "gif" ? "image/gif" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  // Prefer persistent storage (Directory.Data) so images survive offline/OS cache
  // cleanups. Fall back to the old Directory.Cache location (migration).
  try {
    const result = await Filesystem.readFile({
      path: `image_cache/${fileName}`,
      directory: Directory.Data,
    });
    return `data:${mime};base64,${result.data}`;
  } catch (e) {
    logger.warn("[CachedImage] readFile from Data failed", { error: e });
  }
  try {
    const result = await Filesystem.readFile({
      path: `image_cache/${fileName}`,
      directory: Directory.Cache,
    });
    return `data:${mime};base64,${result.data}`;
  } catch (e) {
    logger.warn("[CachedImage] readFile from Cache failed", { error: e });
    return null;
  }
}

// Timeout amplio (25s): GIFs/stickers oficiales pesados (1-5 MB+) pueden tardar
// más de 8s en redes lentas; un abort prematuro producía network_error → ciclos
// de reintento y la percepción de "carga infinita".
async function fetchWithTimeout(url: string, timeoutMs = 25000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// Resultado tipado del fetch: distingue un error HTTP (URL rota, marca estable)
// de un fallo de red (transitorio, reintenta con cooldown o al recuperar red).
// La clave: NO se renderiza un <img> con la URL remota sin antes verificar que
// descarga correctamente (eso eliminaba el parpadeo: el <img> fallaba y se
// alternaba verde ↔ gris en cada reintento).
type FetchDataUrlResult =
  | { kind: "ok"; dataUrl: string }
  | { kind: "http_error" }
  | { kind: "network_error" };

const inflightMap = new Map<string, Promise<FetchDataUrlResult>>();

async function fetchAsDataUrl(url: string): Promise<FetchDataUrlResult> {
  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return { kind: "http_error" };
    const blob = await resp.blob();
    // Nunca cachear respuestas que no son imágenes (HTML/JSON/error docs): un
    // fichero así quedaba almacenado en image_cache y fallaba para siempre.
    if (!blob.type || !blob.type.startsWith("image/")) return { kind: "http_error" };
    const reader = new FileReader();
    const dataUrl = await new Promise<string | null>((resolve) => {
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return { kind: "network_error" };
    return { kind: "ok", dataUrl };
  } catch {
    return { kind: "network_error" };
  }
}

function resolveImageDataUrl(url: string): Promise<FetchDataUrlResult> {
  const existing = memoryCache.get(url);
  if (existing) return Promise.resolve({ kind: "ok", dataUrl: existing });

  const inflight = inflightMap.get(url);
  if (inflight) return inflight;

  const isNative = Capacitor.isNativePlatform();
  const ext = getExtension(url);
  const fileName = `${hashUrl(url)}.${ext}`;
  let promise: Promise<FetchDataUrlResult>;
  promise = (async (): Promise<FetchDataUrlResult> => {
    try {
      if (isNative) {
        const cached = await getCachedFile(fileName);
        if (cached) {
          memoryCacheSet(url, cached);
          return { kind: "ok", dataUrl: cached };
        }
      }

      const result = await fetchAsDataUrl(url);
      if (result.kind !== "ok") return result;

      memoryCacheSet(url, result.dataUrl);
      if (isNative) {
        const base64 = result.dataUrl.split(",")[1] || "";
        if (base64) {
          await Filesystem.writeFile({
            path: `image_cache/${fileName}`,
            data: base64,
            directory: Directory.Data,
            recursive: true,
          }).catch((e) => {
            logger.warn("[CachedImage] writeFile failed for image_cache", { fileName, error: e });
          });
        }
      }
      return result;
    } finally {
      if (inflightMap.get(url) === promise) {
        inflightMap.delete(url);
      }
    }
  })();
  inflightMap.set(url, promise);
  return promise;
}

// Precarga una URL en la caché (memoria + filesystem) para que el componente
// la renderice de inmediato en el primer montaje, sin mostrar el placeholder
// verde. Se usa justo después de un upload para que la vista previa y el feed
// aparezcan instantáneos. Ignora URLs rotas ya conocidas en esta sesión.
export async function precacheImage(url: string): Promise<void> {
  if (!url || brokenSet.has(url)) return;
  if (memoryCache.has(url)) return;

  const result = await resolveImageDataUrl(url);
  if (result.kind !== "ok") return;
}

// Borra el estado de URL "rota" de esta sesión para una URL concreta. Lo usa el
// botón "Reintentar" de los mensajes: permite una nueva descarga inmediata sin
// depender del timer silencioso ni de un evento de red.
export function clearCachedImageRetryState(url: string): void {
  brokenSet.delete(url);
  retryCountMap.delete(url);
  lastErrorAt.delete(url);
  memoryCacheDelete(url);
}

export default function CachedImage({
  src,
  alt = "",
  className = "",
  style,
  loading = "lazy",
  onLoad,
  onError,
  onClick,
}: CachedImageProps) {
  const [displaySrc, setDisplaySrc] = useState<string | null>(() => {
    if (!src || brokenSet.has(src)) return null;
    return memoryCache.get(src) ?? null;
  });
  const [hasError, setHasError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const isCapacitor = Capacitor.isNativePlatform();
  const imgRef = useRef<HTMLImageElement>(null);

  const initials = useMemo(() => alt ? getInitials(alt) : "", [alt]);

  // Cuando cambia `src`, restablece el estado a lo que ya se sabe en esta sesión
  // (caché o URL rota) para no mostrar la imagen del `src` anterior.
  useEffect(() => {
    setDisplaySrc(brokenSet.has(src) ? null : (memoryCache.get(src) ?? null));
    setHasError(!src || brokenSet.has(src));
  }, [src]);

  useEffect(() => {
    if (!src) {
      // Sin foto: fallback estable de iniciales. Nunca intentar cargar nada.
      setHasError(true);
      setDisplaySrc(null);
      return;
    }
    // URL ya marcada como rota en esta sesión: no volver a intentar (evita el
    // parpadeo). El retry solo ocurre con cooldown vía network recovery.
    if (brokenSet.has(src)) {
      setHasError(true);
      setDisplaySrc(null);
      return;
    }

    const sessionValue = memoryCache.get(src);
    if (sessionValue) {
      setHasError(false);
      setDisplaySrc(sessionValue);
      return;
    }

    if (!isCapacitor) {
      // Web: el <img> carga directamente; un error cae en handleError.
      memoryCacheSet(src, src);
      setDisplaySrc(src);
      setHasError(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const result = await resolveImageDataUrl(src);
      if (cancelled) return;
      if (result.kind === "ok") {
        setDisplaySrc(result.dataUrl);
        setHasError(false);
      } else {
        memoryCacheDelete(src);
        setDisplaySrc(src);
        setHasError(false);
      }
    })();

    return () => { cancelled = true; };
  }, [src, isCapacitor, retryTick]);

  const handleError = () => {
    const current = memoryCache.get(src);
    if (current?.startsWith("data:")) {
      // Un dato cacheado que por alguna razón falló: olvidarlo y reintentar.
      memoryCacheDelete(src);
    } else {
      brokenSet.add(src);
      lastErrorAt.set(src, Date.now());
      memoryCacheDelete(src);
    }
    setHasError(true);
    setDisplaySrc(null);
    onError?.();
  };

  // Reintento SILENCIOSO al recuperar red, con cooldown por URL: no se apaga el
  // fallback ni se monta un <img> de inmediato. Simplemente se limpia la marca
  // de rota y el efecto principal vuelve a verificar; si sigue rota, el verde
  // se mantiene sin parpadear, y si ya responde, se muestra la foto.
  useEffect(() => {
    if (!hasError || !src || !brokenSet.has(src)) return;
    // Reintento ante un evento de red real (online/wifi): resetea el budget de
    // reintentos silenciosos (quizá la URL rota era un fallo transitorio).
    const onOnline = () => {
      const last = lastErrorAt.get(src) ?? 0;
      if (Date.now() - last < RETRY_GAP_MS) return;
      brokenSet.delete(src);
      retryCountMap.delete(src);
      memoryCacheDelete(src);
      setRetryTick((t) => t + 1);
    };
    // Reintento SILENCIOSO por timer con cooldown y tope: no se apaga el fallback
    // ni se monta un <img> de inmediato; el effect principal vuelve a verificar, y
    // si sigue rota el verde se mantiene sin parpadear. No encadena polling infinito.
    const silentRetryTimer = setTimeout(() => {
      const last = lastErrorAt.get(src) ?? 0;
      if (Date.now() - last < RETRY_GAP_MS) return;
      const attempts = retryCountMap.get(src) ?? 0;
      if (attempts >= MAX_SILENT_RETRIES) return; // rota estable: esperar a red
      retryCountMap.set(src, attempts + 1);
      brokenSet.delete(src);
      memoryCacheDelete(src);
      setRetryTick((t) => t + 1);
    }, RETRY_GAP_MS);
    window.addEventListener("online", onOnline);
    let netHandler: { remove: () => Promise<void> } | null = null;
    if (isCapacitor) {
      Network.addListener("networkStatusChange", (status) => {
        if (status.connected) onOnline();
      })
        .then((handle) => {
          netHandler = handle;
        })
        .catch(() => {});
    }
    return () => {
      clearTimeout(silentRetryTimer);
      window.removeEventListener("online", onOnline);
      if (netHandler) {
        netHandler.remove();
        netHandler = null;
      }
    };
  }, [hasError, isCapacitor, src, retryTick]);

  if (!displaySrc) {
    if (initials) {
      return (
        <div
          className={`${className} overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center`}
          style={style}
        >
          <span className="text-white font-bold text-xs">{initials}</span>
        </div>
      );
    }
    return (
      <div
        className={`${className} bg-slate-200 animate-pulse`}
        style={style}
      />
    );
  }

  return (
    <img
      ref={imgRef}
      src={displaySrc}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onLoad={onLoad}
      onError={handleError}
      onClick={onClick}
    />
  );
}
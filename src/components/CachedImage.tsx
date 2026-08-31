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
const memoryCache = new Map<string, string>();

// URLs que fallaron al cargar en esta sesión. Se muestran directamente como
// fallback de iniciales (verdes) en lugar de intentar una y otra vez, que era
// lo que producía el parpadeo del avatar cuando el contacto no tiene foto o la
// URL quedó rota (foto borrada/token expirado).
const brokenSet = new Set<string>();
// Timestamp del último error por URL para throttle de reintentos silenciosos.
const lastErrorAt = new Map<string, number>();
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

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// Descarga la imagen y la devuelve como data URL. Devuelve null si la URL está
// rota, sin red, o el fetch falla. La clave: NO se renderiza un <img> con la
// URL remota sin antes verificar que descarga correctamente (eso eliminaba el
// parpadeo: el <img> fallaba y se alternaba verde ↔ gris en cada reintento).
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const reader = new FileReader();
    const dataUrl = await new Promise<string | null>((resolve) => {
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(blob);
    });
    return dataUrl;
  } catch (e) {
    logger.warn("[CachedImage] fetch failed", { error: e, url });
    return null;
  }
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
      memoryCache.set(src, src);
      setDisplaySrc(src);
      setHasError(false);
      return;
    }

    const ext = getExtension(src);
    const fileName = `${hashUrl(src)}.${ext}`;
    let cancelled = false;

    (async () => {
      const cached = await getCachedFile(fileName);
      if (cancelled) return;
      if (cached) {
        memoryCache.set(src, cached);
        setDisplaySrc(cached);
        setHasError(false);
        return;
      }
      // Verificar la URL ANTES de renderizarla: si está rota, el fallback verde
      // se mantiene y no se llega a montar un <img> que falle.
      const dataUrl = await fetchAsDataUrl(src);
      if (cancelled) return;
      if (dataUrl) {
        const base64 = dataUrl.split(",")[1] || "";
        if (base64) {
          await Filesystem.writeFile({
            path: `image_cache/${fileName}`,
            data: base64,
            directory: Directory.Data,
            recursive: true,
          }).catch(() => {});
        }
        memoryCache.set(src, dataUrl);
        setDisplaySrc(dataUrl);
        setHasError(false);
      } else {
        brokenSet.add(src);
        lastErrorAt.set(src, Date.now());
        memoryCache.delete(src);
        setDisplaySrc(null);
        setHasError(true);
      }
    })();

    return () => { cancelled = true; };
  }, [src, isCapacitor, retryTick]);

  const handleError = () => {
    const current = memoryCache.get(src);
    if (current?.startsWith("data:")) {
      // Un dato cacheado que por alguna razón falló: olvidarlo y reintentar.
      memoryCache.delete(src);
    } else {
      brokenSet.add(src);
      lastErrorAt.set(src, Date.now());
      memoryCache.delete(src);
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
    const tryAgain = () => {
      const last = lastErrorAt.get(src) ?? 0;
      if (Date.now() - last < RETRY_GAP_MS) return;
      brokenSet.delete(src);
      memoryCache.delete(src);
      setRetryTick((t) => t + 1);
    };
    window.addEventListener("online", tryAgain);
    let netHandler: { remove: () => Promise<void> } | null = null;
    if (isCapacitor) {
      Network.addListener("networkStatusChange", (status) => {
        if (status.connected) tryAgain();
      })
        .then((handle) => {
          netHandler = handle;
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("online", tryAgain);
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
        className={`${className} bg-slate-200 animate-pulse min-h-[200px]`}
        style={style}
      />
    );
  }

  return (
    <div
      className={className}
      style={style}
      onClick={onClick}
    >
      <img
        ref={imgRef}
        src={displaySrc}
        alt={alt}
        className="w-full h-full object-contain"
        loading={loading}
        onLoad={onLoad}
        onError={handleError}
      />
    </div>
  );
}
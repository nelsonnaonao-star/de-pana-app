import React, { useState, useEffect, useRef, useMemo } from "react";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

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
  } catch {}
  try {
    const result = await Filesystem.readFile({
      path: `image_cache/${fileName}`,
      directory: Directory.Cache,
    });
    return `data:${mime};base64,${result.data}`;
  } catch {
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

async function saveToCache(fileName: string, url: string): Promise<void> {
  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || "");
      };
      reader.readAsDataURL(blob);
    });
    if (base64) {
      await Filesystem.writeFile({
        path: `image_cache/${fileName}`,
        data: base64,
        directory: Directory.Data,
      });
    }
  } catch {
    // Silently fail — next load will try again
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
  const [displaySrc, setDisplaySrc] = useState<string | null>(
    () => memoryCache.get(src) ?? null
  );
  const [hasError, setHasError] = useState(false);
  const isCapacitor = Capacitor.isNativePlatform();
  const imgRef = useRef<HTMLImageElement>(null);

  const initials = useMemo(() => alt ? getInitials(alt) : "", [alt]);

  useEffect(() => {
    if (!src) return;
    setHasError(false);

    if (!isCapacitor) {
      memoryCache.set(src, src);
      setDisplaySrc(src);
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
      } else {
        memoryCache.set(src, src);
        setDisplaySrc(src);
        saveToCache(fileName, src);
      }
    })();

    return () => { cancelled = true; };
  }, [src, isCapacitor]);

  const handleError = () => {
    setHasError(true);
    setDisplaySrc(null);
    onError?.();
  };

  if (!displaySrc) {
    if (hasError && initials) {
      return (
        <div
          className={`${className} bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center`}
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

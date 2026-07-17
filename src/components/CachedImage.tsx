import React, { useState, useEffect, useRef } from "react";
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

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36) + "_" + Date.now().toString(36);
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
  try {
    const result = await Filesystem.readFile({
      path: `image_cache/${fileName}`,
      directory: Directory.Cache,
    });
    const ext = fileName.split(".").pop() || "jpg";
    const mime = ext === "gif" ? "image/gif" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${result.data}`;
  } catch {
    return null;
  }
}

async function saveToCache(fileName: string, url: string): Promise<void> {
  try {
    const resp = await fetch(url);
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
        directory: Directory.Cache,
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
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const isCapacitor = Capacitor.isNativePlatform();
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) return;

    if (!isCapacitor) {
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
        setDisplaySrc(cached);
      } else {
        setDisplaySrc(src);
        saveToCache(fileName, src);
      }
    })();

    return () => { cancelled = true; };
  }, [src, isCapacitor]);

  if (!displaySrc) {
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
      onError={onError}
      onClick={onClick}
    />
  );
}

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { logger } from "../lib/logger";

const CACHE_DIR = "video_cache";
const MAX_VIDEO_SIZE = 150 * 1024 * 1024; // 150MB
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB total

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getExtFromUrl(url: string): string {
  const match = url.match(/\.(\w{3,4})(\?|$)/);
  if (match) return match[1].toLowerCase();
  return "mp4";
}

/**
 * Get a local cached video path for a given URL.
 * Returns null if not cached or not on native platform.
 */
export async function getCachedVideoPath(url: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform() || !url) return null;
  try {
    const fileName = `${hashUrl(url)}.mp4`;
    const result = await Filesystem.readFile({
      path: `${CACHE_DIR}/${fileName}`,
      directory: Directory.Data,
    });
    // Return a file:// URI for <video> src
    return result.uri;
  } catch {
    return null;
  }
}

/**
 * Cache a video Blob to disk (called after successful send).
 * Skips if larger than MAX_VIDEO_SIZE.
 * Uses recursive:true to avoid silent failures when the directory doesn't exist.
 */
export async function cacheVideoBlob(
  url: string,
  blob: Blob
): Promise<void> {
  if (!Capacitor.isNativePlatform() || !url) return;
  if (blob.size > MAX_VIDEO_SIZE) {
    logger.log("[VideoCache] skip — too large", { size: blob.size });
    return;
  }
  try {
    const fileName = `${hashUrl(url)}.mp4`;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const base64 = uint8ToBase64(bytes);

    await Filesystem.writeFile({
      path: `${CACHE_DIR}/${fileName}`,
      data: base64,
      directory: Directory.Data,
      recursive: true, // CRITICAL: prevents silent failure if dir missing
    });
    logger.log("[VideoCache] saved", { fileName, sizeMB: (blob.size / 1048576).toFixed(1) });
    await enforceSizeLimit().catch(() => {});
  } catch (e) {
    logger.warn("[VideoCache] save failed", { error: e });
  }
}

/**
 * Cache a remote video URL to disk (called on first play).
 * Fetches the full video, saves to video_cache/.
 */
export async function cacheVideoUrl(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !url) return;

  // Already cached?
  const existing = await getCachedVideoPath(url);
  if (existing) return;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    if (blob.size > MAX_VIDEO_SIZE) return;
    await cacheVideoBlob(url, blob);
  } catch (e) {
    logger.warn("[VideoCache] fetch+save failed", { error: e });
  }
}

/**
 * Convert Uint8Array to base64 string.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Evict oldest files when total cache exceeds MAX_CACHE_SIZE.
 */
async function enforceSizeLimit(): Promise<void> {
  try {
    const listing = await Filesystem.readdir({
      path: CACHE_DIR,
      directory: Directory.Data,
    });
    const files = listing.files.filter(
      (f) => f.type === "file" && f.name.endsWith(".mp4")
    );
    if (files.length === 0) return;

    let totalSize = 0;
    const fileDetails: { name: string; mtime: number; size: number }[] = [];
    for (const f of files) {
      try {
        const stat = await Filesystem.stat({
          path: `${CACHE_DIR}/${f.name}`,
          directory: Directory.Data,
        });
        const size = stat.size ?? 0;
        totalSize += size;
        fileDetails.push({
          name: f.name,
          mtime: (stat as any).mtime ?? 0,
          size,
        });
      } catch {}
    }

    if (totalSize <= MAX_CACHE_SIZE) return;

    fileDetails.sort((a, b) => a.mtime - b.mtime);
    let freed = 0;
    const toFree = totalSize - MAX_CACHE_SIZE;
    for (const f of fileDetails) {
      if (freed >= toFree) break;
      try {
        await Filesystem.deleteFile({
          path: `${CACHE_DIR}/${f.name}`,
          directory: Directory.Data,
        });
        freed += f.size;
      } catch {}
    }
    logger.log("[VideoCache] enforced limit", {
      freedMB: (freed / 1048576).toFixed(1),
    });
  } catch {}
}

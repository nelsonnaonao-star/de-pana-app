import { Media } from "@capacitor-community/media";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase";
import { FileOpener } from "@capawesome-team/capacitor-file-opener";
import { mimeTypeFor } from "./mime";

const ALBUM_NAME = "RED ON";

let cachedAlbumId: string | null = null;

async function getAlbumId(): Promise<string> {
  if (cachedAlbumId) return cachedAlbumId;
  const { albums } = await Media.getAlbums();
  const existing = albums.find((a) => a.name === ALBUM_NAME);
  if (existing) {
    cachedAlbumId = existing.identifier;
    return cachedAlbumId;
  }
  await Media.createAlbum({ name: ALBUM_NAME });
  const { albums: updated } = await Media.getAlbums();
  const created = updated.find((a) => a.name === ALBUM_NAME);
  if (!created) throw new Error("No se pudo crear el álbum");
  cachedAlbumId = created.identifier;
  return cachedAlbumId;
}

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

async function fetchWithAuth(url: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  } catch { /* proceed without auth */ }
  const response = await fetchWithTimeout(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function saveMediaToGallery(url: string, fileName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    return;
  }
  await Share.share({ title: "Guardar en galería", url });
}

export async function saveMediaToGalleryDirect(url: string, fileName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    return;
  }

  const blob = await fetchWithAuth(url);
  const dataUri = await blobToDataUri(blob);
  const albumId = await getAlbumId();

  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const isVideo = ["mp4", "mov", "avi", "mkv", "webm", "3gp"].includes(ext);
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");

  if (isVideo) {
    await Media.saveVideo({ path: dataUri, albumIdentifier: albumId, fileName: nameWithoutExt });
  } else {
    await Media.savePhoto({ path: dataUri, albumIdentifier: albumId, fileName: nameWithoutExt });
  }
}

export async function shareMedia(url: string, title: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    try {
      await navigator.share({ title, url });
    } catch {
      await navigator.clipboard.writeText(url);
    }
    return;
  }
  await Share.share({ title, url });
}

export async function openDocument(url: string, fileName: string, mimeType?: string): Promise<void> {
  const inferred = mimeTypeFor(fileName, mimeType);

  if (!Capacitor.isNativePlatform()) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  // Native: download to cache and open via the native viewer intent (FileOpener).
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  } catch { /* proceed without auth */ }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let blob: Blob;
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } finally {
    clearTimeout(timeout);
  }

  if (!blob || blob.size === 0) {
    throw new Error("Empty file body");
  }

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  const base64 = btoa(chunks.join(""));

  const path = `downloads/${fileName}`;
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Cache,
  });

  await FileOpener.openFile({
    path: uri,
    mimeType: inferred || "*/*",
  });
}

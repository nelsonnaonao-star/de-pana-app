import { Media } from "@capacitor-community/media";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase";

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

async function fetchWithAuth(url: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  } catch { /* proceed without auth */ }
  const response = await fetch(url, { headers });
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

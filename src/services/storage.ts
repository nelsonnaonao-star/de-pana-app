import { supabase } from "../lib/supabase";
import { apiUrl } from "../lib/api";

const BUCKET = "chat-images";

async function uploadViaServer(blob: Blob): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", blob, `file.${blob.type.split("/")[1] || "bin"}`);
    const res = await fetch(apiUrl("/api/media/upload"), {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Error al subir archivo");
    }
    const data = await res.json();
    return data.url;
  } catch {
    return null;
  }
}

async function uploadDirectToSupabase(
  blob: Blob,
  folder: string
): Promise<string> {
  const ext = blob.type.split("/")[1] || "bin";
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, blob, {
      contentType: blob.type,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

export async function uploadChatMedia(
  blob: Blob,
  folder: string = "uploads"
): Promise<string> {
  const serverUrl = await uploadViaServer(blob);
  if (serverUrl) return serverUrl;
  return uploadDirectToSupabase(blob, folder);
}

export async function uploadAvatar(blob: Blob, _userId: string): Promise<string> {
  return uploadChatMedia(blob, "uploads/avatars");
}

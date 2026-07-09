import { supabase } from "../lib/supabase";

const BUCKET = "chat-images";

export async function uploadChatMedia(
  blob: Blob,
  folder: string = "uploads"
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

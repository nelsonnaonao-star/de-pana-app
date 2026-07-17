import { supabase } from "../lib/supabase";

const BUCKET = "chat-images";

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

export async function compressImage(blob: Blob, maxPx: number = 1080, quality: number = 0.7): Promise<Blob> {
  if (!blob.type.startsWith("image/")) return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width;
    let h = bitmap.height;
    if (w > maxPx || h > maxPx) {
      const ratio = Math.min(maxPx / w, maxPx / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/jpeg", quality);
    });
    console.log(`[STORAGE] Compressed image: ${(blob.size / 1024 / 1024).toFixed(1)}MB → ${(out.size / 1024 / 1024).toFixed(1)}MB (${w}x${h})`);
    return out;
  } catch (e) {
    console.warn("[STORAGE] Image compression failed, using original:", e);
    return blob;
  }
}

export async function uploadChatMedia(
  blob: Blob,
  folder: string = "uploads"
): Promise<string> {
  const shouldCompress = folder.startsWith("image") || folder.startsWith("uploads");
  const toUpload = shouldCompress ? await compressImage(blob) : blob;
  return uploadDirectToSupabase(toUpload, folder);
}

export async function uploadAvatar(blob: Blob, _userId: string): Promise<string> {
  return uploadChatMedia(blob, "uploads/avatars");
}

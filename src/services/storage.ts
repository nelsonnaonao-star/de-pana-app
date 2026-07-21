import { supabase } from "../lib/supabase";

const BUCKET = "chat-images";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";

async function uploadDirectToSupabase(
  blob: Blob,
  folder: string
): Promise<string> {
  const baseType = blob.type.split(";")[0];
  const ext = baseType.split("/")[1] || "bin";
  const contentType = baseType || "application/octet-stream";
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("No auth session");

  const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${fileName}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": contentType,
      },
      body: blob,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${fileName}`;
    return publicUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}

const MAX_W = 800;
const MAX_H = 800;
const TARGET_BYTES = 500 * 1024;

async function compressToTarget(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  let w = bitmap.width;
  let h = bitmap.height;
  if (w > MAX_W || h > MAX_H) {
    const ratio = Math.min(MAX_W / w, MAX_H / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  bitmap.close();

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const tempImg = await createImageBitmap(blob);
  ctx.drawImage(tempImg, 0, 0, w, h);
  tempImg.close();

  for (let quality = 0.7; quality >= 0.2; quality -= 0.15) {
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))),
        "image/jpeg",
        quality
      );
    });
    if (out.size <= TARGET_BYTES) return out;
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))),
      "image/jpeg",
      0.2
    );
  });
}

export async function compressImage(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith("image/")) return blob;

  const timeout = new Promise<Blob>((_, reject) =>
    setTimeout(() => reject(new Error("compressImage timed out")), 10000)
  );

  const compress = compressToTarget(blob);

  const result = await Promise.race([compress, timeout]);
  console.log(
    `[STORAGE] ${(blob.size / 1024).toFixed(0)}KB → ${(result.size / 1024).toFixed(0)}KB`
  );
  return result;
}

export async function uploadChatMedia(
  blob: Blob,
  folder: string = "uploads"
): Promise<string> {
  const isImage = folder.startsWith("image") || folder.startsWith("uploads");
  const toUpload = isImage ? await compressImage(blob) : blob;
  return uploadDirectToSupabase(toUpload, folder);
}

export async function uploadAvatar(blob: Blob, _userId: string): Promise<string> {
  return uploadChatMedia(blob, "uploads/avatars");
}

import { uploadChatMedia, uploadPrivateChatMedia, planConversationUpload } from "./storage";
import { sendMessage } from "./messages";
import type { SharedImage } from "./shareReceiver";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
};

function newClientId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveImageMime(path: string, blob: Blob): string {
  const declared = String(blob.type || "").split(";")[0].trim().toLowerCase();
  if (declared.startsWith("image/")) return declared;
  const ext = (path.split(".").pop() || "").toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || "image/jpeg";
}

async function readSharedImage(image: SharedImage): Promise<Blob> {
  const res = await fetch(image.url);
  if (!res.ok) {
    throw new Error(`No se pudo leer la imagen compartida (${res.status})`);
  }
  const raw = await res.blob();
  const mime = resolveImageMime(image.path, raw);
  return raw.type === mime ? raw : new Blob([raw], { type: mime });
}

export async function sendSharedImagesToChat(
  chatId: string,
  images: SharedImage[],
  senderId: string,
): Promise<number> {
  let sent = 0;
  for (const image of images) {
    const blob = await readSharedImage(image);
    const plan = planConversationUpload(blob, chatId, "image", { publicFolder: "files" });
    if (plan.action === "reject") {
      throw new Error(plan.reason);
    }
    const url =
      plan.action === "private"
        ? await uploadPrivateChatMedia(blob, chatId, plan.kind)
        : await uploadChatMedia(blob, plan.folder);

    await sendMessage({
      chat_id: chatId,
      sender_id: senderId,
      type: "image",
      text: "Imagen",
      image_url: url,
      client_id: newClientId(),
    });
    sent++;
  }
  return sent;
}

// Lógica PURA de la subida privada (chat-media) del cliente. Sin Supabase, red
// ni Capacitor: la compresión de imagen y la petición multipart se inyectan como
// dependencias, de modo que el enrutado de endpoint, la validación de `chat_id`,
// el allowlist de MIME y el manejo de la respuesta son verificables aislados.
//
// Espejo del allowlist del servidor (`server/src/lib/privateUpload.js`):
// MANTENER SINCRONIZADO. Un MIME no listado no se sube a chat-media.

export const PRIVATE_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav",
  "audio/x-m4a": "m4a", "audio/mp4": "m4a", "audio/webm": "webm",
  "application/pdf": "pdf",
  "text/plain": "txt", "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function normalizeMime(mimeType?: string): string {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

export function isPrivateUploadAllowedMime(mimeType?: string): boolean {
  return !!PRIVATE_MIME_EXT[normalizeMime(mimeType)];
}

const CHAT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidChatId(chatId: unknown): chatId is string {
  return typeof chatId === "string" && CHAT_UUID_RE.test(chatId);
}

export type PrivateMediaKind = "image" | "video" | "audio" | "file";

// Formatos de vídeo privado con ruta de procesamiento/reproducción verificada
// (deben existir en PRIVATE_MIME_EXT; el servidor valida lo mismo). MKV/AVI/3GP
// quedan fuera hasta que exista una ruta compatible: evita persistir objetos
// `.bin` con contentType de vídeo que el reproductor no abre.
export function isSupportedPrivateVideoMime(mimeType?: string): boolean {
  return isPrivateUploadAllowedMime(mimeType);
}

// ¿Puede subirse este blob a chat-media con el endpoint correspondiente?
// - vídeo (kind o MIME video/*) → endpoint de vídeo SÓLO si el formato está
//   soportado (mp4/quicktime/webm). Un `video/*` sin extensión mapeada se
//   rechaza (nunca cae a chat-images ni se sube como `.bin`).
// - imagen (MIME image/*)       → se comprime a jpeg → admitida.
// - resto                       → sólo si el MIME está en el allowlist.
export function isPrivateUploadSupported(blob: Blob, kind: PrivateMediaKind): boolean {
  const mime = normalizeMime(blob.type);
  const isVideoMime = mime.startsWith("video/");
  if (kind === "video" || isVideoMime) return isVideoMime && isPrivateUploadAllowedMime(mime);
  if (mime.startsWith("image/")) return true;
  if (kind === "image") return false;
  return isPrivateUploadAllowedMime(mime);
}

// Plan de enrutado de un adjunto de CONVERSACIÓN (puro, testeable). Evita que un
// MIME no admitido termine silenciosamente en el bucket público `chat-images`:
// - Chat remoto (UUID) + MIME admitido   → privado (chat-media).
// - Chat remoto (UUID) + MIME NO admitido → { action: "reject" } (NUNCA público).
// - Chat local (sin UUID)                 → público (comportamiento existente).
// - Sticker (recurso deliberadamente público) → público ("stickers").
export type ConversationUploadPlan =
  | { action: "private"; kind: PrivateMediaKind }
  | { action: "public"; folder: string }
  | { action: "reject"; reason: string };

export function planConversationUpload(
  blob: Blob,
  chatId: unknown,
  kind: PrivateMediaKind,
  opts: { isSticker?: boolean; publicFolder?: string } = {},
): ConversationUploadPlan {
  if (opts.isSticker) {
    return { action: "public", folder: opts.publicFolder || "stickers" };
  }
  if (isValidChatId(chatId)) {
    if (isPrivateUploadSupported(blob, kind)) {
      return { action: "private", kind };
    }
    const mime = normalizeMime(blob.type) || "desconocido";
    return {
      action: "reject",
      reason: `Este tipo de archivo (${mime}) no se puede enviar a este chat`,
    };
  }
  return { action: "public", folder: opts.publicFolder || "uploads" };
}

function privateFileName(prefix: string, mime: string, fallbackExt: string): string {
  const ext = PRIVATE_MIME_EXT[normalizeMime(mime)] || fallbackExt;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}

export interface MultipartResult {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export interface PrivateUploadDeps {
  // Realiza el POST multipart (con Bearer) y devuelve la respuesta. La URL
  // recibida es relativa (p. ej. `/api/media/upload-private?chat_id=...`).
  postMultipart(url: string, form: FormData): Promise<MultipartResult>;
  // Comprime una imagen a jpeg antes de subirla.
  compressImage(blob: Blob): Promise<Blob>;
}

// Sube un adjunto de conversación a chat-media y devuelve la referencia canónica
// estable que devuelve el servidor (NO una URL firmada). Valida el `chat_id`
// (UUID) ANTES de cualquier petición; el servidor revalida membresía.
export async function performPrivateUpload(
  blob: Blob,
  chatId: string,
  kind: PrivateMediaKind,
  deps: PrivateUploadDeps,
): Promise<string> {
  if (!isValidChatId(chatId)) {
    throw new Error("chat_id inválido: se requiere el UUID del chat de destino");
  }

  const mime = normalizeMime(blob.type);
  // Sólo un MIME `video/*` usa el endpoint de vídeo; un `kind: "video"` con MIME
  // no-vídeo (o vacío) se rechaza por la vía de archivo (allowlist).
  const isVideo = mime.startsWith("video/");
  const chatQuery = `?chat_id=${encodeURIComponent(chatId)}`;

  if (isVideo) {
    if (!isPrivateUploadAllowedMime(mime)) {
      throw new Error(`MIME de video no admitido para chat-media: ${mime || "desconocido"}`);
    }
    const form = new FormData();
    form.append("video", blob, privateFileName("video", mime, "mp4"));
    const res = await deps.postMultipart(`/api/media/upload-private-video${chatQuery}`, form);
    if (!res.ok) throw new Error(`upload-private-video ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!data?.url) throw new Error("respuesta sin url");
    return data.url as string;
  }

  const isImage = kind === "image" || mime.startsWith("image/");
  const toUpload = isImage ? await deps.compressImage(blob) : blob;
  const effectiveMime = normalizeMime(toUpload.type);
  if (!isPrivateUploadAllowedMime(effectiveMime)) {
    throw new Error(`MIME no admitido para chat-media: ${effectiveMime || "desconocido"}`);
  }

  const form = new FormData();
  form.append("file", toUpload, privateFileName("file", effectiveMime, "bin"));
  const res = await deps.postMultipart(`/api/media/upload-private${chatQuery}`, form);
  if (!res.ok) throw new Error(`upload-private ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data?.url) throw new Error("respuesta sin url");
  return data.url as string;
}

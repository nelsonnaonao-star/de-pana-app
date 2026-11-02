export const VIDEO_EXT_RE = /\.(mp4|m4v|mov|qt|webm|3gp|mkv|avi)$/i;

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

export function isVideoFileLike(type?: string, name?: string): boolean {
  return String(type || "").toLowerCase().startsWith("video/") || VIDEO_EXT_RE.test(name || "");
}

// Devuelve un File con un MIME de video real (por MIME o por extensión). Evita
// que un video de galería con MIME vacío/genérico se trate como imagen o que un
// blob URL con tipo incorrecto deje el <video> en negro.
export function ensureVideoMime(file: File): File {
  const type = (file.type || "").trim().toLowerCase();
  if (type.startsWith("video/") && type !== "video/unknown") return file;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = VIDEO_MIME_BY_EXT[ext] || "video/mp4";
  return new File([file], file.name || `video.${ext || "mp4"}`, { type: mime });
}

export function mimeTypeFor(name: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    apk: "application/vnd.android.package-archive",
    zip: "application/zip",
    rar: "application/vnd.rar",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    csv: "text/csv",
    txt: "text/plain",
    xml: "application/xml",
    json: "application/json",
  };
  return map[ext];
}

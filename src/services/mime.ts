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

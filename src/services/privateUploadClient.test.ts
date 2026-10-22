import test from "node:test";
import assert from "node:assert/strict";

import {
  performPrivateUpload,
  isValidChatId,
  isPrivateUploadAllowedMime,
  isPrivateUploadSupported,
  planConversationUpload,
  PRIVATE_MIME_EXT,
  type PrivateUploadDeps,
  type MultipartResult,
} from "./privateUploadClient";

const CHAT = "11111111-2222-3333-4444-555555555555";

function blobOf(type: string, body = "x"): Blob {
  return new Blob([body], { type });
}

function okResult(url: string): MultipartResult {
  return { ok: true, status: 200, json: async () => ({ url }) };
}
function errResult(status: number): MultipartResult {
  return { ok: false, status, json: async () => ({ error: "nope" }) };
}

// Captura lo que se envía al POST y devuelve un resultado configurable.
function makeDeps(result: MultipartResult | ((url: string, form: FormData) => MultipartResult)) {
  const calls: Array<{ url: string; form: FormData }> = [];
  const deps: PrivateUploadDeps = {
    postMultipart: async (url, form) => {
      calls.push({ url, form });
      return typeof result === "function" ? result(url, form) : result;
    },
    compressImage: async (blob) => new Blob([blob], { type: "image/jpeg" }),
  };
  return { deps, calls };
}

test("isValidChatId: sólo acepta UUID", () => {
  assert.equal(isValidChatId(CHAT), true);
  assert.equal(isValidChatId("local-123"), false);
  assert.equal(isValidChatId(""), false);
  assert.equal(isValidChatId(undefined), false);
  assert.equal(isValidChatId("11111111-2222-3333-4444-55555555555Z"), false);
});

test("allowlist cliente: positivos aprobados y negativos sin comodines", () => {
  for (const m of ["audio/webm", "text/plain", "text/csv", "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
    assert.equal(isPrivateUploadAllowedMime(m), true, m);
  }
  for (const m of ["", "application/octet-stream", "application/x-msdownload",
    "application/zip", "font/woff2", "video/x-matroska"]) {
    assert.equal(isPrivateUploadAllowedMime(m), false, m);
  }
});

test("isPrivateUploadSupported: vídeo sólo formatos soportados; imagen y allowlist", () => {
  assert.equal(isPrivateUploadSupported(blobOf("video/mp4"), "video"), true);
  assert.equal(isPrivateUploadSupported(blobOf("video/quicktime"), "video"), true);
  assert.equal(isPrivateUploadSupported(blobOf("video/webm"), "video"), true);
  assert.equal(isPrivateUploadSupported(blobOf("video/x-matroska"), "video"), false);
  assert.equal(isPrivateUploadSupported(blobOf("video/x-msvideo"), "video"), false);
  assert.equal(isPrivateUploadSupported(blobOf("video/3gpp"), "video"), false);
  assert.equal(isPrivateUploadSupported(blobOf("image/heic"), "file"), true);
  assert.equal(isPrivateUploadSupported(blobOf("audio/webm"), "audio"), true);
  assert.equal(isPrivateUploadSupported(blobOf("application/zip"), "file"), false);
  assert.equal(isPrivateUploadSupported(blobOf("application/octet-stream"), "file"), false);
});

test("planConversationUpload: chat remoto + MIME no admitido → reject (NUNCA chat-images)", () => {
  const cases: Array<[string, "file" | "video" | "audio"]> = [
    ["application/zip", "file"],
    ["application/octet-stream", "file"],
    ["application/x-msdownload", "file"],
    ["application/vnd.rar", "file"],
    ["video/x-matroska", "video"],
    ["video/x-msvideo", "video"],
    ["video/3gpp", "video"],
    ["audio/aac", "audio"],
  ];
  for (const [mime, kind] of cases) {
    const plan = planConversationUpload(blobOf(mime), CHAT, kind, { publicFolder: "files" });
    assert.equal(plan.action, "reject", mime);
  }
});

test("planConversationUpload: chat remoto + MIME admitido → privado", () => {
  assert.deepEqual(planConversationUpload(blobOf("image/png"), CHAT, "image"), { action: "private", kind: "image" });
  assert.deepEqual(planConversationUpload(blobOf("video/mp4"), CHAT, "video"), { action: "private", kind: "video" });
  assert.deepEqual(planConversationUpload(blobOf("audio/webm"), CHAT, "audio"), { action: "private", kind: "audio" });
  assert.deepEqual(planConversationUpload(blobOf("application/pdf"), CHAT, "file"), { action: "private", kind: "file" });
});

test("planConversationUpload: chat local (sin UUID) conserva el flujo público", () => {
  assert.deepEqual(
    planConversationUpload(blobOf("application/zip"), "local_123", "file", { publicFolder: "files" }),
    { action: "public", folder: "files" },
  );
  assert.deepEqual(
    planConversationUpload(blobOf("image/png"), undefined, "image", { publicFolder: "uploads" }),
    { action: "public", folder: "uploads" },
  );
});

test("planConversationUpload: sticker permanece público (chat-images)", () => {
  assert.deepEqual(
    planConversationUpload(blobOf("image/webp"), CHAT, "file", { isSticker: true, publicFolder: "stickers" }),
    { action: "public", folder: "stickers" },
  );
});

test("performPrivateUpload: MIME de vídeo no admitido lanza SIN llamar al endpoint", async () => {
  const { deps, calls } = makeDeps(okResult("http://x/y"));
  await assert.rejects(
    () => performPrivateUpload(blobOf("video/x-matroska"), CHAT, "video", deps),
    /MIME de video no admitido/,
  );
  assert.equal(calls.length, 0);
});

test("chat_id inválido: lanza ANTES de cualquier petición", async () => {
  const { deps, calls } = makeDeps(okResult("http://x/y"));
  await assert.rejects(
    () => performPrivateUpload(blobOf("audio/webm"), "chat-local", "audio", deps),
    /chat_id inválido/,
  );
  assert.equal(calls.length, 0);
});

test("audio permitido: endpoint de archivo, campo 'file', chat_id en query", async () => {
  const { deps, calls } = makeDeps(okResult("https://cdn/chat-media/c/a.webm"));
  const url = await performPrivateUpload(blobOf("audio/webm"), CHAT, "audio", deps);
  assert.equal(url, "https://cdn/chat-media/c/a.webm");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api/media/upload-private?chat_id=${CHAT}`);
  assert.equal(calls[0].form.has("file"), true);
  assert.equal(calls[0].form.has("video"), false);
  const name = (calls[0].form.get("file") as File).name;
  assert.match(name, /\.webm$/);
});

test("vídeo: usa endpoint de vídeo y campo 'video'", async () => {
  const { deps, calls } = makeDeps(okResult("https://cdn/chat-media/c/v.mp4"));
  await performPrivateUpload(blobOf("video/mp4"), CHAT, "video", deps);
  assert.equal(calls[0].url, `/api/media/upload-private-video?chat_id=${CHAT}`);
  assert.equal(calls[0].form.has("video"), true);
  assert.equal(calls[0].form.has("file"), false);
});

test("imagen: se comprime a jpeg antes de subir y usa campo 'file'", async () => {
  let compressed = false;
  const calls: Array<{ url: string; form: FormData }> = [];
  const deps: PrivateUploadDeps = {
    postMultipart: async (url, form) => { calls.push({ url, form }); return okResult("https://cdn/chat-media/c/i.jpg"); },
    compressImage: async (blob) => { compressed = true; return new Blob([blob], { type: "image/jpeg" }); },
  };
  await performPrivateUpload(blobOf("image/png"), CHAT, "image", deps);
  assert.equal(compressed, true);
  assert.equal(calls[0].url, `/api/media/upload-private?chat_id=${CHAT}`);
  const file = calls[0].form.get("file") as File;
  assert.equal(file.type, "image/jpeg");
  assert.match(file.name, /\.jpg$/);
});

test("MIME no admitido (no imagen/vídeo): lanza sin llamar al endpoint", async () => {
  const { deps, calls } = makeDeps(okResult("http://x/y"));
  await assert.rejects(
    () => performPrivateUpload(blobOf("application/zip"), CHAT, "file", deps),
    /MIME no admitido/,
  );
  assert.equal(calls.length, 0);
});

test("errores HTTP 401/403/400 se propagan con el código", async () => {
  for (const status of [400, 401, 403]) {
    const { deps } = makeDeps(errResult(status));
    await assert.rejects(
      () => performPrivateUpload(blobOf("audio/webm"), CHAT, "audio", deps),
      new RegExp(String(status)),
    );
  }
});

test("respuesta sin url → error explícito", async () => {
  const { deps } = makeDeps({ ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(
    () => performPrivateUpload(blobOf("audio/webm"), CHAT, "audio", deps),
    /sin url/,
  );
});

test("MIME_EXT: la extensión se deriva del MIME explícito (nunca del nombre)", () => {
  assert.equal(PRIVATE_MIME_EXT["audio/webm"], "webm");
  assert.equal(PRIVATE_MIME_EXT["text/csv"], "csv");
  assert.equal(PRIVATE_MIME_EXT["application/pdf"], "pdf");
  assert.equal(PRIVATE_MIME_EXT["video/x-matroska"], undefined);
});

// Pruebas locales de la lógica de subida privada (chat-media).
// Ejecutar: node --test server/src/lib/privateUpload.test.js
// No requiere red, Supabase ni otras dependencias.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIVATE_UPLOAD_BUCKET,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  ALLOWED_MIMES,
  normalizeMime,
  isAllowedMime,
  isVideoMime,
  isSupportedPrivateVideoMime,
  extForMime,
  isValidChatId,
  privateObjectPath,
  privateObjectUrl,
  createChatMembershipGuard,
} from './privateUpload.js';

// El módulo resuelve el host al importarse y FALLA explícitamente si
// `VITE_SUPABASE_URL` no está configurada: se define antes de la importación.
process.env.VITE_SUPABASE_URL = 'https://akgsylutbpgolurkcavh.supabase.co';
const { extractStorageRef, SUPABASE_HOST } = await import('./storageRefs.js');

const CHAT_ID = '11111111-2222-3333-4444-555555555555';

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('límites de subida privada (chat-media)', () => {
  assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
  // El bucket chat-media está configurado a 50 MiB: el endpoint de vídeo debe
  // coincidir para fallar con 413 en el servidor y no en Supabase.
  assert.equal(MAX_VIDEO_BYTES, 50 * 1024 * 1024);
});

test('normalizeMime / isAllowedMime / isVideoMime', () => {
  assert.equal(normalizeMime('image/jpeg; charset=utf-8'), 'image/jpeg');
  assert.equal(normalizeMime('  IMAGE/PNG '), 'image/png');
  assert.ok(isAllowedMime('image/jpeg'));
  assert.ok(isAllowedMime('video/mp4'));
  assert.ok(isAllowedMime('application/pdf'));
  assert.equal(isAllowedMime('application/x-msdownload'), false);
  assert.equal(isAllowedMime('text/html'), false);
  assert.ok(isVideoMime('video/quicktime'));
  assert.equal(isVideoMime('image/png'), false);
  // La lista pública sigue siendo la misma referencia de comportamiento.
  assert.equal(ALLOWED_MIMES.includes('image/webp'), true);
});

test('extForMime deriva extensión del MIME (nunca del nombre)', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg');
  assert.equal(extForMime('image/png'), 'png');
  assert.equal(extForMime('video/quicktime'), 'mov');
  assert.equal(extForMime('application/pdf'), 'pdf');
  assert.equal(extForMime('image/jpeg; charset=binary'), 'jpg');
  assert.equal(extForMime('application/x-evil'), 'bin');
});

test('allowlist ampliada: nota de voz (audio/webm) y documentos comunes', () => {
  // Nota de voz del cliente, incluso con codecs anexados (normaliza a audio/webm).
  assert.ok(isAllowedMime('audio/webm'));
  assert.ok(isAllowedMime('audio/webm;codecs=opus'));
  assert.equal(extForMime('audio/webm'), 'webm');

  const docs = {
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  };
  for (const [mime, ext] of Object.entries(docs)) {
    assert.ok(ALLOWED_MIMES.includes(mime), `debe listar ${mime}`);
    assert.ok(isAllowedMime(mime), `debe admitir ${mime}`);
    assert.equal(extForMime(mime), ext, `extensión de ${mime}`);
  }
});

test('allowlist: rechaza tipos no admitidos (sin comodines / no octet-stream)', () => {
  for (const mime of [
    'application/octet-stream',
    'application/zip',
    'application/x-msdownload',
    'application/javascript',
    'text/html',
    'audio/aac',
    'audio/flac',
  ]) {
    assert.equal(isAllowedMime(mime), false, `no debe admitir ${mime}`);
  }
  // video/x-matroska NO está en la allowlist de /upload-private ni del endpoint
  // de vídeo privado (ver pruebas siguientes), por lo que NO produce `.bin`.
  assert.equal(isAllowedMime('video/x-matroska'), false);
});

test('video: cualquier video/* es reconocido como MIME de vídeo', () => {
  assert.ok(isVideoMime('video/mp4'));
  assert.ok(isVideoMime('video/quicktime'));
  assert.ok(isVideoMime('video/webm'));
  assert.ok(isVideoMime('video/x-matroska'));
  assert.equal(isVideoMime('audio/webm'), false);
  assert.equal(isVideoMime('image/png'), false);
});

test('video privado: SÓLO formatos con ruta compatible (mp4/mov/webm)', () => {
  for (const mime of ['video/mp4', 'video/quicktime', 'video/webm']) {
    assert.equal(isSupportedPrivateVideoMime(mime), true, `debe admitir ${mime}`);
  }
  // Rechazados: no tienen extensión explícita ni ruta de procesamiento fiable.
  for (const mime of [
    'video/x-matroska',
    'video/x-msvideo',
    'video/3gpp',
    'video/mp2t',
    'audio/webm',
    'image/png',
    '',
  ]) {
    assert.equal(isSupportedPrivateVideoMime(mime), false, `no debe admitir ${mime}`);
  }
});

test('video privado: correspondencia MIME→extensión (nunca .bin)', () => {
  assert.equal(extForMime('video/mp4'), 'mp4');
  assert.equal(extForMime('video/quicktime'), 'mov');
  assert.equal(extForMime('video/webm'), 'webm');
  // Los formatos rechazados caerían en `bin`; por eso NO se admiten.
  assert.equal(extForMime('video/x-matroska'), 'bin');
  assert.equal(extForMime('video/x-msvideo'), 'bin');
  assert.equal(extForMime('video/3gpp'), 'bin');
});

test('isValidChatId sólo acepta UUID', () => {
  const valid = '11111111-2222-3333-4444-555555555555';
  assert.equal(isValidChatId(valid), true);
  assert.equal(isValidChatId('not-a-uuid'), false);
  assert.equal(isValidChatId('11111111-2222-3333-4444-55555555555'), false);
  assert.equal(isValidChatId('../../etc/passwd'), false);
  assert.equal(isValidChatId(''), false);
  assert.equal(isValidChatId(null), false);
});

test('privateObjectPath: <chat_uuid>/<uuid>.<ext> sin traversal', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const p = privateObjectPath('11111111-2222-3333-4444-555555555555', 'jpg', () => id);
  assert.equal(p, `11111111-2222-3333-4444-555555555555/${id}.jpg`);
  assert.equal(p.includes('..'), false);
  assert.equal(p.split('/').length, 2);
  // ext saneada: no puede inyectar segmentos.
  const evilExt = privateObjectPath('11111111-2222-3333-4444-555555555555', '../evil', () => id);
  assert.equal(evilExt, `11111111-2222-3333-4444-555555555555/${id}.evil`);
});

test('privateObjectUrl: URL canónica compatible con storageRefs (bucket chat-media)', () => {
  const host = `https://${SUPABASE_HOST}`;
  const path = '11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg';
  const url = privateObjectUrl(host, path);
  assert.equal(url, `${host}/storage/v1/object/public/${PRIVATE_UPLOAD_BUCKET}/${path}`);
  const ref = extractStorageRef(url);
  assert.deepEqual(ref, { bucket: PRIVATE_UPLOAD_BUCKET, path });
  // No es una URL firmada (no contiene token de firma).
  assert.equal(url.includes('/object/sign/'), false);
  assert.equal(url.includes('token='), false);
});

test('guard: miembro autorizado → next() y req.chatId', async () => {
  const validId = '11111111-2222-3333-4444-555555555555';
  const guard = createChatMembershipGuard({
    isChatMember: async (chatId, userId) => chatId === validId && userId === 'u1',
  });
  const req = { query: { chat_id: validId }, userId: 'u1' };
  const res = { status: () => res, json: () => res };
  let called = false;
  await guard(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.chatId, validId);
});

test('guard: no miembro → 403 y no llama next', async () => {
  const validId = '11111111-2222-3333-4444-555555555555';
  const guard = createChatMembershipGuard({ isChatMember: async () => false });
  const req = { query: { chat_id: validId }, userId: 'u2' };
  let status;
  let body;
  let called = false;
  const res = { status: (c) => { status = c; return res; }, json: (b) => { body = b; return res; } };
  await guard(req, res, () => { called = true; });
  assert.equal(status, 403);
  assert.equal(called, false);
  assert.equal(req.chatId, undefined);
  assert.ok(body.error);
});

test('guard: chat_id inválido o ausente → 400 y no llama next', async () => {
  const guard = createChatMembershipGuard({ isChatMember: async () => true });
  for (const query of [{ chat_id: 'not-a-uuid' }, { chat_id: '../../x' }, {}]) {
    let status; let called = false;
    const req = { query, userId: 'u1' };
    const res = { status: (c) => { status = c; return res; }, json: () => res };
    await guard(req, res, () => { called = true; });
    assert.equal(status, 400);
    assert.equal(called, false);
  }
});

test('guard: cabecera x-chat-id como alternativa a query', async () => {
  const validId = '11111111-2222-3333-4444-555555555555';
  const guard = createChatMembershipGuard({ isChatMember: async () => true });
  const req = { query: {}, headers: { 'x-chat-id': validId }, userId: 'u1' };
  let called = false;
  await guard(req, { status: () => req, json: () => req }, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.chatId, validId);
});

test('guard: error de verificación → 500 y no llama next', async () => {
  const validId = '11111111-2222-3333-4444-555555555555';
  const guard = createChatMembershipGuard({
    isChatMember: async () => { throw new Error('db down'); },
  });
  const req = { query: { chat_id: validId }, userId: 'u1' };
  let status; let called = false;
  const res = { status: (c) => { status = c; return res; }, json: () => res };
  await guard(req, res, () => { called = true; });
  assert.equal(status, 500);
  assert.equal(called, false);
});

// P1.4.1 — Pruebas de INTEGRACIÓN HTTP locales para el binding de referencias
// privadas (chat-media) al chat. Monta el authMiddleware REAL y los routers
// REALES de media.js y messages.js, e inyecta mocks en el singleton
// supabaseAdmin (misma instancia que usan los módulos importados).
//
// Sin red, sin credenciales y sin dependencias nuevas (usa 'express', ya
// instalado, y módulos nativos de Node).
//
// Ejecutar: node --test server/src/routes/privateRefs.integration.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

const SUPA = 'https://akgsylutbpgolurkcavh.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy-key-integration-tests';
process.env.VITE_SUPABASE_URL = SUPA;

const base = `${SUPA}/storage/v1/object/public`;
const PUBLIC_IMG = `${base}/chat-images/image/foo.jpg`;
const CHAT_A = '11111111-2222-3333-4444-555555555555';
const CHAT_B = '99999999-8888-7777-6666-555555555555';
const USER = 'user-member';
const PRIV_A = `${base}/chat-media/${CHAT_A}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`;
const PRIV_B = `${base}/chat-media/${CHAT_B}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`;

const db = await import('../db.js');
const mediaMod = await import('./media.js');
const messagesMod = await import('./messages.js');
const authMod = await import('../middleware/auth.js');
const express = (await import('express')).default;
const { MAX_VIDEO_BYTES } = await import('../lib/privateUpload.js');

// ── Estado simulado (por prueba; ejecución secuencial) ───────────────────────
const state = {
  chat: null,
  participants: new Set(),
  participantsList: [],
  messagesById: new Map(),
  messagesList: [],
  blocks: null,
  profiles: null,
  inserted: [],
  storageCalls: [],
  uploadError: null,
};
function reset() {
  state.chat = null;
  state.participants = new Set();
  state.participantsList = [];
  state.messagesById = new Map();
  state.messagesList = [];
  state.blocks = null;
  state.profiles = null;
  state.inserted = [];
  state.storageCalls = [];
  state.uploadError = null;
}
function memberChat(chatId, userId, isGroup = true) {
  state.chat = { profile_id: userId, admin_id: userId, is_group: isGroup, ephemeral_timer: 0 };
}
function foreignChat(chatId) {
  state.chat = { profile_id: 'someone-else', admin_id: 'someone-else', is_group: true, ephemeral_timer: 0 };
}

function makeBuilder(table) {
  const q = { _table: table, _eq: {}, _or: false, _op: 'select', _payload: null };
  const singleData = () => {
    if (q._op === 'insert') {
      const row = { ...(q._payload || {}) };
      if (!row.id) row.id = row.client_id || `gen-${state.inserted.length}`;
      state.inserted.push(row);
      return { data: row, error: null };
    }
    if (table === 'chats') return { data: state.chat, error: null };
    if (table === 'chat_participants') {
      const key = `${q._eq.chat_id}:${q._eq.profile_id}`;
      return { data: state.participants.has(key) ? { profile_id: q._eq.profile_id } : null, error: null };
    }
    if (table === 'messages') return { data: state.messagesById.get(q._eq.id) || null, error: null };
    if (table === 'blocks') return { data: state.blocks, error: null };
    if (table === 'profiles') return { data: state.profiles, error: null };
    return { data: null, error: null };
  };
  const arrayData = () => {
    if (q._op === 'update' || q._op === 'delete') return { data: null, error: null };
    if (q._op === 'insert') return { data: q._payload ? [q._payload] : [], error: null };
    if (table === 'chat_participants') return { data: state.participantsList, error: null };
    if (table === 'messages') return { data: state.messagesList, error: null };
    if (table === 'chats') return { data: state.chat ? [state.chat] : [], error: null };
    return { data: [], error: null };
  };
  const self = {
    select() { return self; },
    insert(payload) { q._op = 'insert'; q._payload = payload; return self; },
    update(payload) { q._op = 'update'; q._payload = payload; return self; },
    delete() { q._op = 'delete'; return self; },
    eq(col, val) { q._eq[col] = val; return self; },
    neq() { return self; },
    or() { q._or = true; return self; },
    order() { return self; },
    limit() { return self; },
    maybeSingle() { return Promise.resolve(singleData()); },
    single() { return Promise.resolve(singleData()); },
    then(res, rej) { return Promise.resolve(arrayData()).then(res, rej); },
  };
  return self;
}

db.supabaseAdmin.from = makeBuilder;
db.supabaseAdmin.rpc = async (name) => {
  return { data: null, error: { message: `RPC inesperada: ${name}` } };
};
db.supabaseAdmin.storage = {
  from(bucket) {
    return {
      async upload(objectPath, buffer, opts = {}) {
        state.storageCalls.push({ bucket, path: objectPath, opts });
        if (state.uploadError) return { data: null, error: { message: state.uploadError } };
        return { data: { path: objectPath }, error: null };
      },
      getPublicUrl(objectPath) {
        return { data: { publicUrl: `${base}/${bucket}/${objectPath}` } };
      },
      async createSignedUrls(paths) {
        return { data: paths.map((p) => ({ path: p, signedUrl: `SIGNED/${bucket}/${p}` })), error: null };
      },
    };
  },
};
db.supabaseAdmin.auth = {
  async getUser(token) {
    const m = /^tok:(.+)$/.exec(token || '');
    if (!m) return { data: { user: null }, error: { message: 'invalid' } };
    return { data: { user: { id: m[1], email: `${m[1]}@test` } }, error: null };
  },
};

const app = express();
app.use(express.json());
app.use('/api/media', authMod.authMiddleware, mediaMod.default);
app.use('/api/messages', authMod.authMiddleware, messagesMod.default);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const URL_BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const auth = (u = USER) => ({ Authorization: `Bearer tok:${u}` });
function jsonReq(path, body, u = USER) {
  return fetch(`${URL_BASE}${path}`, {
    method: 'POST',
    headers: { ...auth(u), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── /api/media/signed-url · Modo A ───────────────────────────────────────────
test('signed-url modo A: ref privada del chat correcto → 200 firmada', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesById.set('m1', { id: 'm1', chat_id: CHAT_A, image_url: PRIV_A, audio_url: null, video_url: null, file_url: null });
  const res = await jsonReq('/api/media/signed-url', { messageId: 'm1' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.image || '', new RegExp(`^SIGNED/chat-media/${CHAT_A}/`));
});

test('signed-url modo A: ref privada de OTRO chat → 403 (no se firma)', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesById.set('m1', { id: 'm1', chat_id: CHAT_A, image_url: PRIV_B, audio_url: null, video_url: null, file_url: null });
  const res = await jsonReq('/api/media/signed-url', { messageId: 'm1' });
  assert.equal(res.status, 403);
});

test('signed-url modo A: no miembro → 403', async () => {
  reset(); foreignChat(CHAT_A);
  state.messagesById.set('m1', { id: 'm1', chat_id: CHAT_A, image_url: PRIV_A, audio_url: null, video_url: null, file_url: null });
  const res = await jsonReq('/api/media/signed-url', { messageId: 'm1' });
  assert.equal(res.status, 403);
});

test('signed-url modo A: ref pública chat-images se conserva (200)', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesById.set('m1', { id: 'm1', chat_id: CHAT_A, image_url: PUBLIC_IMG, audio_url: null, video_url: null, file_url: null });
  const res = await jsonReq('/api/media/signed-url', { messageId: 'm1' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.image || '', /^SIGNED\/chat-images\//);
});

// ── /api/media/signed-url · Modo B ───────────────────────────────────────────
test('signed-url modo B: ref privada referenciada por un mensaje del chat correcto → 200', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesList = [{ chat_id: CHAT_A }];
  const res = await jsonReq('/api/media/signed-url', { urls: [PRIV_A] });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.signedUrls[PRIV_A] || '', new RegExp(`^SIGNED/chat-media/${CHAT_A}/`));
});

test('signed-url modo B: ref privada de otro chat referenciada desde mi chat → 403', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesList = [{ chat_id: CHAT_A }]; // el mensaje del atacante vive en CHAT_A
  const res = await jsonReq('/api/media/signed-url', { urls: [PRIV_B] }); // pero el objeto es de CHAT_B
  assert.equal(res.status, 403);
});

test('signed-url modo B: no miembro → 403', async () => {
  reset(); foreignChat(CHAT_A);
  state.messagesList = [{ chat_id: CHAT_A }];
  const res = await jsonReq('/api/media/signed-url', { urls: [PRIV_A] });
  assert.equal(res.status, 403);
});

test('signed-url modo B: ref pública chat-images se conserva (200)', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesList = [{ chat_id: CHAT_A }];
  const res = await jsonReq('/api/media/signed-url', { urls: [PUBLIC_IMG] });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.signedUrls[PUBLIC_IMG] || '', /^SIGNED\/chat-images\//);
});

test('signed-url: usuario anónimo (sin token) → 401', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesById.set('m1', { id: 'm1', chat_id: CHAT_A, image_url: PRIV_A, audio_url: null, video_url: null, file_url: null });
  const res = await fetch(`${URL_BASE}/api/media/signed-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: 'm1' }),
  });
  assert.equal(res.status, 401);
});

test('signed-url malformada (traversal en chat-media) → 400', async () => {
  reset(); memberChat(CHAT_A, USER);
  state.messagesList = [{ chat_id: CHAT_A }];
  const bad = `${base}/chat-media/../${CHAT_A}/x.png`;
  const res = await jsonReq('/api/media/signed-url', { urls: [bad] });
  assert.equal(res.status, 400);
});

// ── /api/messages/send ───────────────────────────────────────────────────────
function sendBody(extra = {}) {
  return { chat_id: CHAT_A, sender_id: USER, type: 'image', image_url: extra.image_url, ...extra };
}

test('send: ref privada del chat correcto → 200 e inserta', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await jsonReq('/api/messages/send', sendBody({ image_url: PRIV_A }));
  assert.equal(res.status, 200);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].image_url, PRIV_A);
  assert.equal(state.inserted[0].is_ephemeral, false);
  assert.equal(state.inserted[0].ephemeral_expires_at, null);
});

test('send: ref privada de OTRO chat → 400 y NO inserta', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await jsonReq('/api/messages/send', sendBody({ image_url: PRIV_B }));
  assert.equal(res.status, 400);
  assert.equal(state.inserted.length, 0);
});

test('send: ref privada malformada (traversal) → 400 y NO inserta', async () => {
  reset(); memberChat(CHAT_A, USER);
  const bad = `${base}/chat-media/../${CHAT_A}/x.png`;
  const res = await jsonReq('/api/messages/send', sendBody({ image_url: bad }));
  assert.equal(res.status, 400);
  assert.equal(state.inserted.length, 0);
});

test('send: ref pública chat-images se conserva → 200', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await jsonReq('/api/messages/send', sendBody({ image_url: PUBLIC_IMG }));
  assert.equal(res.status, 200);
  assert.equal(state.inserted.length, 1);
});

test('send: no miembro → 403', async () => {
  reset(); foreignChat(CHAT_A);
  const res = await jsonReq('/api/messages/send', sendBody({ image_url: PRIV_A }));
  assert.equal(res.status, 403);
  assert.equal(state.inserted.length, 0);
});

// ── /api/media/upload-private-video · formatos de vídeo privado ──────────────
async function videoReq(mime, filename, bytes = 8) {
  const form = new FormData();
  form.append('video', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  return fetch(`${URL_BASE}/api/media/upload-private-video?chat_id=${CHAT_A}`, {
    method: 'POST', headers: auth(), body: form,
  });
}

test('upload-private-video: MKV rechazado (400) y NO persiste objeto', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await videoReq('video/x-matroska', 'clip.mkv');
  assert.equal(res.status, 400);
  assert.equal(state.storageCalls.length, 0);
});

test('upload-private-video: AVI y 3GP rechazados (400) sin persistir', async () => {
  for (const [mime, name] of [['video/x-msvideo', 'a.avi'], ['video/3gpp', 'a.3gp']]) {
    reset(); memberChat(CHAT_A, USER);
    const res = await videoReq(mime, name);
    assert.equal(res.status, 400, mime);
    assert.equal(state.storageCalls.length, 0, mime);
  }
});

test('upload-private-video: MP4 pequeño se sube SIN transcodificar (ext .mp4)', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await videoReq('video/mp4', 'small.mp4', 1024);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.compressed, false);
  assert.equal(state.storageCalls.length, 1);
  assert.equal(state.storageCalls[0].bucket, 'chat-media');
  assert.match(state.storageCalls[0].path, /\.mp4$/);
  assert.equal(state.storageCalls[0].opts.contentType, 'video/mp4');
});

test('upload-private-video: excede el tamaño máximo (50 MiB) → 413 sin persistir', async () => {
  reset(); memberChat(CHAT_A, USER);
  const form = new FormData();
  form.append('video', new Blob([new Uint8Array(MAX_VIDEO_BYTES + 1)], { type: 'video/mp4' }), 'huge.mp4');
  const res = await fetch(`${URL_BASE}/api/media/upload-private-video?chat_id=${CHAT_A}`, {
    method: 'POST', headers: auth(), body: form,
  });
  assert.equal(res.status, 413);
  assert.equal(state.storageCalls.length, 0);
});

test('upload-private-video: no miembro → 403 (guard antes de multer)', async () => {
  reset(); foreignChat(CHAT_A);
  const res = await videoReq('video/mp4', 'x.mp4', 4);
  assert.equal(res.status, 403);
  assert.equal(state.storageCalls.length, 0);
});

// ── /api/media/upload-private · imagen/archivo y autorización ───────────────
async function fileReq(chatId = CHAT_A, token = `tok:${USER}`) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'x.png');
  return fetch(`${URL_BASE}/api/media/upload-private?chat_id=${chatId}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

test('upload-private: miembro del chat → 200 y sube a chat-media', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await fileReq();
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.bucket, 'chat-media');
  assert.match(json.path, new RegExp(`^${CHAT_A}/[0-9a-f-]+\\.png$`));
  assert.equal(state.storageCalls.length, 1);
  assert.equal(state.storageCalls[0].bucket, 'chat-media');
});

test('upload-private: usuario ajeno al chat → 403 sin subir', async () => {
  reset(); foreignChat(CHAT_A);
  const res = await fileReq();
  assert.equal(res.status, 403);
  assert.equal(state.storageCalls.length, 0);
});

test('upload-private: usuario anónimo (sin token) → 401 sin subir', async () => {
  reset(); memberChat(CHAT_A, USER);
  const res = await fileReq(CHAT_A, null);
  assert.equal(res.status, 401);
  assert.equal(state.storageCalls.length, 0);
});


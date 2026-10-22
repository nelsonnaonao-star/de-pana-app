// Cierre del bloqueo A1 — Recuperación de contraseña.
//
// Pruebas de INTEGRACIÓN HTTP locales para el flujo de recuperación por código.
// Monta el router REAL (server/src/routes/auth.js) y los middlewares REALES de
// rate-limit, e inyecta un mock en el singleton supabaseAdmin (misma instancia
// que usa el módulo importado). Sin red, sin credenciales y sin dependencias
// nuevas.
//
// Ejecutar: node --test src/routes/auth.reset.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

const SUPA = 'https://akgsylutbpgolurkcavh.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy-key-auth-reset-tests';
process.env.VITE_SUPABASE_URL = SUPA;

const db = await import('../db.js');

// ── Modelo de estado simulado ────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const PROFILE_ID = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'victima@example.com';

const state = {
  profiles: [],
  codes: [],
  nextId: 1,
  updatedPasswords: [],
  rpcError: null,
  rpcCalls: 0,
};

function resetState() {
  state.profiles = [{ id: PROFILE_ID, real_email: EMAIL }];
  state.codes = [];
  state.nextId = 1;
  state.updatedPasswords = [];
  state.rpcError = null;
  state.rpcCalls = 0;
}

function seedCode({
  code = '123456',
  profileId = PROFILE_ID,
  phone = EMAIL,
  expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  attempts = 0,
  used = false,
} = {}) {
  const row = { id: state.nextId++, profile_id: profileId, code, phone, expires_at: expiresAt, attempts, used };
  state.codes.push(row);
  return row;
}

// ── Mock del query-builder de supabase-js ────────────────────────────────────
function rowsOf(table) {
  if (table === 'password_reset_codes') return state.codes;
  if (table === 'profiles') return state.profiles;
  return [];
}

function matches(row, q) {
  for (const [col, val] of q.eq) if (row[col] !== val) return false;
  for (const [col, val] of q.gt) if (!(String(row[col]) > String(val))) return false;
  for (const [col, val] of q.lt) if (!(String(row[col]) < String(val))) return false;
  return true;
}

function makeBuilder(table) {
  const q = { table, op: 'select', payload: null, eq: [], gt: [], lt: [], wantSelect: false, orderDesc: false, limit: null };

  function run() {
    let matched = rowsOf(table).filter((r) => matches(r, q));

    if (q.op === 'insert') {
      const row = { id: state.nextId++, used: false, attempts: 0, ...q.payload };
      state.codes.push(row);
      return { data: q.wantSelect ? [row] : row, error: null };
    }
    if (q.op === 'update') {
      for (const r of matched) Object.assign(r, q.payload);
      return { data: q.wantSelect ? matched : null, error: null };
    }
    if (q.op === 'delete') {
      const keep = rowsOf(table).filter((r) => !matches(r, q));
      state.codes = keep;
      return { data: null, error: null };
    }
    // select
    if (q.orderDesc) matched = matched.slice().sort((a, b) => b.id - a.id);
    if (q.limit != null) matched = matched.slice(0, q.limit);
    return { data: matched, error: null };
  }

  const self = {
    select() { q.wantSelect = true; return self; },
    insert(p) { q.op = 'insert'; q.payload = p; return self; },
    update(p) { q.op = 'update'; q.payload = p; return self; },
    delete() { q.op = 'delete'; return self; },
    eq(c, v) { q.eq.push([c, v]); return self; },
    neq() { return self; },
    gt(c, v) { q.gt.push([c, v]); return self; },
    lt(c, v) { q.lt.push([c, v]); return self; },
    or() { return self; },
    order(_c, opts) { if (opts && opts.ascending === false) q.orderDesc = true; return self; },
    limit(n) { q.limit = n; return self; },
    single() {
      const r = run();
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      return Promise.resolve({ data: row ?? null, error: row ? null : { message: 'no rows' } });
    },
    maybeSingle() {
      const r = run();
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      return Promise.resolve({ data: row ?? null, error: null });
    },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return self;
}

db.supabaseAdmin.from = makeBuilder;

// RPC atómico `increment_password_reset_attempt` (equivalente a la migración
// 019, que NO se ejecuta en las pruebas). Es síncrono y sin awaits internos, de
// modo que incrementa de forma atómica incluso ante llamadas concurrentes: si
// el código se implementara con read-modify-write, aquí se detectaría la
// pérdida de incrementos.
db.supabaseAdmin.rpc = async (fn, params = {}) => {
  if (fn !== 'increment_password_reset_attempt') {
    return { data: null, error: { message: `rpc desconocida: ${fn}` } };
  }
  state.rpcCalls += 1;
  if (state.rpcError) {
    return { data: null, error: { message: state.rpcError } };
  }
  const row = state.codes.find((r) => r.id === params.p_id);
  if (!row || row.used) return { data: [], error: null };
  row.attempts = (row.attempts || 0) + 1;
  if (row.attempts >= params.p_max_attempts) row.used = true;
  return { data: [{ attempts: row.attempts, used: row.used }], error: null };
};

db.supabaseAdmin.auth = {
  admin: {
    async updateUserById(id, attrs) {
      state.updatedPasswords.push({ id, password: attrs.password });
      return { data: { user: { id } }, error: null };
    },
  },
};

// ── Servidor HTTP de prueba ──────────────────────────────────────────────────
const express = (await import('express')).default;
const authMod = await import('./auth.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/auth', authMod.default);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 200)}.${(ipCounter % 200) + 1}`;
}
function post(path, body, ip = uniqueIp()) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Regresión del flujo legítimo (send → verify → update con código correcto)
// ─────────────────────────────────────────────────────────────────────────────
test('flujo legítimo: send→verify→update con código correcto', async () => {
  resetState();
  const ip = uniqueIp();

  const send = await post('/api/auth/send-reset-code', { email: EMAIL }, ip);
  assert.equal(send.status, 200);
  const sendJson = await send.json();
  assert.equal(sendJson.profileId, PROFILE_ID);
  assert.equal(state.codes.length, 1);
  const code = state.codes[0].code;

  const verify = await post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code }, ip);
  assert.equal(verify.status, 200, 'el código correcto debe verificar');
  const verifyJson = await verify.json();
  assert.equal(verifyJson.message, 'Código verificado');
  assert.equal(verifyJson.email, undefined, 'no debe devolverse el correo completo');

  const update = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code, newPassword: 'nueva123' },
    ip,
  );
  assert.equal(update.status, 200);
  assert.equal(state.updatedPasswords.length, 1);
  assert.equal(state.updatedPasswords[0].password, 'nueva123');
  assert.equal(state.codes[0].used, true, 'el código debe quedar consumido');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. A1: los intentos fallidos en /update-password NO deben eludir el límite
// ─────────────────────────────────────────────────────────────────────────────
test('A1: /update-password bloquea tras 5 intentos fallidos', async () => {
  resetState();
  const ip = uniqueIp();
  const row = seedCode({ code: '123456' });

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const r = await post(
      '/api/auth/update-password',
      { profileId: PROFILE_ID, email: EMAIL, code: '000000', newPassword: 'x12345' },
      ip,
    );
    assert.equal(r.status, 400, `intento fallido #${i}`);
  }

  assert.equal(row.used, true, 'tras 5 fallos el código debe quedar inutilizable');
  assert.ok(row.attempts >= MAX_ATTEMPTS, `attempts=${row.attempts}`);
  assert.equal(state.updatedPasswords.length, 0, 'ningún cambio de contraseña debe ocurrir');

  // Incluso con el código correcto, ya está bloqueado.
  const ok = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'x12345' },
    ip,
  );
  assert.equal(ok.status, 400, 'no debe permitirse el código correcto tras el bloqueo');
  assert.equal(state.updatedPasswords.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Intentos alternados entre /verify-reset-code y /update-password
// ─────────────────────────────────────────────────────────────────────────────
test('A1: intentos alternados verify/update comparten el mismo contador', async () => {
  resetState();
  const ip = uniqueIp();
  const row = seedCode({ code: '123456' });

  for (let i = 0; i < 3; i++) {
    const r = await post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code: '111111' }, ip);
    assert.equal(r.status, 400);
  }
  assert.equal(row.attempts, 3, 'verify debe incrementar el contador');

  for (let i = 0; i < 3; i++) {
    const r = await post(
      '/api/auth/update-password',
      { profileId: PROFILE_ID, email: EMAIL, code: '222222', newPassword: 'x12345' },
      ip,
    );
    assert.equal(r.status, 400);
  }
  assert.ok(row.attempts >= MAX_ATTEMPTS, `attempts=${row.attempts} (los fallos de update deben contar)`);

  const ok = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'x12345' },
    ip,
  );
  assert.equal(ok.status, 400, 'el código correcto ya no debe servir');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Código caducado
// ─────────────────────────────────────────────────────────────────────────────
test('código caducado no permite cambiar la contraseña', async () => {
  resetState();
  seedCode({ code: '123456', expiresAt: new Date(Date.now() - 1000).toISOString() });

  const r = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'x12345' },
    uniqueIp(),
  );
  assert.equal(r.status, 400);
  assert.equal(state.updatedPasswords.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reutilización de un código ya consumido
// ─────────────────────────────────────────────────────────────────────────────
test('un código ya consumido no se puede reutilizar', async () => {
  resetState();
  const ip = uniqueIp();
  const row = seedCode({ code: '123456' });

  const first = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'clave1' },
    ip,
  );
  assert.equal(first.status, 200);
  assert.equal(row.used, true);

  const second = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'clave2' },
    ip,
  );
  assert.equal(second.status, 400, 'no debe permitirse reutilizar el código');
  assert.equal(state.updatedPasswords.length, 1, 'solo el primer uso cambia la contraseña');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Concurrencia: dos usos simultáneos del mismo código
// ─────────────────────────────────────────────────────────────────────────────
test('concurrencia: dos update simultáneos con el mismo código → solo uno consume', async () => {
  resetState();
  const ip = uniqueIp();
  seedCode({ code: '123456' });

  const [a, b] = await Promise.all([
    post('/api/auth/update-password', { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'uno123' }, ip),
    post('/api/auth/update-password', { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'dos123' }, ip),
  ]);

  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 400], 'exactamente una petición debe ganar');
  assert.equal(state.updatedPasswords.length, 1, 'solo una debe cambiar la contraseña');
  assert.equal(state.codes[0].used, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Anti-enumeración: usuario inexistente con respuesta uniforme
// ─────────────────────────────────────────────────────────────────────────────
test('send-reset-code: respuesta uniforme para correo existente e inexistente', async () => {
  resetState();
  const ip = uniqueIp();

  const existing = await post('/api/auth/send-reset-code', { email: EMAIL }, ip);
  const missing = await post('/api/auth/send-reset-code', { email: 'nadie@example.com' }, ip);

  assert.equal(existing.status, 200);
  assert.equal(missing.status, 200);

  const ej = await existing.json();
  const mj = await missing.json();
  assert.deepEqual(Object.keys(ej).sort(), Object.keys(mj).sort(), 'misma forma de respuesta');
  assert.equal(typeof mj.profileId, 'string');
  assert.ok(mj.maskedEmail.includes('@'), 'email enmascarado no debe filtrar los datos reales');
  assert.equal(state.codes.length, 1, 'solo se debe crear código para el correo existente');
});

test('verify con profileId inexistente → 400 genérico', async () => {
  resetState();
  const r = await post('/api/auth/verify-reset-code', { profileId: 'no-existe', code: '123456' }, uniqueIp());
  assert.equal(r.status, 400);
});

test('send-reset-email no revela existencia (mismo mensaje)', async () => {
  resetState();
  const a = await post('/api/auth/send-reset-email', { identifier: 'victima' }, uniqueIp());
  const b = await post('/api/auth/send-reset-email', { identifier: 'noexiste' }, uniqueIp());
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json());
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. A1: incrementos concurrentes NO se pierden (operación atómica)
//    Con un read-modify-write, 5 peticiones simultáneas leerían attempts=0 y
//    escribirían todas attempts=1 → el límite se eludiría. El RPC atómico debe
//    producir exactamente 5.
// ─────────────────────────────────────────────────────────────────────────────
test('A1: 5 intentos fallidos concurrentes suman exactamente 5 (sin perder incrementos)', async () => {
  resetState();
  const ip = uniqueIp();
  const row = seedCode({ code: '123456' });

  const responses = await Promise.all(
    Array.from({ length: MAX_ATTEMPTS }, () =>
      post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code: '000000' }, ip),
    ),
  );
  for (const r of responses) assert.equal(r.status, 400);

  assert.equal(row.attempts, MAX_ATTEMPTS, `attempts=${row.attempts} (se perdieron incrementos)`);
  assert.equal(row.used, true, 'el código debe quedar bloqueado al 5º intento');
  assert.equal(state.rpcCalls, MAX_ATTEMPTS, 'cada fallo debe invocar el incremento atómico');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. A1: error de persistencia en verify → 500, no se finge intento registrado
// ─────────────────────────────────────────────────────────────────────────────
test('A1: si falla el incremento en verify responde 500 (no 400)', async () => {
  resetState();
  const row = seedCode({ code: '123456' });
  state.rpcError = 'fallo de escritura simulado';

  const r = await post(
    '/api/auth/verify-reset-code',
    { profileId: PROFILE_ID, code: '000000' },
    uniqueIp(),
  );
  assert.equal(r.status, 500, 'debe fallar cerrado si no se persiste el intento');
  assert.equal(state.rpcCalls, 1);
  assert.equal(row.attempts, 0, 'no debe darse por registrado el intento');
  assert.equal(row.used, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. A1: error de persistencia en update → 500 y sin cambio de contraseña
// ─────────────────────────────────────────────────────────────────────────────
test('A1: si falla el incremento en update responde 500 y no cambia la contraseña', async () => {
  resetState();
  const row = seedCode({ code: '123456' });
  state.rpcError = 'fallo de escritura simulado';

  const r = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '000000', newPassword: 'x12345' },
    uniqueIp(),
  );
  assert.equal(r.status, 500);
  assert.equal(state.rpcCalls, 1);
  assert.equal(row.attempts, 0);
  assert.equal(state.updatedPasswords.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. A1: bloqueo exactamente en el quinto intento (ni antes ni después)
// ─────────────────────────────────────────────────────────────────────────────
test('A1: el código se bloquea exactamente al quinto intento', async () => {
  resetState();
  const ip = uniqueIp();
  const row = seedCode({ code: '123456' });

  for (let i = 1; i <= MAX_ATTEMPTS - 1; i++) {
    const r = await post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code: '000000' }, ip);
    assert.equal(r.status, 400, `intento #${i}`);
  }
  assert.equal(row.attempts, MAX_ATTEMPTS - 1);
  assert.equal(row.used, false, 'antes del 5º intento el código sigue utilizable');

  const fifth = await post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code: '000000' }, ip);
  assert.equal(fifth.status, 400);
  assert.equal(row.attempts, MAX_ATTEMPTS);
  assert.equal(row.used, true, 'en el 5º intento debe quedar inutilizable');

  const correctAfterLock = await post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code: '123456' }, ip);
  assert.equal(correctAfterLock.status, 400, 'ya no debe servir ni el código correcto');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. A1: consumo único — el código válido se consume exactamente una vez
// ─────────────────────────────────────────────────────────────────────────────
test('A1: el código válido se consume exactamente una vez', async () => {
  resetState();
  const ip = uniqueIp();
  const row = seedCode({ code: '123456' });

  const first = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'unico1' },
    ip,
  );
  assert.equal(first.status, 200);
  assert.equal(row.used, true);

  const verifyAfter = await post('/api/auth/verify-reset-code', { profileId: PROFILE_ID, code: '123456' }, ip);
  assert.equal(verifyAfter.status, 400, 'un código consumido ya no verifica');

  const second = await post(
    '/api/auth/update-password',
    { profileId: PROFILE_ID, email: EMAIL, code: '123456', newPassword: 'unico2' },
    ip,
  );
  assert.equal(second.status, 400);
  assert.equal(state.updatedPasswords.length, 1, 'solo el primer consumo cambia la contraseña');
  assert.equal(state.updatedPasswords[0].password, 'unico1');
});

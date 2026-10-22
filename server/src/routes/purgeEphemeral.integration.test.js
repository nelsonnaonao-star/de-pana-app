// Pruebas de INTEGRACIÓN HTTP locales para el endpoint de purga de mensajes
// temporales. Monta el authMiddleware REAL y el router REAL de messages.js e
// inyecta un mock en el singleton supabaseAdmin (misma instancia que usan los
// módulos importados).
//
// Sin red, sin credenciales y sin dependencias nuevas (usa 'express', ya
// instalado, y módulos nativos de Node).
//
// Ejecutar: node --test server/src/routes/purgeEphemeral.integration.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

const SUPA = 'https://akgsylutbpgolurkcavh.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy-key-purge-integration-tests';
process.env.VITE_SUPABASE_URL = SUPA;

const db = await import('../db.js');
const messagesMod = await import('./messages.js');
const authMod = await import('../middleware/auth.js');
const express = (await import('express')).default;

const USER = 'user-member';

// Builder mínimo: cualquier consulta devuelve vacío. La prueba sólo verifica que
// el endpoint ya no existe, así que no debe llegar a la base de datos.
function makeBuilder() {
  const q = {
    select() { return q; },
    insert() { return q; },
    update() { return q; },
    delete() { return q; },
    eq() { return q; },
    neq() { return q; },
    or() { return q; },
    order() { return q; },
    limit() { return q; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    single() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
  };
  return q;
}

let rpcCalls = 0;

db.supabaseAdmin.from = makeBuilder;
db.supabaseAdmin.rpc = async (name) => {
  rpcCalls += 1;
  return { data: null, error: { message: `RPC inesperada: ${name}` } };
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
app.use('/api/messages', authMod.authMiddleware, messagesMod.default);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const URL_BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('purge-ephemeral: usuario autenticado no puede disparar la purga → 404', async () => {
  rpcCalls = 0;
  const res = await fetch(`${URL_BASE}/api/messages/purge-ephemeral`, {
    method: 'POST',
    headers: { Authorization: `Bearer tok:${USER}` },
  });
  assert.equal(res.status, 404);
  assert.equal(rpcCalls, 0);
});

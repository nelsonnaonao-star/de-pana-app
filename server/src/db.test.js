// Prueba de validación FAIL-FAST de `SUPABASE_SERVICE_KEY` en `db.js`.
//
// No usa refactor: `db.js` crea el cliente al importarse, así que el caso
// "falta la clave" se ejercita en un proceso hijo con la variable ausente y se
// comprueba que el arranque falla con un mensaje que nombra la variable (sin
// revelar su valor). El caso "clave presente" usa un valor dummy local.
//
// Ejecutar: node --test server/src/db.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const dbUrl = new URL('./db.js', import.meta.url).href;
const FALLBACK_URL = 'https://example.supabase.co';

function importDb(env) {
  execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(dbUrl)});`],
    { env, stdio: 'pipe', encoding: 'utf8' },
  );
}

test('db.js falla al arrancar si SUPABASE_SERVICE_KEY falta', () => {
  const env = { ...process.env, VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || FALLBACK_URL };
  delete env.SUPABASE_SERVICE_KEY;

  let error = null;
  try {
    importDb(env);
  } catch (e) {
    error = e;
  }

  assert.ok(error, 'se esperaba que la importación de db.js fallara');
  const output = String(error.stderr || '') + String(error.stdout || '');
  assert.match(output, /SUPABASE_SERVICE_KEY/);
});

test('db.js arranca si SUPABASE_SERVICE_KEY está presente', () => {
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || FALLBACK_URL,
    SUPABASE_SERVICE_KEY: 'dummy-key-db-test',
  };
  assert.doesNotThrow(() => importDb(env));
});

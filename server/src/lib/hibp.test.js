// Pruebas del chequeo HIBP k-anonymity del servidor. Sin red: se inyecta fetch.
// Ejecutar: node --test src/lib/hibp.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sha1Hex,
  splitSha1,
  parseHibpRange,
  getPasswordLeakCount,
  assertPasswordNotLeaked,
} from './hibp.js';

const PASSWORD = 'password';
const SHA1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
const SUFFIX = SHA1.slice(5);

function response(body) {
  return { ok: true, text: async () => body };
}

test('sha1Hex coincide con el vector conocido', () => {
  assert.equal(sha1Hex(PASSWORD), SHA1);
});

test('splitSha1 separa prefijo y sufijo', () => {
  assert.deepEqual(splitSha1(SHA1.toLowerCase()), {
    prefix: '5BAA6',
    suffix: SUFFIX,
  });
});

test('parseHibpRange encuentra el sufijo (CRLF, minúsculas)', () => {
  const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:9546821\r\n`;
  assert.equal(parseHibpRange(body, SUFFIX.toLowerCase()), 9546821);
});

test('parseHibpRange devuelve 0 si no aparece', () => {
  assert.equal(parseHibpRange('AAAA:1\nBBBB:2', SUFFIX), 0);
});

test('getPasswordLeakCount consulta el prefijo correcto', async () => {
  let calledUrl = '';
  const fetchImpl = async (url) => {
    calledUrl = String(url);
    return response(`${SUFFIX}:3\r\n`);
  };

  assert.equal(await getPasswordLeakCount(PASSWORD, { fetchImpl }), 3);
  assert.ok(calledUrl.endsWith('/5BAA6'));
});

test('fail-open si la red falla', async () => {
  const fetchImpl = async () => {
    throw new Error('offline');
  };

  assert.equal(await getPasswordLeakCount(PASSWORD, { fetchImpl }), 0);
});

test('assertPasswordNotLeaked lanza con code PASSWORD_LEAKED', async () => {
  const fetchImpl = async () => response(`${SUFFIX}:5\r\n`);

  await assert.rejects(
    () => assertPasswordNotLeaked(PASSWORD, { fetchImpl }),
    (error) => error.code === 'PASSWORD_LEAKED',
  );
});

test('assertPasswordNotLeaked no lanza si no aparece', async () => {
  const fetchImpl = async () => response('AAAA:1\r\n');
  await assert.doesNotReject(() =>
    assertPasswordNotLeaked(PASSWORD, { fetchImpl }),
  );
});

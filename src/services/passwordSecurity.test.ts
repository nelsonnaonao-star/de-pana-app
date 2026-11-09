// Pruebas del chequeo HIBP k-anonymity. Sin red: se inyecta fetch.
// Ejecutar: npx tsx --test src/services/passwordSecurity.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  splitSha1,
  parseHibpRange,
  sha1Hex,
  getPasswordLeakCount,
  assertPasswordNotLeaked,
} from "./passwordSecurity";

const PASSWORD = "password";
const SHA1 = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const SUFFIX = SHA1.slice(5);

function response(body: string): Response {
  return { ok: true, text: async () => body } as unknown as Response;
}

test("sha1Hex coincide con el vector conocido", async () => {
  assert.equal(await sha1Hex(PASSWORD), SHA1);
});

test("splitSha1 separa prefijo y sufijo", () => {
  assert.deepEqual(splitSha1(SHA1.toLowerCase()), {
    prefix: "5BAA6",
    suffix: SUFFIX,
  });
});

test("parseHibpRange encuentra el sufijo (CRLF, minúsculas)", () => {
  const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:9546821\r\n`;
  assert.equal(parseHibpRange(body, SUFFIX.toLowerCase()), 9546821);
});

test("parseHibpRange devuelve 0 si no aparece", () => {
  assert.equal(parseHibpRange("AAAA:1\nBBBB:2", SUFFIX), 0);
});

test("getPasswordLeakCount consulta el prefijo correcto", async () => {
  let calledUrl = "";
  const fetchImpl = (async (url: string | URL) => {
    calledUrl = String(url);
    return response(`${SUFFIX}:3\r\n`);
  }) as unknown as typeof fetch;

  assert.equal(await getPasswordLeakCount(PASSWORD, { fetchImpl }), 3);
  assert.ok(calledUrl.endsWith("/5BAA6"));
});

test("fail-open si la red falla", async () => {
  const fetchImpl = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;

  assert.equal(await getPasswordLeakCount(PASSWORD, { fetchImpl }), 0);
});

test("assertPasswordNotLeaked lanza si aparece", async () => {
  const fetchImpl = (async () =>
    response(`${SUFFIX}:5\r\n`)) as unknown as typeof fetch;

  await assert.rejects(() => assertPasswordNotLeaked(PASSWORD, { fetchImpl }));
});

test("assertPasswordNotLeaked no lanza si no aparece", async () => {
  const fetchImpl = (async () =>
    response("AAAA:1\r\n")) as unknown as typeof fetch;

  await assert.doesNotReject(() =>
    assertPasswordNotLeaked(PASSWORD, { fetchImpl }),
  );
});

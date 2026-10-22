// Pruebas del núcleo de resolución (caché, dedupe, expiración, passthrough).
// Ejecutar: npx tsx --test src/services/mediaResolver.test.ts
// Sin red: el firmador se inyecta como dependencia.

import test from "node:test";
import assert from "node:assert/strict";

import { createMediaResolver } from "./mediaResolver";
import { SUPABASE_HOST, PUBLIC_BUCKET, PRIVATE_BUCKET, storageBaseUrl } from "./storageRefs";

const base = `https://${SUPABASE_HOST}/storage/v1/object/public`;
const CHAT_A = "11111111-2222-3333-4444-555555555555";
const media = `${base}/${PRIVATE_BUCKET}/${CHAT_A}/video/bar.mp4`;
const img = `${base}/${PUBLIC_BUCKET}/image/foo.jpg`;
const signBase = `https://${SUPABASE_HOST}/storage/v1/object/sign`;

function makeSigner(expiresIn = 3600) {
  const calls: string[] = [];
  const sign = async (key: string) => {
    calls.push(key);
    return { url: `${signBase}/${key.split("/object/public/")[1]}?token=${calls.length}`, expiresIn };
  };
  return { sign, calls };
}

test("passthrough: externos, blob y data no se firman", async () => {
  const { sign, calls } = makeSigner();
  const r = createMediaResolver(sign);
  assert.equal(await r.resolveMediaUrl("https://external.example/x.jpg"), "https://external.example/x.jpg");
  assert.equal(await r.resolveMediaUrl("blob:http://x/y"), "blob:http://x/y");
  assert.equal(await r.resolveMediaUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(calls.length, 0);
});

test("firma canónica de chat-media y cachea por object path", async () => {
  const { sign, calls } = makeSigner();
  const r = createMediaResolver(sign);
  assert.equal(r.getResolvedMediaUrlSync(media), null);

  const signed = await r.resolveMediaUrl(media);
  assert.ok(signed.startsWith(signBase));
  assert.equal(signed, `${signBase}/${PRIVATE_BUCKET}/${CHAT_A}/video/bar.mp4?token=1`);

  // El sync ya ve el valor cacheado.
  assert.equal(r.getResolvedMediaUrlSync(media), signed);

  // Segunda resolución: cache hit (sin nueva firma).
  assert.equal(await r.resolveMediaUrl(media), signed);
  assert.equal(calls.length, 1);
  // El firmador recibió la clave canónica estable.
  assert.equal(calls[0], media);
});

test("identidad de caché: canónica y firmada comparten clave (no re-firma)", async () => {
  const { sign, calls } = makeSigner();
  const r = createMediaResolver(sign);
  const signed = await r.resolveMediaUrl(media);
  // Entrada firmada (equivale a la misma clave normalizada) → cache hit.
  const signedInput = signed;
  assert.equal(await r.resolveMediaUrl(signedInput), signed);
  assert.equal(calls.length, 1);
  assert.equal(storageBaseUrl(signedInput), media);
});

test("expiración: tras el TTL se renueva la firma", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const { sign, calls } = makeSigner(3600); // ttl = 3600-300 = 3300s
  const r = createMediaResolver(sign);
  const first = await r.resolveMediaUrl(media);
  assert.equal(calls.length, 1);
  assert.equal(r.getResolvedMediaUrlSync(media), first);

  // Dentro del TTL: sigue cacheado.
  t.mock.timers.tick(3300 * 1000 - 1000);
  assert.equal(r.getResolvedMediaUrlSync(media), first);

  // Pasado el TTL: el sync deja de servirla y se re-firma.
  t.mock.timers.tick(2000);
  assert.equal(r.getResolvedMediaUrlSync(media), null);
  const second = await r.resolveMediaUrl(media);
  assert.equal(calls.length, 2);
  assert.notEqual(second, first);
  t.mock.timers.reset();
});

test("dedupe en vuelo: N llamadas concurrentes comparten una sola firma", async () => {
  const { sign, calls } = makeSigner();
  const r = createMediaResolver(sign);
  const [a, b, c] = await Promise.all([
    r.resolveMediaUrl(media),
    r.resolveMediaUrl(media),
    r.resolveMediaUrl(media),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(calls.length, 1);
});

test("fallo de firma se propaga y libera el inflight (reintentable)", async () => {
  let fail = true;
  const calls: string[] = [];
  const sign = async (key: string) => {
    calls.push(key);
    if (fail) throw new Error("boom");
    return { url: `${signBase}/x?token=1`, expiresIn: 3600 };
  };
  const r = createMediaResolver(sign);
  await assert.rejects(() => r.resolveMediaUrl(media));
  assert.equal(r.getResolvedMediaUrlSync(media), null);
  fail = false;
  const ok = await r.resolveMediaUrl(media);
  assert.ok(ok.startsWith(signBase));
  assert.equal(calls.length, 2);
});

test("clearResolvedMediaUrl / clearAllResolvedMedia vacían la caché", async () => {
  const { sign } = makeSigner();
  const r = createMediaResolver(sign);
  await r.resolveMediaUrl(media);
  await r.resolveMediaUrl(img);
  r.clearResolvedMediaUrl(media);
  assert.equal(r.getResolvedMediaUrlSync(media), null);
  assert.ok(r.getResolvedMediaUrlSync(img));
  r.clearAllResolvedMedia();
  assert.equal(r.getResolvedMediaUrlSync(img), null);
});

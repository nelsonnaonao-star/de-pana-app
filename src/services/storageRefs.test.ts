// Pruebas de clasificación/normalización de referencias propias.
// Ejecutar: npx tsx --test src/services/storageRefs.test.ts
// Sin red, Supabase ni dependencias externas.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPABASE_HOST,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  parseStorageRef,
  parseSignedStorageRef,
  isSignableStorageUrl,
  isStorageSignedUrl,
  isChatImagesUrl,
  isChatImagesSignedUrl,
  storageBaseUrl,
} from "./storageRefs";

const base = `https://${SUPABASE_HOST}/storage/v1/object/public`;
const signBase = `https://${SUPABASE_HOST}/storage/v1/object/sign`;
const CHAT_A = "11111111-2222-3333-4444-555555555555";

const img = `${base}/${PUBLIC_BUCKET}/image/foo.jpg`;
const media = `${base}/${PRIVATE_BUCKET}/${CHAT_A}/video/bar.mp4`;
const signedImg = `${signBase}/${PUBLIC_BUCKET}/image/foo.jpg?token=aaa`;
const signedMedia = `${signBase}/${PRIVATE_BUCKET}/${CHAT_A}/video/bar.mp4?token=bbb`;

test("parseStorageRef: reconoce chat-images y chat-media como buckets distintos", () => {
  assert.deepEqual(parseStorageRef(img), { bucket: PUBLIC_BUCKET, path: "image/foo.jpg" });
  assert.deepEqual(parseStorageRef(media), {
    bucket: PRIVATE_BUCKET,
    path: `${CHAT_A}/video/bar.mp4`,
  });
  // Misma carpeta, distinto bucket → distinto resultado (no se infiere por carpeta).
  const avatarPublico = `${base}/${PUBLIC_BUCKET}/uploads/avatars/a.png`;
  const avatarPrivado = `${base}/${PRIVATE_BUCKET}/${CHAT_A}/uploads/avatars/a.png`;
  assert.equal(parseStorageRef(avatarPublico)?.bucket, PUBLIC_BUCKET);
  assert.equal(parseStorageRef(avatarPrivado)?.bucket, PRIVATE_BUCKET);
});

test("parseStorageRef: rechaza host ajeno, bucket desconocido, traversal y no-http", () => {
  assert.equal(parseStorageRef(`https://evil.example.com/storage/v1/object/public/${PUBLIC_BUCKET}/x.jpg`), null);
  assert.equal(parseStorageRef(`${base}/stickers_oficiales/a.png`), null);
  assert.equal(parseStorageRef(`${base}/${PUBLIC_BUCKET}/../secret.txt`), null);
  assert.equal(parseStorageRef(`${base}/${PUBLIC_BUCKET}/%2e%2e/secret.txt`), null);
  assert.equal(parseStorageRef(`${base}/${PUBLIC_BUCKET}//leading.txt`), null);
  assert.equal(parseStorageRef(`${base}/${PUBLIC_BUCKET}/`), null);
  assert.equal(parseStorageRef(`blob:http://x/y`), null);
  assert.equal(parseStorageRef(`data:image/png;base64,AAAA`), null);
  assert.equal(parseStorageRef("some-internal-id"), null);
  assert.equal(parseStorageRef(""), null);
  assert.equal(parseStorageRef(null), null);
  assert.equal(parseStorageRef(undefined), null);
});

test("parseSignedStorageRef: reconoce la forma firmada de ambos buckets", () => {
  assert.deepEqual(parseSignedStorageRef(signedImg), { bucket: PUBLIC_BUCKET, path: "image/foo.jpg" });
  assert.deepEqual(parseSignedStorageRef(signedMedia), {
    bucket: PRIVATE_BUCKET,
    path: `${CHAT_A}/video/bar.mp4`,
  });
  // Canónica (public) NO es firmada; externo tampoco.
  assert.equal(parseSignedStorageRef(img), null);
  assert.equal(parseSignedStorageRef(media), null);
  assert.equal(parseSignedStorageRef(`https://evil.example.com/storage/v1/object/sign/${PUBLIC_BUCKET}/x?token=1`), null);
});

test("isSignableStorageUrl / isStorageSignedUrl distinguen canónica y firmada", () => {
  assert.equal(isSignableStorageUrl(img), true);
  assert.equal(isSignableStorageUrl(media), true);
  assert.equal(isSignableStorageUrl(signedImg), true);
  assert.equal(isSignableStorageUrl(signedMedia), true);
  assert.equal(isSignableStorageUrl("https://external.example/x.jpg"), false);
  assert.equal(isSignableStorageUrl("blob:http://x/y"), false);
  assert.equal(isSignableStorageUrl("data:image/png;base64,AAAA"), false);

  assert.equal(isStorageSignedUrl(signedImg), true);
  assert.equal(isStorageSignedUrl(signedMedia), true);
  assert.equal(isStorageSignedUrl(img), false);
  assert.equal(isStorageSignedUrl(media), false);
});

test("isChatImagesUrl / isChatImagesSignedUrl son estrictos de chat-images", () => {
  assert.equal(isChatImagesUrl(img), true);
  assert.equal(isChatImagesUrl(media), false);
  assert.equal(isChatImagesSignedUrl(signedImg), true);
  assert.equal(isChatImagesSignedUrl(signedMedia), false);
});

test("storageBaseUrl: normaliza firmadas a canónica sin transformar privada en pública usable", () => {
  // Firmadas → canónica (identidad estable), manteniendo SU bucket.
  assert.equal(storageBaseUrl(signedImg), img);
  assert.equal(storageBaseUrl(signedMedia), media);
  // Canónicas (con o sin query) → intactas salvo la query.
  assert.equal(storageBaseUrl(img), img);
  assert.equal(storageBaseUrl(media), media);
  assert.equal(storageBaseUrl(`${media}?x=1`), media);
  // La privada normaliza a chat-media (NUNCA a chat-images): no se "publica".
  assert.ok(storageBaseUrl(signedMedia)!.includes(`/${PRIVATE_BUCKET}/`));
  assert.ok(!storageBaseUrl(signedMedia)!.includes(`/${PUBLIC_BUCKET}/`));
  // Externos / blob / data → intactos.
  assert.equal(storageBaseUrl("https://external.example/x.jpg"), "https://external.example/x.jpg");
  assert.equal(storageBaseUrl("blob:http://x/y"), "blob:http://x/y");
  assert.equal(storageBaseUrl(null), null);
  // Idempotente.
  assert.equal(storageBaseUrl(storageBaseUrl(signedMedia)), media);
});

// Pruebas locales de clasificación de referencias de Storage.
// Ejecutar: node --test server/src/lib/storageRefs.test.js
// No requiere red, Supabase, ni dependencias externas.

import test from 'node:test';
import assert from 'node:assert/strict';

// El módulo resuelve el host al importarse y FALLA de forma explícita si
// `VITE_SUPABASE_URL` no está configurada. Se define ANTES de la importación
// dinámica (una importación estática evaluaría el módulo sin ella).
process.env.VITE_SUPABASE_URL = 'https://akgsylutbpgolurkcavh.supabase.co';

const {
  SUPABASE_HOST,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  isPrivateBucket,
  isPrivateRefForChat,
  mediaRefAllowedForChat,
  extractStorageRef,
  extractPath,
  isAllowedMediaRef,
  validateMediaReference,
  resolveSupabaseHost,
} = await import('./storageRefs.js');

const base = `https://${SUPABASE_HOST}/storage/v1/object/public`;
const img = `${base}/${PUBLIC_BUCKET}/image/foo.jpg`;
const media = `${base}/${PRIVATE_BUCKET}/video/bar.mp4`;

test('extractStorageRef: clasifica por BUCKET, no por carpeta', () => {
  assert.deepEqual(extractStorageRef(img), {
    bucket: PUBLIC_BUCKET,
    path: 'image/foo.jpg',
  });
  assert.deepEqual(extractStorageRef(media), {
    bucket: PRIVATE_BUCKET,
    path: 'video/bar.mp4',
  });
  // Misma carpeta en distinto bucket → distinto resultado (no se infiere por carpeta).
  const avatarPublico = `${base}/${PUBLIC_BUCKET}/uploads/avatars/a.png`;
  const mediaPrivado = `${base}/${PRIVATE_BUCKET}/uploads/avatars/a.png`;
  assert.equal(extractStorageRef(img).bucket, PUBLIC_BUCKET);
  assert.equal(extractStorageRef(avatarPublico).bucket, PUBLIC_BUCKET);
  assert.equal(extractStorageRef(mediaPrivado).bucket, PRIVATE_BUCKET);
});

test('extractStorageRef: rechaza host ajeno, otro bucket, traversal y no-http', () => {
  assert.equal(extractStorageRef('https://evil.example.com/storage/v1/object/public/chat-images/x.jpg'), null);
  // Otro bucket del MISMO proyecto (stickers oficiales) → no soportado aquí
  assert.equal(
    extractStorageRef(`https://${SUPABASE_HOST}/storage/v1/object/public/stickers_oficiales/a.png`),
    null
  );
  assert.equal(extractStorageRef(`${base}/${PUBLIC_BUCKET}/../secret.txt`), null);
  assert.equal(extractStorageRef(`${base}/${PUBLIC_BUCKET}/../../secret.txt`), null);
  assert.equal(extractStorageRef(`${base}/${PUBLIC_BUCKET}//leading.txt`), null);
  assert.equal(extractStorageRef('blob:http://x/y'), null);
  assert.equal(extractStorageRef('some-internal-id'), null);
  assert.equal(extractStorageRef(''), null);
  assert.equal(extractStorageRef(null), null);
  // Formato /object/sign/ no soportado (se documenta como dependencia)
  assert.equal(
    extractStorageRef(`https://${SUPABASE_HOST}/storage/v1/object/sign/${PRIVATE_BUCKET}/a.jpg?token=x`),
    null
  );
});

test('extractPath: retrocompatible, sólo bucket público', () => {
  assert.equal(extractPath(img), 'image/foo.jpg');
  assert.equal(extractPath(media), null); // privado NO se resuelve como path público
  assert.equal(extractPath('some-internal-id'), null);
});

test('isAllowedMediaRef: preserva el contrato de mensajería y admite chat-media', () => {
  // Aceptados (no-http): comportamiento previo
  assert.equal(isAllowedMediaRef('data:image/png;base64,AAAA'), true);
  assert.equal(isAllowedMediaRef('blob:http://localhost/abc'), true);
  assert.equal(isAllowedMediaRef('temp_msg_123'), true);
  // Aceptados: buckets conocidos del proyecto
  assert.equal(isAllowedMediaRef(img), true);
  assert.equal(isAllowedMediaRef(media), true);
  // Rechazados: host externo y host del proyecto con bucket desconocido
  assert.equal(isAllowedMediaRef('https://evil.example/x.jpg'), false);
  assert.equal(
    isAllowedMediaRef(`https://${SUPABASE_HOST}/storage/v1/object/public/otro-bucket/a.jpg`),
    false
  );
});

test('isPrivateBucket', () => {
  assert.equal(isPrivateBucket(PUBLIC_BUCKET), false);
  assert.equal(isPrivateBucket(PRIVATE_BUCKET), true);
  assert.equal(isPrivateBucket('nope'), false);
});

const CHAT_A = '11111111-2222-3333-4444-555555555555';
const CHAT_B = '99999999-8888-7777-6666-555555555555';

test('isPrivateRefForChat: sólo privado y con prefijo exacto del chat', () => {
  const refA = extractStorageRef(`${base}/${PRIVATE_BUCKET}/${CHAT_A}/file.png`);
  assert.deepEqual(refA, { bucket: PRIVATE_BUCKET, path: `${CHAT_A}/file.png` });
  assert.equal(isPrivateRefForChat(refA, CHAT_A), true);
  assert.equal(isPrivateRefForChat(refA, CHAT_B), false);
  // Prefijo parcial / comodines no valen.
  assert.equal(isPrivateRefForChat(extractStorageRef(`${base}/${PRIVATE_BUCKET}/${CHAT_A}x/f.png`), CHAT_A), false);
  // Público nunca aplica.
  assert.equal(isPrivateRefForChat(extractStorageRef(img), CHAT_A), false);
  // Ruta sin archivo o sin separador.
  assert.equal(isPrivateRefForChat({ bucket: PRIVATE_BUCKET, path: CHAT_A }, CHAT_A), false);
  // Refs inválidas.
  assert.equal(isPrivateRefForChat(null, CHAT_A), false);
  assert.equal(isPrivateRefForChat(refA, ''), false);
  assert.equal(isPrivateRefForChat(refA, undefined), false);
});

test('mediaRefAllowedForChat: privado atado al chat, público y no-http libres', () => {
  const privA = `${base}/${PRIVATE_BUCKET}/${CHAT_A}/v.mp4`;
  const privB = `${base}/${PRIVATE_BUCKET}/${CHAT_B}/v.mp4`;
  // Privado del chat correcto → permitido; de otro chat → rechazado.
  assert.equal(mediaRefAllowedForChat(privA, CHAT_A), true);
  assert.equal(mediaRefAllowedForChat(privB, CHAT_A), false);
  // Público y no-http → sin restricción (contrato conservado).
  assert.equal(mediaRefAllowedForChat(img, CHAT_A), true);
  assert.equal(mediaRefAllowedForChat('data:image/png;base64,AAAA', CHAT_A), true);
  assert.equal(mediaRefAllowedForChat('blob:http://localhost/x', CHAT_A), true);
  assert.equal(mediaRefAllowedForChat('temp_msg_1', CHAT_A), true);
  // Malformadas / host ajeno / bucket desconocido → false.
  assert.equal(mediaRefAllowedForChat(`${base}/${PRIVATE_BUCKET}/../x.png`, CHAT_A), false);
  assert.equal(mediaRefAllowedForChat(`https://evil.example/storage/v1/object/public/${PRIVATE_BUCKET}/${CHAT_A}/x.png`, CHAT_A), false);
  assert.equal(mediaRefAllowedForChat(`https://${SUPABASE_HOST}/storage/v1/object/public/otro-bucket/${CHAT_A}/x.png`, CHAT_A), false);
});

test('validateMediaReference: permite externos (contrato histórico)', () => {
  assert.equal(validateMediaReference('https://external.example/x.jpg'), true);
  assert.equal(validateMediaReference(img), true);
  assert.equal(validateMediaReference(media), true);
  assert.equal(
    validateMediaReference(`https://${SUPABASE_HOST}/storage/v1/object/public/otro/a.jpg`),
    false
  );
});

test('resolveSupabaseHost: falta / vacía / inválida → falla explícitamente', () => {
  assert.throws(() => resolveSupabaseHost(undefined), /VITE_SUPABASE_URL/);
  assert.throws(() => resolveSupabaseHost(null), /VITE_SUPABASE_URL/);
  assert.throws(() => resolveSupabaseHost(''), /VITE_SUPABASE_URL/);
  assert.throws(() => resolveSupabaseHost('   '), /VITE_SUPABASE_URL/);
  assert.throws(() => resolveSupabaseHost('no-es-una-url'), /VITE_SUPABASE_URL/);
});

test('resolveSupabaseHost: URL válida devuelve el host (sin fallback)', () => {
  assert.equal(resolveSupabaseHost('https://proyecto-ejemplo.supabase.co'), 'proyecto-ejemplo.supabase.co');
  assert.equal(resolveSupabaseHost('https://otro.example.com/storage/v1'), 'otro.example.com');
});

test('extractStorageRef: acepta el host configurado y rechaza cualquier otro host', () => {
  const ok = `https://${SUPABASE_HOST}/storage/v1/object/public/${PUBLIC_BUCKET}/image/foo.jpg`;
  assert.deepEqual(extractStorageRef(ok), { bucket: PUBLIC_BUCKET, path: 'image/foo.jpg' });
  assert.equal(extractStorageRef(ok.replace(SUPABASE_HOST, 'otro-host.supabase.co')), null);
});

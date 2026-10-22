import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrationObjectPath,
  safeExtension,
  canonicalUrlFrom,
  shouldMigrateMessageRef,
  isValidChatId,
  IMAGE_BUCKET,
  PRIVATE_BUCKET,
} from './chatMediaMigration.js';

const CHAT = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

test('migrationObjectPath: determinista, prefijado por el chat y sin traversal', () => {
  const a = migrationObjectPath(CHAT, 'voice/1783-abc.webm');
  const b = migrationObjectPath(CHAT, 'voice/1783-abc.webm');
  assert.equal(a, b);
  assert.match(a, new RegExp(`^${CHAT}/migrated-[0-9a-f]{32}\\.webm$`));
  assert.notEqual(a, migrationObjectPath(OTHER, 'voice/1783-abc.webm'));
  assert.ok(!a.includes('..'));
});

test('migrationObjectPath: chat_id no UUID es rechazado', () => {
  assert.throws(() => migrationObjectPath('local_123', 'x.png'), /chat_id/);
  assert.throws(() => migrationObjectPath('../../x', 'x.png'), /chat_id/);
});

test('safeExtension: sólo extensiones simples, nunca segmentos raros', () => {
  assert.equal(safeExtension('files/x.PDF'), 'pdf');
  assert.equal(safeExtension('files/x.vnd.android.package-archive'), 'bin');
  assert.equal(safeExtension('files/sin-extension'), 'bin');
  assert.equal(safeExtension('a/b/../c.webp'), 'webp');
});

test('canonicalUrlFrom: conserva host y storage/v1, apunta a chat-media', () => {
  const src = 'https://akgsylutbpgolurkcavh.supabase.co/storage/v1/object/public/chat-images/voice/a.webm';
  const out = canonicalUrlFrom(src, PRIVATE_BUCKET, `${CHAT}/migrated-x.webm`);
  assert.equal(out, `https://akgsylutbpgolurkcavh.supabase.co/storage/v1/object/public/chat-media/${CHAT}/migrated-x.webm`);
});

test('shouldMigrateMessageRef: migra media de conversación y excluye stickers', () => {
  assert.equal(shouldMigrateMessageRef({ bucket: IMAGE_BUCKET, path: 'voice/a.webm' }, 'voice_note'), true);
  assert.equal(shouldMigrateMessageRef({ bucket: IMAGE_BUCKET, path: 'image/a.jpg' }, 'image'), true);
  assert.equal(shouldMigrateMessageRef({ bucket: IMAGE_BUCKET, path: 'sticker/a.webp' }, 'sticker'), false);
  assert.equal(shouldMigrateMessageRef({ bucket: IMAGE_BUCKET, path: 'sticker/a.webp' }, 'image'), false);
  assert.equal(shouldMigrateMessageRef({ bucket: PRIVATE_BUCKET, path: `${CHAT}/a.webp` }, 'image'), false);
  assert.equal(shouldMigrateMessageRef(null, 'image'), false);
});

test('isValidChatId: sólo UUID', () => {
  assert.equal(isValidChatId(CHAT), true);
  assert.equal(isValidChatId('chat_1'), false);
  assert.equal(isValidChatId(null), false);
});

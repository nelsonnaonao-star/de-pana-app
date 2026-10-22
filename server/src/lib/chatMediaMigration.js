// Utilidades PURAS de la migración de media de conversaciones desde el bucket
// público `chat-images` al privado `chat-media`. Sin red ni Supabase para poder
// probar el enrutado y la idempotencia de forma aislada.
//
// Reglas:
// - Sólo se migran referencias de los 4 campos de media de `messages`.
// - Los stickers (`sticker/`) son recursos deliberadamente públicos: NO se migran.
// - El destino es DETERMINISTA a partir del path de origen, de modo que una
//   re-ejecución reutiliza el mismo objeto en vez de duplicarlo.
// - El path de destino siempre empieza por el UUID del chat real del mensaje,
//   requisito que exige `isPrivateRefForChat` en el servidor.

import { createHash } from 'node:crypto';

export const IMAGE_BUCKET = 'chat-images';
export const PRIVATE_BUCKET = 'chat-media';
export const MESSAGE_MEDIA_FIELDS = ['image_url', 'audio_url', 'video_url', 'file_url'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidChatId(chatId) {
  return typeof chatId === 'string' && UUID_RE.test(chatId);
}

// Extensión segura y acotada. Si el nombre de origen no aporta una extensión
// simple se usa `bin`; el contentType del objeto conserva el tipo real.
export function safeExtension(sourcePath) {
  const name = String(sourcePath || '').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'bin';
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : 'bin';
}

// Path determinista: chat/<migrated-<sha256(sourcePath)>>.<ext>.
export function migrationObjectPath(chatId, sourcePath, ext = safeExtension(sourcePath)) {
  if (!isValidChatId(chatId)) {
    throw new Error('chat_id inválido para migración');
  }
  const safeExt = /^[a-z0-9]{1,12}$/.test(String(ext || '')) ? String(ext).toLowerCase() : 'bin';
  const digest = createHash('sha256').update(String(sourcePath)).digest('hex').slice(0, 32);
  return `${chatId}/migrated-${digest}.${safeExt}`;
}

// URL canónica (identificador estable, no accesible por ser bucket privado) a
// partir de la URL de origen. Conserva el prefijo `<host>/storage/v1`.
export function canonicalUrlFrom(sourceUrl, bucket, objectPath) {
  const marker = '/object/public/';
  const idx = String(sourceUrl).indexOf(marker);
  if (idx === -1) throw new Error('URL de origen no canónica');
  const base = String(sourceUrl).slice(0, idx);
  const encoded = String(objectPath).split('/').map(encodeURIComponent).join('/');
  return `${base}/object/public/${bucket}/${encoded}`;
}

// ¿Esta referencia de mensaje debe migrarse al bucket privado?
// Devuelve false para stickers, para no-http, para refs que ya están en
// chat-media y para cualquier bucket desconocido.
export function shouldMigrateMessageRef(ref, messageType) {
  if (!ref || ref.bucket !== IMAGE_BUCKET) return false;
  if (messageType === 'sticker') return false;
  const first = String(ref.path || '').split('/')[0];
  if (first === 'sticker') return false;
  return true;
}

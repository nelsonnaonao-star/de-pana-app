// Lógica PURA para la subida privada de media de conversaciones a `chat-media`.
// Sin dependencias de Express/Supabase para poder probarse de forma aislada.
//
// Compatibilidad de referencias: la URL devuelta (`privateObjectUrl`) tiene la
// forma canónica `/storage/v1/object/public/<bucket>/<path>` que reconocen
// `server/src/lib/storageRefs.js` (extractStorageRef → bucket chat-media),
// `/api/messages/send` (isAllowedMediaRef) y `/api/media/signed-url`.

import { randomUUID } from 'node:crypto';

export const PRIVATE_UPLOAD_BUCKET = 'chat-media';

// Límites existentes (idénticos a los endpoints públicos).
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
// Límite alineado con el bucket `chat-media` (50 MiB): el endpoint de vídeo
// debe rechazar en el servidor (413) antes de transcodificar/subir, no fallar
// en Supabase por superar el límite del bucket.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MiB

export const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/mp4',
  // Notas de voz grabadas por el cliente (MediaRecorder): audio/webm.
  'audio/webm',
  'application/pdf',
  // Documentos comunes que el selector de archivos (*/*) puede enviar.
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

// Extensión derivada del MIME (NUNCA del nombre original del archivo).
// Correspondencia explícita y acotada: un MIME no listado aquí no es admitido.
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeMime(mimeType) {
  return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

export function isAllowedMime(mimeType) {
  return ALLOWED_MIMES.includes(normalizeMime(mimeType));
}

export function isVideoMime(mimeType) {
  return normalizeMime(mimeType).startsWith('video/');
}

// Formatos de vídeo privado con ruta de procesamiento/reproducción verificada:
// MP4, MOV (quicktime) y WebM (los tres con extensión explícita en MIME_EXT).
// MKV/AVI/3GP/TS quedan RECHAZADOS: subirlos produciría un objeto `.bin` con
// contentType de vídeo que FFmpeg/el reproductor no manejan de forma fiable.
export function isSupportedPrivateVideoMime(mimeType) {
  return isVideoMime(mimeType) && isAllowedMime(mimeType);
}

export function extForMime(mimeType) {
  return MIME_EXT[normalizeMime(mimeType)] || 'bin';
}

export function isValidChatId(chatId) {
  return typeof chatId === 'string' && UUID_RE.test(chatId);
}

// Ruta destino: `<chat_uuid>/<uuid>.<ext>`. El chat_id ya está validado como
// UUID, por lo que no puede inyectar segmentos de path (`..`, `/`).
export function privateObjectPath(chatId, ext, genId = randomUUID) {
  const safeExt = String(ext || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  return `${chatId}/${genId()}.${safeExt}`;
}

// URL canónica a partir de la base de Supabase. Devuelve la referencia estable
// que se guarda en `messages.*_url` (no una URL firmada).
export function privateObjectUrl(supabaseUrl, objectPath) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${PRIVATE_UPLOAD_BUCKET}/${objectPath}`;
}

// Guard de autorización estilo Express, con dependencias inyectables para poder
// probarlo sin Express ni Supabase. Autoriza ANTES de que multer procese el
// archivo (debe montarse antes del middleware de multer en la ruta).
export function createChatMembershipGuard({ isChatMember, isValidId = isValidChatId }) {
  return async function chatMembershipGuard(req, res, next) {
    const raw = (req && req.query && req.query.chat_id) != null
      ? req.query.chat_id
      : (req && req.headers ? req.headers['x-chat-id'] : undefined);
    const chatId = raw == null ? '' : String(raw);

    if (!isValidId(chatId)) {
      if (typeof res.status === 'function') res.status(400).json({ error: 'chat_id inválido' });
      return;
    }

    let member = false;
    try {
      member = await isChatMember(chatId, req.userId);
    } catch {
      if (typeof res.status === 'function') res.status(500).json({ error: 'Error verificando autorización' });
      return;
    }

    if (!member) {
      if (typeof res.status === 'function') res.status(403).json({ error: 'No eres miembro de este chat' });
      return;
    }

    req.chatId = chatId;
    if (typeof next === 'function') next();
  };
}

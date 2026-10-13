import { Router } from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { supabaseAdmin } from '../db.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

ffmpeg.setFfmpegPath(ffmpegPath.path);

import {
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  isPrivateBucket,
  isPrivateRefForChat,
  extractStorageRef,
  extractPath,
  validateMediaReference,
  isAllowedMediaRef,
} from '../lib/storageRefs.js';

import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  isAllowedMime,
  isSupportedPrivateVideoMime,
  extForMime,
  privateObjectPath,
  privateObjectUrl,
  createChatMembershipGuard,
} from '../lib/privateUpload.js';

// Re-export de utilidades puras (compatibilidad con messages.js y tests).
export {
  extractStorageRef,
  extractPath,
  validateMediaReference,
  isAllowedMediaRef,
  isPrivateBucket,
  PRIVATE_BUCKET,
};

// chat-images = bucket PÚBLICO (avatares, historias, flyers, stickers y media de
// conversación legado). chat-media = bucket PRIVADO para media de mensajes, que
// se sirve SIEMPRE mediante URL firmada. La clasificación se hace por el bucket
// explícito en la URL guardada, NUNCA por el nombre de la carpeta.
const BUCKET = PUBLIC_BUCKET;

async function isChatMember(chatId, userId) {
  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('profile_id, admin_id, is_group')
    .eq('id', chatId)
    .maybeSingle();
  if (!chat) return false;
  if (chat.profile_id === userId || chat.admin_id === userId) return true;
  const { data: participant } = await supabaseAdmin
    .from('chat_participants')
    .select('profile_id')
    .eq('chat_id', chatId)
    .eq('profile_id', userId)
    .maybeSingle();
  return !!participant;
}

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (req, file, cb) => {
      cb(null, `raw-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten videos'));
    }
  },
});

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/mp4',
  'application/pdf',
];

const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
  },
});

function getOutputPath() {
  return path.join(__dirname, '..', '..', 'uploads', `compressed-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
}

async function uploadBufferToSupabase(buffer, mimeType, ext = 'bin') {
  if (!supabaseAdmin) throw new Error('Supabase no configurado');

  const prefix = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'file';
  const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from('chat-images')
    .upload(fileName, buffer, { contentType: mimeType, upsert: false });

  if (error) throw error;

  const { data } = supabaseAdmin.storage.from('chat-images').getPublicUrl(fileName);
  return data.publicUrl;
}

router.post('/compress-video', (req, res) => {
  uploadVideo.single('video')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún video' });
    }

    const inputPath = req.file.path;
    const outputPath = getOutputPath();
    const originalSize = req.file.size;

    if (originalSize < 2 * 1024 * 1024) {
      try {
        const origExt = req.file.originalname.split('.').pop() || 'mp4';
        const url = await uploadToSupabase(inputPath, req.file.mimetype, origExt);
        await fs.unlink(inputPath).catch(() => {});
        return res.json({ url, compressed: false, originalSize, compressedSize: originalSize });
      } catch (uploadErr) {
        await fs.unlink(inputPath).catch(() => {});
        return res.status(500).json({ error: 'Error al subir el video' });
      }
    }

    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .audioBitrate('128k')
          .outputOptions([
            '-preset veryfast',
            '-crf 28',
            '-movflags +faststart',
            '-vf', "scale='min(720,iw)':min'(720,ih)':force_original_aspect_ratio=decrease",
          ])
          .on('end', resolve)
          .on('error', (ffmpegErr) => {
            reject(ffmpegErr);
          })
          .save(outputPath);
      });

      const compressedSize = (await fs.stat(outputPath)).size;
      const url = await uploadToSupabase(outputPath, 'video/mp4');
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});

      res.json({ url, compressed: true, originalSize, compressedSize });
    } catch (compressErr) {
      try {
        const origExt = req.file.originalname.split('.').pop() || 'mp4';
        const url = await uploadToSupabase(inputPath, req.file.mimetype, origExt);
        await fs.unlink(inputPath).catch(() => {});
        return res.json({ url, compressed: false, originalSize, compressedSize: originalSize });
      } catch (uploadErr) {
        await fs.unlink(inputPath).catch(() => {});
        return res.status(500).json({ error: 'Error al comprimir y subir el video' });
      }
    }
  });
});

router.post('/upload', uploadAny.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }
    const ext = req.file.originalname.split('.').pop() || 'bin';
    const url = await uploadBufferToSupabase(req.file.buffer, req.file.mimetype, ext);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: 'Error al subir el archivo' });
  }
});

async function uploadToSupabase(filePath, mimeType, ext = 'mp4') {
  if (!supabaseAdmin) throw new Error('Supabase no configurado');

  const prefix = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'file';
  const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const fileBuffer = await fs.readFile(filePath);

  const { error } = await supabaseAdmin.storage
    .from('chat-images')
    .upload(fileName, fileBuffer, { contentType: mimeType, upsert: false });

  if (error) throw error;

  const { data } = supabaseAdmin.storage.from('chat-images').getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── Subida privada de media de conversaciones (chat-media) ─────
// Requiere `chat_id` (query `?chat_id=<uuid>` o cabecera `x-chat-id`) y valida
// la membresía ANTES de que multer lea el archivo (guard montado antes de
// multer). Sube a `chat-media/<chat_uuid>/<uuid>.<ext>` con service_role,
// `upsert:false`, límites y MIME de los endpoints públicos. Devuelve la URL
// canónica (referencia estable), NO una URL firmada.
// Los endpoints públicos `/upload` y `/compress-video` NO se modifican.

const privateUploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
  },
});

const privateUploadVideo = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (_req, _file, cb) => {
      cb(null, `raw-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    },
  }),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isSupportedPrivateVideoMime(file.mimetype)) cb(null, true);
    else cb(new Error(`Formato de video no admitido: ${file.mimetype}`));
  },
});

const requireChatMembership = createChatMembershipGuard({ isChatMember });

async function uploadPrivateBufferToSupabase(buffer, mimeType, objectPath) {
  if (!supabaseAdmin) throw new Error('Supabase no configurado');
  const { error } = await supabaseAdmin.storage
    .from(PRIVATE_BUCKET)
    .upload(objectPath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;
  // `getPublicUrl` devuelve la forma canónica
  // `<base>/storage/v1/object/public/chat-media/<path>` (identificador estable,
  // no accesible directamente por ser bucket privado). Se usa como referencia.
  const { data } = supabaseAdmin.storage.from(PRIVATE_BUCKET).getPublicUrl(objectPath);
  const fallbackBase = process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co';
  const url = data && data.publicUrl ? data.publicUrl : privateObjectUrl(fallbackBase, objectPath);
  return { url, path: objectPath };
}

async function uploadPrivateFileToSupabase(filePath, mimeType, objectPath) {
  const buffer = await fs.readFile(filePath);
  return uploadPrivateBufferToSupabase(buffer, mimeType, objectPath);
}

router.post('/upload-private', requireChatMembership, privateUploadAny.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }
    const ext = extForMime(req.file.mimetype);
    const objectPath = privateObjectPath(req.chatId, ext);
    const { url, path: storedPath } = await uploadPrivateBufferToSupabase(req.file.buffer, req.file.mimetype, objectPath);
    res.json({ url, bucket: PRIVATE_BUCKET, path: storedPath });
  } catch (err) {
    console.error('[MEDIA] private upload error:', err.message);
    res.status(500).json({ error: 'Error al subir el archivo' });
  }
});

router.post('/upload-private-video', requireChatMembership, (req, res) => {
  uploadVideoPrivate(req, res);
});

// Wrapper con diskStorage para video privado; autoriza (guard) antes de FFmpeg
// y garantiza la limpieza de temporales (input y output) en todos los caminos.
function uploadVideoPrivate(req, res) {
  privateUploadVideo.single('video')(req, res, async (err) => {
    if (err) {
      // Patrón de tamaño del proyecto (index.js): el tamaño máximo es 413 y se
      // resuelve antes de ejecutar FFmpeg o intentar subir el archivo.
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'El archivo excede el tamaño máximo permitido' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún video' });

    const chatId = req.chatId;
    const inputPath = req.file.path;
    const outputPath = getOutputPath();
    const originalSize = req.file.size;

    try {
      let sourcePath = inputPath;
      let mimeType = req.file.mimetype;
      let ext = extForMime(mimeType);
      let compressed = false;
      let compressedSize = originalSize;

      if (originalSize >= 2 * 1024 * 1024) {
        try {
          await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
              .videoCodec('libx264')
              .audioCodec('aac')
              .audioBitrate('128k')
              .outputOptions([
                '-preset veryfast',
                '-crf 28',
                '-movflags +faststart',
                '-vf', "scale='min(720,iw)':min'(720,ih)':force_original_aspect_ratio=decrease",
              ])
              .on('end', resolve)
              .on('error', reject)
              .save(outputPath);
          });
          sourcePath = outputPath;
          mimeType = 'video/mp4';
          ext = 'mp4';
          compressed = true;
          compressedSize = (await fs.stat(outputPath)).size;
        } catch (compressErr) {
          console.error('[MEDIA] private video compress failed, uploading original:', compressErr.message);
        }
      }

      const objectPath = privateObjectPath(chatId, ext);
      const { url, path: storedPath } = await uploadPrivateFileToSupabase(sourcePath, mimeType, objectPath);
      res.json({ url, bucket: PRIVATE_BUCKET, path: storedPath, compressed, originalSize, compressedSize });
    } catch (uploadErr) {
      console.error('[MEDIA] private video upload error:', uploadErr.message);
      res.status(500).json({ error: 'Error al subir el video' });
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  });
}

// ─── Signed URL endpoint ────────────────────────────────────────
// Modo A (messageId): flujo existente — firma las 4 columnas de media
//   del mensaje; autorización por membresía al chat del mensaje.
// Modo B (urls): URLs históricas almacenadas — la autorización se
//   resuelve buscando el objeto en mensajes (4 columnas) de chats de los
//   que el usuario es miembro. No es un proxy de firma: paths de otros
//   buckets, traversal y objetos no referenciados por ningún mensaje son
//   rechazados. Las URLs de los mensajes NO se modifican.
const SIGNED_URL_TTL = 3600;

function storageObjectUrl(inputUrl, bucket, storagePath) {
  // Reconstruye la URL exacta almacenada (`getPublicUrl`) partiendo de la
  // URL entrante, para buscarla por igualdad (eq) en messages.*_url.
  // `origin` ya incluye `…/storage/v1` (prefijo que precede al marcador).
  const marker = `/object/public/${bucket}/`;
  const origin = inputUrl.split(marker)[0];
  const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${origin}${marker}${encoded}`;
}

async function authorizeStoragePaths(entries, userId) {
  // entries: [{ url, ref: { bucket, path } }]. Devuelve { authorized: [ref] } o un error.
  const authorized = [];
  for (const { url, ref } of entries) {
    const { bucket, path } = ref;
    // Defensa en profundidad: caracteres que romperían el filtro .or()
    // (generados por el sistema, nunca aparecen en paths legítimos).
    if (/[(),]/.test(path)) {
      return { error: 400, message: 'Path inválido' };
    }
    const stored = storageObjectUrl(url, bucket, path);
    const { data: refs, error } = await supabaseAdmin
      .from('messages')
      .select('chat_id')
      .or(`image_url.eq.${stored},audio_url.eq.${stored},video_url.eq.${stored},file_url.eq.${stored}`)
      .limit(40);

    if (error) {
      console.error('[MEDIA] authz lookup error:', error.message);
      return { error: 500, message: 'Error verificando autorización' };
    }
    if (!refs || refs.length === 0) {
      return { error: 403, message: 'No tienes acceso a este media' };
    }

    let ok = false;
    for (const r of refs) {
      // Una referencia privada (chat-media) sólo autoriza por mensajes cuyo
      // chat real coincida con el chat al que pertenece el objeto (`<chat_id>/…`).
      // Así una URL privada filtrada no se re-firma desde otro chat.
      if (isPrivateBucket(ref.bucket) && !isPrivateRefForChat(ref, r.chat_id)) {
        continue;
      }
      if (await isChatMember(r.chat_id, userId)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      return { error: 403, message: 'No tienes acceso a este media' };
    }
    authorized.push(ref);
  }
  return { authorized };
}

const REF_KEY_SEP = '\u0000';
function refKey(bucket, path) {
  return `${bucket}${REF_KEY_SEP}${path}`;
}

router.post('/signed-url', async (req, res) => {
  try {
    const { messageId, urls } = req.body;

    const sign = async (refs) => {
      // refs: [{ bucket, path }]. Agrupa por bucket y firma cada grupo por
      // separado (chat-media privado y chat-images público), devolviendo un Map
      // keyed por `bucket\0path` para evitar colisiones entre buckets.
      if (refs.length === 0) return new Map();

      const byBucket = new Map();
      for (const { bucket, path } of refs) {
        if (!byBucket.has(bucket)) byBucket.set(bucket, []);
        byBucket.get(bucket).push(path);
      }

      const signedMap = new Map();
      for (const [bucket, paths] of byBucket) {
        const { data: signedData, error: signError } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrls(paths, SIGNED_URL_TTL);
        if (signError) {
          console.error('[MEDIA] signedUrl error:', signError.message);
          throw signError;
        }
        for (const item of (signedData || [])) {
          if (item.path && item.signedUrl) {
            signedMap.set(refKey(bucket, item.path), item.signedUrl);
          }
        }
      }
      return signedMap;
    };


    // ── Modo A: messageId ─────────────────────────────────────
    if (messageId) {
      if (typeof messageId !== 'string') {
        return res.status(400).json({ error: 'messageId inválido' });
      }

      const { data: msg, error: fetchError } = await supabaseAdmin
        .from('messages')
        .select('id, chat_id, image_url, audio_url, video_url, file_url')
        .eq('id', messageId)
        .maybeSingle();

      if (fetchError || !msg) {
        return res.status(404).json({ error: 'Mensaje no encontrado' });
      }

      if (!(await isChatMember(msg.chat_id, req.userId))) {
        return res.status(403).json({ error: 'No eres miembro de este chat' });
      }

      const fields = ['image_url', 'audio_url', 'video_url', 'file_url'];
      const refs = [];
      const fieldMap = {};

      for (const field of fields) {
        const raw = msg[field];
        if (!raw) continue;
        const ref = extractStorageRef(raw);
        if (!ref) continue;
        // Una referencia privada (chat-media) sólo se firma si su objeto
        // pertenece exactamente al chat real del mensaje. Los públicos
        // (chat-images) no se restringen.
        if (isPrivateBucket(ref.bucket) && !isPrivateRefForChat(ref, msg.chat_id)) {
          return res.status(403).json({ error: 'No tienes acceso a este media' });
        }
        refs.push(ref);
        fieldMap[field] = ref;
      }

      if (refs.length === 0) {
        return res.json({ image: null, audio: null, video: null, file: null, expiresIn: SIGNED_URL_TTL });
      }

      const signedMap = await sign(refs);
      const result = { image: null, audio: null, video: null, file: null, expiresIn: SIGNED_URL_TTL };
      for (const [field, ref] of Object.entries(fieldMap)) {
        const key = field.replace('_url', '');
        result[key] = signedMap.get(refKey(ref.bucket, ref.path)) || null;
      }

      return res.json(result);
    }

    // ── Modo B: urls históricas ──────────────────────────────
    if (Array.isArray(urls)) {
      if (urls.length === 0 || urls.length > 20) {
        return res.status(400).json({ error: 'Entre 1 y 20 URLs' });
      }

      const entries = [];
      for (const raw of urls) {
        if (typeof raw !== 'string' || !/^https?:\/\//.test(raw)) {
          return res.status(400).json({ error: 'URL inválida' });
        }
        const ref = extractStorageRef(raw);
        if (!ref) {
          return res.status(400).json({ error: 'URL no pertenece a un bucket soportado' });
        }
        entries.push({ url: raw, ref });
      }

      const authz = await authorizeStoragePaths(entries, req.userId);
      if (authz.error) {
        return res.status(authz.error).json({ error: authz.message });
      }

      const signedMap = await sign(authz.authorized);
      const signedUrls = {};
      for (const { url, ref } of entries) {
        signedUrls[url] = signedMap.get(refKey(ref.bucket, ref.path)) || null;
      }

      return res.json({ signedUrls, expiresIn: SIGNED_URL_TTL });
    }

    return res.status(400).json({ error: 'messageId o urls requerido' });
  } catch (err) {
    console.error('[MEDIA] signed-url error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
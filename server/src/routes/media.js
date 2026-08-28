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

const SUPABASE_HOST = 'akgsylutbpgolurkcavh.supabase.co';
const BUCKET = 'chat-images';

export function validateMediaReference(url) {
  if (!url || typeof url !== 'string') return true;
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== SUPABASE_HOST) return true;
    if (!parsed.pathname.includes(`/object/public/${BUCKET}/`)) return false;
    const pathPart = decodeURIComponent(parsed.pathname.split(`/object/public/${BUCKET}/`)[1] || '');
    if (!pathPart || pathPart.includes('..') || pathPart.startsWith('/')) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractPath(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== SUPABASE_HOST) return null;
    const match = parsed.pathname.match(
      new RegExp(`/object/public/${BUCKET}/(.+)$`)
    );
    if (!match) return null;
    const storagePath = decodeURIComponent(match[1]);
    if (!storagePath || storagePath.includes('..') || storagePath.startsWith('/')) return null;
    return storagePath;
  } catch {
    return null;
  }
}

async function isChatMember(chatId, userId) {
  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('profile_id, admin_id, is_group')
    .eq('id', chatId)
    .maybeSingle();
  if (!chat) return false;
  if (chat.profile_id === userId || chat.admin_id === userId) return true;
  if (chat.is_group) {
    const { data: participant } = await supabaseAdmin
      .from('chat_participants')
      .select('profile_id')
      .eq('chat_id', chatId)
      .eq('profile_id', userId)
      .maybeSingle();
    return !!participant;
  }
  return false;
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

// ─── Signed URL endpoint ────────────────────────────────────────
router.post('/signed-url', async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'messageId requerido' });
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
    const paths = [];
    const fieldMap = {};

    for (const field of fields) {
      const raw = msg[field];
      if (!raw) continue;
      const p = extractPath(raw);
      if (p) {
        paths.push(p);
        fieldMap[field] = p;
      }
    }

    if (paths.length === 0) {
      return res.json({ image: null, audio: null, video: null, file: null });
    }

    const { data: signedData, error: signError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600);

    if (signError) {
      console.error('[MEDIA] signedUrl error:', signError.message);
      return res.status(500).json({ error: 'Error generando URLs firmadas' });
    }

    const result = { image: null, audio: null, video: null, file: null };
    const signedMap = {};
    for (const item of (signedData || [])) {
      if (item.path && item.signedUrl) {
        signedMap[item.path] = item.signedUrl;
      }
    }

    for (const [field, p] of Object.entries(fieldMap)) {
      const key = field.replace('_url', '');
      result[key] = signedMap[p] || null;
    }

    res.json(result);
  } catch (err) {
    console.error('[MEDIA] signed-url error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
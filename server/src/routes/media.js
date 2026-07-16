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
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = file.originalname.split('.').pop() || 'bin';
      cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
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
    const url = await uploadToSupabase(req.file.path, req.file.mimetype, req.file.originalname.split('.').pop() || 'bin');
    await fs.unlink(req.file.path).catch(() => {});
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

export default router;

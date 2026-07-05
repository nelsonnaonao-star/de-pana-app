import { Router } from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

ffmpeg.setFfmpegPath(ffmpegPath.path);

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads'),
    filename: (req, file, cb) => {
      cb(null, `raw-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten videos'));
    }
  },
});

function getOutputPath() {
  return path.join(__dirname, '..', '..', 'uploads', `compressed-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
}

router.post('/compress-video', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      console.error('[media] Multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún video' });
    }

    const inputPath = req.file.path;
    const outputPath = getOutputPath();
    const originalSize = req.file.size;

    // If video is already small (< 2 MB), skip compression and upload directly
    if (originalSize < 2 * 1024 * 1024) {
      try {
        const origExt = req.file.originalname.split('.').pop() || 'mp4';
        const url = await uploadToSupabase(inputPath, req.file.mimetype, origExt);
        await fs.unlink(inputPath).catch(() => {});
        return res.json({ url, compressed: false, originalSize, compressedSize: originalSize });
      } catch (uploadErr) {
        console.error('[media] Upload error (skip compression):', uploadErr);
        await fs.unlink(inputPath).catch(() => {});
        return res.status(500).json({ error: 'Error al subir el video' });
      }
    }

    // Compress with FFmpeg
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
            console.error('[media] FFmpeg error:', ffmpegErr.message);
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
      console.error('[media] Compression failed, fallback to raw upload:', compressErr);
      // Fallback: upload the original file instead
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

async function uploadToSupabase(filePath, mimeType, ext = 'mp4') {
  if (!supabase) throw new Error('Supabase no configurado');

  const fileName = `video-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const fileBuffer = await fs.readFile(filePath);

  const { error } = await supabase.storage
    .from('chat-images')
    .upload(fileName, fileBuffer, { contentType: mimeType, upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from('chat-images').getPublicUrl(fileName);
  return data.publicUrl;
}

export default router;

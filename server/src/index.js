import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import fcmRoutes from './routes/fcm.js';
import turnRoutes from './routes/turn.js';
import linkPreviewRoutes from './routes/linkpreview.js';
import mediaRoutes from './routes/media.js';
import dataRoutes from './routes/data.js';
import ratesRoutes from './routes/rates.js';
import messagesRoutes from './routes/messages.js';
import contentRoutes from './routes/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

async function main() {
  await initDb();

  const app = express();

  app.set('trust proxy', 1);

  const staticOrigins = [
    'http://localhost:5173',
    'http://localhost:5199',
    'http://localhost:5000',
    'http://localhost:3000',
    'capacitor://localhost',
    'file://',
    'https://de-pana-app.onrender.com',
    process.env.CORS_ORIGIN || '',
  ].filter(Boolean);

  const clientOrigin = process.env.CLIENT_ORIGIN || '';
  if (clientOrigin && !staticOrigins.includes(clientOrigin)) {
    staticOrigins.push(clientOrigin);
  }

  const isProduction = process.env.NODE_ENV === 'production';

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (staticOrigins.includes(origin)) return callback(null, true);
      if (clientOrigin && origin.endsWith(new URL(clientOrigin).hostname)) return callback(null, true);
      if (isProduction) {
        return callback(new Error('Origen no autorizado'));
      }
      callback(null, true);
    },
    credentials: true,
  }));

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }));

  const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
  });
  app.use('/api/', globalLimiter);

  const smsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Has solicitado demasiados códigos. Espera 15 minutos.' },
  });
  app.use('/api/auth/send-reset-code', smsLimiter);

  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/fcm', fcmRoutes);
  app.use('/api/turn', turnRoutes);
  app.use('/api/link-preview', linkPreviewRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/data', dataRoutes);
  app.use('/api/rates', ratesRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/content', contentRoutes);

  // Gemini AI Chat endpoint (from original server.ts)
  const { GoogleGenAI } = await import('@google/genai');
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'El mensaje es requerido.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY no configurada.' });
      }

      const ai = new GoogleGenAI({ apiKey });

      const formattedContents = [];
      if (history && Array.isArray(history)) {
        for (const msg of history) {
          formattedContents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
          });
        }
      }
      formattedContents.push({
        role: 'user',
        parts: [{ text: message }]
      });

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: formattedContents,
        config: {
          systemInstruction: `Eres OpenCode, una ingeniera de software de élite experta en desarrollo móvil híbrido...`
        }
      });

      res.json({ response: response.text });
    } catch (error) {
      console.error('Error in /api/chat:', error);
      res.status(500).json({ error: error.message || 'Error al procesar la solicitud.' });
    }
  });

  // Serve built frontend in production
  const distPath = path.join(ROOT_DIR, 'dist');
  app.use(express.static(distPath));

  // JSON 404 for unmatched API/uploads routes
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Ruta API no encontrada: ${req.method} ${req.originalUrl}` });
  });
  app.use('/uploads', (req, res) => {
    res.status(404).json({ error: `Archivo no encontrado: ${req.originalUrl}` });
  });

  // SPA catch-all for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  const PORT = process.env.PORT || process.env.SERVER_PORT || 5000;
  app.listen(PORT, () => {
    const url = process.env.APP_URL || `http://localhost:${PORT}`;
    console.log(`RED ON corriendo en ${url}`);
  });
}

main().catch(err => {
  console.error('Error al iniciar el servidor:', err);
  process.exit(1);
});

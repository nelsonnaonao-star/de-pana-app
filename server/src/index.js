import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb } from './db.js';
import { authMiddleware } from './middleware/auth.js';
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

  app.use(express.json({ limit: '10mb' }));

  // ─── Global rate limiter ───────────────────────────────────────
  const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
  });

  // ─── Strict rate limiter for sensitive endpoints ────────────────
  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  });

  // ─── Upload rate limiter ───────────────────────────────────────
  const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: { error: 'Demasiadas subidas. Espera unos minutos.' },
  });

  // ─── PUBLIC routes (no auth needed) ────────────────────────────
  app.use('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.use('/api/auth', globalLimiter, authRoutes);
  app.use('/api/rates', globalLimiter, ratesRoutes);
  app.use('/api/turn', globalLimiter, turnRoutes);
  app.use('/api/link-preview', globalLimiter, linkPreviewRoutes);

  // ─── FCM: webhook is public (authenticated via secret header) ──
  // ─── FCM: register/send require JWT auth ───────────────────────
  app.use('/api/fcm', (req, res, next) => {
    if (req.path === '/webhook') return next();
    globalLimiter(req, res, next);
  }, (req, res, next) => {
    if (req.path === '/webhook') return next();
    authMiddleware(req, res, next);
  }, fcmRoutes);

  // ─── PROTECTED routes (auth required) ──────────────────────────
  app.use('/api/data', globalLimiter, authMiddleware, dataRoutes);
  app.use('/api/messages', globalLimiter, authMiddleware, messagesRoutes);
  app.use('/api/content', globalLimiter, authMiddleware, contentRoutes);
  app.use('/api/media', uploadLimiter, authMiddleware, mediaRoutes);

  // ─── GIPHY proxy (hides API key from client) ───────────────────
  const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
  if (!GIPHY_API_KEY) console.warn('[GIPHY] GIPHY_API_KEY no está configurada en variables de entorno');
  app.get('/api/giphy/:action', async (req, res) => {
    if (!GIPHY_API_KEY) return res.status(503).json({ error: 'GIPHY no configurado' });
    try {
      const { action } = req.params;
      const { q, limit = 30, type = 'gifs' } = req.query;

      if (!['trending', 'search'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
      }
      if (!['gifs', 'stickers'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
      }

      const params = action === 'search' ? `q=${encodeURIComponent(q || '')}` : '';
      const url = `https://api.giphy.com/v1/${type}/${action}?api_key=${GIPHY_API_KEY}&${params}&limit=${Math.min(Number(limit) || 30, 50)}&rating=g`;

      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return res.status(response.status).json({ error: 'Giphy API error' });
      const data = await response.json();
      res.json(data.data || []);
    } catch (err) {
      console.error('[GIPHY] Proxy error:', err.message);
      res.status(500).json({ error: 'Error fetching from Giphy' });
    }
  });

  // ─── Static files ──────────────────────────────────────────────
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // ─── Gemini AI Chat endpoint ───────────────────────────────────
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones al chat. Espera un minuto.' },
  });

  const MAX_HISTORY_MESSAGES = 50;
  const MAX_HISTORY_CHARS = 50000;

  app.post('/api/chat', globalLimiter, authMiddleware, chatLimiter, async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'El mensaje es requerido.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY no configurada.' });
      }

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const formattedContents = [];
      let totalChars = 0;
      if (history && Array.isArray(history)) {
        const limitedHistory = history.slice(-MAX_HISTORY_MESSAGES);
        for (const msg of limitedHistory) {
          const text = String(msg.text || '').slice(0, 2000);
          totalChars += text.length;
          if (totalChars > MAX_HISTORY_CHARS) break;
          formattedContents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text }]
          });
        }
      }
      formattedContents.push({
        role: 'user',
        parts: [{ text: message.slice(0, 4000) }]
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

    // ─── Self-ping keep-alive (anti-sleep para Render free tier) ──
    const SERVER_URL = process.env.SERVER_URL;
    if (SERVER_URL && isProduction) {
      const pingUrl = `${SERVER_URL}/api/health`;
      console.log(`[KEEP-ALIVE] Ping cada 14 min → ${pingUrl}`);
      setInterval(async () => {
        try {
          const res = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
          console.log(`[KEEP-ALIVE] ${res.ok ? '✓' : '✗'} ${res.status}`);
        } catch (err) {
          console.error('[KEEP-ALIVE] Ping failed:', err.message);
        }
      }, 14 * 60 * 1000);
    } else if (!isProduction) {
      console.log('[KEEP-ALIVE] Deshabilitado (no es producción)');
    } else {
      console.warn('[KEEP-ALIVE] SERVER_URL no configurado, keep-alive deshabilitado');
    }
  });
}

main().catch(err => {
  console.error('Error al iniciar el servidor:', err);
  process.exit(1);
});

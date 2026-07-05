import express from 'express';

const router = express.Router();

const METERED_API_KEY = process.env.METERED_API_KEY || '';
const STATIC_TURN_URL = process.env.VITE_TURN_URL || '';
const STATIC_TURN_USER = process.env.VITE_TURN_USERNAME || '';
const STATIC_TURN_CRED = process.env.VITE_TURN_CREDENTIAL || '';

router.post('/credentials', async (req, res) => {
  // 1) Try Metered.ca REST API for dynamic temp credentials (production)
  if (METERED_API_KEY) {
    try {
      const meterRes = await fetch(
        `https://onchat.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`,
        { method: 'POST' }
      );
      if (meterRes.ok) {
        const iceServers = await meterRes.json();
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          return res.json({ iceServers });
        }
      }
    } catch {}
  }

  // 2) Fallback: static TURN from env vars
  if (STATIC_TURN_URL && STATIC_TURN_USER && STATIC_TURN_CRED) {
    return res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: STATIC_TURN_URL, username: STATIC_TURN_USER, credential: STATIC_TURN_CRED },
      ],
    });
  }

  // 3) Last resort: STUN-only
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
});

export default router;

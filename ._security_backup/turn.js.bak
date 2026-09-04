import express from 'express';

const router = express.Router();

const METERED_API_KEY = process.env.METERED_API_KEY || '';
const METERED_SUBDOMAIN = process.env.METERED_SUBDOMAIN || 'onchat';

// Debug: confirm env var is loaded at startup
if (METERED_API_KEY) {
  console.log(`[TURN] ✅ METERED_API_KEY loaded: ...${METERED_API_KEY.slice(-4)} (subdomain: ${METERED_SUBDOMAIN})`);
} else {
  console.warn('[TURN] ⚠️ METERED_API_KEY is EMPTY — TURN will not work! Only STUN fallback.');
}

// Helper to obscure API key in logs (show last 4 chars only)
const obscureApiKey = (apiKey) => {
  if (!apiKey) return '';
  if (apiKey.length <= 4) return '*'.repeat(apiKey.length);
  return '*'.repeat(apiKey.length - 4) + apiKey.slice(-4);
};

router.post('/credentials', async (req, res) => {
  const apiKey = process.env.METERED_API_KEY || '';
  
  if (apiKey) {
    const url = `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    const obscuredUrl = `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credentials?apiKey=${obscureApiKey(apiKey)}`;
    console.log(`[TURN] Requesting credentials from Metered API...`);
    
    try {
      const response = await fetch(url);
      if (response.ok) {
        const iceServers = await response.json();
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          console.log(`[TURN] ✅ Got ${iceServers.length} ICE servers from Metered`);
          return res.json({ iceServers });
        }
      } else {
        const errorText = await response.text();
        console.error('[TURN] Metered API HTTP error:', {
          status: response.status,
          statusText: response.statusText,
          url: obscuredUrl,
          responseBody: errorText
        });
      }
    } catch (err) {
      console.error('[TURN] Metered API request error:', {
        message: err.message,
        url: obscuredUrl
      });
    }
  } else {
    console.warn('[TURN] No METERED_API_KEY — returning STUN-only fallback');
  }

  // Fallback: public STUN servers only
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
  });
});

export default router;
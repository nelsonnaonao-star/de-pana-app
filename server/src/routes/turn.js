import express from 'express';

const router = express.Router();

const METERED_API_KEY = process.env.METERED_API_KEY || '';
const METERED_SUBDOMAIN = process.env.METERED_SUBDOMAIN || 'onchat';

router.post('/credentials', async (req, res) => {
  // Try Metered.ca REST API for dynamic TURN credentials (GET request)
  if (METERED_API_KEY) {
    try {
      const response = await fetch(
        `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
      );
      if (response.ok) {
        const iceServers = await response.json();
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          return res.json({ iceServers });
        }
      } else {
        // Log detailed error when HTTP response is not ok
        const errorText = await response.text();
        console.error('[TURN] Metered API HTTP error:', {
          status: response.status,
          statusText: response.statusText,
          url: `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`,
          responseBody: errorText
        });
      }
    } catch (err) {
      // Log network or other errors
      console.error('[TURN] Metered API request error:', {
        message: err.message,
        stack: err.stack,
        url: `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
      });
    }
  }

  // Fallback: public STUN servers only
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
});

export default router;
import { Router } from 'express';
import { URL } from 'url';
import { isIPv4 } from 'net';

const router = Router();

function extractMeta(html, names) {
  for (const name of names) {
    const attr = name.startsWith('og:') || name.startsWith('twitter:') ? 'property' : 'name';
    const patterns = [
      new RegExp(`<meta[^>]+${attr}=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escapeRegex(name)}["']`, 'i'),
    ];
    for (const p of patterns) {
      const match = html.match(p);
      if (match) return decodeEntities(match[1]);
    }
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
}

function isPrivateIP(hostname) {
  if (!hostname) return false;

  const cleaned = hostname.replace(/^\[|\]$/g, '');

  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i.test(cleaned)) return true;
  if (/^10\./.test(cleaned)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(cleaned)) return true;
  if (/^192\.168\./.test(cleaned)) return true;
  if (/^169\.254\./.test(cleaned)) return true;
  if (/^::ffff:127\.|^::ffff:10\.|^::ffff:172\.(1[6-9]|2\d|3[01])\.|^::ffff:192\.168\./.test(cleaned)) return true;
  if (/^fc00:/i.test(cleaned) || /^fd00:/i.test(cleaned)) return true;
  if (/^fe80:/i.test(cleaned)) return true;
  if (cleaned === '::' || cleaned === '0:0:0:0:0:0:0:0') return true;

  return false;
}

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RedOnBot/1.0)' },
      redirect: 'follow',
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Solo se permiten URLs HTTP/HTTPS' });
  }

  if (isPrivateIP(parsed.hostname)) {
    return res.status(400).json({ error: 'No se permiten URLs internas/privadas' });
  }

  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return res.json({ url, title: '', description: '', image: '' });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return res.json({ url, title: '', description: '', image: '' });
    }

    const html = await response.text();
    const truncated = html.slice(0, 1024 * 1024);

    const title = extractMeta(truncated, ['og:title', 'twitter:title', 'title']) || '';
    const description = extractMeta(truncated, ['og:description', 'twitter:description', 'description']) || '';
    const image = extractMeta(truncated, ['og:image', 'twitter:image', 'thumbnail']) || '';

    res.json({ url, title: title.slice(0, 500), description: description.slice(0, 1000), image: image.slice(0, 2000) });
  } catch {
    res.json({ url, title: '', description: '', image: '' });
  }
});

export default router;

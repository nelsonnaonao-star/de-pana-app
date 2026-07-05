import { Router } from 'express';

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

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return res.json({ url, title: '', description: '', image: '' });
    }
    const html = await response.text();

    const title = extractMeta(html, ['og:title', 'twitter:title', 'title']) || '';
    const description = extractMeta(html, ['og:description', 'twitter:description', 'description']) || '';
    const image = extractMeta(html, ['og:image', 'twitter:image', 'thumbnail']) || '';

    res.json({ url, title, description, image });
  } catch {
    res.json({ url, title: '', description: '', image: '' });
  }
});

export default router;

import { Router } from 'express';
import { URL } from 'url';
import { isIPv4 } from 'net';
import { lookup } from 'node:dns/promises';

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
  if (/^0\./.test(cleaned)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(cleaned)) return true;
  if (/^198\.(1[89])\./.test(cleaned)) return true;
  if (/^(22[4-9]|23\d|24\d|25[0-5])\./.test(cleaned)) return true;
  if (/^::ffff:127\.|^::ffff:10\.|^::ffff:172\.(1[6-9]|2\d|3[01])\.|^::ffff:192\.168\.|^::ffff:169\.254\.|^::ffff:0\./.test(cleaned)) return true;
  if (/^fc00:/i.test(cleaned) || /^fd00:/i.test(cleaned)) return true;
  if (/^fe80:/i.test(cleaned)) return true;
  if (cleaned === '::' || cleaned === '0:0:0:0:0:0:0:0') return true;

  return false;
}

async function assertPublicHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host) throw new Error('SSRF blocked: empty host');
  if (isPrivateIP(host)) throw new Error('SSRF blocked: private host');
  if (isIPv4(host) || host.includes(':')) return;
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('SSRF blocked: unresolved host');
  for (const entry of addresses) {
    if (isPrivateIP(entry.address)) throw new Error('SSRF blocked: private DNS');
  }
}

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RedOnBot/1.0)' },
      redirect: 'manual',
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

const MAX_REDIRECTS = 5;

async function followRedirects(initialUrl, timeoutMs = 5000) {
  let currentUrl = initialUrl;
  let response;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    response = await fetchWithTimeout(currentUrl, timeoutMs);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) return response;

    let redirectTarget;
    try {
      redirectTarget = new URL(location, currentUrl);
    } catch {
      return response;
    }

    if (!['http:', 'https:'].includes(redirectTarget.protocol)) return response;
    if (isPrivateIP(redirectTarget.hostname)) {
      throw new Error('SSRF blocked: redirect to private/internal host');
    }
    await assertPublicHost(redirectTarget.hostname);

    currentUrl = redirectTarget.href;
  }

  return response;
}

async function readTextLimited(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
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
    await assertPublicHost(parsed.hostname);
  } catch {
    return res.status(400).json({ error: 'No se permiten URLs internas/privadas' });
  }

  try {
    const response = await followRedirects(url);
    if (!response.ok) {
      return res.json({ url, title: '', description: '', image: '' });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return res.json({ url, title: '', description: '', image: '' });
    }

    const html = await readTextLimited(response, 1024 * 1024);
    const truncated = html;

    const title = extractMeta(truncated, ['og:title', 'twitter:title', 'title']) || '';
    const description = extractMeta(truncated, ['og:description', 'twitter:description', 'description']) || '';
    const image = extractMeta(truncated, ['og:image', 'twitter:image', 'thumbnail']) || '';

    res.json({ url, title: title.slice(0, 500), description: description.slice(0, 1000), image: image.slice(0, 2000) });
  } catch {
    res.json({ url, title: '', description: '', image: '' });
  }
});

export default router;

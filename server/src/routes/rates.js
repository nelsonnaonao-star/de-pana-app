import { Router } from 'express';

const router = Router();

let ratesCache = {
  data: null,
  timestamp: 0,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function parseVesNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function scrapeBCV() {
  const res = await fetch('https://www.bcv.org.ve', {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-VE,es;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`BCV HTTP ${res.status}`);
  const html = await res.text();

  let usd = null, eur = null, dateStr = null;

  const usdMatch = html.match(/id="dolar"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (usdMatch) usd = parseVesNumber(usdMatch[1]);

  const eurMatch = html.match(/id="euro"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (eurMatch) eur = parseVesNumber(eurMatch[1]);

  const dateMatch = html.match(/content="([\d]{4}-[\d]{2}-[\d]{2}T[\d:+\-Z]+)"/i);
  if (dateMatch) dateStr = dateMatch[1];

  if (!usd && !eur) throw new Error('Could not parse rates from BCV HTML');

  return { usd, eur, date: dateStr || new Date().toISOString() };
}

async function fetchBcvToday() {
  const res = await fetch('https://bcv.today/api/v1/rate.json', {
    cache: 'no-cache',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`bcv.today HTTP ${res.status}`);
  const data = await res.json();
  return {
    usd: data.USD || null,
    eur: data.EUR || null,
    date: data.effective_date || data.date || new Date().toISOString(),
  };
}

router.get('/dollar', async (_req, res) => {
  try {
    if (ratesCache.data && Date.now() - ratesCache.timestamp < CACHE_TTL) {
      return res.json(ratesCache.data);
    }

    let source = 'BCV Oficial';
    let rates;

    try {
      rates = await scrapeBCV();
      source = 'BCV Oficial';
    } catch (e) {
      console.warn('[RATES] BCV scrape failed, trying bcv.today:', e.message);
      rates = await fetchBcvToday();
      source = 'bcv.today (cache)';
    }

    const result = {
      usd: rates.usd ? {
        name: 'Dólar BCV',
        symbol: '$',
        value: rates.usd,
        source: 'Banco Central de Venezuela',
        time: rates.date,
      } : null,
      eur: rates.eur ? {
        name: 'Euro BCV',
        symbol: '€',
        value: rates.eur,
        source: 'Banco Central de Venezuela',
        time: rates.date,
      } : null,
      dataSource: source,
      updatedAt: new Date().toISOString(),
    };

    ratesCache = { data: result, timestamp: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[RATES] Error:', err);
    res.status(500).json({ error: 'Error al obtener tasas del BCV' });
  }
});

export default router;

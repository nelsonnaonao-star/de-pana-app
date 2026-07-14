import { Router } from 'express';
import { supabaseAdmin } from '../db.js';

const router = Router();

let memoryCache = { data: null, timestamp: 0 };
const MEMORY_TTL = 5 * 60 * 1000;
const DB_TTL = 30 * 60 * 1000;

async function fetchFromVeDolarApi() {
  const [usdRes, eurRes] = await Promise.all([
    fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      signal: AbortSignal.timeout(10000),
    }),
    fetch('https://ve.dolarapi.com/v1/euros/oficial', {
      signal: AbortSignal.timeout(10000),
    }),
  ]);

  if (!usdRes.ok) throw new Error(`ve.dolarapi USD HTTP ${usdRes.status}`);

  const usdData = await usdRes.json();
  const eurData = eurRes.ok ? await eurRes.json() : null;

  const usd = usdData.promedio || usdData.precio;
  if (!usd) throw new Error('No USD rate in ve.dolarapi response');

  return {
    usd: {
      name: 'Dólar BCV',
      symbol: '$',
      value: usd,
      source: 'Banco Central de Venezuela',
      time: usdData.fechaActualizacion || new Date().toISOString(),
    },
    eur: eurData ? {
      name: 'Euro BCV',
      symbol: '€',
      value: eurData.promedio || eurData.precio,
      source: 'Banco Central de Venezuela',
      time: eurData.fechaActualizacion || new Date().toISOString(),
    } : null,
    dataSource: 've.dolarapi.com',
    updatedAt: new Date().toISOString(),
  };
}

async function fetchBcvToday() {
  const res = await fetch('https://bcv.today/api/v1/rate.json', {
    cache: 'no-cache',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`bcv.today HTTP ${res.status}`);
  const data = await res.json();
  if (!data.USD) throw new Error('No USD in bcv.today');

  return {
    usd: {
      name: 'Dólar BCV',
      symbol: '$',
      value: data.USD,
      source: 'Banco Central de Venezuela',
      time: data.effective_date || data.date || new Date().toISOString(),
    },
    eur: data.EUR ? {
      name: 'Euro BCV',
      symbol: '€',
      value: data.EUR,
      source: 'Banco Central de Venezuela',
      time: data.effective_date || data.date || new Date().toISOString(),
    } : null,
    dataSource: 'bcv.today',
    updatedAt: new Date().toISOString(),
  };
}

async function scrapeBCV() {
  const res = await fetch('https://www.bcv.org.ve', {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-VE,es;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`BCV HTTP ${res.status}`);
  const html = await res.text();

  function parseVesNumber(str) {
    if (!str) return null;
    const cleaned = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    return isNaN(parseFloat(cleaned)) ? null : parseFloat(cleaned);
  }

  let usd = null, eur = null;
  const usdMatch = html.match(/id="dolar"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (usdMatch) usd = parseVesNumber(usdMatch[1]);
  const eurMatch = html.match(/id="euro"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (eurMatch) eur = parseVesNumber(eurMatch[1]);

  if (!usd && !eur) throw new Error('Could not parse BCV HTML');

  return {
    usd: usd ? {
      name: 'Dólar BCV',
      symbol: '$',
      value: usd,
      source: 'Banco Central de Venezuela',
      time: new Date().toISOString(),
    } : null,
    eur: eur ? {
      name: 'Euro BCV',
      symbol: '€',
      value: eur,
      source: 'Banco Central de Venezuela',
      time: new Date().toISOString(),
    } : null,
    dataSource: 'bcv.org.ve',
    updatedAt: new Date().toISOString(),
  };
}

async function fetchFreshRates() {
  const sources = [
    { fn: fetchFromVeDolarApi, name: 've.dolarapi' },
    { fn: fetchBcvToday, name: 'bcv.today' },
    { fn: scrapeBCV, name: 'bcv.org.ve' },
  ];

  for (const source of sources) {
    try {
      const result = await source.fn();
      console.log(`[RATES] OK from ${result.dataSource || source.name}`);
      return result;
    } catch (e) {
      console.warn(`[RATES] ${source.name} failed:`, e.message);
    }
  }
  throw new Error('All rate sources failed');
}

async function getRatesFromDB() {
  try {
    const { data, error } = await supabaseAdmin
      .from('exchange_rates')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveRatesToDB(result) {
  try {
    await supabaseAdmin.from('exchange_rates').insert({
      usd_value: result.usd?.value || null,
      eur_value: result.eur?.value || null,
      usd_date: result.usd?.time || null,
      eur_date: result.eur?.time || null,
      data_source: result.dataSource,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[RATES] DB save failed:', e.message);
  }
}

function buildResultFromDB(dbRow) {
  return {
    usd: dbRow.usd_value ? {
      name: 'Dólar BCV',
      symbol: '$',
      value: dbRow.usd_value,
      source: 'Banco Central de Venezuela',
      time: dbRow.usd_date,
    } : null,
    eur: dbRow.eur_value ? {
      name: 'Euro BCV',
      symbol: '€',
      value: dbRow.eur_value,
      source: 'Banco Central de Venezuela',
      time: dbRow.eur_date,
    } : null,
    dataSource: dbRow.data_source,
    updatedAt: dbRow.updated_at,
  };
}

router.get('/dollar', async (_req, res) => {
  try {
    if (memoryCache.data && Date.now() - memoryCache.timestamp < MEMORY_TTL) {
      return res.json(memoryCache.data);
    }

    const dbCache = await getRatesFromDB();
    const dbAge = dbCache ? Date.now() - new Date(dbCache.updated_at).getTime() : Infinity;

    if (dbCache && dbAge < DB_TTL) {
      const result = buildResultFromDB(dbCache);
      memoryCache = { data: result, timestamp: Date.now() };
      return res.json(result);
    }

    try {
      const result = await fetchFreshRates();
      memoryCache = { data: result, timestamp: Date.now() };
      await saveRatesToDB(result);
      return res.json(result);
    } catch (fetchErr) {
      console.warn('[RATES] Fresh fetch failed:', fetchErr.message);
      if (dbCache) {
        const result = buildResultFromDB(dbCache);
        memoryCache = { data: result, timestamp: Date.now() };
        return res.json(result);
      }
      throw fetchErr;
    }
  } catch (err) {
    console.error('[RATES] Error:', err);
    res.status(500).json({ error: 'Error al obtener tasas del BCV' });
  }
});

export default router;

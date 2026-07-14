import { Router } from 'express';
import { supabaseAdmin } from '../db.js';

const router = Router();

let memoryCache = { data: null, timestamp: 0 };
const MEMORY_TTL = 5 * 60 * 1000;
const DB_TTL = 30 * 60 * 1000;

function parseVesNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function fetchFromVeDolarApi() {
  const res = await fetch('https://ve.dolarapi.com/v1/dolares', {
    signal: AbortSignal.timeout(10000),
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`ve.dolarapi HTTP ${res.status}`);
  const data = await res.json();

  let usd = null, eur = null;

  const oficial = data.find(d => d.fuente === 'BCV' || d.nombre?.toLowerCase().includes('oficial'));
  if (oficial && oficial.precio) {
    usd = oficial.precio;
  } else if (data.length > 0 && data[0].precio) {
    usd = data[0].precio;
  }

  try {
    const eurRes = await fetch('https://ve.dolarapi.com/v1/euros', {
      signal: AbortSignal.timeout(10000),
    });
    if (eurRes.ok) {
      const eurData = await eurRes.json();
      const eurOficial = eurData.find(d => d.fuente === 'BCV' || d.nombre?.toLowerCase().includes('oficial'));
      if (eurOficial && eurOficial.precio) {
        eur = eurOficial.precio;
      } else if (eurData.length > 0 && eurData[0].precio) {
        eur = eurData[0].precio;
      }
    }
  } catch {}

  if (!usd) throw new Error('No USD rate found in ve.dolarapi');
  return { usd, eur, date: new Date().toISOString(), source: 've.dolarapi.com' };
}

async function fetchBcvToday() {
  const res = await fetch('https://bcv.today/api/v1/rate.json', {
    cache: 'no-cache',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`bcv.today HTTP ${res.status}`);
  const data = await res.json();
  if (!data.USD) throw new Error('No USD in bcv.today response');
  return {
    usd: data.USD,
    eur: data.EUR || null,
    date: data.effective_date || data.date || new Date().toISOString(),
    source: 'bcv.today',
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

  let usd = null, eur = null;
  const usdMatch = html.match(/id="dolar"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (usdMatch) usd = parseVesNumber(usdMatch[1]);
  const eurMatch = html.match(/id="euro"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (eurMatch) eur = parseVesNumber(eurMatch[1]);
  const dateMatch = html.match(/content="([\d]{4}-[\d]{2}-[\d]{2}T[\d:+\-Z]+)"/i);

  if (!usd && !eur) throw new Error('Could not parse BCV HTML');
  return { usd, eur, date: dateMatch?.[1] || new Date().toISOString(), source: 'bcv.org.ve' };
}

async function fetchFreshRates() {
  const sources = [
    { fn: fetchFromVeDolarApi, name: 've.dolarapi' },
    { fn: fetchBcvToday, name: 'bcv.today' },
    { fn: scrapeBCV, name: 'bcv.org.ve' },
  ];

  for (const source of sources) {
    try {
      const rates = await source.fn();
      console.log(`[RATES] Fetched from ${rates.source || source.name}`);
      return {
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
        dataSource: rates.source || source.name,
        updatedAt: new Date().toISOString(),
      };
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
    console.warn('[RATES] Failed to save to DB:', e.message);
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

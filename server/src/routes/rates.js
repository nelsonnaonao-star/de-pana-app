import { Router } from 'express';

const router = Router();

let ratesCache = {
  data: null,
  timestamp: 0,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.get('/dollar', async (_req, res) => {
  try {
    if (ratesCache.data && Date.now() - ratesCache.timestamp < CACHE_TTL) {
      return res.json(ratesCache.data);
    }

    let oficialUsd = null;
    let paraleloUsd = null;
    let oficialEur = null;
    let paraleloEur = null;

    // 1) USD rates (oficial BCV + paralelo)
    try {
      const response = await fetch('https://ve.dolarapi.com/v1/dolares', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.fuente === 'oficial') {
              oficialUsd = item;
            } else if (item.fuente === 'paralelo') {
              paraleloUsd = item;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[RATES] USD fetch failed:', e.message);
    }

    // 2) EUR rates (oficial BCV + paralelo)
    try {
      const response = await fetch('https://ve.dolarapi.com/v1/euros', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.fuente === 'oficial') {
              oficialEur = item;
            } else if (item.fuente === 'paralelo') {
              paraleloEur = item;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[RATES] EUR fetch failed:', e.message);
    }

    // Build response
    const usdOficial = oficialUsd ? {
      name: 'Dólar BCV (Oficial)',
      symbol: '$',
      value: oficialUsd.promedio || 0,
      change: '+0.00%',
      isUp: true,
      source: 'Banco Central de Venezuela',
      time: oficialUsd.fechaActualizacion,
    } : null;

    const usdParalelo = paraleloUsd ? {
      name: 'Dólar Paralelo',
      symbol: '$',
      value: paraleloUsd.promedio || 0,
      change: '+0.00%',
      isUp: true,
      source: 'Mercado Paralelo',
      time: paraleloUsd.fechaActualizacion,
    } : null;

    const eurOficial = oficialEur ? {
      name: 'Euro BCV (Oficial)',
      symbol: '€',
      value: oficialEur.promedio || 0,
      change: '+0.00%',
      isUp: true,
      source: 'Banco Central de Venezuela',
      time: oficialEur.fechaActualizacion,
    } : null;

    const eurParalelo = paraleloEur ? {
      name: 'Euro Paralelo',
      symbol: '€',
      value: paraleloEur.promedio || 0,
      change: '+0.00%',
      isUp: true,
      source: 'Mercado Paralelo',
      time: paraleloEur.fechaActualizacion,
    } : null;

    // Primary (always prefer BCV oficial)
    const usd = usdOficial || usdParalelo || {
      name: 'Dólar',
      symbol: '$',
      value: 709.69,
      change: '+0.00%',
      isUp: true,
      source: 'Referencia',
      time: new Date().toISOString(),
    };

    const eur = eurOficial || eurParalelo || {
      name: 'Euro',
      symbol: '€',
      value: 811.45,
      change: '+0.00%',
      isUp: true,
      source: 'Referencia',
      time: new Date().toISOString(),
    };

    const result = {
      usd,
      eur,
      bcv: usdOficial && eurOficial ? { usd: usdOficial, eur: eurOficial } : null,
      paralelo: usdParalelo && eurParalelo ? { usd: usdParalelo, eur: eurParalelo } : null,
      updatedAt: new Date().toISOString(),
    };

    ratesCache = { data: result, timestamp: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[RATES] Error:', err);
    res.status(500).json({ error: 'Error al obtener tasas' });
  }
});

export default router;

import { Router } from 'express';

const router = Router();

// Cache for rates to avoid hitting the API too often
let ratesCache = {
  data: null,
  timestamp: 0,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.get('/dollar', async (_req, res) => {
  try {
    // Return cached data if fresh
    if (ratesCache.data && Date.now() - ratesCache.timestamp < CACHE_TTL) {
      return res.json(ratesCache.data);
    }

    // Try ve.dolarapi.com/v1/dolares (parallel market rate)
    try {
      const response = await fetch('https://ve.dolarapi.com/v1/dolares', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        const paralelo = Array.isArray(data) ? data.find((d) => d.nombre?.toLowerCase().includes('paralelo')) : null;
        if (paralelo) {
          const result = {
            usd: {
              name: paralelo.nombre || 'Dólar Paralelo',
              symbol: '$',
              value: paralelo.promedio || paralelo.precio || 0,
              change: paralelo.cambio || '+0.00%',
              isUp: (paralelo.cambio || '').startsWith('+'),
              source: paralelo.fuente || 'Mercado Paralelo',
              time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
            },
            eur: {
              name: 'Euro (Referencia)',
              symbol: '€',
              value: (paralelo.promedio || paralelo.precio || 0) * 1.14,
              change: '+0.00%',
              isUp: true,
              source: 'Mercado Paralelo',
              time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
            },
            updatedAt: new Date().toISOString(),
          };
          ratesCache = { data: result, timestamp: Date.now() };
          return res.json(result);
        }
      }
    } catch (e) {
      console.warn('[RATES] ve.dolarapi.com/dolares failed:', e.message);
    }

    // Fallback: try ve.dolarapi.com/v1/tasas/bcv (official BCV)
    try {
      const response = await fetch('https://ve.dolarapi.com/v1/tasas/bcv', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        const result = {
          usd: {
            name: 'Dólar BCV (Oficial)',
            symbol: '$',
            value: data.usd || 0,
            change: data.usd_change || '+0.00%',
            isUp: (data.usd_change || '').startsWith('+'),
            source: 'Banco Central de Venezuela',
            time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
          },
          eur: {
            name: 'Euro BCV (Oficial)',
            symbol: '€',
            value: data.eur || 0,
            change: data.eur_change || '+0.00%',
            isUp: (data.eur_change || '').startsWith('+'),
            source: 'Banco Central de Venezuela',
            time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
          },
          updatedAt: new Date().toISOString(),
        };
        ratesCache = { data: result, timestamp: Date.now() };
        return res.json(result);
      }
    } catch (e) {
      console.warn('[RATES] ve.dolarapi.com/bcv failed:', e.message);
    }

    // Fallback: try exchangerate-api.com
    try {
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        const vesRate = data.rates?.VES || 0;
        const eurRate = data.rates?.EUR || 0;
        const result = {
          usd: {
            name: 'Dólar (USD)',
            symbol: '$',
            value: vesRate,
            change: '+0.00%',
            isUp: true,
            source: 'exchangerate-api.com',
            time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
          },
          eur: {
            name: 'Euro (EUR)',
            symbol: '€',
            value: vesRate / eurRate,
            change: '+0.00%',
            isUp: true,
            source: 'exchangerate-api.com',
            time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
          },
          updatedAt: new Date().toISOString(),
        };
        ratesCache = { data: result, timestamp: Date.now() };
        return res.json(result);
      }
    } catch (e) {
      console.warn('[RATES] exchangerate-api.com failed:', e.message);
    }

    // If all APIs fail, return fallback data
    const mockResult = {
      usd: {
        name: 'Dólar Paralelo',
        symbol: '$',
        value: 667.05,
        change: '+0.00%',
        isUp: true,
        source: 'Mercado Paralelo',
        time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
      },
      eur: {
        name: 'Euro (Referencia)',
        symbol: '€',
        value: 763.19,
        change: '+0.00%',
        isUp: true,
        source: 'Mercado Paralelo',
        time: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
      },
      updatedAt: new Date().toISOString(),
      warning: 'No se pudo obtener datos en tiempo real',
    };
    res.json(mockResult);
  } catch (err) {
    console.error('[RATES] Error:', err);
    res.status(500).json({ error: 'Error al obtener tasas' });
  }
});

export default router;

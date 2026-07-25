const CRITICAL_STATUSES = [401, 403, 429];
const THRESHOLD = 5;
const WINDOW_MS = 60_000;

const ipHits = new Map();

function sendSecurityAlert(ip, errorType, path, attempts) {
  console.error(`
╔══ ⚠️  🚨  ⚠️  🚨  ⚠️  🚨  ⚠️  🚨  ⚠️  🚨  ══╗
║   A L E R T A   C R Í T I C A   D E           ║
║        S E G U R I D A D                       ║
╠══════════════════════════════════════════════════╣
║  IP ATACANTE:  ${ip.padEnd(38)}║
║  RUTA:         ${path.padEnd(38)}║
║  CÓDIGO HTTP:  ${String(errorType).padEnd(38)}║
║  INTENTOS:     ${String(attempts).padEnd(38)}║
║  TIMESTAMP:    ${new Date().toISOString().padEnd(38)}║
╚══════════════════════════════════════════════════════╝
  `);
}

function cleanupExpired() {
  const now = Date.now();
  for (const [ip, record] of ipHits) {
    if (now - record.windowStart > WINDOW_MS) {
      ipHits.delete(ip);
    }
  }
}

setInterval(cleanupExpired, WINDOW_MS);

export function tripwire(req, res, next) {
  const originalStatus = res.status.bind(res);

  res.status = function (statusCode) {
    if (CRITICAL_STATUSES.includes(statusCode)) {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const now = Date.now();
      let record = ipHits.get(ip);

      if (!record || now - record.windowStart > WINDOW_MS) {
        record = { count: 0, windowStart: now };
        ipHits.set(ip, record);
      }

      record.count += 1;

      if (record.count >= THRESHOLD) {
        sendSecurityAlert(ip, statusCode, req.originalUrl || req.url, record.count);
        ipHits.delete(ip);
      }
    }

    return originalStatus(statusCode);
  };

  next();
}

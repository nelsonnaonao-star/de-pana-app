// Chequeo de contraseñas filtradas con k-anonymity (HaveIBeenPwned Pwned
// Passwords) del lado servidor. La contraseña nunca se envía: solo el prefijo
// de 5 caracteres del SHA-1. Fail-open ante fallos de red/API.

import crypto from 'node:crypto';

export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
export const HIBP_TIMEOUT_MS = 4000;

export function sha1Hex(value) {
  return crypto.createHash('sha1').update(String(value), 'utf8').digest('hex').toUpperCase();
}

export function splitSha1(hash) {
  const normalized = String(hash).trim().toUpperCase();
  return { prefix: normalized.slice(0, 5), suffix: normalized.slice(5) };
}

export function parseHibpRange(body, suffix) {
  const target = String(suffix).trim().toUpperCase();
  for (const line of String(body).split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    if (line.slice(0, idx).trim().toUpperCase() !== target) continue;
    const count = Number.parseInt(line.slice(idx + 1), 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  return 0;
}

export async function getPasswordLeakCount(password, options = {}) {
  if (!password) return 0;

  // En tests (sin fetch inyectado) no se hace red; los unit tests inyectan.
  const defaultFetch = process.env.NODE_ENV === 'test' ? null : globalThis.fetch;
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  if (!fetchImpl) return 0;

  const timeoutMs = options.timeoutMs ?? HIBP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { prefix, suffix } = splitSha1(sha1Hex(password));
    const res = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
      // Add-Padding hace que todas las respuestas tengan tamaño uniforme.
      headers: { 'Add-Padding': 'true', 'User-Agent': 'de-pana-server' },
      signal: controller.signal,
    });
    if (!res.ok) return 0;
    return parseHibpRange(await res.text(), suffix);
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export async function assertPasswordNotLeaked(password, options = {}) {
  const count = await getPasswordLeakCount(password, options);
  if (count > 0) {
    const error = new Error(
      'Esa contraseña apareció en filtraciones de datos. Elige una distinta que no hayas usado en otros sitios.',
    );
    error.code = 'PASSWORD_LEAKED';
    throw error;
  }
}

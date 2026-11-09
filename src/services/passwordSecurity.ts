// Chequeo de contraseñas filtradas con k-anonymity (HaveIBeenPwned Pwned
// Passwords). Gratis y sin depender del plan de Supabase.
//
// La contraseña NUNCA sale del dispositivo: se calcula SHA-1 y solo se envían
// los 5 primeros caracteres hex; la comparación se hace localmente.
//
// Fail-open: si la API falla, tarda o no hay Web Crypto, se devuelve 0 y no se
// bloquea al usuario. Una caída externa no puede impedir registro/cambio.

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 4000;

export interface HibpOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function splitSha1(hash: string): { prefix: string; suffix: string } {
  const normalized = hash.trim().toUpperCase();
  return { prefix: normalized.slice(0, 5), suffix: normalized.slice(5) };
}

export function parseHibpRange(body: string, suffix: string): number {
  const target = suffix.trim().toUpperCase();
  for (const line of String(body).split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    if (line.slice(0, idx).trim().toUpperCase() !== target) continue;
    const count = Number.parseInt(line.slice(idx + 1), 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  return 0;
}

export async function sha1Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto no disponible");
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function getPasswordLeakCount(
  password: string,
  options: HibpOptions = {},
): Promise<number> {
  if (!password) return 0;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return 0;

  const timeoutMs = options.timeoutMs ?? HIBP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { prefix, suffix } = splitSha1(await sha1Hex(password));
    const res = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
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

export async function assertPasswordNotLeaked(
  password: string,
  options: HibpOptions = {},
): Promise<void> {
  const count = await getPasswordLeakCount(password, options);
  if (count > 0) {
    throw new Error(
      "Esa contraseña apareció en filtraciones de datos. Elige una distinta que no hayas usado en otros sitios.",
    );
  }
}

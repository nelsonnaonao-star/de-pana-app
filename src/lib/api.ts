import { supabase } from "./supabase";

const FALLBACK_URL = "https://de-pana-app-kucq.onrender.com";

const base = import.meta.env.VITE_SERVER_URL || FALLBACK_URL;

export function apiUrl(path: string): string {
  return base + path;
}

// Timestamp del último fallo de refresh real (excepción, no 401 genérico).
// Usado para cooldown: no disparar session-unrecoverable más de una vez
// cada 45s aunque una ráfaga de llamadas falle simultáneamente.
let lastRefreshFailureAt = 0;
const REFRESH_FAILURE_COOLDOWN_MS = 45000;

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  // Timeout por defecto: con red móvil inestable un POST puede quedar "pendiendo"
  // indefinidamente (relojito eterno). Con timeout el fallo aflora y se reintenta.
  const controller = new AbortController();
  const timeoutMs = options.signal ? undefined : 60000;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const opts: RequestInit = { ...options, headers };
  if (timeoutMs) opts.signal = controller.signal;

  let response: Response;
  try {
    response = await fetch(url, opts);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (response.status === 401) {
    let refreshThrew = false;
    try {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed?.access_token) {
        headers['Authorization'] = `Bearer ${refreshed.access_token}`;
        response = await fetch(url, { ...opts, headers });
      }
      // Si refreshSession no lanzó pero devolvió null → token vencido pero
      // no "explotó". Podría ser 401 del servidor por otra razón (rate limit,
      // permisos, etc.). No disparar sesión muerta — es ambiguo.
    } catch {
      // refreshSession() lanzó excepción real → token/refresh irrecuperable
      refreshThrew = true;
    }

    if (refreshThrew && response.status >= 400) {
      const now = Date.now();
      if (now - lastRefreshFailureAt > REFRESH_FAILURE_COOLDOWN_MS) {
        lastRefreshFailureAt = now;
        window.dispatchEvent(new CustomEvent("session-unrecoverable"));
      }
    }
  }

  return response;
}

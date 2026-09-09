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

// Tiempo máximo para las operaciones de sesión de Supabase que ocurren
// ANTES del fetch. Sin esto, getSession()/refreshSession() podrían dejar
// authFetch() esperando indefinidamente (botón en "Enviando..." eterno).
const SESSION_TIMEOUT_MS = 5000;

function withSessionTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

const NO_SESSION_RESULT = { data: { session: null } } as const;

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // getSession() nunca debe colgar el flujo: si expira el timeout se trata
  // como "sin sesión" (válido para usuario no autenticado en recuperación).
  let { data: { session } } = await withSessionTimeout(
    supabase.auth.getSession(),
    SESSION_TIMEOUT_MS,
    NO_SESSION_RESULT,
  );

  // Capacitor/Android: getSession() a veces retorna null aunque la sesión
  // exista en Preferences (la carga es async y puede no haber completado).
  // En ese caso, refreshSession() fuerza la re-lectura de storage + refresh.
  // También este paso está sujeto a timeout para no bloquear el flujo.
  if (!session?.access_token) {
    const refreshedResult = await withSessionTimeout(
      supabase.auth.refreshSession(),
      SESSION_TIMEOUT_MS,
      NO_SESSION_RESULT,
    );
    if (refreshedResult.data?.session?.access_token) {
      session = refreshedResult.data.session;
    }
  }

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

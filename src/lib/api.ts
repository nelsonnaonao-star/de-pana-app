import { supabase } from "./supabase";

const FALLBACK_URL = "https://de-pana-app.onrender.com";

const base = import.meta.env.VITE_SERVER_URL || FALLBACK_URL;

export function apiUrl(path: string): string {
  return base + path;
}

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
    try {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed?.access_token) {
        headers['Authorization'] = `Bearer ${refreshed.access_token}`;
        response = await fetch(url, { ...opts, headers });
      }
    } catch {
      // refresh failed
    }
  }

  return response;
}

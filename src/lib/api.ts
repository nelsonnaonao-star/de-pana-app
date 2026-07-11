import { supabase } from "./supabase";

const FALLBACK_URL = "https://de-pana-app.onrender.com";

const base = import.meta.env.VITE_SERVER_URL || FALLBACK_URL;

export function apiUrl(path: string): string {
  return base + path;
}

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      cachedToken = session.access_token;
      tokenExpiry = Date.now() + (session.expires_in - 60) * 1000;
      return cachedToken;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
}

export function invalidateToken() {
  cachedToken = null;
  tokenExpiry = 0;
}

import { supabase } from "./supabase";

const FALLBACK_URL = "https://de-pana-app.onrender.com";

const base = import.meta.env.VITE_SERVER_URL || FALLBACK_URL;

export function apiUrl(path: string): string {
  return base + path;
}

let cachedToken: string | null = null;
let tokenExpiry = 0;
let isRefreshing = false;

async function getToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiry) return cachedToken;

  if (isRefreshing) {
    // Wait for existing refresh to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    return getToken();
  }

  isRefreshing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      cachedToken = session.access_token;
      tokenExpiry = Date.now() + (session.expires_in - 60) * 1000;
      return cachedToken;
    }
  } catch {
    // ignore
  } finally {
    isRefreshing = false;
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

  const response = await fetch(url, { ...options, headers });

  // Auto-retry on 401 with fresh token (once)
  if (response.status === 401) {
    invalidateToken();
    const freshToken = await getToken(true);
    if (freshToken) {
      headers['Authorization'] = `Bearer ${freshToken}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
}

export function invalidateToken() {
  cachedToken = null;
  tokenExpiry = 0;
}

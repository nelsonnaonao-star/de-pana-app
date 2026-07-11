import { authFetch } from "../lib/api";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

export interface GiphyResult {
  id: string;
  title: string;
  images: {
    fixed_height: { url: string; width: string; height: string };
    fixed_height_small: { url: string; width: string; height: string };
    original: { url: string; width: string; height: string };
    preview_gif: { url: string; width: string; height: string };
  };
}

type Endpoint = "gifs" | "stickers";

async function giphyFetch(endpoint: Endpoint, action: string, query: string, limit = 30): Promise<GiphyResult[]> {
  const params = new URLSearchParams({ type: endpoint, limit: String(limit) });
  if (query) params.set('q', query);
  const url = `${SERVER_URL}/api/giphy/${action}?${params.toString()}`;

  try {
    const res = await authFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.data || []);
  } catch {
    return [];
  }
}

export async function searchGifs(query: string, limit = 30): Promise<GiphyResult[]> {
  return giphyFetch("gifs", "search", query, limit);
}

export async function getTrendingGifs(limit = 30): Promise<GiphyResult[]> {
  return giphyFetch("gifs", "trending", "", limit);
}

export async function searchStickers(query: string, limit = 30): Promise<GiphyResult[]> {
  return giphyFetch("stickers", "search", query, limit);
}

export async function getTrendingStickers(limit = 30): Promise<GiphyResult[]> {
  return giphyFetch("stickers", "trending", "", limit);
}

export const GIF_CATEGORIES = [
  { emoji: "🔥", name: "Trending" },
  { emoji: "😂", name: "Funny" },
  { emoji: "❤️", name: "Love" },
  { emoji: "🎉", name: "Celebration" },
  { emoji: "😢", name: "Sad" },
  { emoji: "😡", name: "Angry" },
  { emoji: "👍", name: "Thumbs Up" },
  { emoji: "🎶", name: "Music" },
  { emoji: "💪", name: "Workout" },
  { emoji: "🌅", name: "Good Morning" },
  { emoji: "🌙", name: "Good Night" },
  { emoji: "🎮", name: "Gaming" },
];

import { apiUrl } from "../lib/api";

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
  const params = new URLSearchParams({
    limit: String(limit),
    type: endpoint,
  });
  if (query) params.set("q", query);
  const url = apiUrl(`/api/giphy/${action}?${params.toString()}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIPHY error ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.data || []);
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

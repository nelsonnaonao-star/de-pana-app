const GIPHY_API_KEY = "bd36d0j4ju5xmnkLKzGwe6X1wFTURLGB";
const GIPHY_BASE = "https://api.giphy.com/v1";

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
  const params = action === "search"
    ? `q=${encodeURIComponent(query)}`
    : "";
  const url = `${GIPHY_BASE}/${endpoint}/${action}?api_key=${GIPHY_API_KEY}&${params}&limit=${limit}&rating=g`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`GIPHY ${endpoint}/${action} failed:`, res.status);
    return [];
  }
  const data = await res.json();
  return data.data || [];
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

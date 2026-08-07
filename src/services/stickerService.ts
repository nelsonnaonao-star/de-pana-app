import { apiUrl } from "../lib/api";
import { supabase } from "../lib/supabase";

export interface MusicTrack {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  file_url: string;
  cover_url?: string;
  category?: string;
}

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

// ─── Music Library (Supabase Storage bucket "music") ────────────────

const MUSIC_BUCKET = "music";
const AUDIO_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".flac"];

export async function getMusicLibrary(): Promise<MusicTrack[]> {
  try {
    const { data, error } = await supabase.storage.from(MUSIC_BUCKET).list();
    if (error) {
      console.error("[MUSIC] list error:", error.message);
      return [];
    }
    if (!data) return [];
    const tracks: MusicTrack[] = [];
    for (const file of data) {
      if (!file.name) continue;
      const lower = file.name.toLowerCase();
      if (!AUDIO_EXTS.some(ext => lower.endsWith(ext))) continue;
      const { data: urlData } = supabase.storage.from(MUSIC_BUCKET).getPublicUrl(file.name);
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ");
      tracks.push({
        id: file.name,
        title,
        artist: "",
        duration: 0,
        file_url: urlData?.publicUrl || "",
        cover_url: "",
        category: "General",
      });
    }
    return tracks;
  } catch (err) {
    console.error("[MUSIC] getMusicLibrary error:", err);
    return [];
  }
}

export async function getMusicCategories(): Promise<string[]> {
  return ["General"];
}

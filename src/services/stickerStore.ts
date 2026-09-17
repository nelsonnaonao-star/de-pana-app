import { supabase } from "../lib/supabase";

const BUCKET = "stickers_oficiales";
const WEPA_FOLDER = "wepa";

const ALLOWED_EXTS = [".webp", ".png", ".jpg", ".jpeg", ".gif"];

async function listUrls(folder: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(folder);
  if (error) throw error;
  if (!data) return [];
  const urls: string[] = [];
  for (const file of data) {
    if (file.id === null || !file.name) continue;
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXTS.some(ext => lower.endsWith(ext))) continue;
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(folder ? `${folder}/${file.name}` : file.name);
    urls.push(urlData?.publicUrl || "");
  }
  return urls.filter(Boolean);
}

export async function getOfficialStickers(): Promise<string[]> {
  return listUrls("");
}

export async function getWepaStickers(): Promise<string[]> {
  return listUrls(WEPA_FOLDER);
}

import { supabase } from "../lib/supabase";

const BUCKET = "stickers_oficiales";

export async function getOfficialStickers(): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list();
  if (error) throw error;
  if (!data) return [];
  const urls: string[] = [];
  for (const file of data) {
    if (file.id === null || !file.name) continue;
    if (file.name.toLowerCase().endsWith(".webp") || file.name.toLowerCase().endsWith(".png")) {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(file.name);
      urls.push(urlData?.publicUrl || "");
    }
  }
  return urls.filter(Boolean);
}

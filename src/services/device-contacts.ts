import { Contacts } from "@capacitor-community/contacts";
import { supabase } from "../lib/supabase";
import { digitsOnly } from "../utils/phone";

export interface DeviceContact {
  name: string;
  rawPhone: string;
  cleanedPhone: string;
}

export interface MatchedProfile {
  id: string;
  username: string;
  name: string;
  phone_number: string;
  avatar_url?: string;
  contactName?: string;
}

function cleanPhone(phone: string): string {
  return digitsOnly(phone).replace(/^00/, "");
}

// Suffix of the last N digits, used for country-code-agnostic matching. Both
// "573001234567" (+57) and "3001234567" (local) share the same last-10 digits,
// so contacts match regardless of how the number was stored.
export function lastDigits(n: string, count: number): string {
  return n.length > count ? n.slice(-count) : n;
}

export async function requestContactPermission(): Promise<boolean> {
  try {
    const permission = await Contacts.requestPermissions();
    return permission?.contacts === "granted";
  } catch (e) {
    console.warn("[DEVICE-CONTACTS] Permission request error:", e);
    return false;
  }
}

export async function readDeviceContacts(): Promise<DeviceContact[]> {
  const granted = await requestContactPermission();
  if (!granted) {
    console.warn("[DEVICE-CONTACTS] Permission denied");
    return [];
  }

  try {
    const result = await Contacts.getContacts({
      projection: {
        name: true,
        phones: true,
      },
    });

    const contacts: DeviceContact[] = [];

    for (const c of result.contacts || []) {
      const name = c.name?.display || c.name?.given || c.name?.family || "";
      if (!name) continue;

      for (const phone of c.phones || []) {
        const raw = phone?.number || "";
        const cleaned = cleanPhone(raw);
        if (cleaned.length < 7) continue;

        contacts.push({ name, rawPhone: raw, cleanedPhone: cleaned });
      }
    }

    return contacts;
  } catch (e) {
    console.error("[DEVICE-CONTACTS] Read error:", e);
    return [];
  }
}

export async function matchContactsWithSupabase(
  contacts: DeviceContact[]
): Promise<MatchedProfile[]> {
  if (contacts.length === 0) return [];
  const uniqueNumbers = [...new Set(contacts.map((c) => c.cleanedPhone))];
  const BATCH_SIZE = 100;

  const matched: MatchedProfile[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < uniqueNumbers.length; i += BATCH_SIZE) {
    const batch = uniqueNumbers.slice(i, i + BATCH_SIZE);

    // La RPC normaliza y compara del lado servidor (país-agnóstico) y devuelve
    // solo campos públicos + `matched_phone` (el número de la agenda que hizo
    // match). Nunca expone el teléfono almacenado de terceros.
    const { data, error } = await supabase.rpc("match_profiles_by_phones", {
      p_phones: batch,
      p_limit: 500,
    });

    if (error) {
      console.error("[DEVICE-CONTACTS] Supabase RPC error:", error);
      continue;
    }

    for (const profile of (data || []) as any[]) {
      if (seen.has(profile.id)) continue;
      seen.add(profile.id);

      const matchedPhone = profile.matched_phone || "";
      const profileDigits = digitsOnly(matchedPhone);
      const deviceContact = contacts.find(
        (c) => lastDigits(digitsOnly(c.cleanedPhone), 10) === lastDigits(profileDigits, 10)
      );

      matched.push({
        id: profile.id,
        username: profile.username || "",
        name: profile.name || "",
        phone_number: matchedPhone,
        avatar_url: profile.avatar_url || undefined,
        contactName: deviceContact?.name || profile.name || "",
      });
    }
  }

  return matched;
}

export async function syncDeviceContacts(): Promise<MatchedProfile[]> {
  const contacts = await readDeviceContacts();
  if (contacts.length === 0) return [];
  return matchContactsWithSupabase(contacts);
}

export async function searchByPhone(
  query: string
): Promise<MatchedProfile[]> {
  const cleaned = cleanPhone(query);
  // La RPC exige al menos 7 dígitos para evitar coincidencias masivas.
  if (cleaned.length < 7) return [];

  const { data, error } = await supabase.rpc("match_profiles_by_phones", {
    p_phones: [cleaned],
    p_limit: 20,
  });

  if (error) {
    console.error("[DEVICE-CONTACTS] Search error:", error);
    return [];
  }

  return ((data || []) as any[]).map((p) => ({
    id: p.id,
    username: p.username || "",
    name: p.name || "",
    phone_number: p.matched_phone || "",
    avatar_url: p.avatar_url || undefined,
    contactName: p.name || "",
  }));
}

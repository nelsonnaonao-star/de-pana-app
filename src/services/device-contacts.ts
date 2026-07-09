import { Contacts } from "@capacitor-community/contacts";
import { supabase } from "../lib/supabase";

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
  return phone.replace(/[\s\-().–—\+]/g, "").replace(/^00/, "").replace(/^1/, "").trim();
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
      const name = c.name?.display || c.name?.givenName || c.name?.familyName || "";
      if (!name) continue;

      for (const phone of c.phones || []) {
        const raw = phone?.number || phone || "";
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

  for (let i = 0; i < uniqueNumbers.length; i += BATCH_SIZE) {
    const batch = uniqueNumbers.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, name, phone_number, avatar_url")
      .in("phone_number", batch);

    if (error) {
      console.error("[DEVICE-CONTACTS] Supabase query error:", error);
      continue;
    }

    for (const profile of data || []) {
      const deviceContact = contacts.find(
        (c) => c.cleanedPhone === profile.phone_number
      );
      matched.push({
        ...profile,
        contactName: deviceContact?.name || profile.name,
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
  if (cleaned.length < 4) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, phone_number, avatar_url")
    .ilike("phone_number", `%${cleaned}%`)
    .limit(20);

  if (error) {
    console.error("[DEVICE-CONTACTS] Search error:", error);
    return [];
  }

  return (data || []).map((p) => ({ ...p, contactName: p.name }));
}

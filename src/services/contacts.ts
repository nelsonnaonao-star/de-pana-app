import { supabase } from "../lib/supabase";

export type Contact = {
  id: string;
  user_id: string;
  contact_user_id?: string;
  name: string;
  avatar?: string;
  bio?: string;
  phone?: string;
  type: "human" | "business";
  color_theme?: string;
  is_group: boolean;
  is_favorite: boolean;
  created_at: string;
};

export async function searchUsers(q: string, currentUserId: string) {
  const query = q.toLowerCase().replace(/^@/, "").trim();
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, "");

  // Generar múltiples patrones para evadir ceros iniciales / código de país
  const patterns = [digits];
  if (digits.length >= 11) {
    for (let i = 2; i <= 4; i++) {
      if (digits[i] === "0") patterns.push(digits.slice(0, i) + digits.slice(i + 1));
    }
    if (digits[0] === "0") patterns.push(digits.slice(1));
  }

  // 1. Buscar coincidencia exacta de teléfono
  let exactProfile: any = null;
  for (const p of patterns) {
    if (exactProfile) break;
    if (p.length >= 7) {
      const { data: exactPhone } = await supabase
        .from("profiles")
        .select("id")
        .ilike("phone_number", `%${p}%`)
        .neq("id", currentUserId)
        .limit(1);
      if (exactPhone && exactPhone.length > 0) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", exactPhone[0].id)
          .single();
        if (profile) exactProfile = profile;
      }
    }
  }

  if (exactProfile) {
    return [
      {
        id: exactProfile.id,
        name: exactProfile.name,
        username: exactProfile.username || "",
        phone: exactProfile.phone_number || "",
        avatar: exactProfile.avatar_url || "",
        bio: exactProfile.bio || "",
      },
    ];
  }

  // 2. Fallback: búsqueda por username o nombre
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .neq("id", currentUserId)
    .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
    .limit(10);

  return (profiles || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    username: p.username || "",
    phone: p.phone_number || "",
    avatar: p.avatar_url || "",
    bio: p.bio || "",
  }));
}

export async function getContacts(userId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .order("name");

  if (error) throw error;
  return data as Contact[];
}

export async function addContact(
  userId: string,
  contactUserId: string | null,
  name: string,
  avatar?: string,
  phone?: string
): Promise<Contact> {
  const payload: any = {
    user_id: userId,
    name,
    avatar: avatar || "",
    bio: phone ? `Contacto externo: ${phone}` : "",
    type: "human",
    color_theme: "from-indigo-500 to-violet-600",
    is_group: false,
    is_favorite: false,
    created_at: new Date().toISOString(),
  };

  if (contactUserId) {
    payload.contact_user_id = contactUserId;
  }

  if (phone) {
    payload.phone = phone.replace(/[\s+()\-]/g, "").trim();
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as Contact;
}

export async function toggleFavorite(contactId: string, isFavorite: boolean) {
  const { error } = await supabase
    .from("contacts")
    .update({ is_favorite: isFavorite })
    .eq("id", contactId);
  if (error) throw error;
}

import { supabase } from "../lib/supabase";
import { digitsOnly } from "../utils/phone";

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
  const query = q.toLowerCase().trim();
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 7) {
    const { data: byDigits } = await supabase
      .from("profiles")
      .select("id, name, username, phone_number, avatar_url, bio")
      .ilike("phone_digits", `%${digits}%`)
      .neq("id", currentUserId)
      .limit(10);
    if (byDigits && byDigits.length > 0) {
      return byDigits.map((p: any) => ({ id: p.id, name: p.name, username: p.username || "", phone: p.phone_number || "", avatar: p.avatar_url || "", bio: p.bio || "" }));
    }
    const { data: byPhone } = await supabase
      .from("profiles")
      .select("id, name, username, phone_number, avatar_url, bio")
      .ilike("phone_number", `%${digits}%`)
      .neq("id", currentUserId)
      .limit(10);
    if (byPhone && byPhone.length > 0) {
      return byPhone.map((p: any) => ({ id: p.id, name: p.name, username: p.username || "", phone: p.phone_number || "", avatar: p.avatar_url || "", bio: p.bio || "" }));
    }
  }
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, username, phone_number, avatar_url, bio")
    .neq("id", currentUserId)
    .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
    .limit(10);
  return (profiles || []).map((p: any) => ({ id: p.id, name: p.name, username: p.username || "", phone: p.phone_number || "", avatar: p.avatar_url || "", bio: p.bio || "" }));
}

export async function getContacts(userId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .order("name");

  if (error) throw error;

  const contacts = (data || []) as Contact[];

  // Resolve current avatar from profiles for linked contacts
  const linkedIds = contacts
    .map(c => c.contact_user_id)
    .filter((id): id is string => !!id);

  if (linkedIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, avatar_url, name")
      .in("id", linkedIds);

    if (profiles && profiles.length > 0) {
      const profileMap = new Map(profiles.map((p: any) => [p.id, p]));
      return contacts.map(c => {
        const profile = c.contact_user_id ? profileMap.get(c.contact_user_id) : undefined;
        return {
          ...c,
          // Para contactos vinculados el avatar proviene EXCLUSIVAMENTE del
          // perfil: si el perfil no tiene foto, el contacto no debe mostrar
          // ninguna (impide mostrar fotos viejas/ajenas estampadas en la fila).
          avatar: profile ? ((profile as any)?.avatar_url || "") : (c.avatar || ""),
          name: (profile as any)?.name || c.name,
        };
      });
    }
  }

  return contacts;
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
    payload.phone = digitsOnly(phone);
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as Contact;
}

export async function deleteContact(contactId: string) {
  const { error } = await supabase.from("contacts").delete().eq("id", contactId);
  if (error) throw error;
}

export async function toggleFavorite(contactId: string, isFavorite: boolean) {
  const { error } = await supabase
    .from("contacts")
    .update({ is_favorite: isFavorite })
    .eq("id", contactId);
  if (error) throw error;
}

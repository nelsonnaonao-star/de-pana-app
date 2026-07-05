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

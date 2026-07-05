import { supabase } from "../lib/supabase";

export type Chat = {
  id: string;
  name: string;
  is_group: boolean;
  avatar?: string;
  avatar_color?: string;
  last_message?: string;
  last_message_time?: string;
  created_at: string;
  updated_at: string;
  unread_count: number;
  is_online: boolean;
  phone?: string;
  username?: string;
  bio?: string;
  profile_id?: string;
  admin_id?: string;
};

export async function getChats(userId: string): Promise<Chat[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .or(`profile_id.eq.${userId},admin_id.eq.${userId}`)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data as Chat[];
}

export async function getChatById(chatId: string): Promise<Chat | null> {
  const { data } = await supabase
    .from("chats")
    .select("*")
    .eq("id", chatId)
    .single();
  return data as Chat;
}

export async function createChat(chat: Partial<Chat>): Promise<Chat> {
  const { data, error } = await supabase
    .from("chats")
    .insert({
      name: chat.name,
      is_group: chat.is_group || false,
      avatar: chat.avatar || "",
      avatar_color: chat.avatar_color || "bg-slate-450",
      phone: chat.phone || "",
      username: chat.username || "",
      bio: chat.bio || "",
      profile_id: chat.profile_id,
      admin_id: chat.admin_id,
      is_online: true,
      unread_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data as Chat;
}

export async function updateChat(chatId: string, updates: Partial<Chat>) {
  const { error } = await supabase
    .from("chats")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", chatId);
  if (error) throw error;
}

export function subscribeToChats(userId: string, callback: (chat: Chat) => void) {
  return supabase
    .channel("chats")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chats",
        filter: `profile_id=eq.${userId}`,
      },
      (payload) => callback(payload.new as Chat)
    )
    .subscribe();
}

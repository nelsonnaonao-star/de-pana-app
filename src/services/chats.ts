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
  // Get chats where user is a direct participant (profile_id/admin_id)
  const { data: directChats, error } = await supabase
    .from("chats")
    .select("*")
    .or(`profile_id.eq.${userId},admin_id.eq.${userId}`)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  // Also get chats where user is a member via chat_participants
  const { data: participantRows } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("profile_id", userId);

  let groupChatIds: string[] = [];
  if (participantRows) {
    groupChatIds = participantRows.map(r => r.chat_id);
    // Remove any already included via direct lookup
    const directIds = new Set((directChats || []).map(c => c.id));
    groupChatIds = groupChatIds.filter(id => !directIds.has(id));
  }

  let groupChats: Chat[] = [];
  if (groupChatIds.length > 0) {
    const { data: gc } = await supabase
      .from("chats")
      .select("*")
      .in("id", groupChatIds)
      .order("updated_at", { ascending: false });
    groupChats = (gc || []) as Chat[];
  }

  const rows = [...(directChats || []), ...groupChats];
  const seen = new Map<string, Chat>();
  for (const chat of rows) {
    if (chat.is_group) {
      if (!seen.has(chat.id)) seen.set(chat.id, chat);
      continue;
    }
    const partner = chat.profile_id === userId ? chat.admin_id : chat.profile_id;
    if (!partner) {
      if (!seen.has(chat.id)) seen.set(chat.id, chat);
      continue;
    }
    const key = [userId, partner].sort().join("::");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, chat);
    } else {
      if (chat.id < existing.id) {
        seen.set(key, chat);
      }
    }
  }

  let deduped = Array.from(seen.values());

  // Override 1:1 chat names with the partner's profile name
  const partnerIds = deduped
    .filter(c => !c.is_group && c.profile_id && c.admin_id)
    .map(c => (c.profile_id === userId ? c.admin_id! : c.profile_id!));
  if (partnerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, status")
      .in("id", partnerIds);
    if (profiles) {
      const partnerMap = new Map(profiles.map(p => [p.id, { name: p.name, avatar_url: p.avatar_url, status: p.status }]));
      deduped = deduped.map(chat => {
        const partnerId = chat.profile_id === userId ? chat.admin_id : chat.profile_id;
        if (!chat.is_group && partnerId && partnerMap.has(partnerId)) {
          const p = partnerMap.get(partnerId)!;
          return { ...chat, name: p.name, avatar: p.avatar_url || chat.avatar, is_online: p.status === "online" };
        }
        return chat;
      });
    }
  }

  return deduped;
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
  // Check if a chat already exists between the two users (prevents duplicate chats)
  if (chat.profile_id && chat.admin_id && chat.profile_id !== chat.admin_id) {
    // Primary lookup by direct profile_id/admin_id match
    const { data: existing } = await supabase
      .from("chats")
      .select("*")
      .or(
        `and(profile_id.eq.${chat.profile_id},admin_id.eq.${chat.admin_id}),and(profile_id.eq.${chat.admin_id},admin_id.eq.${chat.profile_id})`
      )
      .limit(1)
      .maybeSingle();
    if (existing) return existing as Chat;

    // Fallback: look up via chat_participants (catches edge cases where direct lookup fails)
    const { data: partRows } = await supabase
      .from("chat_participants")
      .select("chat_id")
      .in("profile_id", [chat.profile_id, chat.admin_id]);
    if (partRows && partRows.length >= 2) {
      const chatIds = partRows.map(r => r.chat_id);
      const duplicates = chatIds.filter((id, i) => chatIds.indexOf(id) !== i);
      if (duplicates.length > 0) {
        const { data: existingViaParticipants } = await supabase
          .from("chats")
          .select("*")
          .in("id", duplicates)
          .limit(1)
          .maybeSingle();
        if (existingViaParticipants) return existingViaParticipants as Chat;
      }
    }
  }

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

export async function deleteChat(chatId: string, userId: string) {
  const { authFetch, apiUrl } = await import("../lib/api");
  const res = await authFetch(apiUrl(`/api/data/chats/${chatId}?userId=${userId}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al eliminar chat");
  }
  return res.json();
}

export async function updateChat(chatId: string, updates: Partial<Chat>) {
  const { error } = await supabase
    .from("chats")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", chatId);
  if (error) throw error;
}

export async function createGroupChat(
  name: string,
  creatorId: string,
  memberIds: string[],
  onlyAdminsCanPost?: boolean
): Promise<Chat> {
  const { data, error } = await supabase
    .from("chats")
    .insert({
      name,
      is_group: true,
      avatar: "",
      avatar_color: "bg-teal-500",
      phone: "",
      username: "",
      bio: "",
      profile_id: creatorId,
      admin_id: creatorId,
      is_online: true,
      unread_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // Add all members to chat_participants
  const participantRows = [...new Set([creatorId, ...memberIds])].map(profile_id => ({
    chat_id: data.id,
    profile_id,
  }));
  await supabase.from("chat_participants").insert(participantRows);

  return data as Chat;
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

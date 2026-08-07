import { supabase } from "../lib/supabase";
import { apiUrl, authFetch } from "../lib/api";

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
  ephemeral_timer?: number | null;
};

export async function getChats(userId: string): Promise<Chat[]> {
  // Get chats where user is a direct participant (profile_id/admin_id), excluding deleted
  const { data: directChats, error } = await supabase
    .from("chats")
    .select("*")
    .or(`profile_id.eq.${userId},admin_id.eq.${userId}`)
    .is("deleted_at", null)
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
      .is("deleted_at", null)
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
  try {
    const { authFetch, apiUrl } = await import("../lib/api");
    const res = await authFetch(apiUrl(`/api/data/chats/${chatId}?userId=${userId}`), {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Error al eliminar chat");
    }
    return res.json();
  } catch (serverErr) {
    console.warn("[CHAT] Server delete failed, falling back to Supabase:", serverErr);
    const { error } = await supabase
      .from("chats")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", chatId);
    if (error) throw error;
    await supabase.from("chat_participants").delete().eq("chat_id", chatId);
    return { success: true };
  }
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
  const allMemberIds = [...new Set([creatorId, ...memberIds])].filter(Boolean);
  const participantRows = allMemberIds.map(profile_id => ({
    chat_id: data.id,
    profile_id,
  }));

  // Client-side upsert FIRST (reliable — works with or without RLS)
  const { error: upsertErr } = await supabase.from("chat_participants").upsert(
    participantRows.map(({ chat_id, profile_id }) => ({ chat_id, profile_id })),
    { onConflict: "chat_id,profile_id", ignoreDuplicates: true }
  );
  if (upsertErr) {
    console.error("[CHATS] Failed to upsert participants:", upsertErr);
  } else {
    console.log("[CHATS] Participants inserted:", allMemberIds.length);
  }

  // Then try server endpoint as a safety net (bypasses RLS in case policies get stricter)
  try {
    const { authFetch } = await import("../lib/api");
    const resp = await authFetch(apiUrl("/api/groups/add-participants"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: data.id, member_ids: allMemberIds }),
    });
    const result = await resp.json();
    if (!result.ok) {
      console.warn("[CHATS] Server add-participants responded but not ok:", result);
    }
  } catch (fetchErr) {
    console.warn("[CHATS] Server endpoint unavailable (ignored):", fetchErr?.message);
  }

  return data as Chat;
}

export async function addGroupMember(chatId: string, profileId: string) {
  try {
    const { authFetch } = await import("../lib/api");
    const resp = await authFetch(apiUrl("/api/groups/add-participants"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, member_ids: [profileId] }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.error || "Server add-participants failed");
    return;
  } catch (fetchErr) {
    // Fallback to client-side upsert
    const { error } = await supabase
      .from("chat_participants")
      .upsert(
        { chat_id: chatId, profile_id: profileId },
        { onConflict: "chat_id,profile_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  }
}

export async function removeGroupMember(chatId: string, profileId: string) {
  const { error } = await supabase
    .from("chat_participants")
    .delete()
    .eq("chat_id", chatId)
    .eq("profile_id", profileId);
  if (error) throw error;
}

export async function leaveGroup(chatId: string, userId: string) {
  await removeGroupMember(chatId, userId);
}

export async function getChatWithPartner(chatId: string, userId: string): Promise<Chat | null> {
  const { data: chat } = await supabase
    .from("chats")
    .select("*")
    .eq("id", chatId)
    .is("deleted_at", null)
    .single();
  if (!chat) return null;

  if (!chat.is_group && chat.profile_id && chat.admin_id) {
    const partnerId = chat.profile_id === userId ? chat.admin_id : chat.profile_id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, avatar_url, status")
      .eq("id", partnerId)
      .single();
    if (profile) {
      return {
        ...chat,
        name: profile.name || chat.name,
        avatar: profile.avatar_url || chat.avatar,
        is_online: profile.status === "online",
      } as Chat;
    }
  }

  return chat as Chat;
}

export function subscribeToChats(userId: string, callback: (event: "INSERT" | "UPDATE" | "DELETE", chat: Chat) => void) {
  // Subscribe to chats where user is profile_id
  const ch1 = supabase
    .channel("chats-as-profile")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chats", filter: `profile_id=eq.${userId}` },
      (payload) => callback(payload.eventType as any, payload.new as Chat)
    )
    .subscribe();

  // Subscribe to chats where user is admin_id
  const ch2 = supabase
    .channel("chats-as-admin")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chats", filter: `admin_id=eq.${userId}` },
      (payload) => callback(payload.eventType as any, payload.new as Chat)
    )
    .subscribe();

  // Subscribe to ALL group INSERTs — filter by participant check in callback
  const ch3 = supabase
    .channel("chats-as-participant")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chats" },
      (payload) => {
        const chat = payload.new as Chat;
        if (!chat.is_group) return;
        // Check if user is a participant of this new chat
        supabase
          .from("chat_participants")
          .select("chat_id", { count: "exact", head: true })
          .eq("chat_id", chat.id)
          .eq("profile_id", userId)
          .then(({ count }) => {
            if (count && count > 0) {
              callback("INSERT", chat);
            }
          });
      }
    )
    .subscribe();

  return { unsubscribe: () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); } };
}

export type MuteDuration = "8h" | "12h" | "24h" | "always";

export async function muteGroup(chatId: string, duration: MuteDuration): Promise<void> {
  const resp = await authFetch(apiUrl("/api/groups/mute"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, duration }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Error al silenciar el grupo");
  }
}

export async function unmuteGroup(chatId: string): Promise<void> {
  const resp = await authFetch(apiUrl("/api/groups/unmute"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Error al activar el sonido");
  }
}

export async function getGroupMute(chatId: string): Promise<{ isMuted: boolean; muted_until: string | null }> {
  try {
    const resp = await authFetch(apiUrl(`/api/groups/mute/${chatId}`));
    if (!resp.ok) return { isMuted: false, muted_until: null };
    const data = await resp.json();
    return { isMuted: !!data.isMuted, muted_until: data.muted_until || null };
  } catch {
    return { isMuted: false, muted_until: null };
  }
}

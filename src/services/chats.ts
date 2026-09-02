import { supabase } from "../lib/supabase";
import { apiUrl, authFetch } from "../lib/api";
import { logger } from "../lib/logger";

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
  // Usar RPC SECURITY DEFINER (get_user_chats) para evitar recursión RLS entre
  // chats <-> chat_participants y resolver chats grupales donde el usuario solo
  // aparece en chat_participants (no como profile_id/admin_id).
  const { data, error } = await supabase.rpc("get_user_chats", { user_uuid: userId });
  if (error) throw error;

  const rows = (data || []) as Chat[];
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

  // Override 1:1 chat names: contacts.name → profiles.name → chats.name
  const partnerIds = deduped
    .filter(c => !c.is_group && c.profile_id && c.admin_id)
    .map(c => (c.profile_id === userId ? c.admin_id! : c.profile_id!));
  if (partnerIds.length > 0) {
    const contactsResult = await supabase
      .from("contacts")
      .select("contact_user_id, name")
      .eq("user_id", userId)
      .in("contact_user_id", partnerIds);
    const contactMap = new Map<string, string>();
    if (contactsResult.data) {
      for (const c of contactsResult.data) {
        if (c.contact_user_id && c.name) {
          contactMap.set(c.contact_user_id, c.name);
        }
      }
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, avatar, avatar_url, status")
      .in("id", partnerIds);
    const partnerMap = new Map(
      (profiles ?? []).map(p => [p.id, { name: p.name, avatar: p.avatar, avatar_url: p.avatar_url, status: p.status }])
    );
    deduped = deduped.map(chat => {
      const partnerId = chat.profile_id === userId ? chat.admin_id : chat.profile_id;
      if (chat.is_group || !partnerId) return chat;
      const savedName = contactMap.get(partnerId);
      const profile = partnerMap.get(partnerId);
      const finalName = savedName || profile?.name || chat.name;
      return {
        ...chat,
        name: finalName,
        ...(profile
          ? { avatar: profile.avatar || profile.avatar_url || chat.avatar || "", is_online: profile.status === "online" }
          : { avatar: chat.avatar || "" }),
      };
    });
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
      .eq("is_group", false)
      .is("deleted_at", null)
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
          .eq("is_group", false)
          .in("id", duplicates)
          .limit(1)
          .maybeSingle();
        if (existingViaParticipants) return existingViaParticipants as Chat;
      }
    }
  }

  const res = await authFetch(apiUrl("/api/data/create-chat"), {
    method: "POST",
    body: JSON.stringify({
      name: chat.name,
      is_group: chat.is_group || false,
      avatar: chat.avatar || "",
      avatar_color: chat.avatar_color || "bg-slate-450",
      phone: chat.phone || "",
      username: chat.username || "",
      bio: chat.bio || "",
      profile_id: chat.profile_id,
      admin_id: chat.admin_id,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al crear chat");
  }
  return (await res.json()) as Chat;
}

export async function deleteChat(chatId: string, userId: string) {
  console.log("[DELETE-CHAT] Starting delete", { chatId, userId });
  try {
    const { authFetch, apiUrl } = await import("../lib/api");
    const url = apiUrl(`/api/data/chats/${chatId}?userId=${userId}`);
    console.log("[DELETE-CHAT] Calling server", { url, method: "DELETE" });
    const res = await authFetch(url, { method: "DELETE" });
    console.log("[DELETE-CHAT] Server response", { status: res.status, ok: res.ok });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      console.error("[DELETE-CHAT] Server error body", errBody);
      throw new Error(errBody.error || "Error al eliminar chat");
    }
    const result = await res.json();
    console.log("[DELETE-CHAT] Server success", result);
    return result;
  } catch (serverErr) {
    console.warn("[DELETE-CHAT] Server delete failed, falling back to Supabase", { error: serverErr });
    const { error } = await supabase
      .from("chat_clears")
      .upsert(
        { user_id: userId, chat_id: chatId, hidden: true, cleared_at: new Date().toISOString() },
        { onConflict: "chat_id,user_id" }
      );
    if (error) {
      console.error("[DELETE-CHAT] Supabase fallback also failed", { error });
      throw error;
    }
    console.log("[DELETE-CHAT] Supabase fallback success");
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
    logger.error("[CHATS] Failed to upsert participants", { error: upsertErr });
  } else {
    logger.info("[CHATS] Participants inserted", { count: allMemberIds.length });
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
      logger.warn("[CHATS] Server add-participants responded but not ok", { result });
    }
  } catch (fetchErr) {
    logger.warn("[CHATS] Server endpoint unavailable (ignored)", { error: fetchErr?.message });
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
      .select("name, avatar, avatar_url, status")
      .eq("id", partnerId)
      .single();
    if (profile) {
      return {
        ...chat,
        name: profile.name || chat.name,
        avatar: profile.avatar || profile.avatar_url || "",
        is_online: profile.status === "online",
      } as Chat;
    }
  }

  return chat as Chat;
}

export function subscribeToChats(userId: string, callback: (event: "INSERT" | "UPDATE" | "DELETE", chat: Chat) => void) {
  // Dos canales con filtros simples (profile_id / admin_id). El filtro OR de
  // Realtime no entrega eventos, así que usamos un canal por rol:
  // - 1:1 chats: filtro simple por profile_id o admin_id
  // - Grupos: INSERT en chat_participants (evita escuchar TODOS los chats y hacer query N+1)
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let isUnsubscribed = false;
  let reconnectAttempt = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000; // 1s base
  const MAX_RECONNECT_DELAY = 30000; // 30s max

  const createChannel = () => {
    if (isUnsubscribed) return;
    
    const newChannel = supabase
      .channel(`chats-for-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chats",
          filter: `profile_id=eq.${userId}`,
        },
        (payload) => callback(payload.eventType as any, payload.new as Chat)
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chats",
          filter: `admin_id=eq.${userId}`,
        },
        (payload) => callback(payload.eventType as any, payload.new as Chat)
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_participants",
          filter: `profile_id=eq.${userId}`,
        },
        async (payload) => {
          const participant = payload.new as { chat_id: string; profile_id: string };
          const { data: chat } = await supabase
            .from("chats")
            .select("*")
            .eq("id", participant.chat_id)
            .single();
          if (chat) {
            callback("INSERT", chat as Chat);
          }
        }
      )
      .subscribe((status) => {
        if (isUnsubscribed) return;
        
        if (status === "SUBSCRIBED") {
          reconnectAttempt = 0; // Reset on successful connection
          logger.info("[Chats] Realtime subscribed", { userId });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          logger.warn("[Chats] Realtime connection issue, scheduling reconnect", { status, userId, attempt: reconnectAttempt + 1 });
          scheduleReconnect();
        }
      });

    return newChannel;
  };

  const scheduleReconnect = () => {
    if (isUnsubscribed || reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        logger.error("[Chats] Max reconnect attempts reached", { userId });
      }
      return;
    }

    reconnectAttempt++;
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY);
    const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
    
    logger.info("[Chats] Scheduling reconnect", { userId, attempt: reconnectAttempt, delay: Math.round(delay + jitter) });
    
    setTimeout(() => {
      if (!isUnsubscribed) {
        if (channel) {
          supabase.removeChannel(channel);
        }
        channel = createChannel();
      }
    }, delay + jitter);
  };

  channel = createChannel();

  const unsubscribe = () => {
    isUnsubscribed = true;
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    logger.info("[Chats] Unsubscribed and cleaned up", { userId });
  };

  return { unsubscribe };
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
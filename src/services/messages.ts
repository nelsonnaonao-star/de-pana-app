import { supabase } from "../lib/supabase";
import { apiUrl } from "../lib/api";

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  receiver_id?: string;
  text?: string;
  type: "text" | "image" | "video" | "audio" | "file" | "voice_note" | "video_note" | "poll";
  status: "sent" | "delivered" | "read";
  created_at: string;
  read_at?: string;
  delivered_at?: string;
  edited: boolean;
  edited_at?: string;
  forwarded: boolean;
  reply_to_id?: string;
  reply_to_text?: string;
  reply_to_sender?: string;
  reactions?: Record<string, number>;
  read_by?: { userId: string; name: string; readAt: string }[];
  has_image: boolean;
  image_url?: string;
  image_alt?: string;
  has_audio: boolean;
  audio_url?: string;
  audio_duration?: string;
  mime_type?: string;
  has_video: boolean;
  video_url?: string;
  has_document: boolean;
  document_name?: string;
  document_size?: string;
  document_type?: string;
  has_location: boolean;
  latitude?: number;
  longitude?: number;
  location_name?: string;
  sticker_url?: string;
  gif_url?: string;
  is_animated: boolean;
  is_ephemeral: boolean;
  ephemeral_expires_at?: string;
  poll_id?: string;
  is_deleted: boolean;
};

function toMessage(row: any): Message {
  return {
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id || undefined,
    text: row.text || undefined,
    type: row.type || "text",
    status: row.status || "sent",
    created_at: row.created_at,
    read_at: row.read_at || undefined,
    delivered_at: row.delivered_at || undefined,
    edited: row.edited || false,
    edited_at: row.edited_at || undefined,
    forwarded: row.forwarded || false,
    reply_to_id: row.reply_to_id || undefined,
    reply_to_text: row.reply_to_text || undefined,
    reply_to_sender: row.reply_to_sender || undefined,
    reactions: row.reactions || undefined,
    read_by: row.read_by || undefined,
    has_image: row.has_image || false,
    image_url: row.image_url || undefined,
    image_alt: row.image_alt || undefined,
    has_audio: row.has_audio || false,
    audio_url: row.audio_url || undefined,
    audio_duration: row.audio_duration || undefined,
    mime_type: row.mime_type || undefined,
    has_video: row.has_video || false,
    video_url: row.video_url || undefined,
    has_document: row.has_document || false,
    document_name: row.document_name || undefined,
    document_size: row.document_size || undefined,
    document_type: row.document_type || undefined,
    has_location: row.has_location || false,
    latitude: row.latitude || undefined,
    longitude: row.longitude || undefined,
    location_name: row.location_name || undefined,
    sticker_url: row.sticker_url || undefined,
    gif_url: row.gif_url || undefined,
    is_animated: row.is_animated || false,
    is_ephemeral: row.is_ephemeral || false,
    ephemeral_expires_at: row.ephemeral_expires_at || undefined,
    poll_id: row.poll_id || undefined,
    is_deleted: row.is_deleted || false,
  };
}

export async function getMessages(chatId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[MESSAGES] get error:", error);
    throw error;
  }
  return (data || []).map(toMessage);
}

export async function sendMessage(message: Partial<Message>): Promise<Message> {
  const payload = {
    chat_id: message.chat_id,
    sender_id: message.sender_id,
    receiver_id: message.receiver_id || null,
    text: message.text || "",
    type: message.type || "text",
    status: "sent",
    created_at: new Date().toISOString(),
    edited: false,
    forwarded: false,
    has_image: !!message.image_url,
    image_url: message.image_url || null,
    image_alt: message.image_alt || null,
    has_audio: !!message.audio_url,
    audio_url: message.audio_url || null,
    audio_duration: message.audio_duration || null,
    mime_type: message.mime_type || null,
    has_video: !!message.video_url,
    video_url: message.video_url || null,
    has_document: !!message.document_name,
    document_name: message.document_name || null,
    document_size: message.document_size || null,
    document_type: message.document_type || null,
    has_location: false,
    reply_to_id: message.reply_to_id || null,
    reply_to_text: message.reply_to_text || null,
    reply_to_sender: message.reply_to_sender || null,
    sticker_url: message.sticker_url || null,
    gif_url: message.gif_url || null,
    is_animated: !!message.is_animated,
    is_deleted: false,
    is_ephemeral: false,
    reactions: {},
    read_by: [],
  };

  const { data, error } = await supabase
    .from("messages")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("[MESSAGES] send error:", error);
    throw error;
  }

  // Update chat last_message
  try {
    await supabase
      .from("chats")
      .update({
        last_message: message.text || "Multimedia",
        last_message_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", message.chat_id);
  } catch (e) {
    console.warn("[MESSAGES] update chat last_message falló:", e);
  }

  // Backup push notification (in case webhook is not configured)
  try {
    const { data: chat } = await supabase
      .from("chats")
      .select("profile_id, admin_id")
      .eq("id", message.chat_id)
      .single();
    if (chat) {
      const receiverId = chat.profile_id === message.sender_id ? chat.admin_id : chat.profile_id;
      if (receiverId) {
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", message.sender_id)
          .single();
        sendBackupPush(receiverId, senderProfile?.name || "RED ON", message.text || "Nuevo mensaje", message.chat_id, message.sender_id);
      }
    }
  } catch {}

  return toMessage(data);
}

async function sendBackupPush(receiverId: string, senderName: string, text: string, chatId: string, senderId: string) {
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL;
    if (!serverUrl) { console.warn('[PUSH] VITE_SERVER_URL not set'); return; }
    const res = await fetch(`${serverUrl}/api/fcm/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: receiverId,
        title: senderName || "RED ON",
        body: text || "Nuevo mensaje",
        data: { type: "message", chatId, contactId: senderId },
      }),
    });
    if (!res.ok) console.warn('[PUSH] backup send failed:', res.status, await res.text().catch(() => ''));
    else console.log('[PUSH] backup send OK');
  } catch (err) {
    console.warn('[PUSH] backup send error:', err);
  }
}

export async function markAsRead(chatId: string, userId: string, userName: string) {
  const name = userName || "Usuario";

  const { data: messages, error: fetchError } = await supabase
    .from("messages")
    .select("id, read_by, status")
    .eq("chat_id", chatId)
    .neq("sender_id", userId)
    .eq("is_deleted", false);

  if (fetchError) {
    console.error("[MESSAGES] markAsRead fetch error:", fetchError);
    throw fetchError;
  }

  if (!messages || messages.length === 0) return;

  const now = new Date().toISOString();
  const toUpdate = messages
    .filter((m: any) => {
      const readBy = m.read_by || [];
      return !readBy.some((r: any) => r.userId === userId);
    })
    .map((m: any) => ({
      id: m.id,
      read_by: [...(m.read_by || []), { userId, name, readAt: now }],
      status: "read" as const,
    }));

  if (toUpdate.length === 0) return;

  for (const m of toUpdate) {
    try {
      await supabase
        .from("messages")
        .update({ read_by: m.read_by, status: m.status })
        .eq("id", m.id);
    } catch (e) {
      console.warn("[MESSAGES] markAsRead update falló:", e);
    }
  }
}

export async function addReaction(messageId: string, emoji: string) {
  const { data: msg, error: fetchError } = await supabase
    .from("messages")
    .select("reactions")
    .eq("id", messageId)
    .single();

  if (fetchError) {
    console.error("[MESSAGES] addReaction fetch error:", fetchError);
    throw fetchError;
  }

  const current: Record<string, number> = msg?.reactions || {};
  current[emoji] = (current[emoji] || 0) + 1;

  const { error } = await supabase
    .from("messages")
    .update({ reactions: current })
    .eq("id", messageId);

  if (error) {
    console.error("[MESSAGES] addReaction update error:", error);
    throw error;
  }
}

export async function deleteMessage(messageId: string) {
  const { error } = await supabase
    .from("messages")
    .update({ is_deleted: true })
    .eq("id", messageId);

  if (error) {
    console.error("[MESSAGES] delete error:", error);
    throw error;
  }
}

export async function clearMessages(chatId: string) {
  const { error } = await supabase
    .from("messages")
    .update({ is_deleted: true })
    .eq("chat_id", chatId);

  if (error) {
    console.error("[MESSAGES] clearMessages error:", error);
    throw error;
  }

  // Reset chat's last_message
  try {
    await supabase
      .from("chats")
      .update({
        last_message: "",
        last_message_time: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId);
  } catch (e) {
    console.warn("[MESSAGES] clearMessages update chat falló:", e);
  }
}

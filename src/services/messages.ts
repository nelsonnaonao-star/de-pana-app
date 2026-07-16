import { apiUrl, authFetch } from "../lib/api";

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  receiver_id?: string;
  text?: string;
  type: "text" | "image" | "sticker" | "video" | "audio" | "file" | "voice_note" | "video_note" | "poll" | "location";
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
  poll_question?: string;
  poll_options?: { id: string; text: string; votes: number; votedUsers: string[] }[];
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
    poll_question: row.poll_question || undefined,
    poll_options: row.poll_options || undefined,
    is_deleted: row.is_deleted || false,
  };
}

export async function getMessages(chatId: string, options?: { limit?: number; before?: string; after?: string }): Promise<Message[]> {
  const limit = options?.limit || 200;
  const params = new URLSearchParams({ limit: String(limit) });
  if (options?.before) params.set("before", options.before);
  if (options?.after) params.set("after", options.after);

  const res = await authFetch(apiUrl(`/api/messages/${chatId}?${params.toString()}`));
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al obtener mensajes");
  }
  const data = await res.json();
  return (data || []).map(toMessage);
}

export async function sendMessage(message: Partial<Message>): Promise<Message> {
  const res = await authFetch(apiUrl("/api/messages/send"), {
    method: "POST",
    body: JSON.stringify({
      chat_id: message.chat_id,
      sender_id: message.sender_id,
      receiver_id: message.receiver_id,
      text: message.text,
      type: message.type,
      forwarded: message.forwarded,
      image_url: message.image_url,
      image_alt: message.image_alt,
      audio_url: message.audio_url,
      audio_duration: message.audio_duration,
      mime_type: message.mime_type,
      video_url: message.video_url,
      document_name: message.document_name,
      document_size: message.document_size,
      document_type: message.document_type,
      latitude: message.latitude,
      longitude: message.longitude,
      location_name: message.location_name,
      reply_to_id: message.reply_to_id,
      reply_to_text: message.reply_to_text,
      reply_to_sender: message.reply_to_sender,
      sticker_url: message.sticker_url,
      gif_url: message.gif_url,
      is_animated: message.is_animated,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al enviar mensaje");
  }
  const data = await res.json();
  return toMessage(data);
}

export async function markAsRead(chatId: string, userId: string, userName: string) {
  const res = await authFetch(apiUrl("/api/messages/mark-read"), {
    method: "POST",
    body: JSON.stringify({ chat_id: chatId, user_id: userId, reader_name: userName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al marcar como leído");
  }
  return res.json();
}

export async function addReaction(messageId: string, emoji: string) {
  const res = await authFetch(apiUrl("/api/messages/react"), {
    method: "POST",
    body: JSON.stringify({ message_id: messageId, emoji }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al agregar reacción");
  }
  return res.json();
}

export async function deleteMessage(messageId: string) {
  const res = await authFetch(apiUrl("/api/messages/delete"), {
    method: "POST",
    body: JSON.stringify({ message_id: messageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al eliminar mensaje");
  }
  return res.json();
}

export async function editMessage(messageId: string, newText: string) {
  const res = await authFetch(apiUrl("/api/messages/edit"), {
    method: "POST",
    body: JSON.stringify({ message_id: messageId, new_text: newText }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al editar mensaje");
  }
  return res.json();
}

export async function clearForMe(chatId: string) {
  const res = await authFetch(apiUrl("/api/messages/clear-for-me"), {
    method: "POST",
    body: JSON.stringify({ chat_id: chatId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error al vaciar chat");
  }
  return res.json();
}

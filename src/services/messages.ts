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

async function post(url: string, body: any) {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error en la solicitud");
  }
  return res.json();
}

async function get(url: string) {
  const res = await fetch(apiUrl(url));
  if (!res.ok) throw new Error("Error al obtener datos");
  return res.json();
}

export async function getMessages(chatId: string): Promise<Message[]> {
  return get(`/api/messages/${chatId}`);
}

export async function sendMessage(message: Partial<Message>): Promise<Message> {
  return post("/api/messages/send", message);
}

export async function markAsRead(chatId: string, userId: string, userName: string) {
  return post("/api/messages/mark-read", { chat_id: chatId, user_id: userId, reader_name: userName });
}

export async function addReaction(messageId: string, emoji: string) {
  return post("/api/messages/react", { message_id: messageId, emoji });
}

export async function deleteMessage(messageId: string) {
  return post("/api/messages/delete", { message_id: messageId });
}

export interface Message {
  id: string;
  sender: "me" | "other";
  text?: string;
  timestamp: string;
  type: "text" | "image" | "sticker" | "video" | "audio" | "file" | "voice_note" | "video_note" | "poll" | "location";
  mediaUrl?: string;
  fileName?: string;
  fileSize?: string;
  duration?: string;
  reactions?: { [key: string]: number }; // emoji -> count
  pollQuestion?: string;
  pollOptions?: { id: string; text: string; votes: number; votedUsers: string[] }[];
  latitude?: number;
  longitude?: number;
  locationName?: string;
  status?: "sending" | "sent" | "delivered" | "read";
  forwarded?: boolean;
  replyToId?: string;
  replyToText?: string;
  replyToSender?: string;
}

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  status: "online" | "offline" | "typing";
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: Message[];
  partnerUserId?: string;
  isGroup?: boolean;
}

export interface ActiveCall {
  id: string;
  contactName: string;
  contactAvatar: string;
  type: "audio" | "video";
  status: "incoming" | "outgoing" | "connecting" | "connected" | "disconnected";
  durationSeconds: number;
  isMuted: boolean;
  isVideoOff: boolean;
  activeFilter?: "none" | "warm" | "cool" | "noir" | "vintage" | "neon";
  activeBackground?: "none" | "office" | "beach" | "neon_cyber" | "abstract";
  isGroup: boolean;
  participants?: string[];
  targetUserId?: string;
}

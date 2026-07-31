import { Network } from "@capacitor/network";
import { messageRepo } from "../database/repositories/MessageRepository";
import { sendMessage as apiSendMessage } from "../messages";
import { uploadChatMedia } from "../storage";
import { Capacitor } from "@capacitor/core";

export type SyncedCallback = (
  tempId: string,
  chatId: string,
  savedId: string
) => void;

class SyncService {
  private listeners: SyncedCallback[] = [];
  private processing = false;
  private networkHandler: (() => void) | null = null;
  private started = false;

  onSynced(cb: SyncedCallback): void {
    this.listeners.push(cb);
  }

  offSynced(cb: SyncedCallback): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (Capacitor.getPlatform() !== "web") {
      try {
        const status = await Network.getStatus();
        if (status.connected) {
          this.processQueue();
        }
      } catch {}

      try {
        this.networkHandler = await Network.addListener(
          "networkStatusChange",
          (status) => {
            if (status.connected) {
              this.processQueue();
            }
          }
        );
      } catch {}
    }

    window.addEventListener("online", this.onBrowserOnline);
  }

  stop(): void {
    if (this.networkHandler) {
      try {
        this.networkHandler();
      } catch {}
      this.networkHandler = null;
    }
    window.removeEventListener("online", this.onBrowserOnline);
  }

  private onBrowserOnline = (): void => {
    this.processQueue();
  };

  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const pending = await messageRepo.getAllUnsynced();
      if (pending.length === 0) {
        this.processing = false;
        return;
      }

      console.log(`[SyncService] processing ${pending.length} pending messages`);

      for (const item of pending) {
        try {
          await this.sendSingle(item.chatId, item.message);
        } catch (err) {
          console.warn("[SyncService] failed for message", item.message.id, err);
        }
      }
    } catch (err) {
      console.error("[SyncService] processQueue error:", err);
    }

    this.processing = false;
  }

  private async sendSingle(
    chatId: string,
    msg: any
  ): Promise<void> {
    let imageUrl: string | undefined;
    let audioUrl: string | undefined;
    let videoUrl: string | undefined;
    let stickerUrl: string | undefined;
    let gifUrl: string | undefined;

    const mediaUrl = msg.mediaUrl as string | undefined;
    const localVideoUrl = msg.localVideoUrl as string | undefined;
    const type = msg.type as string;

    if (mediaUrl && !mediaUrl.startsWith("blob:")) {
      const uploaded = await this.uploadIfNeeded(mediaUrl, type);
      if (uploaded) {
        if (type === "image") imageUrl = uploaded;
        else if (type === "video") videoUrl = uploaded;
        else if (type === "audio" || type === "voice_note") audioUrl = uploaded;
        else if (type === "sticker") stickerUrl = uploaded;
        else imageUrl = uploaded;
      } else {
        if (type === "image") imageUrl = mediaUrl;
        else if (type === "video") videoUrl = mediaUrl;
        else if (type === "audio" || type === "voice_note") audioUrl = mediaUrl;
        else if (type === "sticker") stickerUrl = mediaUrl;
        else imageUrl = mediaUrl;
      }
    }

    if (localVideoUrl && !localVideoUrl.startsWith("blob:")) {
      const uploaded = await this.uploadIfNeeded(localVideoUrl, "video");
      if (uploaded) videoUrl = uploaded;
    }

    const replyToId = msg.replyToId as string | undefined;
    const replyToText = msg.replyToText as string | undefined;
    const replyToSender = msg.replyToSender as string | undefined;

    const MAX_RETRIES = 3;
    let lastError: unknown;
    let saved: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        saved = await apiSendMessage({
          chat_id: chatId,
          sender_id: (msg.sender_id as string) || undefined,
          text: (msg.text as string) || undefined,
          type: type as any,
          image_url: imageUrl,
          audio_url: audioUrl,
          video_url: videoUrl,
          sticker_url: stickerUrl,
          gif_url: gifUrl,
          forwarded: (msg.forwarded as boolean) || undefined,
          latitude: (msg.latitude as number) ?? undefined,
          longitude: (msg.longitude as number) ?? undefined,
          location_name: (msg.locationName as string) || (msg.location_name as string) || undefined,
          audio_duration: (msg.duration as string) || undefined,
          reply_to_id: replyToId,
          reply_to_text: replyToText,
          reply_to_sender: replyToSender,
        });
        if (saved?.id) break;
      } catch (err) {
        lastError = err;
        console.warn(`[SyncService] attempt ${attempt}/${MAX_RETRIES} failed for ${msg.id}:`, err);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }

    if (!saved?.id) {
      console.error(`[SyncService] all ${MAX_RETRIES} attempts failed for ${msg.id}:`, lastError);
      return;
    }

    if (saved?.id) {
      const updated = { ...(msg as any), id: saved.id, status: "sent", synced: true };
      await messageRepo.deleteMessage(chatId, msg.id as string);
      await messageRepo.upsertMessage(chatId, updated as any);
      this.notifyListeners(msg.id as string, chatId, saved.id);
      console.log("[SyncService] synced", msg.id, "->", saved.id);
    }
  }

  private async uploadIfNeeded(
    url: string,
    type: string
  ): Promise<string | null> {
    if (url.startsWith("blob:")) return null;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;

    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const folder =
        type === "video" || type === "video_note"
          ? "video"
          : type === "audio" || type === "voice_note"
            ? "voice"
            : type === "sticker"
              ? "stickers"
              : "uploads";
      return await uploadChatMedia(blob, folder);
    } catch {
      return null;
    }
  }

  private notifyListeners(tempId: string, chatId: string, savedId: string): void {
    for (const cb of this.listeners) {
      try {
        cb(tempId, chatId, savedId);
      } catch {}
    }
  }
}

export const syncService = new SyncService();

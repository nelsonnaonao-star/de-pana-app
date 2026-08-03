import { useEffect, useState, memo } from "react";
import { Message } from "../../types";
import MessageBubble from "./MessageBubble";
import { getCachedMedia, getCachedMediaSync } from "../../services/mediaCache";

interface MessageBubbleWithCacheProps {
  msg: Message;
  isMe: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
  isPlayingAudio: string | null;
  setIsPlayingAudio: (id: string | null) => void;
  handleVote: (msgId: string, optionId: string) => void;
  handleAddReaction: (msgId: string, emoji: string) => void;
  handleDeleteMessage: (msgId: string) => void;
  handleDeleteForMe: (msgId: string) => void;
  handleForwardMessage: (msg: Message) => void;
  handleReplyMessage: (msg: Message) => void;
  bubbleColorMeId: string;
  bubbleColorThemId: string;
  isPending: (msgId: string) => boolean;
  onEdit: (msg: Message) => void;
  onUpdatePrice: (msgId: string, price: string) => void;
}

function MessageBubbleWithCache(props: MessageBubbleWithCacheProps) {
  const { msg } = props;
  const hasMedia = !!msg.mediaUrl && !msg.mediaUrl.startsWith("blob:");
  const hasPoster = !!msg.posterUrl && !msg.posterUrl.startsWith("blob:");

  const syncMediaUrl = hasMedia ? getCachedMediaSync(msg.mediaUrl!) : msg.mediaUrl;
  const syncPosterUrl = hasPoster ? getCachedMediaSync(msg.posterUrl!) : msg.posterUrl;

  const [cachedMsg, setCachedMsg] = useState<Message>(() => {
    if (syncMediaUrl && syncMediaUrl !== msg.mediaUrl) {
      return { ...msg, mediaUrl: syncMediaUrl, posterUrl: syncPosterUrl || msg.posterUrl };
    }
    if (syncPosterUrl && syncPosterUrl !== msg.posterUrl) {
      return { ...msg, posterUrl: syncPosterUrl };
    }
    return msg;
  });

  useEffect(() => {
    setCachedMsg(prev => ({
      ...msg,
      mediaUrl: prev.mediaUrl?.startsWith("blob:") ? prev.mediaUrl : msg.mediaUrl,
      posterUrl: prev.posterUrl?.startsWith("blob:") ? prev.posterUrl : msg.posterUrl,
    }));
  }, [msg.id, msg.status, msg.text, msg.reactions, msg.edited, msg.forwarded, msg.pollQuestion, msg.price, msg.isEphemeral, msg.ephemeralExpiresAt]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let newMediaUrl = msg.mediaUrl;
      let newPosterUrl = msg.posterUrl;

      if (hasMedia) newMediaUrl = await getCachedMedia(msg.mediaUrl!);
      if (hasPoster) newPosterUrl = await getCachedMedia(msg.posterUrl!);

      if (!cancelled && (newMediaUrl !== msg.mediaUrl || newPosterUrl !== msg.posterUrl)) {
        setCachedMsg({ ...msg, mediaUrl: newMediaUrl, posterUrl: newPosterUrl });
      }
    })();
    return () => { cancelled = true; };
  }, [msg.mediaUrl, msg.posterUrl]);

  return <MessageBubble {...props} msg={cachedMsg} />;
}

export default memo(MessageBubbleWithCache);

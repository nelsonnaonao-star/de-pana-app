import { useRef, memo } from "react";
import { Message } from "../../types";
import MessageBubble from "./MessageBubble";
import { getCachedMediaSync } from "../../services/mediaCache";

interface MessageBubbleWithCacheProps {
  msg: Message;
  isMe: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
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

// Sin estado local ni efectos: este componente lee y renderiza `msg` (status,
// id, mediaUrl) directamente desde las props. El memo comparador es la única
// barrera de re-render, y compara POR VALOR status/id para que el paso
// temp->sent SIEMPRE repinte la burbuja (elimina el relojito pegado).
function MessageBubbleWithCache(props: MessageBubbleWithCacheProps) {
  const { msg } = props;

  // Preservación del blob: local: al confirmarse la fila (temp->saved) el
  // mediaUrl pasa a https (Supabase), pero el player de voz/video debe seguir
  // reproduciendo el blob local sin recargar ni parpadear.
  const blobMediaRef = useRef<string | null>(null);
  const blobPosterRef = useRef<string | null>(null);

  const isLocalMedia = !!msg.mediaUrl && msg.mediaUrl.startsWith("blob:");
  const isLocalPoster = !!msg.posterUrl && msg.posterUrl.startsWith("blob:");

  if (isLocalMedia) blobMediaRef.current = msg.mediaUrl!;
  if (isLocalPoster) blobPosterRef.current = msg.posterUrl!;

  const syncMediaUrl = !isLocalMedia ? (getCachedMediaSync(msg.mediaUrl!) ?? msg.mediaUrl) : undefined;
  const syncPosterUrl = !isLocalPoster ? (getCachedMediaSync(msg.posterUrl!) ?? msg.posterUrl) : undefined;

  const mediaUrl = isLocalMedia ? msg.mediaUrl : blobMediaRef.current || syncMediaUrl || msg.mediaUrl;
  const posterUrl = isLocalPoster ? msg.posterUrl : blobPosterRef.current || syncPosterUrl || msg.posterUrl;

  const renderMsg =
    mediaUrl === msg.mediaUrl && posterUrl === msg.posterUrl
      ? msg
      : { ...msg, mediaUrl, posterUrl };

  return <MessageBubble {...props} msg={renderMsg} />;
}

function arePropsEqual(prev: MessageBubbleWithCacheProps, next: MessageBubbleWithCacheProps): boolean {
  const p = prev.msg;
  const n = next.msg;
  return (
    p.id === n.id &&
    p.sender === n.sender &&
    p.status === n.status &&
    p.synced === n.synced &&
    p.type === n.type &&
    p.text === n.text &&
    p.timestamp === n.timestamp &&
    p.rawCreatedAt === n.rawCreatedAt &&
    p.mediaUrl === n.mediaUrl &&
    p.posterUrl === n.posterUrl &&
    p.localVideoUrl === n.localVideoUrl &&
    p.fileName === n.fileName &&
    p.fileSize === n.fileSize &&
    p.mimeType === n.mimeType &&
    p.duration === n.duration &&
    p.pollQuestion === n.pollQuestion &&
    p.latitude === n.latitude &&
    p.longitude === n.longitude &&
    p.locationName === n.locationName &&
    p.forwarded === n.forwarded &&
    p.edited === n.edited &&
    p.replyToId === n.replyToId &&
    p.replyToText === n.replyToText &&
    p.replyToSender === n.replyToSender &&
    p.price === n.price &&
    p.chatId === n.chatId &&
    p.isEphemeral === n.isEphemeral &&
    p.ephemeralExpiresAt === n.ephemeralExpiresAt &&
    JSON.stringify(p.reactions) === JSON.stringify(n.reactions) &&
    JSON.stringify(p.pollOptions) === JSON.stringify(n.pollOptions) &&
    prev.isMe === next.isMe &&
    prev.activeReactionMenu === next.activeReactionMenu &&
    prev.bubbleColorMeId === next.bubbleColorMeId &&
    prev.bubbleColorThemId === next.bubbleColorThemId
  );
}

export default memo(MessageBubbleWithCache, arePropsEqual);
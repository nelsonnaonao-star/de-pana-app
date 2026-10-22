import { useRef, useEffect, useState, memo } from "react";
import { Message } from "../../types";
import MessageBubble from "./MessageBubble";
import { getCachedMediaSync } from "../../services/mediaCache";
import { isSignableStorageUrl, resolveMediaUrl, getResolvedMediaUrlSync } from "../../services/mediaResolution";

interface MessageBubbleWithCacheProps {
  msg: Message;
  isMe: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
  handleVote: (msgId: string, optionId: string) => void;
  currentUserId: string;
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
  onVideoPosterReady?: (msgId: string, posterDataUrl: string) => void;
}

type MediaResolutionState = "pending" | "ready" | "failed";

interface MediaResolutionResult {
  kind: "passthrough" | MediaResolutionState;
  value?: string;
}

// Resolución de media de buckets propios (chat-images público / chat-media
// privado) (S2.2):
// - URL ajena a buckets propios → passthrough (nada que firmar).
// - URL de bucket propio     → signed URL; cache local estable anti-expiración;
//   "pending" mientras llega y "failed" si la firma falla (nunca fallback a
//   la URL sin firmar). El estado se expone vía msg.mediaResolved sin sentinels
//   de URL: la identidad del recurso permanece separada de su estado.
function useMediaResolution(url?: string, messageId?: string): MediaResolutionResult {
  const [state, setState] = useState<MediaResolutionResult>(() => {
    if (!url) return { kind: "passthrough" };
    const cached = getResolvedMediaUrlSync(url);
    return cached ? { kind: "ready", value: cached } : { kind: "pending" };
  });

  useEffect(() => {
    if (!url) {
      setState((prev) => (prev.kind === "passthrough" ? prev : { kind: "passthrough" }));
      return;
    }
    const cached = getResolvedMediaUrlSync(url);
    if (cached) {
      setState((prev) =>
        prev.kind === "ready" && prev.value === cached ? prev : { kind: "ready", value: cached },
      );
      return;
    }
    setState((prev) => (prev.kind === "pending" ? prev : { kind: "pending" }));
    let cancelled = false;
    resolveMediaUrl(url, messageId ? { messageId } : undefined)
      .then((signed) => {
        if (!cancelled) {
          setState((prev) =>
            prev.kind === "ready" && prev.value === signed ? prev : { kind: "ready", value: signed },
          );
        }
      })
      .catch(() => {
        if (!cancelled) setState((prev) => (prev.kind === "failed" ? prev : { kind: "failed" }));
      });
    return () => { cancelled = true; };
  }, [url, messageId]);

  return state;
}

// Sin estado local ni efectos fuera del resolver de media: este componente lee
// y renderiza `msg` (status, id, mediaUrl) directamente desde las props. El
// memo comparador es la única barrera de re-render, y compara POR VALOR
// status/id para que el paso temp->sent SIEMPRE repinte la burbuja (elimina
// el relojito pegado).
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

  const isMediaCacheable =
    msg.type === "audio" ||
    msg.type === "voice_note" ||
    msg.type === "video" ||
    msg.type === "video_note";

  const rawMediaUrl = msg.mediaUrl;
  const isChatMedia = !isLocalMedia && !!rawMediaUrl && isSignableStorageUrl(rawMediaUrl);

  const syncMediaUrl = !isLocalMedia && isMediaCacheable
    ? (getCachedMediaSync(rawMediaUrl!) ?? rawMediaUrl)
    : rawMediaUrl;
  const syncPosterUrl = !isLocalPoster && isMediaCacheable
    ? (getCachedMediaSync(msg.posterUrl!) ?? msg.posterUrl)
    : msg.posterUrl;

  // Con blob local ya disponible no hace falta firmar: se reproduce local.
  const needsSigned =
    isChatMedia && !(isMediaCacheable && !!syncMediaUrl && syncMediaUrl !== rawMediaUrl);
  const resolution = useMediaResolution(
    needsSigned ? rawMediaUrl! : undefined,
    needsSigned ? msg.id : undefined,
  );

  let mediaUrl: string | undefined;
  if (isLocalMedia) {
    mediaUrl = rawMediaUrl;
  } else if (blobMediaRef.current) {
    mediaUrl = blobMediaRef.current;
  } else if (isMediaCacheable && syncMediaUrl && syncMediaUrl !== rawMediaUrl) {
    mediaUrl = syncMediaUrl;
  } else if (isChatMedia) {
    mediaUrl = resolution.kind === "ready" ? resolution.value : undefined;
  } else {
    mediaUrl = rawMediaUrl;
  }

  const posterUrl = isLocalPoster ? msg.posterUrl : blobPosterRef.current || syncPosterUrl || msg.posterUrl;

  // Estado de resolución solo cuando es media de un bucket propio (passthrough → sin flag).
  const mediaResolved = resolution.kind === "passthrough" ? undefined : resolution.kind;

  const renderMsg =
    mediaUrl === msg.mediaUrl && posterUrl === msg.posterUrl && mediaResolved === undefined
      ? msg
      : { ...msg, mediaUrl, posterUrl, mediaResolved };

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
    prev.currentUserId === next.currentUserId &&
    prev.activeReactionMenu === next.activeReactionMenu &&
    prev.bubbleColorMeId === next.bubbleColorMeId &&
    prev.bubbleColorThemId === next.bubbleColorThemId
  );
}

export default memo(MessageBubbleWithCache, arePropsEqual);
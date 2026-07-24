import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Play, Pause, BarChart2, Forward, MapPin, Loader2, X, Download, Share2 } from "lucide-react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Message } from "../../types";
import { BUBBLE_PRESETS_ME, BUBBLE_PRESETS_THEM } from "./chatConstants";
import AudioMessagePlayer from "./AudioMessagePlayer";
import { saveMediaToGalleryDirect, shareMedia } from "../../services/mediaUtils";
import toast from "react-hot-toast";

interface MessageBubbleProps {
  msg: Message;
  isMe: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
  isPlayingAudio: string | null;
  setIsPlayingAudio: (id: string | null) => void;
  handleVote: (messageId: string, optionId: string) => void;
  handleAddReaction: (messageId: string, emoji: string) => void;
  handleDeleteMessage: (messageId: string) => void;
  handleDeleteForMe: (messageId: string) => void;
  handleForwardMessage: (msg: Message) => void;
  handleReplyMessage: (msg: Message) => void;
  bubbleColorMeId: string;
  bubbleColorThemId: string;
  isPending?: (msgId: string) => boolean;
  onEdit?: (msg: Message) => void;
  onUpdatePrice?: (msgId: string, price: string) => void;
}

function useSaveMedia() {
  const [saving, setSaving] = useState(false);
  const save = useCallback(async (url: string, fileName: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      await saveMediaToGalleryDirect(url, fileName);
      return true;
    } catch (e) {
      console.error("[SAVE] Error saving media:", e);
      toast.error("No se pudo guardar");
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving]);
  return { saving, save };
}

function MediaViewerToolbar({ onClose, onSave, onShare, onForward, onReact, saving }: {
  onClose: () => void;
  onSave: () => void;
  onShare: () => void;
  onForward: () => void;
  onReact: () => void;
  saving: boolean;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10 bg-gradient-to-b from-black/50 to-transparent">
      <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
        <X className="w-5 h-5 text-white" />
      </button>
      <div className="flex items-center gap-2">
        <button onClick={onReact} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="Reaccionar">
          <span className="text-white text-lg leading-none">👍</span>
        </button>
        <button onClick={onForward} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="Reenviar">
          <Forward className="w-4 h-4 text-white" />
        </button>
        <button onClick={onShare} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="Compartir">
          <Share2 className="w-4 h-4 text-white" />
        </button>
        <button onClick={onSave} disabled={saving} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors disabled:opacity-50" title="Guardar en galería">
          {saving ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Download className="w-4 h-4 text-white" />}
        </button>
      </div>
    </div>
  );
}

function ImageViewer({ src, alt, msg, onClose, handleForwardMessage, handleAddReaction, setActiveReactionMenu, activeReactionMenu }: {
  src: string; alt: string; msg: Message;
  onClose: () => void;
  handleForwardMessage: (m: Message) => void;
  handleAddReaction: (id: string, emoji: string) => void;
  setActiveReactionMenu: (id: string | null) => void;
  activeReactionMenu: string | null;
}) {
  const [showReactions, setShowReactions] = useState(false);
  const { saving, save } = useSaveMedia();
  const transformRef = useRef<any>(null);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center touch-none select-none"
      onContextMenu={e => e.preventDefault()}
      onClick={() => { if (!showReactions) onClose(); }}
    >
      <MediaViewerToolbar
        onClose={onClose}
        onSave={() => save(src, `redon-image-${Date.now()}.jpg`)}
        onShare={() => shareMedia(src, "Imagen")}
        onForward={() => { onClose(); handleForwardMessage(msg); }}
        onReact={() => setShowReactions(!showReactions)}
        saving={saving}
      />

      <TransformWrapper
        ref={transformRef}
        minScale={0.5}
        maxScale={5}
        wheel={{ smoothStep: 0.02 }}
        pinch={{ disabled: false }}
        doubleClick={{ mode: "toggleMin" }}
      >
        <TransformComponent
          wrapperClass="!w-full !h-full !flex !items-center !justify-center"
          contentClass="!flex !items-center !justify-center"
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="max-w-[95vw] max-h-[90vh] object-contain pointer-events-none"
            style={{ willChange: "transform" }}
          />
        </TransformComponent>
      </TransformWrapper>

      {showReactions && (
        <div onClick={e => e.stopPropagation()} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-100/80 shadow-lg overflow-hidden">
          <div className="flex gap-1 px-3 py-2">
            {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
              <button key={emo} onClick={() => { handleAddReaction(msg.id, emo); setShowReactions(false); onClose(); }} className="text-2xl hover:scale-125 transition-transform p-1">{emo}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VideoViewer({ src, msg, onClose, handleForwardMessage, handleAddReaction }: {
  src: string; msg: Message;
  onClose: () => void;
  handleForwardMessage: (m: Message) => void;
  handleAddReaction: (id: string, emoji: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const { saving, save } = useSaveMedia();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnd = () => setIsPlaying(false);
    v.addEventListener("ended", onEnd);
    return () => v.removeEventListener("ended", onEnd);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={() => { if (!showReactions) onClose(); }}
    >
      <MediaViewerToolbar
        onClose={onClose}
        onSave={() => save(src, `redon-video-${Date.now()}.mp4`)}
        onShare={() => shareMedia(src, "Video")}
        onForward={() => { onClose(); handleForwardMessage(msg); }}
        onReact={() => setShowReactions(!showReactions)}
        saving={saving}
      />

      <div className="w-full h-full flex items-center justify-center relative">
        {/* Poster mask: covers the video until it renders real frames */}
        {!isRendered && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            {msg.posterUrl ? (
              <img
                src={msg.posterUrl}
                alt=""
                className="max-w-[95vw] max-h-[90vh] object-contain"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
              </div>
            )}
          </div>
        )}

        <video
          ref={videoRef}
          src={src}
          className="max-w-[95vw] max-h-[90vh] cursor-pointer"
          style={{ opacity: isRendered ? 1 : 0, backgroundColor: 'black' }}
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          onPlaying={() => setIsRendered(true)}
          controls={true}
          playsInline
          preload="metadata"
        />
      </div>

      {!isPlaying && isRendered && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
          <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center">
            <Play className="w-8 h-8 text-white ml-1" />
          </div>
        </div>
      )}

      {showReactions && (
        <div onClick={e => e.stopPropagation()} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-100/80 shadow-lg overflow-hidden">
          <div className="flex gap-1 px-3 py-2">
            {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
              <button key={emo} onClick={() => { handleAddReaction(msg.id, emo); setShowReactions(false); onClose(); }} className="text-2xl hover:scale-125 transition-transform p-1">{emo}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isEmoji(str: string): boolean {
  return /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D\u20E3#*0-9]+$/u.test(str.trim());
}

function ImageMessage({ msg, isMe, isSticker, activeReactionMenu, setActiveReactionMenu, handleForwardMessage, handleAddReaction, handleReplyMessage }: {
  msg: Message; isMe: boolean; isSticker: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
  handleForwardMessage: (m: Message) => void;
  handleAddReaction: (id: string, emoji: string) => void;
  handleReplyMessage: (m: Message) => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const isSending = msg.status === "sending";
  const isEmojiOnly = isSticker && msg.mediaUrl && isEmoji(msg.mediaUrl);

  return (
    <>
      {showViewer && !isEmojiOnly && (
        <ImageViewer
          src={msg.mediaUrl!}
          alt={isSticker ? "Sticker" : "Imagen"}
          msg={msg}
          onClose={() => setShowViewer(false)}
          handleForwardMessage={handleForwardMessage}
          handleAddReaction={handleAddReaction}
          setActiveReactionMenu={setActiveReactionMenu}
          activeReactionMenu={activeReactionMenu}
        />
      )}
      <div
        className="relative max-w-[85%] cursor-pointer group select-none"
        onClick={() => { if (!isEmojiOnly) setShowViewer(true); }}
        onTouchStart={(e) => {
          (e.currentTarget as HTMLElement).dataset.touchX = e.touches[0].clientX.toString();
          (e.currentTarget as HTMLElement).dataset.lpTimer = window.setTimeout(() => {
            setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id);
          }, 500).toString();
        }}
        onTouchMove={(e) => {
          const timer = (e.currentTarget as HTMLElement).dataset.lpTimer;
          if (timer) { clearTimeout(Number(timer)); delete (e.currentTarget as HTMLElement).dataset.lpTimer; }
        }}
        onTouchEnd={(e) => {
          const timer = (e.currentTarget as HTMLElement).dataset.lpTimer;
          if (timer) { clearTimeout(Number(timer)); delete (e.currentTarget as HTMLElement).dataset.lpTimer; }
          const startX = Number((e.currentTarget as HTMLElement).dataset.touchX || 0);
          const dx = e.changedTouches[0].clientX - startX;
          if (dx > 80) {
            e.preventDefault();
            handleReplyMessage(msg);
          }
        }}
      >
        {isEmojiOnly ? (
          <div className="text-6xl leading-none p-1 select-none">
            {msg.mediaUrl}
          </div>
        ) : (
          <>
        {!imgLoaded && !imgError && (
          <div className={`${isSticker ? "w-[140px] h-[140px]" : "w-[220px] h-[200px]"} bg-slate-200 rounded-xl animate-pulse flex items-center justify-center`}>
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        )}

        {imgError && (
          <div className={`${isSticker ? "w-[140px] h-[140px]" : "w-[220px] h-[200px]"} bg-slate-100 rounded-xl flex items-center justify-center`}>
            <span className="text-slate-400 text-xs">No se pudo cargar</span>
          </div>
        )}

        <img
          src={msg.mediaUrl}
          alt={isSticker ? "Sticker" : "Image"}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          className={`${isSticker
            ? "max-w-[160px] max-h-[160px] object-contain filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)] select-none"
            : "max-w-[280px] max-h-[300px] object-contain rounded-xl select-none"
          } ${!imgLoaded ? "hidden" : ""}`}
        />
        </>)}

        {imgLoaded && !isSending && (
          <button
            onClick={(e) => { e.stopPropagation(); setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id); }}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
          >
            <span className="text-white text-[11px] leading-none">➕</span>
          </button>
        )}

        {isSending && imgLoaded && (
          <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 rounded-full p-2">
              <Loader2 className="w-5 h-5 text-[#0a4d52] animate-spin" />
            </div>
          </div>
        )}

        {msg.price && (
          <div className="absolute bottom-1 left-1 bg-emerald-600/90 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold pointer-events-none backdrop-blur-xs shadow-sm">
            💰 {msg.price}
          </div>
        )}

        <div className="absolute bottom-1 right-1 bg-black/50 text-white/90 text-[10px] px-1.5 py-0.5 rounded-full backdrop-blur-xs font-medium pointer-events-none flex items-center gap-1">
          <span>{msg.timestamp}</span>
          {isMe && (
            <span className={`leading-none ${msg.status === "read" ? "text-teal-400" : "text-slate-400"}`}>
              {msg.status === "sending" && <Loader2 className="w-3 h-3 animate-spin inline" />}
              {msg.status === "sent" && "✓"}
              {msg.status === "delivered" && <span className="tracking-[-2px]">✓✓</span>}
              {msg.status === "read" && <span className="tracking-[-2px]">✓✓</span>}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export default React.memo(function MessageBubble({
  msg, isMe, activeReactionMenu, setActiveReactionMenu,
  isPlayingAudio, setIsPlayingAudio,
  handleVote, handleAddReaction, handleDeleteMessage, handleDeleteForMe, handleForwardMessage, handleReplyMessage, bubbleColorMeId, bubbleColorThemId, isPending, onEdit, onUpdatePrice,
}: MessageBubbleProps) {
  const activeMeBubble = BUBBLE_PRESETS_ME.find(b => b.id === bubbleColorMeId) || BUBBLE_PRESETS_ME[0];
  const activeThemBubble = BUBBLE_PRESETS_THEM.find(b => b.id === bubbleColorThemId) || BUBBLE_PRESETS_THEM[0];
  const isGlass = isMe ? bubbleColorMeId === "glass" : bubbleColorThemId === "glass";
  const { saving, save } = useSaveMedia();
  const [showPriceInput, setShowPriceInput] = useState(false);
  const [priceValue, setPriceValue] = useState("");
  const isTextOnlyEmoji = msg.type === "text" && msg.text && isEmoji(msg.text);

  const isMediaType = msg.type === "sticker" || msg.type === "image" || msg.type === "video";
  if (isMediaType) {
    const isSticker = msg.type === "sticker";
    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} relative group`}>
        {msg.type === "video" ? (
          <VideoMessageContent
            msg={msg} isMe={isMe}
            activeReactionMenu={activeReactionMenu} setActiveReactionMenu={setActiveReactionMenu}
            handleForwardMessage={handleForwardMessage} handleAddReaction={handleAddReaction}
            handleReplyMessage={handleReplyMessage}
          />
        ) : (
          <ImageMessage
            msg={msg} isMe={isMe} isSticker={isSticker}
            activeReactionMenu={activeReactionMenu} setActiveReactionMenu={setActiveReactionMenu}
            handleForwardMessage={handleForwardMessage} handleAddReaction={handleAddReaction}
            handleReplyMessage={handleReplyMessage}
          />
        )}
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className={`flex gap-1 mt-[-6px] z-10 ${isMe ? "mr-2" : "ml-2"}`}>
            {Object.entries(msg.reactions).map(([emo, count]) => (
              <span key={emo} className="bg-white px-1.5 py-0.5 rounded-full text-[9px] border border-slate-100 shadow-sm flex items-center gap-0.5 font-bold text-slate-600">
                {emo} <span className="text-[8px] text-slate-400">{count}</span>
              </span>
            ))}
          </div>
        )}
        {activeReactionMenu === msg.id && (
          <div className={`absolute z-30 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-100/80 shadow-lg overflow-hidden -top-8 ${isMe ? "right-2" : "left-2"}`}>
            {showPriceInput ? (
              <div className="py-2.5 px-3 min-w-[200px]">
                <p className="text-[11px] font-bold text-slate-700 mb-1.5">Precio del producto</p>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <span className="text-[13px] font-bold text-slate-500">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={priceValue}
                    onChange={(e) => setPriceValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && priceValue.trim() && onUpdatePrice) {
                        onUpdatePrice(msg.id, priceValue.trim());
                        setShowPriceInput(false);
                        setActiveReactionMenu(null);
                      }
                    }}
                    placeholder="0.00"
                    className="flex-1 text-[13px] px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 bg-slate-50"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowPriceInput(false); setPriceValue(""); setActiveReactionMenu(null); }}
                    className="flex-1 text-[11px] py-1.5 rounded-lg bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      if (priceValue.trim() && onUpdatePrice) {
                        onUpdatePrice(msg.id, priceValue.trim());
                        toast.success("Precio actualizado");
                      }
                      setShowPriceInput(false);
                      setActiveReactionMenu(null);
                    }}
                    disabled={!priceValue.trim()}
                    className="flex-1 text-[11px] py-1.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 transition-colors disabled:opacity-40"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-1 px-3 py-2 border-b border-slate-100">
                  {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
                    <button key={emo} onClick={() => handleAddReaction(msg.id, emo)} className="text-lg hover:scale-125 transition-transform p-1">{emo}</button>
                  ))}
                </div>
                <div className="py-1">
                  <button onClick={() => { setActiveReactionMenu(null); handleReplyMessage(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                    ↩️ Responder
                  </button>
                  <button onClick={() => { setActiveReactionMenu(null); handleForwardMessage(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                    ↪️ Reenviar
                  </button>
                  {msg.mediaUrl && (
                    <button
                      onClick={async () => {
                        setActiveReactionMenu(null);
                        const ext = msg.type === "video" ? "mp4" : "jpg";
                        const fn = `redon-${msg.type === "video" ? "video" : "image"}-${Date.now()}.${ext}`;
                        const ok = await save(msg.mediaUrl!, fn);
                        if (ok) toast.success("Guardado en galería");
                      }}
                      disabled={saving}
                      className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "⬇️"} Guardar
                    </button>
                  )}
                  {msg.mediaUrl && (
                    <button
                      onClick={() => {
                        setPriceValue(msg.price || "");
                        setShowPriceInput(true);
                      }}
                      className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                    >
                      🏷️ Precio {msg.price && <span className="text-emerald-600 font-bold ml-auto">${msg.price}</span>}
                    </button>
                  )}
                  <div className="border-t border-slate-100 my-1"></div>
                  <button onClick={() => { setActiveReactionMenu(null); handleDeleteForMe(msg.id); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 flex items-center gap-2">
                    🗑️ Eliminar para mí
                  </button>
                  {isMe && (
                    <button onClick={() => { setActiveReactionMenu(null); handleDeleteMessage(msg.id); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 flex items-center gap-2">
                      🗑️ Eliminar para todos
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isTextOnlyEmoji) {
    return (
      <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} relative group`}>
        <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} gap-0.5`}>
          <span className="text-7xl leading-none select-none px-1">{msg.text}</span>
          <div className={`flex items-center gap-1 px-2 text-[8px] opacity-70 ${isGlass ? "text-gray-600" : ""}`}>
            {msg.edited && <span className="italic opacity-60">editado</span>}
            <span>{msg.timestamp}</span>
            {isMe && (
              <span className={`text-[10px] leading-none ${msg.status === "read" ? "text-teal-400" : isGlass ? "text-gray-500" : "text-slate-400"}`}>
                {msg.status === "sending" && "🕒"}
                {msg.status === "sent" && "✓"}
                {msg.status === "delivered" && <span className="tracking-[-2px]">✓✓</span>}
                {msg.status === "read" && <span className="tracking-[-2px]">✓✓</span>}
                {!msg.status && "✓"}
              </span>
            )}
          </div>
        </div>
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className={`flex gap-1 mt-[-6px] z-10 ${isMe ? "mr-2" : "ml-2"}`}>
            {Object.entries(msg.reactions).map(([emo, count]) => (
              <span key={emo} className="bg-white px-1.5 py-0.5 rounded-full text-[9px] border border-slate-100 shadow-sm flex items-center gap-0.5 font-bold text-slate-600">
                {emo} <span className="text-[8px] text-slate-400">{count}</span>
              </span>
            ))}
          </div>
        )}
        {activeReactionMenu === msg.id && (
          <div className={`absolute z-30 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-100/80 shadow-lg overflow-hidden -top-8 ${isMe ? "right-2" : "left-2"}`}>
            <div className="flex gap-1 px-3 py-2 border-b border-slate-100">
              {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
                <button key={emo} onClick={() => handleAddReaction(msg.id, emo)} className="text-lg hover:scale-125 transition-transform p-1">{emo}</button>
              ))}
            </div>
            <div className="py-1">
              <button onClick={() => { setActiveReactionMenu(null); handleReplyMessage(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                ↩️ Responder
              </button>
              <button onClick={() => { setActiveReactionMenu(null); handleForwardMessage(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                ↪️ Reenviar
              </button>
              {isMe && msg.type === "text" && (
                <button onClick={() => { setActiveReactionMenu(null); onEdit?.(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                  ✏️ Editar
                </button>
              )}
              <div className="border-t border-slate-100 my-1"></div>
              <button onClick={() => { setActiveReactionMenu(null); handleDeleteForMe(msg.id); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 flex items-center gap-2">
                🗑️ Eliminar para mí
              </button>
              {isMe && (
                <button onClick={() => { setActiveReactionMenu(null); handleDeleteMessage(msg.id); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 flex items-center gap-2">
                  🗑️ Eliminar para todos
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} relative group`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2.5 shadow-sm text-xs relative cursor-pointer select-none transition-all duration-200 ${
          isMe ? activeMeBubble.css : activeThemBubble.css
        }`}
        onClick={() => setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id)}
      >
        {msg.forwarded && (
          <div className="flex items-center gap-1 mb-1">
            <Forward className={`w-3 h-3 ${isGlass ? "text-gray-500" : "text-slate-400"}`} />
            <span className={`text-[9px] font-bold uppercase tracking-wider ${isGlass ? "text-gray-500" : "text-slate-400"}`}>Reenviado</span>
          </div>
        )}
        {msg.replyToId && (
          <div className={`mb-1.5 pl-2 border-l-2 ${isMe ? "border-teal-300" : "border-teal-500"} bg-black/5 dark:bg-white/5 rounded-r-md py-1 px-2`}>
            <p className={`text-[9px] font-bold opacity-70 ${isGlass ? "text-gray-700" : ""}`}>{msg.replyToSender || "Desconocido"}</p>
            <p className={`text-[10px] opacity-60 truncate ${isGlass ? "text-gray-600" : ""}`}>{msg.replyToText}</p>
          </div>
        )}
        {msg.type === "text" && <p className={`leading-relaxed whitespace-pre-wrap ${isGlass ? "text-gray-900" : ""}`}>{msg.text}</p>}

        {msg.type === "audio" && (
          <div className={`flex items-center gap-2.5 p-1 rounded-xl min-w-[180px] ${isGlass ? "bg-black/5" : "bg-black/5 dark:bg-white/5"}`}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsPlayingAudio(isPlayingAudio === msg.id ? null : msg.id);
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                isGlass ? "bg-gray-800/10 text-gray-800 hover:bg-gray-800/20" : "bg-white/20 text-white hover:bg-white/30"
              }`}
            >
              {isPlayingAudio === msg.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-semibold truncate ${isGlass ? "text-gray-800" : "text-slate-100"}`}>{msg.fileName}</p>
              <span className={`text-[9px] opacity-70 block font-mono ${isGlass ? "text-gray-500" : ""}`}>{msg.fileSize} • {msg.duration}</span>
            </div>
          </div>
        )}

        {msg.type === "voice_note" && msg.mediaUrl && (
          <AudioMessagePlayer
            audioUrl={msg.mediaUrl}
            msgId={msg.id}
            isMe={isMe}
            isGlass={isGlass}
            duration={msg.duration}
          />
        )}

        {msg.type === "voice_note" && !msg.mediaUrl && (
          <div className="flex items-center gap-2 w-44">
            <Mic className={`w-4 h-4 shrink-0 ${isGlass ? "text-gray-500 opacity-60" : "opacity-50"}`} />
            <span className={`text-[10px] ${isGlass ? "text-gray-500" : "opacity-50"}`}>Audio no disponible</span>
          </div>
        )}

        {msg.type === "video_note" && (
          <VideoNoteContent
            msg={msg}
            handleForwardMessage={handleForwardMessage}
            handleAddReaction={handleAddReaction}
          />
        )}

        {msg.type === "location" && (
          <div className="space-y-1.5 min-w-[180px]">
            <div
              className="w-full h-28 rounded-xl overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center cursor-pointer hover:opacity-85 transition-opacity border border-slate-100"
              onClick={() => {
                const url = `https://www.openstreetmap.org/?mlat=${msg.latitude}&mlon=${msg.longitude}&zoom=15`;
                window.open(url, "_blank");
              }}
            >
              <MapPin className="w-7 h-7 text-rose-500 mb-1" />
              <span className="text-[9px] font-bold text-slate-600">Ver ubicación</span>
              <span className="text-[8px] text-slate-400">{msg.latitude?.toFixed(4)}, {msg.longitude?.toFixed(4)}</span>
            </div>
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
              <span className="text-[9px] font-medium text-slate-600 truncate">{msg.locationName}</span>
            </div>
          </div>
        )}

        {msg.type === "poll" && (
          <div className="space-y-3 min-w-[200px] text-slate-800 p-1 bg-white rounded-xl">
            <div className="flex items-start gap-1.5 border-b border-slate-100 pb-1.5">
              <BarChart2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <h4 className="text-[11px] font-bold text-slate-900 leading-snug">{msg.pollQuestion}</h4>
            </div>
            <div className="space-y-1.5">
              {msg.pollOptions?.map((opt) => {
                const hasVoted = opt.votedUsers.includes("me");
                return (
                  <button
                    key={opt.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVote(msg.id, opt.id);
                    }}
                    className={`w-full text-left p-2 rounded-lg border text-[10px] transition-all relative overflow-hidden flex items-center justify-between ${
                      hasVoted
                        ? "border-teal-400 bg-teal-50/50"
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-50"
                    }`}
                  >
                    <span className="relative z-10 font-semibold">{opt.text}</span>
                    <span className="relative z-10 font-mono font-bold bg-[#10646a]/10 text-[#10646a] px-1.5 py-0.5 rounded-full">
                      {opt.votes} v
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="text-[9px] text-slate-400 block text-right">Encuesta interactiva</span>
          </div>
        )}

        <div className={`flex items-center justify-end gap-1 mt-1 text-[8px] opacity-70 ${isGlass ? "text-gray-600" : ""}`}>
          {msg.edited && <span className="italic opacity-60">editado</span>}
          <span>{msg.timestamp}</span>
          {isMe && (
            <span className={`text-[10px] leading-none ${
              msg.status === "read" ? "text-teal-400" : isGlass ? "text-gray-500" : "text-slate-400"
            }`}>
              {msg.status === "sending" && "🕒"}
              {msg.status === "sent" && "✓"}
              {msg.status === "delivered" && <span className="tracking-[-2px]">✓✓</span>}
              {msg.status === "read" && <span className="tracking-[-2px]">✓✓</span>}
              {!msg.status && "✓"}
            </span>
          )}
        </div>
      </div>

      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
        <div className={`flex gap-1 mt-[-6px] z-10 ${isMe ? "mr-2" : "ml-2"}`}>
          {Object.entries(msg.reactions).map(([emo, count]) => (
            <span
              key={emo}
              className="bg-white px-1.5 py-0.5 rounded-full text-[9px] border border-slate-100 shadow-sm flex items-center gap-0.5 font-bold text-slate-600"
            >
              {emo} <span className="text-[8px] text-slate-400">{count}</span>
            </span>
          ))}
        </div>
      )}

      {activeReactionMenu === msg.id && (
        <div className={`absolute z-30 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-100/80 shadow-lg overflow-hidden -top-8 ${
          isMe ? "right-2" : "left-2"
        }`}>
          <div className="flex gap-1 px-3 py-2 border-b border-slate-100">
            {["👍", "❤️", "🔥", "😆", "😮", "😢"].map((emo) => (
              <button key={emo} onClick={() => handleAddReaction(msg.id, emo)} className="text-lg hover:scale-125 transition-transform p-1">{emo}</button>
            ))}
          </div>
          <div className="py-1">
            <button onClick={() => { setActiveReactionMenu(null); handleReplyMessage(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
              ↩️ Responder
            </button>
            <button onClick={() => { setActiveReactionMenu(null); handleForwardMessage(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
              ↪️ Reenviar
            </button>
            {isMe && msg.type === "text" && (
              <button onClick={() => { setActiveReactionMenu(null); onEdit?.(msg); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                ✏️ Editar
              </button>
            )}
            <div className="border-t border-slate-100 my-1"></div>
            <button onClick={() => { setActiveReactionMenu(null); handleDeleteForMe(msg.id); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 flex items-center gap-2">
              🗑️ Eliminar para mí
            </button>
            {isMe && (
              <button onClick={() => { setActiveReactionMenu(null); handleDeleteMessage(msg.id); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 flex items-center gap-2">
                🗑️ Eliminar para todos
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function VideoMessageContent({ msg, isMe, activeReactionMenu, setActiveReactionMenu, handleForwardMessage, handleAddReaction, handleReplyMessage }: {
  msg: Message; isMe: boolean;
  activeReactionMenu: string | null;
  setActiveReactionMenu: (id: string | null) => void;
  handleForwardMessage: (m: Message) => void;
  handleAddReaction: (id: string, emoji: string) => void;
  handleReplyMessage: (m: Message) => void;
}) {
  const [showViewer, setShowViewer] = useState(false);
  const isSending = msg.status === "sending";

  return (
    <>
      {showViewer && (
        <VideoViewer
          src={msg.mediaUrl!}
          msg={msg}
          onClose={() => setShowViewer(false)}
          handleForwardMessage={handleForwardMessage}
          handleAddReaction={handleAddReaction}
        />
      )}
      <div
        className="relative max-w-[85%] group select-none"
        onClick={() => setShowViewer(true)}
        onTouchStart={(e) => {
          (e.currentTarget as HTMLElement).dataset.touchX = e.touches[0].clientX.toString();
          (e.currentTarget as HTMLElement).dataset.lpTimer = window.setTimeout(() => {
            setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id);
          }, 500).toString();
        }}
        onTouchMove={(e) => {
          const timer = (e.currentTarget as HTMLElement).dataset.lpTimer;
          if (timer) { clearTimeout(Number(timer)); delete (e.currentTarget as HTMLElement).dataset.lpTimer; }
        }}
        onTouchEnd={(e) => {
          const timer = (e.currentTarget as HTMLElement).dataset.lpTimer;
          if (timer) { clearTimeout(Number(timer)); delete (e.currentTarget as HTMLElement).dataset.lpTimer; }
          const startX = Number((e.currentTarget as HTMLElement).dataset.touchX || 0);
          const dx = e.changedTouches[0].clientX - startX;
          if (dx > 80) {
            e.preventDefault();
            handleReplyMessage(msg);
          }
        }}
      >
        <div className="relative bg-black overflow-hidden rounded-xl shadow-md border border-white/10" style={{ width: 260, height: 340 }}>
          {/* Capa de imagen (Thumbnail) */}
          {msg.posterUrl ? (
            <img
              src={msg.posterUrl}
              alt="Video thumbnail"
              className="w-full h-full object-cover absolute inset-0 bg-black"
            />
          ) : (
            <div className="w-full h-full bg-black flex items-center justify-center absolute inset-0">
              <Loader2 className="w-6 h-6 text-white/20 animate-spin" />
            </div>
          )}

          {/* Overlay oscuro para mejorar contraste */}
          <div className="absolute inset-0 bg-black/20 pointer-events-none" />

          {/* Botón de Play (siempre sobre fondo negro) */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm border border-white/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="ml-1">
                <polygon points="8,5 19,12 8,19" />
              </svg>
            </div>
          </div>

          <div className="absolute bottom-1 right-1 bg-black/50 text-white/90 text-[10px] px-1.5 py-0.5 rounded-full backdrop-blur-xs font-medium pointer-events-none flex items-center gap-1 z-10">
            <span>{msg.timestamp}</span>
            {isMe && (
              <span className={`leading-none ${msg.status === "read" ? "text-teal-400" : "text-slate-400"}`}>
                {msg.status === "sending" && <Loader2 className="w-3 h-3 animate-spin inline" />}
                {msg.status === "sent" && "✓"}
                {msg.status === "delivered" && <span className="tracking-[-2px]">✓✓</span>}
                {msg.status === "read" && <span className="tracking-[-2px]">✓✓</span>}
              </span>
            )}
          </div>
        </div>

        <div className="px-0.5 pt-1 flex items-center gap-2">
          <span className="text-[9px] font-mono opacity-60 truncate">{msg.fileName}</span>
          <span className="text-[8px] font-mono opacity-40">({msg.fileSize})</span>
          {msg.price && (
            <span className="text-[9px] font-bold text-emerald-600 ml-auto">💰 {msg.price}</span>
          )}
        </div>

        {!isSending && (
          <button
            onClick={(e) => { e.stopPropagation(); setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id); }}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
          >
            <span className="text-white text-[11px] leading-none">➕</span>
          </button>
        )}

        {isSending && (
          <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center pointer-events-none" style={{ borderRadius: 12 }}>
            <div className="bg-white/90 rounded-full p-2">
              <Loader2 className="w-5 h-5 text-[#0a4d52] animate-spin" />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function VideoNoteContent({ msg, handleForwardMessage, handleAddReaction }: {
  msg: Message;
  handleForwardMessage: (m: Message) => void;
  handleAddReaction: (id: string, emoji: string) => void;
}) {
  const [showViewer, setShowViewer] = useState(false);
  const isSending = msg.status === "sending";

  return (
    <>
      {showViewer && (
        <VideoViewer
          src={msg.mediaUrl!}
          msg={msg}
          onClose={() => setShowViewer(false)}
          handleForwardMessage={handleForwardMessage}
          handleAddReaction={handleAddReaction}
        />
      )}
      <div
        className="space-y-1.5 flex flex-col items-center cursor-pointer active:scale-95 transition-transform group"
        onClick={() => setShowViewer(true)}
      >
        <div className="w-24 h-24 rounded-full border-4 border-teal-400 overflow-hidden bg-black flex items-center justify-center relative shadow-inner">
          {isSending ? (
            <div className="w-full h-full flex items-center justify-center bg-black/60">
              <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
            </div>
          ) : (
            <video src={msg.mediaUrl} className="w-full h-full object-cover absolute inset-0" muted playsInline preload="none" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="w-5 h-5 text-white ml-0.5" />
            </div>
          </div>
        </div>
        <span className={`text-[9px] font-bold tracking-tight opacity-90`}>📹 Nota de Video ({msg.duration || "0:08"})</span>
      </div>
    </>
  );
}

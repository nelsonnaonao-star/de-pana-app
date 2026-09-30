import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, TrendingUp } from "lucide-react";
import {
  searchGifs,
  getTrendingGifs,
  searchStickers,
  getTrendingStickers,
  GiphyResult,
} from "../services/stickerService";
import { getOfficialStickers, getWepaStickers } from "../services/stickerStore";
import { getItem, setItem } from "../services/storageService";
import { CHAT_BACKGROUNDS } from "./chat/chatConstants";
import ChatPatternBackground from "./chat/ChatPatternBackground";
import CachedImage from "./CachedImage";

type Tab = "gif" | "sticker" | "emoji" | "wepa";

interface GifPickerProps {
  onSelect: (value: string, type: "gif" | "sticker" | "emoji") => void;
  onClose: () => void;
}

const TWEMOJI_CDN = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72";

const WEPA_CACHE_KEY = "wepa_stickers_cache";
const OFFICIAL_CACHE_KEY = "official_stickers_cache";
const PACK_CACHE_TTL = 24 * 60 * 60 * 1000;

type GiphyKind = "gif" | "sticker";

// Caché en memoria de sesión para resultados de Giphy (trending + búsquedas).
// Vive a nivel de módulo, así que sobrevive al desmontaje/reapertura del picker.
// La clave es `${kind}:${query}` (trending usa query vacío).
const GIPHY_CACHE = new Map<string, GiphyResult[]>();
// Peticiones en vuelo, para no duplicar la misma consulta simultánea.
const GIPHY_INFLIGHT = new Map<string, Promise<GiphyResult[]>>();

function fetchGiphyCached(kind: GiphyKind, query: string): Promise<GiphyResult[]> {
  const key = `${kind}:${query.trim()}`;
  const cached = GIPHY_CACHE.get(key);
  if (cached) return Promise.resolve(cached);

  let promise = GIPHY_INFLIGHT.get(key);
  if (!promise) {
    promise = query.trim()
      ? (kind === "gif" ? searchGifs(query) : searchStickers(query))
      : (kind === "gif" ? getTrendingGifs(30) : getTrendingStickers(30));
    GIPHY_INFLIGHT.set(key, promise);
    promise
      .then((results) => { GIPHY_CACHE.set(key, results); })
      .finally(() => { GIPHY_INFLIGHT.delete(key); });
  }
  return promise;
}

function emojiToTwemojiUrl(emoji: string): string {
  const codes: string[] = [];
  for (const char of emoji) {
    const code = char.codePointAt(0);
    if (code !== undefined && code !== 0xFE0F) {
      codes.push(code.toString(16));
    }
  }
  return `${TWEMOJI_CDN}/${codes.join("-")}.png`;
}

interface EmojiCategory {
  icon: string;
  name: string;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    icon: "😀", name: "Smileys", emojis: [
      "😀","😃","😄","😁","😆","🤣","😂","🙂","😉","😊","😍","🥰","😘","😋","😛","😜","🤪","😎",
      "🤩","🥳","😏","😒","🙄","😌","😔","😴","🤤","😪","😤","😡","🤬","😭","🥺","😰","😱","🤯",
      "🥶","🥵","🤗","🤭","🤫","🤔","🤐","🤨","😬","😷","🤒","🤕","🤧","🥴","😵","🤠","🥸","🤥",
    ]
  },
  {
    icon: "👋", name: "Gestos", emojis: [
      "👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👋","✋","👏","🙌","🤲","🤝","🙏","💪","🖕","✊",
      "👊","🫶","🤌","🫵","🫱","🫲","🫳","🫴","🤙","🤛","🤜","👈","👉","👆","👇","☝️","✍️","🫡",
    ]
  },
  {
    icon: "❤️", name: "Corazones", emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💕","💞","💗","💖","💘","💝","❣️","💔","💋",
      "💌","💟","🩷","🩵","🩶","❤️‍🔥","❤️‍🩹","💔","🫶🏻",
    ]
  },
  {
    icon: "🎉", name: "Objetos", emojis: [
      "🎁","🎈","🎉","🎊","🎀","💎","💍","🥇","🥈","🥉","🏆","🏅","🎖️","🏵️","🎨","🎭","🎤","🎧",
      "🎼","🎹","🥁","🎷","🎺","🎸","🎻","🎲","🎯","🎳","🎮","🕹️","📸","📷","📱","💻","⌨️","🖥️",
    ]
  },
  {
    icon: "🚀", name: "Viajes", emojis: [
      "🚀","🛸","🌟","⭐️","🌙","☀️","🌈","⛅️","❄️","🔥","💥","✨","🌊","🌋","🏔️","🏖️","🌴","🌵",
    ]
  },
  {
    icon: "🌸", name: "Naturaleza", emojis: [
      "🌸","🌺","🌻","🌷","🌹","🌼","🌿","🍀","🍁","🍂","🪴","🌱","🌲","🌳","🌴","🌵","🪨","🪵",
    ]
  },
  {
    icon: "🍕", name: "Comida", emojis: [
      "🍕","🍔","🌭","🥓","🥞","🍩","🍪","🎂","🍫","🍿","🥤","☕️","🧊","🥗","🥑","🥨","🧀","🥩",
      "🍣","🍱","🍜","🍝","🌮","🌯","🥙","🧁","🍦","🍭","🍰","🧃","🥛","🍺","🍻","🍷","🥃","🍸",
    ]
  },
];

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center h-32 gap-3">
      <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-[9px] text-slate-400 font-medium animate-pulse">Cargando...</span>
    </div>
  );
}

function EmptyState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2">
      <div className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center">
        <TrendingUp className="w-5 h-5 text-slate-400" />
      </div>
      <p className="text-[10px] text-slate-500 font-medium text-center px-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-[9px] text-teal-600 font-bold hover:underline cursor-pointer"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

function StickerTile({ url, alt, onSelect }: { url: string; alt?: string; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="relative rounded-xl overflow-hidden bg-white/70 hover:bg-white/90 hover:ring-2 ring-teal-500/60 hover:shadow-lg transition-all cursor-pointer group active:scale-95 min-w-0"
      style={{ aspectRatio: "1" }}
    >
      <CachedImage
        src={url}
        alt={alt || "Sticker"}
        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
    </button>
  );
}

function StickerGrid({ urls, onSelect }: { urls: string[]; onSelect: (url: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 w-full max-w-full box-border min-w-0">
      {urls.map((url) => (
        <StickerTile key={url} url={url} onSelect={() => onSelect(url)} />
      ))}
    </div>
  );
}

function SectionTitle({ icon, name, className = "" }: { icon: string; name: string; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 mb-1.5 text-[11px] font-black uppercase tracking-wide ${className}`}>
      <span className="text-[14px]">{icon}</span>
      <span>{name}</span>
    </div>
  );
}

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [tab, setTab] = useState<Tab>("gif");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [officialStickers, setOfficialStickers] = useState<string[]>([]);
  const [wepaStickers, setWepaStickers] = useState<string[]>([]);
  const [wepaLoading, setWepaLoading] = useState(false);
  const [officialLoading, setOfficialLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const searchTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadedPacksRef = useRef<{ wepa: boolean; official: boolean }>({ wepa: false, official: false });

  // Fondo del picker = el mismo fondo que el usuario eligió para el chat
  const [selectedBgId] = useState(() => localStorage.getItem("chat_bg_id") || "wepa");
  const [customBgImage] = useState(() => localStorage.getItem("chat_bg_custom"));

  const isCustomBg = selectedBgId === "custom" && !!customBgImage;
  const bgPreset = isCustomBg ? undefined : CHAT_BACKGROUNDS.find(bg => bg.id === selectedBgId);
  const rawBg = isCustomBg
    ? `url("${customBgImage}") center/cover no-repeat`
    : (bgPreset?.value || "#f8fafc");
  const isPatternBg = rawBg.startsWith("pattern:");
  const isGradientBg = rawBg.startsWith("linear-gradient");
  const isImageBg = rawBg.startsWith("url");

  const patternParts = isPatternBg ? rawBg.replace("pattern:", "").split("|") : [];
  const patternTheme = (patternParts[0] || "stars") as "stars" | "bubbles" | "dots" | "constellation" | "waves" | "sparkle";
  const patternFrom = patternParts[1] || "blue";
  const patternTo = patternParts[2] || "purple";

  const containerBgStyle: React.CSSProperties = isPatternBg
    ? { background: "transparent" }
    : isGradientBg
      ? { backgroundImage: rawBg }
      : isImageBg
        ? {
            backgroundImage: rawBg.replace(/ center\/cover no-repeat$/, ''),
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }
        : { backgroundColor: rawBg };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const loadPackUrls = useCallback((
    cacheKey: string,
    fetchFn: () => Promise<string[]>,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    setLoadingFn: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    getItem<{ urls: string[]; ts: number }>(cacheKey).then((cached) => {
      if (cached && Date.now() - cached.ts < PACK_CACHE_TTL && cached.urls?.length) {
        setter(cached.urls);
      }
    });
    fetchFn()
      .then((urls) => {
        setter(urls);
        setError(null);
        setItem(cacheKey, { urls, ts: Date.now() });
      })
      .catch(() => setter((prev) => (prev.length ? prev : [])))
      .finally(() => setLoadingFn(false));
  }, []);

  // Tab WEPA: pack WEPA + oficiales + mis stickers
  useEffect(() => {
    if (tab !== "wepa") return;
    if (!loadedPacksRef.current.wepa) {
      loadedPacksRef.current.wepa = true;
      setWepaLoading(true);
      loadPackUrls(WEPA_CACHE_KEY, getWepaStickers, setWepaStickers, setWepaLoading);
    }
    if (!loadedPacksRef.current.official) {
      loadedPacksRef.current.official = true;
      setOfficialLoading(true);
      loadPackUrls(OFFICIAL_CACHE_KEY, getOfficialStickers, setOfficialStickers, setOfficialLoading);
    }
  }, [tab, loadPackUrls]);

  // Contenido del tab GIFs (Giphy) — usa el caché de sesión si ya está disponible
  useEffect(() => {
    if (tab !== "gif") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const key = `gif:${query.trim()}`;
    const cached = GIPHY_CACHE.get(key);
    if (cached) {
      setItems(cached);
      setError(null);
      setLoading(false);
      return;
    }

    if (!query.trim()) {
      setLoading(true);
      setError(null);
      fetchGiphyCached("gif", "")
        .then(setItems)
        .catch(() => { setItems([]); setError("No se pudieron cargar los GIFs. Verifica tu conexión."); })
        .finally(() => setLoading(false));
    } else {
      setError(null);
      setLoading(true);
      searchTimer.current = window.setTimeout(async () => {
        try {
          const results = await fetchGiphyCached("gif", query);
          setItems(results);
          setError(null);
        } catch {
          setItems([]);
          setError("Error al buscar. Intenta de nuevo.");
        }
        setLoading(false);
        gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }, 400);
    }
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [tab, query, reloadTick]);

  // Contenido del tab Stickers (Giphy) — usa el caché de sesión si ya está disponible
  useEffect(() => {
    if (tab !== "sticker") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const key = `sticker:${query.trim()}`;
    const cached = GIPHY_CACHE.get(key);
    if (cached) {
      setItems(cached);
      setError(null);
      setLoading(false);
      return;
    }

    if (!query.trim()) {
      setLoading(true);
      setError(null);
      fetchGiphyCached("sticker", "")
        .then(setItems)
        .catch(() => { setItems([]); setError("No se pudieron cargar los stickers."); })
        .finally(() => setLoading(false));
    } else {
      setError(null);
      setLoading(true);
      searchTimer.current = window.setTimeout(async () => {
        try {
          const results = await fetchGiphyCached("sticker", query);
          setItems(results);
          setError(null);
        } catch {
          setItems([]);
          setError("Error al buscar. Intenta de nuevo.");
        }
        setLoading(false);
        gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }, 400);
    }
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [tab, query, reloadTick]);

  const retryGiphy = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadTick(t => t + 1);
  }, []);

  function handleTabChange(newTab: Tab) {
    if (newTab === tab) return;
    setTab(newTab);
    setQuery("");
    setError(null);
  }

  const showSearch = tab === "gif" || tab === "sticker";

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-50 flex flex-col w-full max-w-full overflow-hidden rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.18)] max-h-[55%] min-h-[320px] animate-slide-up border-t border-white/30 relative"
      style={containerBgStyle}
    >
      {/* SVG Pattern Background */}
      {isPatternBg && (
        <ChatPatternBackground
          theme={patternTheme}
          gradientFrom={patternFrom}
          gradientTo={patternTo}
          strokeOpacity={0.3}
          className="pointer-events-none"
          idSuffix="picker"
        />
      )}
      {!isPatternBg && !isGradientBg && !isImageBg && (
        <div className="absolute inset-0 bg-white/40 pointer-events-none z-0" />
      )}

      {/* Header */}
      <div className="shrink-0 min-w-0 w-full bg-white/70 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 w-full max-w-full">
          <div className="flex items-center gap-1 bg-slate-100/90 rounded-xl p-0.5 w-full min-w-0">
            <button
              onClick={() => handleTabChange("gif")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[11px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "gif" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              GIFs
            </button>
            <button
              onClick={() => handleTabChange("sticker")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[11px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "sticker" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Stickers
            </button>
            <button
              onClick={() => handleTabChange("emoji")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[11px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "emoji" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Emojis
            </button>
            <button
              onClick={() => handleTabChange("wepa")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[11px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "wepa" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              WEPA
            </button>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-4 pb-2 w-full max-w-full">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Buscar ${tab === "gif" ? "GIFs" : "stickers"}...`}
                className="w-full bg-white/80 rounded-lg py-1.5 pl-8 pr-7 text-[10px] outline-none placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-teal-500/20 transition-all"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {showSearch && query.trim() && (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-1.5 text-[9px] text-teal-700 font-semibold">
              <Search className="w-3 h-3" />
              <span>Resultados para "{query}"</span>
            </div>
          </div>
        )}

        <div className="mx-4 h-px bg-white/50" />
      </div>

      {/* Grid */}
      <div ref={gridRef} className="flex-1 w-full max-w-full min-w-0 overflow-y-auto overflow-x-hidden px-4 py-3 scroll-smooth">
        {tab === "wepa" ? (
          <div className="space-y-4">
            {wepaLoading && wepaStickers.length === 0 ? (
              <Spinner />
            ) : (
              <>
                {wepaStickers.length > 0 && (
                  <div>
                    <SectionTitle icon="⭐" name="Pack WEPA" className="text-teal-700" />
                    <StickerGrid urls={wepaStickers} onSelect={(url) => onSelect(url, "sticker")} />
                  </div>
                )}
                {officialStickers.length > 0 && (
                  <div>
                    <SectionTitle icon="🏛️" name="Oficiales" className="text-slate-600" />
                    <StickerGrid urls={officialStickers} onSelect={(url) => onSelect(url, "sticker")} />
                  </div>
                )}
                {wepaStickers.length === 0 && officialStickers.length === 0 && !wepaLoading && !officialLoading && (
                  <EmptyState message="Aún no hay stickers WEPA." />
                )}
              </>
            )}
          </div>
        ) : tab === "emoji" ? (
          <div className="space-y-4">
            {EMOJI_CATEGORIES.map((cat) => (
              <div key={cat.name}>
                <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                  <span className="text-[13px]">{cat.icon}</span>
                  <span>{cat.name}</span>
                </div>
                <div className="grid grid-cols-8 gap-0.5">
                  {cat.emojis.map((emoji, i) => (
                    <button
                      key={`${cat.name}-${i}`}
                      onClick={() => onSelect(emoji, "emoji")}
                      className="aspect-square flex items-center justify-center hover:bg-white/70 rounded-lg transition-all cursor-pointer active:scale-90 p-1"
                      title={emoji}
                    >
                      <img
                        src={emojiToTwemojiUrl(emoji)}
                        alt={emoji}
                        className="w-7 h-7 object-contain pointer-events-none select-none"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : loading ? (
          <Spinner />
        ) : items.length > 0 ? (
          <div className={tab === "gif" ? "grid grid-cols-3 gap-2 w-full max-w-full box-border min-w-0" : "grid grid-cols-4 gap-2 w-full max-w-full box-border min-w-0"}>
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(
                  item.images?.fixed_height_small?.url || item.images?.preview_gif?.url || item.images?.original?.url,
                  tab === "gif" ? "gif" : "sticker"
                )}
className="relative rounded-xl overflow-hidden bg-white/70 hover:bg-white/90 hover:ring-2 ring-teal-500/60 hover:shadow-lg transition-all cursor-pointer group active:scale-95 min-w-0"
                style={{ aspectRatio: tab === "gif" ? "16/9" : "1" }}
              >
                <img
                  src={item.images?.fixed_height_small?.url || item.images?.preview_gif?.url}
                  alt={item.title || ""}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            message={error || "Sin resultados"}
            onRetry={error ? retryGiphy : undefined}
          />
        )}
      </div>
    </div>
  );
}
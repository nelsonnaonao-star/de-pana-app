import React, { useState, useEffect, useRef } from "react";
import { Search, X, TrendingUp } from "lucide-react";
import {
  searchGifs,
  getTrendingGifs,
  searchStickers,
  getTrendingStickers,
  GiphyResult,
  GIF_CATEGORIES,
} from "../services/stickerService";
import { getMyStickers, removeMySticker } from "../services/myStickers";
import { getOfficialStickers } from "../services/stickerStore";
import { getItem, setItem } from "../services/storageService";
import CachedImage from "./CachedImage";

type Tab = "gif" | "sticker" | "emoji" | "mine" | "official";

interface GifPickerProps {
  onSelect: (value: string, type: "gif" | "sticker" | "emoji") => void;
  onClose: () => void;
}

const TWEMOJI_CDN = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72";

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

const CATEGORY_ICONS: Record<string, string> = {
  Trending: "🔥",
  Funny: "😂",
  Love: "❤️",
  Celebration: "🎉",
  Sad: "😢",
  Angry: "😡",
  "Thumbs Up": "👍",
  Music: "🎶",
  Workout: "💪",
  "Good Morning": "🌅",
  "Good Night": "🌙",
  Gaming: "🎮",
};

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [tab, setTab] = useState<Tab>("gif");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myStickers, setMyStickers] = useState<string[]>([]);
  const [officialStickers, setOfficialStickers] = useState<string[]>([]);
  const searchTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMyStickers(getMyStickers().map((s) => s.url).reverse());
    inputRef.current?.focus();
    loadContent();
  }, []);

  useEffect(() => {
    if (tab === "mine") {
      setMyStickers(getMyStickers().map((s) => s.url).reverse());
      return;
    }
    if (tab === "official") {
      let cancelled = false;
      const OFFICIAL_CACHE_KEY = "official_stickers_cache";
      const OFFICIAL_CACHE_TTL = 24 * 60 * 60 * 1000;
      getItem<{ urls: string[]; ts: number }>(OFFICIAL_CACHE_KEY).then((cached) => {
        const fresh = cached && Date.now() - cached.ts < OFFICIAL_CACHE_TTL && cached.urls?.length;
        if (cancelled) return;
        if (fresh) {
          setOfficialStickers(cached!.urls);
          setError(null);
        } else {
          setLoading(true);
        }
      });
      getOfficialStickers()
        .then(async (urls) => {
          if (cancelled) return;
          setOfficialStickers(urls);
          setError(null);
          try {
            await setItem(OFFICIAL_CACHE_KEY, { urls, ts: Date.now() });
          } catch { /* cache opcional */ }
        })
        .catch(() => {
          if (cancelled) return;
          setOfficialStickers((prev) => prev.length ? prev : []);
          setError("No se pudieron cargar los stickers oficiales.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      loadContent();
      return;
    }
    setError(null);
    setLoading(true);
    searchTimer.current = window.setTimeout(async () => {
      try {
        const fn = tab === "gif" ? searchGifs : searchStickers;
        const results = await fn(query);
        setItems(results);
        setError(null);
      } catch {
        setItems([]);
        setError("Error al buscar. Intenta de nuevo.");
      }
      setLoading(false);
      gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, tab]);

  async function loadContent() {
    if (tab === "mine" || tab === "official") return;
    setLoading(true);
    setError(null);
    try {
      const fn = tab === "gif" ? getTrendingGifs : getTrendingStickers;
      const results = await fn(30);
      setItems(results);
      setError(null);
    } catch {
      setItems([]);
      setError("No se pudieron cargar los GIFs. Verifica tu conexión.");
    }
    setLoading(false);
  }

  function handleTabChange(newTab: Tab) {
    if (newTab === tab) return;
    setTab(newTab);
    setQuery("");
    if (newTab === "mine") {
      setMyStickers(getMyStickers().map((s) => s.url).reverse());
    }
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-col w-full max-w-full overflow-hidden bg-white rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.18)] max-h-[55%] min-h-[320px] animate-slide-up border-t border-slate-100">
      {/* Header */}
      <div className="shrink-0 min-w-0 w-full">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 w-full max-w-full">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-0.5 w-full min-w-0">
            <button
              onClick={() => handleTabChange("gif")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[9px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "gif" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              GIFs
            </button>
            <button
              onClick={() => handleTabChange("sticker")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[9px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "sticker" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Stickers
            </button>
            <button
              onClick={() => handleTabChange("emoji")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[9px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "emoji" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Emojis
            </button>
            <button
              onClick={() => handleTabChange("mine")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[9px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "mine" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Míos
            </button>
            <button
              onClick={() => handleTabChange("official")}
              className={`flex-1 min-w-0 whitespace-nowrap text-center text-[9px] font-bold px-2 py-1.5 rounded-lg transition-all ${
                tab === "official" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Oficiales
            </button>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        {tab !== "emoji" && tab !== "mine" && tab !== "official" && (
          <div className="px-4 pb-2 w-full max-w-full">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Buscar ${tab === "gif" ? "GIFs" : "stickers"}...`}
                className="w-full bg-slate-100 rounded-lg py-1.5 pl-8 pr-7 text-[10px] outline-none placeholder-slate-400 focus:bg-slate-50 focus:ring-2 focus:ring-teal-500/20 transition-all"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Categories */}
        {tab !== "emoji" && tab !== "mine" && tab !== "official" && !query.trim() && (
          <div className="px-4 pb-2 overflow-x-auto shrink-0 scrollbar-none">
            <div className="flex gap-1.5">
              {GIF_CATEGORIES.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => setQuery(cat.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-bold whitespace-nowrap transition-all bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800 border border-slate-100 hover:border-slate-200 active:scale-95 cursor-pointer"
                >
                  <span className="text-[11px]">{CATEGORY_ICONS[cat.name]}</span>
                  <span>{cat.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab !== "emoji" && tab !== "mine" && tab !== "official" && query.trim() && (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-1.5 text-[9px] text-teal-600 font-semibold">
              <Search className="w-3 h-3" />
              <span>Resultados para "{query}"</span>
            </div>
          </div>
        )}

        <div className="mx-4 h-px bg-slate-100" />
      </div>

      {/* Grid */}
      <div ref={gridRef} className="flex-1 w-full max-w-full min-w-0 overflow-y-auto overflow-x-hidden px-4 py-3 scroll-smooth">
        {tab === "mine" ? (
          myStickers.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 w-full max-w-full box-border min-w-0">
              {myStickers.map((url) => (
                <div
                  key={url}
                  className="relative rounded-xl overflow-hidden bg-slate-50 group min-w-0"
                  style={{ aspectRatio: "1" }}
                >
                  <button
                    onClick={() => onSelect(url, "sticker")}
                    className="w-full h-full hover:ring-2 ring-teal-500/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                  >
                    <CachedImage
                      src={url}
                      alt="Mis sticker"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = removeMySticker(url);
                      setMyStickers(next.map((s) => s.url).reverse());
                    }}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md"
                    aria-label="Eliminar sticker"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-slate-300" />
              </div>
              <p className="text-[10px] text-slate-400 font-medium text-center px-4">
                Aún no has creado stickers. Crea uno en el editor y se guardará aquí.
              </p>
            </div>
          )
        ) : tab === "official" ? (
          loading ? (
            <div className="flex flex-col items-center justify-center h-32 gap-3">
              <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[9px] text-slate-400 font-medium animate-pulse">Cargando...</span>
            </div>
          ) : officialStickers.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 w-full max-w-full box-border min-w-0">
              {officialStickers.map((url) => (
                <button
                  key={url}
                  onClick={() => onSelect(url, "sticker")}
                  className="relative rounded-xl overflow-hidden bg-slate-50 hover:ring-2 ring-teal-500/60 hover:shadow-lg transition-all cursor-pointer group active:scale-95 min-w-0"
                  style={{ aspectRatio: "1" }}
                >
                <CachedImage
                  src={url}
                  alt="Sticker oficial"
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-slate-300" />
              </div>
              <p className="text-[10px] text-slate-400 font-medium text-center px-4">
                {error || "No hay stickers oficiales por ahora."}
              </p>
              {error && (
                <button
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    getOfficialStickers()
                      .then(setOfficialStickers)
                      .catch(() => setError("No se pudieron cargar los stickers oficiales."))
                      .finally(() => setLoading(false));
                  }}
                  className="text-[9px] text-teal-600 font-bold hover:underline cursor-pointer"
                >
                  Reintentar
                </button>
              )}
            </div>
          )
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
                      className="aspect-square flex items-center justify-center hover:bg-slate-100 rounded-lg transition-all cursor-pointer active:scale-90 p-1"
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
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] text-slate-400 font-medium animate-pulse">Cargando...</span>
          </div>
        ) : items.length > 0 ? (
          <div className={tab === "gif" ? "grid grid-cols-3 gap-2 w-full max-w-full box-border min-w-0" : "grid grid-cols-4 gap-2 w-full max-w-full box-border min-w-0"}>
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(
                  item.images?.fixed_height_small?.url || item.images?.preview_gif?.url || item.images?.original?.url,
                  tab === "gif" ? "gif" : "sticker"
                )}
                className="relative rounded-xl overflow-hidden bg-slate-50 hover:ring-2 ring-teal-500/60 hover:shadow-lg transition-all cursor-pointer group active:scale-95 min-w-0"
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
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-slate-300" />
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              {error || "Sin resultados"}
            </p>
            <button
              onClick={() => { setQuery(""); loadContent(); }}
              className="text-[9px] text-teal-600 font-bold hover:underline cursor-pointer"
            >
              {error ? "Reintentar" : "Ver tendencias"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

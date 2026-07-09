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

type Tab = "gif" | "sticker" | "emoji";

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
  const searchTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    loadContent();
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      loadContent();
      return;
    }
    setLoading(true);
    searchTimer.current = window.setTimeout(async () => {
      const fn = tab === "gif" ? searchGifs : searchStickers;
      const results = await fn(query).catch(() => []);
      setItems(results);
      setLoading(false);
      gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, tab]);

  async function loadContent() {
    setLoading(true);
    const fn = tab === "gif" ? getTrendingGifs : getTrendingStickers;
    const results = await fn(30).catch(() => []);
    setItems(results);
    setLoading(false);
  }

  function handleTabChange(newTab: Tab) {
    if (newTab === tab) return;
    setTab(newTab);
    setQuery("");
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.18)] max-h-[55%] min-h-[320px] animate-slide-up border-t border-slate-100">
      {/* Header */}
      <div className="shrink-0">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-0.5">
            <button
              onClick={() => handleTabChange("gif")}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all ${
                tab === "gif" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              GIFs
            </button>
            <button
              onClick={() => handleTabChange("sticker")}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all ${
                tab === "sticker" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Stickers
            </button>
            <button
              onClick={() => handleTabChange("emoji")}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all ${
                tab === "emoji" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Emojis
            </button>
          </div>
          <div className="flex items-center gap-2">
            {tab !== "emoji" && (
              <div className="relative w-36">
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
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Categories */}
        {tab !== "emoji" && !query.trim() && (
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

        {tab !== "emoji" && query.trim() && (
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
      <div ref={gridRef} className="flex-1 overflow-y-auto px-4 py-3 scroll-smooth">
        {tab === "emoji" ? (
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
          <div className={tab === "gif" ? "grid grid-cols-3 gap-2" : "grid grid-cols-4 gap-2"}>
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(
                  item.images?.fixed_height_small?.url || item.images?.preview_gif?.url || item.images?.original?.url,
                  tab === "gif" ? "gif" : "sticker"
                )}
                className="relative rounded-xl overflow-hidden bg-slate-50 hover:ring-2 ring-teal-500/60 hover:shadow-lg transition-all cursor-pointer group active:scale-95"
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
            <p className="text-[10px] text-slate-400 font-medium">Sin resultados</p>
            <button
              onClick={() => { setQuery(""); loadContent(); }}
              className="text-[9px] text-teal-600 font-bold hover:underline cursor-pointer"
            >
              Ver tendencias
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import {
  searchGifs,
  getTrendingGifs,
  searchStickers,
  getTrendingStickers,
  GiphyResult,
  GIF_CATEGORIES,
} from "../services/stickerService";

type Tab = "gif" | "sticker";

interface GifPickerProps {
  onSelect: (url: string, type: "gif" | "sticker") => void;
  onClose: () => void;
}

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [tab, setTab] = useState<Tab>("gif");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const searchTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    loadTrending();
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      loadTrending();
      return;
    }
    setLoading(true);
    searchTimer.current = window.setTimeout(async () => {
      const fn = tab === "gif" ? searchGifs : searchStickers;
      const results = await fn(query).catch(() => []);
      setItems(results);
      setLoading(false);
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, tab]);

  async function loadTrending() {
    setLoading(true);
    const fn = tab === "gif" ? getTrendingGifs : getTrendingStickers;
    const results = await fn(30).catch(() => []);
    setItems(results);
    setLoading(false);
  }

  function handleCategoryClick(cat: string) {
    setQuery(cat);
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.15)] max-h-[65%] animate-slide-up border-t border-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setTab("gif"); setQuery(""); }}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all ${
              tab === "gif" ? "bg-[#0a4d52] text-white" : "text-slate-500 bg-slate-100"
            }`}
          >
            GIFs
          </button>
          <button
            onClick={() => { setTab("sticker"); setQuery(""); }}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all ${
              tab === "sticker" ? "bg-[#0a4d52] text-white" : "text-slate-500 bg-slate-100"
            }`}
          >
            Stickers
          </button>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative w-32">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="w-full bg-slate-100 rounded-lg py-1.5 pl-7 pr-6 text-[10px] outline-none placeholder-slate-400"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Categories */}
      {!query.trim() && tab === "gif" && (
        <div className="flex gap-1.5 px-3 py-1.5 overflow-x-auto shrink-0 scrollbar-none border-b border-slate-50">
          {GIF_CATEGORIES.map((cat) => (
            <button
              key={cat.name}
              onClick={() => handleCategoryClick(cat.name)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-bold whitespace-nowrap transition-all bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              <span>{cat.emoji}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-5 h-5 border-2 border-[#0a4d52] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(
                  item.images?.fixed_height_small?.url || item.images?.preview_gif?.url || item.images?.original?.url,
                  tab === "gif" ? "gif" : "sticker"
                )}
                className="relative rounded-lg overflow-hidden bg-slate-50 hover:ring-2 ring-[#0a4d52] transition-all cursor-pointer group"
                style={{ aspectRatio: tab === "gif" ? "16/9" : "1" }}
              >
                <img
                  src={item.images?.fixed_height_small?.url || item.images?.preview_gif?.url}
                  alt={item.title || ""}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-20 text-slate-400">
            <p className="text-[10px] font-medium">Sin resultados</p>
          </div>
        )}
      </div>
    </div>
  );
}

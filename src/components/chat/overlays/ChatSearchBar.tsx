import React from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";

interface ChatSearchBarProps {
  isOpen: boolean;
  query: string;
  resultCount: number;
  currentIndex: number;
  onQueryChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export default function ChatSearchBar({
  isOpen, query, resultCount, currentIndex,
  onQueryChange, onPrev, onNext, onClose,
}: ChatSearchBarProps) {
  if (!isOpen) return null;
  return (
    <div className="relative z-10 px-3 py-2 bg-white/90 backdrop-blur-sm border-b border-slate-200 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar mensajes..."
            value={query}
            onChange={e => { onQueryChange(e.target.value); }}
            className="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-white outline-none focus:border-teal-400 transition-colors"
            autoFocus
          />
        </div>
        {query.trim() && (
          <div className="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
            {resultCount > 0 ? (
              <>
                <span>{currentIndex + 1} de {resultCount}</span>
                <button
                  onClick={onPrev}
                  className="p-0.5 hover:bg-slate-100 rounded cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onNext}
                  className="p-0.5 hover:bg-slate-100 rounded cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <span className="text-slate-400">Sin resultados</span>
            )}
            <button
              onClick={onClose}
              className="p-0.5 hover:bg-slate-100 rounded cursor-pointer ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

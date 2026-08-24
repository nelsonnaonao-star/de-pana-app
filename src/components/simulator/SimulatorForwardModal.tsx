import React from "react";
import { Forward, Search, ArrowRight } from "lucide-react";
import { Chat } from "../../types";
import CachedImage from "../CachedImage";

interface SimulatorForwardModalProps {
  message: { text?: string; type: string; fileName?: string; mediaUrl?: string } | null;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  chats: Chat[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  onForwardMessage: (chatId: string) => Promise<void>;
}

export default function SimulatorForwardModal({
  message,
  onClose,
  searchQuery,
  onSearchChange,
  chats,
  searchRef,
  onForwardMessage,
}: SimulatorForwardModalProps) {
  if (!message) return null;

  const filteredChats = chats.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-4 w-[90vw] max-w-[360px] max-h-[80vh] overflow-y-auto shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Forward className="w-4 h-4 text-teal-600" />
          <h3 className="text-sm font-extrabold text-slate-900">Reenviar mensaje</h3>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Buscar chat..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-[11px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:border-tele-400 transition-colors"
            autoFocus
          />
        </div>
        <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => onForwardMessage(chat.id)}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors text-left"
            >
              {chat.avatar ? (
                <CachedImage src={chat.avatar} alt={chat.name} className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                  <span className="text-white font-bold text-[10px]">
                    {chat.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                  </span>
                </div>
              )}
              <span className="flex-1 text-[11px] font-bold text-slate-800 truncate">{chat.name}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
            </button>
          ))}
          {chats.length === 0 && (
            <p className="text-[10px] text-slate-400 text-center py-4">No hay chats para reenviar</p>
          )}
        </div>
      </div>
    </div>
  );
}

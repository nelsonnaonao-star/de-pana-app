import React, { useMemo, useState } from "react";
import { Search, X, Loader2, Send, Users } from "lucide-react";
import type { Chat } from "../types";
import type { Contact } from "../services/contacts";
import type { SharedImage } from "../services/shareReceiver";
import CachedImage from "./CachedImage";

interface ShareTargetModalProps {
  images: SharedImage[];
  chats: Chat[];
  contacts: Contact[];
  busy: boolean;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
  onSelectContact: (contact: Contact) => void;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function ShareTargetModal({
  images,
  chats,
  contacts,
  busy,
  onClose,
  onSelectChat,
  onSelectContact,
}: ShareTargetModalProps) {
  const [query, setQuery] = useState("");

  const filteredChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => c.name.toLowerCase().includes(q));
  }, [chats, query]);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withUser = contacts.filter((c) => !!c.contact_user_id);
    if (!q) return withUser;
    return withUser.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, query]);

  if (images.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-900">Enviar a un contacto</h3>
            <button
              onClick={onClose}
              disabled={busy}
              className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Cancelar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex gap-2 mt-3 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
            {images.map((image) => (
              <img
                key={image.path}
                src={image.url}
                alt=""
                className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            ))}
          </div>

          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar contacto o chat..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-[12px] rounded-xl border border-slate-200 bg-slate-50 outline-none focus:border-teal-400 transition-colors"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {busy && (
            <div className="flex items-center justify-center gap-2 py-6 text-teal-600 text-[12px] font-bold">
              <Loader2 className="w-4 h-4 animate-spin" />
              Enviando imagen...
            </div>
          )}

          {!busy && filteredChats.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                Conversaciones
              </p>
              {filteredChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors text-left"
                >
                  {chat.avatar ? (
                    <CachedImage src={chat.avatar} alt={chat.name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                      {chat.isGroup ? (
                        <Users className="w-4 h-4 text-white" />
                      ) : (
                        <span className="text-white font-bold text-[11px]">{initials(chat.name)}</span>
                      )}
                    </div>
                  )}
                  <span className="flex-1 text-[12px] font-bold text-slate-800 truncate">{chat.name}</span>
                  <Send className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </>
          )}

          {!busy && filteredContacts.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                Contactos
              </p>
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => onSelectContact(contact)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors text-left"
                >
                  {contact.avatar ? (
                    <CachedImage src={contact.avatar} alt={contact.name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                      <span className="text-white font-bold text-[11px]">{initials(contact.name)}</span>
                    </div>
                  )}
                  <span className="flex-1 text-[12px] font-bold text-slate-800 truncate">{contact.name}</span>
                  <Send className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </>
          )}

          {!busy && filteredChats.length === 0 && filteredContacts.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-8">
              {query ? "Sin resultados" : "No hay contactos ni conversaciones todavía"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

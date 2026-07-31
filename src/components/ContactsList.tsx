import React, { useState, useRef, useEffect } from "react";
import { Search, UserPlus, X, ChevronRight, Users, ArrowLeft, Trash2 } from "lucide-react";
import { Contact } from "../services/contacts";
import CachedImage from "./CachedImage";

interface ContactsListProps {
  contacts: Contact[];
  onSelectContact: (contact: Contact) => void;
  onAddContact: () => void;
  onDeleteContact: (contactId: string) => void;
  onBack?: () => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function ContactsList({ contacts, onSelectContact, onAddContact, onDeleteContact, onBack }: ContactsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [menuContact, setMenuContact] = useState<Contact | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuContact(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleContextMenu = (contact: Contact, e: React.MouseEvent) => {
    e.preventDefault();
    setMenuContact(contact);
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (contact: Contact) => {
    longPressTimer.current = setTimeout(() => {
      setMenuContact(contact);
      longPressTimer.current = null;
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const favorites = filtered.filter((c) => c.is_favorite);
  const others = filtered.filter((c) => !c.is_favorite);

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="p-1 text-teal-300 hover:text-white transition-all cursor-pointer">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h3 className="text-sm font-black tracking-tight">Contactos</h3>
          </div>
          <button
            onClick={onAddContact}
            className="p-1.5 hover:bg-white/10 rounded-full transition-all cursor-pointer"
            title="Agregar contacto"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-teal-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar contacto..."
            className="w-full bg-white/10 border border-white/20 text-white text-sm pl-9 pr-3 py-2.5 rounded-xl outline-none placeholder-teal-200/60 focus:bg-white/15 focus:border-teal-400/50 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-300 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3 mt-4">
            <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
              <Users className="w-7 h-7 text-teal-500" />
            </div>
            <p className="text-sm font-bold text-slate-700">
              {searchQuery ? "Sin resultados" : "No tienes contactos"}
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
              {searchQuery
                ? "Prueba con otro nombre o número"
                : "Agrega contactos para empezar a chatear con ellos en Red On."}
            </p>
          </div>
        )}

        {favorites.length > 0 && (
          <div className="mb-4">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-2">Favoritos</h4>
            <div className="space-y-0.5">
              {favorites.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onClick={onSelectContact}
                  onContextMenu={(e) => handleContextMenu(contact, e)}
                  onTouchStart={() => handleTouchStart(contact)}
                  onTouchEnd={handleTouchEnd}
                />
              ))}
            </div>
          </div>
        )}

        {others.length > 0 && (
          <div>
            {favorites.length > 0 && (
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-2">Todos</h4>
            )}
            <div className="space-y-0.5">
              {others.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onClick={onSelectContact}
                  onContextMenu={(e) => handleContextMenu(contact, e)}
                  onTouchStart={() => handleTouchStart(contact)}
                  onTouchEnd={handleTouchEnd}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {menuContact && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 py-1 min-w-[180px]"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            onClick={() => {
              onDeleteContact(menuContact.id);
              setMenuContact(null);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Eliminar contacto
          </button>
        </div>
      )}
    </div>
  );
}

function ContactRow({
  contact, onClick, onContextMenu, onTouchStart, onTouchEnd
}: {
  contact: Contact;
  onClick: (c: Contact) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
}) {
  const avatarColors = [
    "from-teal-400 to-emerald-600",
    "from-blue-400 to-indigo-600",
    "from-purple-400 to-pink-600",
    "from-amber-400 to-orange-600",
    "from-rose-400 to-red-600",
    "from-cyan-400 to-teal-600",
  ];
  const colorIndex = contact.name.length % avatarColors.length;

  return (
    <button
      onClick={() => onClick(contact)}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="w-full bg-white rounded-xl p-3 flex items-center gap-3 hover:shadow-md hover:bg-slate-50 transition-all text-left cursor-pointer border border-transparent hover:border-slate-200"
    >
      <div className={`w-11 h-11 rounded-full overflow-hidden bg-gradient-to-br ${avatarColors[colorIndex]} shrink-0 shadow-sm flex items-center justify-center`}>
        {contact.avatar ? (
          <CachedImage src={contact.avatar} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-white font-black text-sm">{getInitials(contact.name)}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">{contact.name}</p>
        <p className="text-[10px] text-slate-500 font-mono">
          {contact.phone || (contact.contact_user_id ? "En Red On" : "Sin teléfono")}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </button>
  );
}

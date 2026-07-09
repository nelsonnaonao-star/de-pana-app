import React, { useState, useEffect } from "react";
import {
  ArrowLeft, Users, RefreshCw, Smartphone, UserPlus,
  ChevronRight, Loader2, Search, X
} from "lucide-react";
import { syncDeviceContacts, searchByPhone, MatchedProfile } from "../services/device-contacts";

interface SyncedContactsProps {
  currentUserId: string;
  onBack: () => void;
  onStartChat: (profile: MatchedProfile) => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function SyncedContacts({ currentUserId, onBack, onStartChat }: SyncedContactsProps) {
  const [contacts, setContacts] = useState<MatchedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MatchedProfile[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (searchQuery.length >= 4) {
      setSearching(true);
      const timer = setTimeout(async () => {
        const results = await searchByPhone(searchQuery);
        setSearchResults(results);
        setSearching(false);
      }, 400);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  async function handleSync() {
    setLoading(true);
    const matched = await syncDeviceContacts();
    setContacts(matched);
    setSynced(true);
    setLoading(false);
  }

  const displayList = searchQuery.length >= 4 ? searchResults : contacts;

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 flex items-center gap-3 z-10 shadow-sm">
        <button onClick={onBack} className="p-1 text-teal-300 hover:text-white transition-all cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h3 className="text-sm font-black tracking-tight">Contactos Red On</h3>
      </div>

      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por número de teléfono..."
            className="w-full bg-white border border-slate-200 text-slate-800 text-sm pl-9 pr-9 py-3 rounded-xl outline-none focus:border-teal-400/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-2 shrink-0">
        {!synced ? (
          <button
            onClick={handleSync}
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-[#0a4d52] to-[#10646a] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-teal-500/20 transition-all disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {loading ? "Sincronizando..." : "Sincronizar Contactos del Teléfono"}
          </button>
        ) : (
          <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-2 text-[12px] text-teal-800 font-semibold">
              <Smartphone className="w-4 h-4" />
              {contacts.length} contacto{contacts.length !== 1 ? "s" : ""} en Red On
            </div>
            <button
              onClick={handleSync}
              disabled={loading}
              className="text-[11px] text-teal-600 hover:text-teal-800 font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5">
        {!synced && !searchQuery && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3 mt-4">
            <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
              <Users className="w-7 h-7 text-teal-500" />
            </div>
            <p className="text-sm font-bold text-slate-700">Descubre quiénes están en Red On</p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
              Sincroniza tu agenda para ver qué contactos ya usan la aplicación y empieza a chatear al instante.
            </p>
          </div>
        )}

        {synced && displayList.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3 mt-4">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
              <Smartphone className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm font-bold text-slate-600">Ningún contacto usa Red On aún</p>
            <p className="text-[11px] text-slate-500">
              Invita a tus amigos a descargar la app para empezar a chatear.
            </p>
          </div>
        )}

        {displayList.map((profile) => (
          <button
            key={profile.id}
            onClick={() => onStartChat(profile)}
            className="w-full bg-white rounded-xl p-3 flex items-center gap-3 hover:shadow-md hover:bg-slate-50 transition-all text-left cursor-pointer border border-transparent hover:border-slate-200"
          >
            <div className="w-11 h-11 rounded-full overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 shrink-0 shadow-sm flex items-center justify-center">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-black text-sm">{getInitials(profile.contactName || profile.name)}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">
                {profile.contactName || profile.name}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">
                {profile.phone_number}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

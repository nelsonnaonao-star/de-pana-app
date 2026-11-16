import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft, Users, RefreshCw, Smartphone, UserPlus,
  ChevronRight, Loader2, Search, X
} from "lucide-react";
import {
  readDeviceContacts,
  matchContactsWithSupabase,
  searchByPhone,
  hasContactPermission,
  lastDigits,
  DeviceContactsError,
  MatchedProfile,
} from "../services/device-contacts";
import CachedImage from "./CachedImage";
import {
  getContacts,
  addContact,
  linkContactToProfile,
  deleteContactsByIds,
  toggleFavorite,
  type Contact,
} from "../services/contacts";
import { digitsOnly } from "../utils/phone";
import { useSupabase } from "../contexts/SupabaseContext";

interface SyncedContactsProps {
  currentUserId: string;
  onBack: () => void;
  onStartChat: (profile: MatchedProfile) => void;
  onContactsChanged?: () => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function normalizeName(name?: string): string {
  return (name || "").trim().toLowerCase();
}

function phoneKey(phone?: string): string {
  const digits = digitsOnly(phone || "");
  return digits ? lastDigits(digits, 10) : "";
}

export default function SyncedContacts({ currentUserId, onBack, onStartChat, onContactsChanged }: SyncedContactsProps) {
  const { contacts: savedContacts } = useSupabase();
  const [contacts, setContacts] = useState<MatchedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [linkedCount, setLinkedCount] = useState(0);
  const [syncError, setSyncError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MatchedProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const autoSyncStarted = useRef(false);

  // Hidrata la pantalla con los contactos WEPA ya guardados (vienen del
  // contexto, que a su vez se hidrata de SQLite al arrancar), para no arrancar
  // vacía ni obligar a re-escanear. Si el permiso ya está concedido, el
  // escaneo se hace solo al abrir.
  useEffect(() => {
    if (synced) return;
    const seen = new Set<string>();
    const mapped: MatchedProfile[] = [];
    for (const c of savedContacts) {
      if (!c.contact_user_id || seen.has(c.contact_user_id)) continue;
      seen.add(c.contact_user_id);
      mapped.push({
        id: c.contact_user_id,
        username: "",
        name: c.name,
        phone_number: c.phone || "",
        avatar_url: c.avatar || "",
        contactName: c.name,
      });
    }
    if (mapped.length === 0) return;
    setContacts(mapped);
    setSynced(true);
  }, [savedContacts]);

  useEffect(() => {
    if (searchQuery.length >= 4) {
      setSearching(true);
      setSearchError("");
      const timer = setTimeout(async () => {
        try {
          const results = await searchByPhone(searchQuery);
          setSearchResults(results);
        } catch (e) {
          console.warn("[SYNC-CONTACTS] search error", { error: e });
          setSearchResults([]);
          setSearchError(e instanceof Error ? e.message : "No se pudo buscar ese número.");
        } finally {
          setSearching(false);
        }
      }, 400);
      return () => clearTimeout(timer);
    }

    setSearchResults([]);
    setSearchError("");
    setSearching(false);
  }, [searchQuery]);

  const handleSync = useCallback(async () => {
    setLoading(true);
    setSyncError("");
    setAddedCount(0);
    setLinkedCount(0);
    try {
      const deviceList = await readDeviceContacts();
      const matched = await matchContactsWithSupabase(deviceList);
      setContacts(matched);
      setSynced(true);

      // Guarda en la lista los contactos que ya usan WEPA y vincula las filas
      // externas que ya existían con ese mismo teléfono, sin duplicarlas.
      try {
        const existing = await getContacts(currentUserId);
        const existingIds = new Set<string>();
        const unlinkedByPhone = new Map<string, Contact[]>();

        for (const c of existing) {
          if (c.contact_user_id) {
            existingIds.add(c.contact_user_id);
            continue;
          }
          const key = phoneKey(c.phone);
          if (!key) continue;
          const rows = unlinkedByPhone.get(key) || [];
          rows.push(c);
          unlinkedByPhone.set(key, rows);
        }

        let added = 0;
        let linked = 0;
        let failed = 0;

        for (const profile of matched) {
          if (profile.id === currentUserId) continue;
          if (existingIds.has(profile.id)) continue;

          const key = phoneKey(profile.phone_number);
          const candidates = key ? unlinkedByPhone.get(key) || [] : [];

          if (candidates.length > 0) {
            const profileName = normalizeName(profile.contactName || profile.name);
            const primary =
              candidates.find((c) => normalizeName(c.name) === profileName) || candidates[0];

            try {
              await linkContactToProfile(currentUserId, primary, {
                id: profile.id,
                name: profile.name,
                avatar_url: profile.avatar_url,
                phone_number: profile.phone_number,
              });

              // Si el favorito estaba en otra fila duplicada, lo conservamos.
              if (candidates.some((c) => c.is_favorite) && !primary.is_favorite) {
                try {
                  await toggleFavorite(primary.id, true, currentUserId);
                } catch (e) {
                  console.warn("[SYNC-CONTACTS] favorite merge failed", { error: e });
                }
              }

              linked++;
              existingIds.add(profile.id);
              unlinkedByPhone.delete(key);

              // Limpia solo duplicados con el mismo nombre; si el usuario tiene
              // dos etiquetas distintas para el mismo número, no se toca nada.
              const duplicateIds = candidates
                .filter(
                  (c) =>
                    c.id !== primary.id &&
                    normalizeName(c.name) === normalizeName(primary.name)
                )
                .map((c) => c.id);
              if (duplicateIds.length > 0) {
                try {
                  await deleteContactsByIds(currentUserId, duplicateIds);
                } catch (e) {
                  console.warn("[SYNC-CONTACTS] duplicate cleanup failed", { error: e });
                }
              }
            } catch (e) {
              failed++;
              console.warn("[SYNC-CONTACTS] linkContactToProfile failed", {
                error: e,
                id: profile.id,
              });
            }
            continue;
          }

          try {
            await addContact(
              currentUserId,
              profile.id,
              profile.contactName || profile.name,
              profile.avatar_url,
              profile.phone_number
            );
            added++;
            existingIds.add(profile.id);
          } catch (e) {
            failed++;
            console.warn("[SYNC-CONTACTS] addContact failed", { error: e, id: profile.id });
          }
        }

        setAddedCount(added);
        setLinkedCount(linked);
        if (failed > 0) {
          setSyncError("Algunos contactos no se pudieron guardar. Intenta de nuevo.");
        }
        if (added + linked > 0) onContactsChanged?.();
      } catch (e) {
        console.warn("[SYNC-CONTACTS] contact persistence error", { error: e });
        setSyncError("No se pudieron guardar los contactos en tu lista");
      }
    } catch (e) {
      console.warn("[SYNC-CONTACTS] sync error", { error: e });
      setSyncError(
        e instanceof DeviceContactsError ? e.message : "No se pudo sincronizar la agenda"
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId, onContactsChanged]);

  const handleSyncRef = useRef(handleSync);
  useEffect(() => {
    handleSyncRef.current = handleSync;
  }, [handleSync]);

  // Sincroniza sola al abrir la pantalla, pero solo si el permiso ya estaba
  // concedido. Si no, se muestra el botón para pedirlo explícitamente.
  useEffect(() => {
    if (autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    hasContactPermission().then((granted) => {
      if (granted) void handleSyncRef.current();
    });
  }, []);

  const displayList = searchQuery.length >= 4 ? searchResults : contacts;

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 flex items-center gap-3 z-10 shadow-sm">
        <button onClick={onBack} className="p-1 text-teal-300 hover:text-white transition-all cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h3 className="text-sm font-black tracking-tight">Contactos WEPA</h3>
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
        {searchError && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-[12px] text-red-700 font-semibold">
            {searchError}
          </div>
        )}
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
              {contacts.length} contacto{contacts.length !== 1 ? "s" : ""} en WEPA
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
        {addedCount > 0 && (
          <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-[12px] text-emerald-800 font-semibold">
            {addedCount === 1 ? "1 contacto" : `${addedCount} contactos`} agregado{addedCount !== 1 ? "s" : ""} a tu lista
          </div>
        )}
        {linkedCount > 0 && (
          <div className="mt-2 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 text-[12px] text-teal-800 font-semibold">
            {linkedCount === 1
              ? "1 contacto de tu agenda ahora está vinculado a WEPA"
              : `${linkedCount} contactos de tu agenda ahora están vinculados a WEPA`}
          </div>
        )}
        {syncError && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-[12px] text-red-700 font-semibold">
            {syncError}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5">
        {!synced && !searchQuery && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3 mt-4">
            <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
              <Users className="w-7 h-7 text-teal-500" />
            </div>
            <p className="text-sm font-bold text-slate-700">Descubre quiénes están en WEPA</p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
              Sincroniza tu agenda para ver qué contactos ya usan la aplicación y empieza a chatear al instante.
            </p>
          </div>
        )}

        {synced && !searching && !searchError && displayList.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3 mt-4">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
              {searchQuery.length >= 4 ? (
                <Search className="w-6 h-6 text-slate-400" />
              ) : (
                <Smartphone className="w-6 h-6 text-slate-400" />
              )}
            </div>
            <p className="text-sm font-bold text-slate-600">
              {searchQuery.length >= 4
                ? "No encontramos ese número en WEPA"
                : "Ningún contacto usa WEPA aún"}
            </p>
            <p className="text-[11px] text-slate-500">
              {searchQuery.length >= 4
                ? "Verifica que el número tenga al menos 7 dígitos o invita a esa persona a WEPA."
                : "Invita a tus amigos a descargar la app para empezar a chatear."}
            </p>
          </div>
        )}

        {displayList.map((profile) => (
          <button
            key={profile.id}
            onClick={() => onStartChat(profile)}
            className="w-full bg-white rounded-xl p-3 flex items-center gap-3 hover:shadow-md hover:bg-slate-50 transition-all text-left cursor-pointer border border-transparent hover:border-slate-200"
          >
            <div className="relative shrink-0" style={{ width: 44, height: 44 }}>
              <div style={{ borderRadius: '62% 38% 55% 45% / 45% 55% 40% 60%', background: 'conic-gradient(from 0deg, #5EB7FF, #C65EFF, #4ADE80, #5EB7FF)', padding: 2 }}>
                <div className="rounded-[62%_38%_55%_45%/45%_55%_40%_60%] overflow-hidden" style={{ width: 40, height: 40 }}>
                  {profile.avatar_url ? (
                    <CachedImage src={profile.avatar_url} alt={profile.contactName || profile.name} className="w-full h-full rounded-[62%_38%_55%_45%/45%_55%_40%_60%] object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full rounded-[62%_38%_55%_45%/45%_55%_40%_60%] overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                      <span className="text-white font-black text-sm">
                        {(profile.contactName || profile.name).split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
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

import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiUrl } from "../lib/api";
import {
  ArrowLeft, Phone, User, Check, Loader2, UserPlus, X, Shield, Smartphone, ExternalLink
} from "lucide-react";

interface AddContactProps {
  currentUserId: string;
  onBack: () => void;
  onContactAdded: (name: string, avatar: string) => void;
}

interface FoundUser {
  id: string;
  name: string;
  username?: string;
  phone_number?: string;
  avatar?: string;
  avatar_url?: string;
  bio?: string;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `+${digits.slice(0, 1)} ${digits.slice(1, 3)} ${digits.slice(3)}`.trim();
  if (digits.length <= 10) return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`.trim();
  return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)} ${digits.slice(10, 12)}`.trim();
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function AddContact({ currentUserId, onBack, onContactAdded }: AddContactProps) {
  const [phoneRaw, setPhoneRaw] = useState("");
  const [contactName, setContactName] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const cleanDigits = phoneRaw.replace(/\D/g, "").trim();

  const doSearch = useCallback(async (digits: string) => {
    if (digits.length < 7) {
      setFoundUser(null);
      setNotFound(false);
      setError("");
      return;
    }

    setSearching(true);
    setError("");
    setFoundUser(null);
    setNotFound(false);

    try {
      const res = await fetch(apiUrl("/api/data/lookup-profile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });

      if (!res.ok) {
        if (res.status === 404) {
          setNotFound(true);
        } else {
          const err = await res.json().catch(() => ({}));
          setError(err.error || "Error al buscar");
        }
        return;
      }

      const profile = await res.json();
      setFoundUser(profile);
      if (!contactName) setContactName(profile.name);
    } catch (e: any) {
      setError(e.message || "Error de conexión");
    } finally {
      setSearching(false);
    }
  }, [contactName]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const digits = phoneRaw.replace(/\D/g, "").trim();
    if (digits.length >= 7) {
      debounceRef.current = setTimeout(() => doSearch(digits), 500);
    } else {
      setFoundUser(null);
      setNotFound(false);
      setError("");
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [phoneRaw, doSearch]);

  async function handleAddContact() {
    if (!foundUser) return;
    setAdding(true);

    try {
      await fetch(apiUrl("/api/data/create-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: foundUser.name,
          avatar: foundUser.avatar || foundUser.avatar_url || "",
          username: foundUser.username || "",
          phone: foundUser.phone_number || "",
          bio: foundUser.bio || "",
          profile_id: foundUser.id,
          admin_id: currentUserId,
        }),
      });

      await fetch(apiUrl("/api/data/add-contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUserId,
          contact_user_id: foundUser.id,
          name: contactName || foundUser.name,
          avatar: foundUser.avatar || foundUser.avatar_url || "",
          bio: foundUser.bio || "",
        }),
      });

      setAdded(true);
      onContactAdded(contactName || foundUser.name, foundUser.avatar || foundUser.avatar_url || "");
    } catch (e) {
      console.error("Add contact error:", e);
      setError("Error al agregar contacto");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 flex items-center gap-3 z-10 shadow-sm">
        <button onClick={onBack} className="p-1 text-teal-300 hover:text-white transition-colors cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h3 className="text-sm font-black tracking-tight">Agregar Contacto</h3>
      </div>

      {added ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center space-y-4 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto shadow-inner">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-black text-slate-800">Contacto agregado</p>
              <p className="text-[13px] text-slate-500">{contactName || foundUser?.name} ahora está en tu lista</p>
            </div>
            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 bg-slate-50 rounded-xl py-2 px-3">
              <Smartphone className="w-3.5 h-3.5" />
              Pueden chatear y compartir contenido de forma segura
            </div>
            <button
              onClick={onBack}
              className="w-full py-3 bg-gradient-to-r from-[#0a4d52] to-[#10646a] text-white rounded-xl text-xs font-bold hover:opacity-90 transition-all cursor-pointer shadow-sm"
            >
              Ir a Chats
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Smartphone className="w-3 h-3 text-teal-500" /> Número de teléfono
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">
                  <Phone className="w-4 h-4" />
                </div>
                <input
                  ref={inputRef}
                  type="tel"
                  value={formatPhone(phoneRaw)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "");
                    if (raw.length <= 12) setPhoneRaw(raw);
                  }}
                  placeholder="+58 412 1234567"
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm pl-10 pr-4 py-3.5 rounded-xl outline-none focus:border-teal-400/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                  </div>
                )}
              </div>
              {cleanDigits.length > 0 && cleanDigits.length < 7 && (
                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-amber-400" />
                  Ingresa al menos 7 dígitos para buscar
                </p>
              )}
            </div>

            {cleanDigits.length >= 7 && (
              <div className="space-y-1.5 pt-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <User className="w-3 h-3 text-teal-500" /> Nombre del contacto
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder={foundUser?.name || "Nombre para este contacto"}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm px-4 py-3 rounded-xl outline-none focus:border-teal-400/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                />
              </div>
            )}

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-700 font-medium flex items-start gap-2">
                <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                {error}
              </div>
            )}
          </div>

          {/* Found user card */}
          {foundUser && (
            <div className="bg-white rounded-2xl shadow-md p-5 space-y-4 animate-fade-in border border-teal-100">
              <div className="flex items-center gap-2 text-[10px] font-bold text-teal-700 bg-teal-50 px-3 py-1.5 rounded-full w-fit">
                <Shield className="w-3 h-3" />
                Usuario RED ON verificado
              </div>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 shrink-0 shadow-md flex items-center justify-center">
                  {foundUser.avatar || foundUser.avatar_url ? (
                    <img src={foundUser.avatar || foundUser.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-black text-lg">{getInitials(foundUser.name)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-800 truncate">{foundUser.name}</p>
                  {foundUser.username && (
                    <p className="text-[11px] text-teal-600 font-mono">@{foundUser.username}</p>
                  )}
                  {foundUser.bio && (
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{foundUser.bio}</p>
                  )}
                </div>
              </div>

              <div className="bg-gradient-to-r from-teal-50 to-emerald-50 rounded-xl p-3 flex items-center gap-2 text-[11px] text-slate-600 border border-teal-100/50">
                <ExternalLink className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                Este número usa RED ON. Pueden chatear y compartir contenido al instante.
              </div>

              <button
                onClick={handleAddContact}
                disabled={adding || !contactName.trim()}
                className="w-full py-3 bg-gradient-to-r from-[#0a4d52] to-[#10646a] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-teal-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {adding ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                {adding ? "Agregando..." : "Agregar a Contactos"}
              </button>
            </div>
          )}

          {/* Not found state */}
          {notFound && !searching && cleanDigits.length >= 7 && (
            <div className="bg-white rounded-2xl shadow-sm p-6 text-center space-y-3 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                <Smartphone className="w-6 h-6 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Número no registrado</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Este número no tiene cuenta en RED ON. Puedes invitar a esta persona a unirse.
                </p>
              </div>
              <button
                onClick={() => {
                  const encoded = encodeURIComponent(`¡Únete a RED ON! Descarga la app y chatea conmigo de forma segura. Mi código: ${currentUserId.slice(0, 8)}`);
                  window.open(`https://wa.me/${cleanDigits}?text=${encoded}`, "_blank");
                }}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Invitar por WhatsApp
              </button>
            </div>
          )}

          {/* Info tip */}
          {!phoneRaw && (
            <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
                <UserPlus className="w-5 h-5 text-teal-500" />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Ingresa el número de teléfono de la persona que quieres agregar.
                Si tiene RED ON, aparecerá automáticamente.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

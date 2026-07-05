import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiUrl } from "../lib/api";
import {
  ArrowLeft, Phone, User, Check, Loader2, UserPlus, X, Smartphone, ExternalLink, Shield
} from "lucide-react";
import { useSupabase } from "../contexts/SupabaseContext";

interface AddContactManualProps {
  currentUserId: string;
  currentUserPhone: string;
  onBack: () => void;
}

interface FoundProfile {
  id: string;
  name: string;
  username?: string;
  avatar_url?: string;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function AddContactManual({ currentUserId, currentUserPhone, onBack }: AddContactManualProps) {
  const { refreshContacts } = useSupabase();

  const [phoneRaw, setPhoneRaw] = useState("");
  const [contactName, setContactName] = useState("");
  const [checking, setChecking] = useState(false);
  const [foundProfile, setFoundProfile] = useState<FoundProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const cleanDigits = phoneRaw.replace(/\D/g, "").trim();

  const doCheck = useCallback(async (digits: string) => {
    if (digits.length < 7) {
      setFoundProfile(null);
      setNotFound(false);
      setError("");
      return;
    }

    const ownDigits = currentUserPhone.replace(/\D/g, "").trim();
    if (ownDigits && (digits === ownDigits || digits.slice(-10) === ownDigits.slice(-10))) {
      setError("No puedes agregarte a ti mismo como contacto");
      setFoundProfile(null);
      setNotFound(false);
      return;
    }

    setChecking(true);
    setError("");
    setFoundProfile(null);
    setNotFound(false);

    try {
      const res = await fetch(apiUrl("/api/data/check-phone"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Error al verificar número");
        return;
      }

      const data = await res.json();
      if (data.exists) {
        setFoundProfile(data.profile);
        if (!contactName) setContactName(data.profile.name);
        setNotFound(false);
      } else {
        setFoundProfile(null);
        setNotFound(true);
      }
    } catch (e: any) {
      setError(e.message || "Error de conexión");
    } finally {
      setChecking(false);
    }
  }, [contactName, currentUserPhone]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (cleanDigits.length >= 7) {
      debounceRef.current = setTimeout(() => doCheck(cleanDigits), 500);
    } else {
      setFoundProfile(null);
      setNotFound(false);
      if (error === "No puedes agregarte a ti mismo como contacto") setError("");
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [phoneRaw, doCheck, cleanDigits.length]);

  async function handleSave() {
    if (!contactName.trim() || cleanDigits.length < 7) return;

    setSaving(true);
    setError("");

    try {
      const body: any = {
        user_id: currentUserId,
        name: contactName.trim(),
        avatar: "",
      };

      if (foundProfile) {
        body.contact_user_id = foundProfile.id;
      } else {
        body.phone = cleanDigits;
      }

      const res = await fetch(apiUrl("/api/data/add-contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al guardar contacto");
      }

      await refreshContacts();
      setSaved(true);
      setTimeout(() => onBack(), 1500);
    } catch (e: any) {
      setError(e.message || "No se pudo guardar el contacto");
    } finally {
      setSaving(false);
    }
  }

  const canSave = contactName.trim().length > 0 && cleanDigits.length >= 7 && !error;

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 flex items-center gap-3 z-10 shadow-sm">
        <button onClick={onBack} className="p-1 text-teal-300 hover:text-white transition-colors cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h3 className="text-sm font-black tracking-tight">Agregar Contacto</h3>
      </div>

      {saved ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center space-y-4 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto shadow-inner">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-black text-slate-800">Contacto guardado</p>
              <p className="text-[13px] text-slate-500">{contactName.trim()} está en tu lista</p>
            </div>
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
                  value={phoneRaw}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d+]/g, "");
                    if (raw.length <= 13) setPhoneRaw(raw);
                    if (error) setError("");
                  }}
                  placeholder="04241305887"
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm pl-10 pr-10 py-3.5 rounded-xl outline-none focus:border-teal-400/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                />
                {checking && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                  </div>
                )}
              </div>

              {cleanDigits.length > 0 && cleanDigits.length < 7 && (
                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-amber-400" />
                  Ingresa al menos 7 dígitos
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <User className="w-3 h-3 text-teal-500" /> Nombre del contacto
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Nombre completo"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm px-4 py-3.5 rounded-xl outline-none focus:border-teal-400/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
              />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-700 font-medium flex items-start gap-2">
                <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                {error}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="w-full py-3.5 bg-gradient-to-r from-[#0a4d52] to-[#10646a] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-teal-500/20 transition-all disabled:opacity-40 cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {saving ? "Guardando..." : "Guardar Contacto"}
            </button>
          </div>

          {foundProfile && !error && (
            <div className="bg-white rounded-2xl shadow-md p-5 space-y-3 animate-fade-in border border-emerald-200">
              <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full w-fit">
                <Shield className="w-3 h-3" />
                Usa RED ON
              </div>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 shrink-0 shadow-md flex items-center justify-center">
                  {foundProfile.avatar_url ? (
                    <img src={foundProfile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-black text-lg">{getInitials(foundProfile.name)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-800 truncate">{foundProfile.name}</p>
                  {foundProfile.username && (
                    <p className="text-[11px] text-teal-600 font-mono">@{foundProfile.username}</p>
                  )}
                </div>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 flex items-center gap-2 text-[11px] text-slate-600 border border-emerald-100">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                Este número pertenece a un usuario de RED ON. Se agregará automáticamente a tus contactos.
              </div>
            </div>
          )}

          {notFound && !checking && cleanDigits.length >= 7 && !error && (
            <div className="bg-white rounded-2xl shadow-sm p-5 text-center space-y-3 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                <Smartphone className="w-6 h-6 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Este número no usa RED ON aún</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Se guardará como contacto externo. Cuando se una a RED ON, se vinculará automáticamente.
                </p>
              </div>
              <button
                onClick={() => {
                  const encoded = encodeURIComponent("¡Únete a RED ON! Descarga la app y chatea conmigo.");
                  window.open(`https://wa.me/${cleanDigits}?text=${encoded}`, "_blank");
                }}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Invitar por WhatsApp
              </button>
            </div>
          )}

          {!phoneRaw && (
            <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
              <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-3">
                <UserPlus className="w-5 h-5 text-teal-500" />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Ingresa el número de teléfono y el nombre de la persona que quieres agregar. Si usa RED ON, lo verás reflejado aquí.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

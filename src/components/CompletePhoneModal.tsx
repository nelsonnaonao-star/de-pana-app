import React, { useState } from "react";
import { Loader2, Phone, ShieldCheck, X } from "lucide-react";
import toast from "react-hot-toast";
import { updateMyPhone } from "../services/auth";
import { digitsOnly, normalizePhone } from "../utils/phone";

interface CompletePhoneModalProps {
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function CompletePhoneModal({ onClose, onSaved }: CompletePhoneModalProps) {
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const digits = digitsOnly(phone);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (digits.length < 7) {
      setError("Ingresa al menos 7 dígitos.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateMyPhone(phone);
      toast.success("Número guardado");
      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || "No se pudo guardar el número.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[85000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in"
      >
        <div className="bg-gradient-to-r from-[#0a4d52] to-[#10646a] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Phone className="w-4 h-4" />
            <span className="text-sm font-black tracking-tight">Completa tu número</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1 text-teal-200 hover:text-white transition-all disabled:opacity-40 cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="w-14 h-14 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6 text-teal-600" />
          </div>

          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-slate-800">Tu número es necesario para que te encuentren</p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Tus contactos usan su agenda para encontrarte en WEPA. Tu número no se muestra a otros usuarios.
            </p>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Teléfono móvil</label>
            <div className="mt-1.5 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 focus-within:border-teal-400/60 focus-within:ring-2 focus-within:ring-teal-500/10 transition-all">
              <Phone className="w-4 h-4 text-teal-500 shrink-0" />
              <input
                type="tel"
                inputMode="tel"
                autoFocus
                value={phone}
                onChange={(e) => {
                  setPhone(normalizePhone(e.target.value));
                  if (error) setError("");
                }}
                placeholder="+58 412 1234567"
                className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-800 placeholder:text-slate-400"
              />
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-[11px] font-semibold text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || digits.length < 7}
            className="w-full py-3 bg-gradient-to-r from-[#0a4d52] to-[#10646a] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-teal-500/20 transition-all disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
            {saving ? "Guardando..." : "Guardar número"}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-full py-2 text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-all disabled:opacity-40 cursor-pointer"
          >
            Ahora no
          </button>
        </div>
      </form>
    </div>
  );
}

import { useState } from "react";
import { Users, Eye, EyeOff, Lock, Check } from "lucide-react";
import { StoryAudience } from "../../hooks/useStatesManagement";
import { Contact } from "../../services/contacts";
import CachedImage from "../CachedImage";

interface StoryAudiencePickerProps {
  audience: StoryAudience;
  onChange: (a: StoryAudience) => void;
  contacts: Contact[];
}

const OPTIONS: { key: StoryAudience["tipo"]; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: "todos", label: "Todos mis contactos", desc: "Todos tus contactos mutuos", icon: <Users className="w-4 h-4" /> },
  { key: "solo", label: "Solo algunos", desc: "Solo las personas que elijas", icon: <Eye className="w-4 h-4" /> },
  { key: "ocultar", label: "Ocultar para algunos", desc: "Todos menos las que elijas", icon: <EyeOff className="w-4 h-4" /> },
  { key: "nadie", label: "Solo yo", desc: "Nadie puede verlo", icon: <Lock className="w-4 h-4" /> },
];

export default function StoryAudiencePicker({ audience, onChange, contacts }: StoryAudiencePickerProps) {
  const [showContacts, setShowContacts] = useState(false);

  const selectedIds = audience.tipo === "solo" || audience.tipo === "ocultar" ? audience.ids : [];

  const toggleId = (id: string) => {
    if (audience.tipo !== "solo" && audience.tipo !== "ocultar") return;
    const has = selectedIds.includes(id);
    const next = has ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    onChange({ tipo: audience.tipo, ids: next });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Audiencia del estado</span>
        {audience.tipo !== "todos" && (
          <span className="text-[8px] font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">Personalizado</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => onChange({ tipo: opt.key, ids: opt.key === "solo" || opt.key === "ocultar" ? [] : undefined })}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-left transition-all cursor-pointer ${
              audience.tipo === opt.key
                ? "bg-teal-50 border-teal-300 text-[#0a4d52]"
                : "bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span className={audience.tipo === opt.key ? "text-teal-600" : "text-slate-400"}>{opt.icon}</span>
            <span className="flex-1">
              <span className="block text-[9px] font-bold leading-tight">{opt.label}</span>
              <span className={`block text-[7.5px] leading-tight ${audience.tipo === opt.key ? "text-teal-700/70" : "text-slate-400"}`}>
                {opt.desc}
              </span>
            </span>
          </button>
        ))}
      </div>

      {(audience.tipo === "solo" || audience.tipo === "ocultar") && (
        <div>
          <button
            onClick={() => setShowContacts(v => !v)}
            className="w-full text-[9px] font-bold text-teal-600 hover:text-teal-700 py-1.5 flex items-center justify-center gap-1 cursor-pointer"
          >
            {showContacts ? "Ocultar lista" : "Elegir contactos..."} ({selectedIds.length} seleccionados)
          </button>
          {showContacts && (
            <div className="max-h-36 overflow-y-auto space-y-0.5 border-t border-slate-100 pt-1.5">
              {contacts.length === 0 && (
                <p className="text-[8px] text-slate-400 text-center py-2">No tienes contactos sincronizados aún.</p>
              )}
              {contacts.map(c => {
                const id = c.contact_user_id || c.id;
                if (!id) return null;
                const selected = selectedIds.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleId(id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      selected ? "bg-teal-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-slate-200 overflow-hidden shrink-0">
                      {c.avatar ? (
                        <CachedImage src={c.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[7px] font-bold text-slate-500">
                          {(c.name || "?").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span className={`flex-1 text-[9px] font-medium truncate ${selected ? "text-teal-700" : "text-slate-600"}`}>
                      {c.name}
                    </span>
                    {selected && <Check className="w-3 h-3 text-teal-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

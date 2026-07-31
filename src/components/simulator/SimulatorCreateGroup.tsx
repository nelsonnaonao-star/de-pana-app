import { ArrowLeft, Search, Check } from "lucide-react";

interface SimulatorCreateGroupProps {
  onBack: () => void;
  groupName: string;
  onGroupNameChange: (value: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  contacts: any[];
  selectedMembers: string[];
  onToggleMember: (id: string) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isAdminOnly: boolean;
  onToggleAdminOnly: () => void;
  onCreateGroup: () => void;
}

export default function SimulatorCreateGroup({
  onBack,
  groupName,
  onGroupNameChange,
  searchQuery,
  onSearchChange,
  contacts,
  selectedMembers,
  onToggleMember,
  isMuted,
  onToggleMute,
  isAdminOnly,
  onToggleAdminOnly,
  onCreateGroup,
}: SimulatorCreateGroupProps) {
  const filteredContacts = contacts.filter(
    (c) =>
      c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="bg-[#0a4d52] px-4 pt-5 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-teal-100" />
          </button>
          <div>
            <h3 className="text-sm font-bold text-white">Nuevo Grupo</h3>
            <p className="text-[10px] text-teal-200">{selectedMembers.length} participantes</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-100">
        <input
          type="text"
          placeholder="Nombre del grupo (opcional)"
          value={groupName}
          onChange={(e) => onGroupNameChange(e.target.value)}
          className="w-full bg-slate-100 text-slate-800 placeholder-slate-400 text-xs px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
        />
      </div>

      <div className="px-4 py-2 border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar contactos..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-slate-100 text-slate-800 placeholder-slate-400 text-xs pl-9 pr-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5">
        {filteredContacts.map((contact) => {
          const contactId = contact.contact_user_id || contact.id || "";
          const isSelected = selectedMembers.includes(contactId);
          return (
            <button
              key={contactId}
              onClick={() => onToggleMember(contactId)}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-teal-500 border-teal-500" : "border-slate-300"}`}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
              {contact.avatar ? (
                <img src={contact.avatar} alt={contact.name} className="w-9 h-9 rounded-full object-cover" loading="lazy" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                  <span className="text-white font-bold text-[10px]">
                    {(contact.name || "?").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
                  </span>
                </div>
              )}
              <div className="text-left">
                <p className="text-[11px] font-bold text-slate-800">{contact.name}</p>
                <p className="text-[9px] text-slate-400">{contact.phone || "Sin teléfono"}</p>
              </div>
            </button>
          );
        })}
        {contacts.length === 0 && (
          <p className="text-[10px] text-slate-400 text-center py-8">No hay contactos disponibles</p>
        )}
      </div>

      {selectedMembers.length >= 1 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-white space-y-2.5">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              <span className="text-[11px] font-semibold text-slate-700">Silenciar grupo</span>
            </div>
            <button
              onClick={onToggleMute}
              className={`w-9 h-5 rounded-full transition-colors relative ${isMuted ? "bg-teal-500" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isMuted ? "translate-x-4.5 left-0.5" : "left-0.5"}`}></span>
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="text-[11px] font-semibold text-slate-700">Solo admins pueden escribir</span>
            </div>
            <button
              onClick={onToggleAdminOnly}
              className={`w-9 h-5 rounded-full transition-colors relative ${isAdminOnly ? "bg-teal-500" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isAdminOnly ? "translate-x-4.5 left-0.5" : "left-0.5"}`}></span>
            </button>
          </label>

          <button
            onClick={onCreateGroup}
            className="w-full py-2.5 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-xl text-xs font-bold transition-colors"
          >
            Crear Grupo
          </button>
        </div>
      )}
    </div>
  );
}

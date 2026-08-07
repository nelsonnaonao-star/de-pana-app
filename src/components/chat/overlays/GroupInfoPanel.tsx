import React, { useRef, useState } from "react";
import { X, Check, Loader2, Camera, Trash2, BellOff, Bell } from "lucide-react";
import { MuteDuration } from "../../../services/chats";

export interface GroupMember {
  profile_id: string;
  name?: string;
  avatar?: string;
}

export interface AddMemberResult {
  id: string;
  name: string;
  avatar?: string;
}

interface GroupInfoPanelProps {
  isOpen: boolean;
  chatName: string;
  groupAvatar?: string;
  currentUserId: string;
  groupMembers: GroupMember[];
  editingName: boolean;
  groupNameDraft: string;
  showAddMember: boolean;
  addMemberQuery: string;
  addMemberResults: AddMemberResult[];
  addingMember: boolean;
  onChangePhoto: (dataUrl: string) => void;
  onClose: () => void;
  onStartEditName: () => void;
  onNameDraftChange: (value: string) => void;
  onSaveName: () => void;
  onCancelEditName: () => void;
  onToggleAddMember: () => void;
  onAddMemberQueryChange: (value: string) => void;
  onAddMember: (profileId: string) => void;
  onRemoveMember: (profileId: string) => void;
  onLeaveGroup: () => void;
  onOpenDeleteConfirm: () => void;
  isMuted: boolean;
  muteUntil: string | null;
  muting: boolean;
  onMute: (duration: MuteDuration) => void;
  onUnmute: () => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function GroupInfoPanel({
  isOpen, chatName, groupAvatar, currentUserId, groupMembers,
  editingName, groupNameDraft, showAddMember,
  addMemberQuery, addMemberResults, addingMember,
  onChangePhoto,
  onClose, onStartEditName, onNameDraftChange, onSaveName, onCancelEditName,
  onToggleAddMember, onAddMemberQueryChange, onAddMember, onRemoveMember,
  onLeaveGroup, onOpenDeleteConfirm,
  isMuted, muteUntil, muting, onMute, onUnmute,
}: GroupInfoPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [memberToRemove, setMemberToRemove] = useState<GroupMember | null>(null);
  const [showMuteOptions, setShowMuteOptions] = useState(false);
  if (!isOpen) return null;
  const localGroupName = chatName;

  const MUTE_OPTIONS: Array<{ value: MuteDuration; label: string }> = [
    { value: "8h", label: "8 horas" },
    { value: "12h", label: "12 horas" },
    { value: "24h", label: "24 horas" },
    { value: "always", label: "Siempre" },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChangePhoto(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-[420px] rounded-t-3xl shadow-lg animate-slide-up max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-bold text-slate-800">Info del grupo</h3>
          <button
            onClick={() => { onClose(); onCancelEditName(); }}
            className="p-1.5 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="flex flex-col items-center py-5 border-b border-slate-100 shrink-0">
          <div className="relative mb-3">
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
            <div className="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
              {groupAvatar ? (
                <img src={groupAvatar} alt={localGroupName} className="w-full h-full object-cover" />
              ) : (
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center shadow-md border-2 border-white cursor-pointer hover:bg-teal-600 transition-colors"
            >
              <Camera className="w-3 h-3 text-white" />
            </button>
          </div>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={groupNameDraft}
                onChange={e => onNameDraftChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onSaveName(); if (e.key === "Escape") onCancelEditName(); }}
                className="text-sm font-bold text-slate-800 text-center border-b-2 border-teal-500 outline-none bg-slate-50 px-2 py-1 rounded"
                autoFocus
              />
              <button onClick={onSaveName} className="p-1 text-teal-600 hover:bg-teal-50 rounded cursor-pointer">
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-800">{localGroupName}</p>
              <button onClick={onStartEditName} className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-100 rounded cursor-pointer">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-0.5">{groupMembers.length} miembros</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 border rounded-xl divide-y divide-slate-100">
            {!isMuted ? (
              <button
                onClick={() => setShowMuteOptions(v => !v)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold text-slate-800">Silenciar grupo</p>
                  <p className="text-[9px] text-slate-400">Silencia las notificaciones para todos los miembros</p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center text-rose-500">
                  <BellOff className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold text-slate-800">Grupo silenciado</p>
                  <p className="text-[9px] text-slate-400">{muteUntil ? `Hasta ${new Date(muteUntil).toLocaleString()}` : "Siempre"}</p>
                </div>
                <button
                  onClick={onUnmute}
                  disabled={muting}
                  className="px-2.5 py-1 text-[10px] font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {muting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Activar"}
                </button>
              </div>
            )}
            {showMuteOptions && !isMuted && (
              <div className="p-2 grid grid-cols-2 gap-1.5 animate-fade-in">
                {MUTE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { onMute(opt.value); setShowMuteOptions(false); }}
                    disabled={muting}
                    className="py-2 text-[11px] font-bold text-slate-700 bg-slate-50 hover:bg-teal-50 hover:text-teal-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase">{groupMembers.length} miembros</p>
            <button
              onClick={onToggleAddMember}
              className="flex items-center gap-1 text-[10px] font-bold text-teal-600 hover:text-teal-700 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              Agregar
            </button>
          </div>

          {showAddMember && (
            <div className="mb-3 p-2 bg-slate-50 rounded-xl border border-slate-200">
              <input
                type="text"
                placeholder="Buscar por nombre o teléfono..."
                value={addMemberQuery}
                onChange={e => onAddMemberQueryChange(e.target.value)}
                className="w-full text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 outline-none focus:border-teal-400 bg-white"
                autoFocus
              />
              {addMemberResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {addMemberResults.map(r => (
                    <button
                      key={r.id}
                      onClick={() => onAddMember(r.id)}
                      disabled={addingMember}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-teal-50 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {r.avatar ? (
                        <img src={r.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
                          <span className="text-white font-bold text-[8px]">
                            {r.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                          </span>
                        </div>
                      )}
                      <span className="flex-1 text-left truncate">{r.name}</span>
                      {addingMember ? <Loader2 className="w-3 h-3 animate-spin text-teal-600" /> : <span className="text-teal-600 font-bold">+</span>}
                    </button>
                  ))}
                </div>
              )}
              {addMemberQuery.trim().length >= 2 && addMemberResults.length === 0 && (
                <p className="text-[10px] text-slate-400 text-center py-2">Sin resultados</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            {groupMembers.map(m => (
              <div key={m.profile_id} className="flex items-center gap-3 py-1.5 px-1 rounded-lg hover:bg-slate-50 group">
                {m.avatar ? (
                  <img src={m.avatar} className="w-8 h-8 rounded-full object-cover" alt="" loading="lazy" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shrink-0">
                    <span className="text-white font-bold text-[10px]">
                      {m.name ? m.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2) : "?"}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-semibold text-slate-800 truncate">{m.name || "Usuario"}</p>
                    {m.profile_id === currentUserId && (
                      <span className="text-[8px] font-bold text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded-full">Tú</span>
                    )}
                  </div>
                </div>
                {m.profile_id !== currentUserId && (
                  <button
                    onClick={() => setMemberToRemove(m)}
                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors cursor-pointer"
                    title="Eliminar del grupo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {groupMembers.length === 0 && (
              <p className="text-[11px] text-slate-400 text-center py-4">Cargando miembros...</p>
            )}
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 shrink-0 space-y-2">
          <button
            onClick={onLeaveGroup}
            className="w-full py-2.5 text-[11px] font-bold text-amber-600 bg-amber-50 rounded-xl hover:bg-amber-100 transition-colors cursor-pointer"
          >
            Salir del grupo
          </button>
          <button
            onClick={onOpenDeleteConfirm}
            className="w-full py-2.5 text-[11px] font-bold text-rose-500 bg-rose-50 rounded-xl hover:bg-rose-100 transition-colors cursor-pointer"
          >
            Eliminar grupo
          </button>
        </div>
      </div>

      {memberToRemove && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setMemberToRemove(null)}>
          <div className="bg-white rounded-2xl shadow-lg w-[280px] p-5 text-center animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 mb-1">Eliminar miembro</h3>
            <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
              ¿Eliminar a <span className="font-semibold text-slate-700">{memberToRemove.name || "este miembro"}</span> del grupo?
              Ya no podrá ver los mensajes ni enviar en este grupo.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setMemberToRemove(null)}
                className="flex-1 py-2 text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onRemoveMember(memberToRemove.profile_id);
                  setMemberToRemove(null);
                }}
                className="flex-1 py-2 text-[11px] font-semibold text-white bg-rose-500 rounded-xl hover:bg-rose-600 transition-colors cursor-pointer"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

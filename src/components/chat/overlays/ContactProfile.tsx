import React from "react";
import { X, Phone, User, Shield, Maximize2, Pencil, Check, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import CachedImage from "../../CachedImage";
import ImageLightbox from "./ImageLightbox";
import { updateContactName } from "../../../services/contacts";

export interface ContactProfileData {
  id: string;
  name: string;
  phone?: string;
  avatar?: string;
  bio?: string;
  username?: string;
  contactUserId?: string;
  contactId?: string;
}

interface ContactProfileProps {
  isOpen: boolean;
  profile: ContactProfileData | null;
  onClose: () => void;
  currentUserId?: string;
  onNameUpdated?: (newName: string) => void;
  autoEdit?: boolean;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function ContactProfile({ isOpen, profile, onClose, currentUserId, onNameUpdated, autoEdit }: ContactProfileProps) {
  const [showPhoto, setShowPhoto] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [savingName, setSavingName] = React.useState(false);
  const [nameError, setNameError] = React.useState("");

  React.useEffect(() => {
    if (isOpen && profile && autoEdit) {
      setEditName(profile.name || "");
      setNameError("");
      setEditingName(true);
    } else if (!isOpen) {
      setEditingName(false);
      setEditName("");
      setNameError("");
    }
  }, [isOpen, profile, autoEdit]);

  if (!isOpen || !profile) return null;

  const canEdit = Boolean(currentUserId);

  const startEdit = () => {
    setEditName(profile.name || "");
    setNameError("");
    setEditingName(true);
  };

  const cancelEdit = () => {
    setEditingName(false);
    setEditName("");
    setNameError("");
  };

  const saveName = async () => {
    const newName = (editName || "").trim();
    if (!newName) {
      setNameError("El nombre no puede estar vacío");
      return;
    }
    if (!currentUserId) return;
    setSavingName(true);
    setNameError("");
    try {
      await updateContactName(
        currentUserId,
        profile.contactUserId || null,
        newName,
        profile.contactId
      );
      setEditingName(false);
      onNameUpdated?.(newName);
      toast.success("Nombre actualizado correctamente");
      onClose();
    } catch (e: any) {
      setNameError(e?.message || "No se pudo guardar el nombre");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[200]" onClick={onClose} />
      <div className="fixed inset-x-4 top-[15%] z-[210] animate-fade-in">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] px-5 pt-8 pb-12 relative">
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-[62%_38%_55%_45%/45%_55%_40%_60%] overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 shadow-lg border-2 border-white/30 flex items-center justify-center mb-3 relative group">
                {profile.avatar ? (
                  <>
                    <CachedImage src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setShowPhoto(true)}
                      title="Ver foto en pantalla completa"
                      className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                    </button>
                  </>
                ) : (
                  <span className="text-white font-black text-xl">{getInitials(profile.name)}</span>
                )}
              </div>
              <h2 className="text-white font-bold text-base text-center">{profile.name}</h2>
              {profile.username && (
                <p className="text-teal-200 text-[11px] font-mono mt-0.5">@{profile.username}</p>
              )}
              <div className="flex items-center gap-1.5 mt-2 bg-white/10 rounded-full px-3 py-1">
                <Shield className="w-3 h-3 text-teal-300" />
                <span className="text-[10px] text-teal-100 font-semibold">Usuario RED ON</span>
              </div>
            </div>
          </div>

          <div className="px-5 py-4 space-y-3 bg-[#f8fafc]">
            {canEdit && !editingName && (
              <button
                onClick={startEdit}
                className="w-full bg-white rounded-xl p-3.5 flex items-center gap-3 shadow-sm border border-slate-100 hover:border-teal-200 transition-all cursor-pointer"
              >
                <div className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
                  <Pencil className="w-4 h-4 text-teal-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Nombre personalizado</p>
                  <p className="text-sm text-slate-800 font-bold truncate">{profile.name}</p>
                </div>
                <span className="text-[11px] font-bold text-teal-600">Editar</span>
              </button>
            )}

            {canEdit && editingName && (
              <div className="bg-white rounded-xl p-3.5 shadow-sm border border-teal-200">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-2">Editar nombre personalizado</p>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nombre del contacto"
                  maxLength={40}
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm px-3 py-2.5 rounded-lg outline-none focus:border-teal-400/50 focus:ring-2 focus:ring-teal-500/10 transition-all"
                />
                {nameError && (
                  <p className="text-[11px] text-rose-600 mt-1.5 font-medium">{nameError}</p>
                )}
                <div className="grid grid-cols-2 gap-2 mt-2.5">
                  <button
                    onClick={cancelEdit}
                    disabled={savingName}
                    className="py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveName}
                    disabled={savingName || !editName.trim()}
                    className="py-2 bg-gradient-to-r from-[#0a4d52] to-[#10646a] hover:opacity-90 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Guardar
                  </button>
                </div>
              </div>
            )}

            {profile.phone && (
              <div className="bg-white rounded-xl p-3.5 flex items-center gap-3 shadow-sm border border-slate-100">
                <div className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-teal-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Teléfono</p>
                  <p className="text-sm text-slate-800 font-mono font-medium truncate">{profile.phone}</p>
                </div>
              </div>
            )}

            {profile.bio && (
              <div className="bg-white rounded-xl p-3.5 flex items-start gap-3 shadow-sm border border-slate-100">
                <div className="w-9 h-9 rounded-full bg-purple-50 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Bio</p>
                  <p className="text-[13px] text-slate-600 leading-relaxed">{profile.bio?.replace(/RED ON/g, "Wepa")}</p>
                </div>
              </div>
            )}

            {!profile.phone && !profile.bio && (
              <div className="text-center py-6 text-[11px] text-slate-400">
                Sin información adicional disponible
              </div>
            )}
          </div>
        </div>
      </div>
      {showPhoto && profile.avatar && (
        <ImageLightbox src={profile.avatar} alt={profile.name} onClose={() => setShowPhoto(false)} />
      )}
    </>
  );
}

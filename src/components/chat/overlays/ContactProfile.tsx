import React from "react";
import { X, Phone, User, Shield } from "lucide-react";
import CachedImage from "../../CachedImage";

export interface ContactProfileData {
  id: string;
  name: string;
  phone?: string;
  avatar?: string;
  bio?: string;
  username?: string;
}

interface ContactProfileProps {
  isOpen: boolean;
  profile: ContactProfileData | null;
  onClose: () => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function ContactProfile({ isOpen, profile, onClose }: ContactProfileProps) {
  if (!isOpen || !profile) return null;

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
              <div className="w-20 h-20 rounded-full overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-600 shadow-lg border-2 border-white/30 flex items-center justify-center mb-3">
                {profile.avatar ? (
                  <CachedImage src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />
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
                  <p className="text-[13px] text-slate-600 leading-relaxed">{profile.bio}</p>
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
    </>
  );
}

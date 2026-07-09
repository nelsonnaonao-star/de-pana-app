import React from "react";
import { Plus, QrCode } from "lucide-react";

interface FabMenuProps {
  showActionMenu: boolean;
  setShowActionMenu: (v: boolean) => void;
  setCurrentScreen: (screen: any) => void;
}

export default function FabMenu({ showActionMenu, setShowActionMenu, setCurrentScreen }: FabMenuProps) {
  return (
    <div className="absolute right-4 bottom-16 z-30 flex flex-col items-end gap-2">
      {showActionMenu && (
        <>
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-slate-100 overflow-hidden">
            <button
              onClick={() => { setShowActionMenu(false); setCurrentScreen("synced_contacts"); }}
              className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors w-full text-left cursor-pointer"
            >
              <svg className="w-4 h-4 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
              </svg>
              <span className="text-xs font-semibold text-slate-700">Sincronizar Agenda</span>
            </button>
            <button
              onClick={() => { setShowActionMenu(false); setCurrentScreen("add_contact_manual"); }}
              className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors w-full text-left border-t border-slate-100 cursor-pointer"
            >
              <svg className="w-4 h-4 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              <span className="text-xs font-semibold text-slate-700">Agregar por teléfono</span>
            </button>
            <button
              onClick={() => { setShowActionMenu(false); setCurrentScreen("qr_scanner"); }}
              className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors w-full text-left border-t border-slate-100 cursor-pointer"
            >
              <svg className="w-4 h-4 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect x="7" y="7" width="5" height="5" /><rect x="14" y="7" width="5" height="5" />
                <rect x="7" y="14" width="5" height="5" /><rect x="14" y="14" width="5" height="5" />
              </svg>
              <span className="text-xs font-semibold text-slate-700">Escanear QR</span>
            </button>
            <button
              onClick={() => { setShowActionMenu(false); setCurrentScreen("my_qr"); }}
              className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors w-full text-left border-t border-slate-100 cursor-pointer"
            >
              <QrCode className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-semibold text-slate-700">Mi QR</span>
            </button>
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setShowActionMenu(false)} />
        </>
      )}
      <button
        onClick={() => setShowActionMenu(!showActionMenu)}
        className="w-12 h-12 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
        title="Agregar contacto"
      >
        <Plus className={`w-5 h-5 transition-transform ${showActionMenu ? "rotate-45" : ""}`} />
      </button>
    </div>
  );
}

import React, { useEffect } from "react";
import { Plus, QrCode, Phone } from "lucide-react";

interface FabMenuProps {
  showActionMenu: boolean;
  setShowActionMenu: (v: boolean) => void;
  setCurrentScreen: (screen: any) => void;
}

export default function FabMenu({ showActionMenu, setShowActionMenu, setCurrentScreen }: FabMenuProps) {
  useEffect(() => {
    if (!showActionMenu) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowActionMenu(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showActionMenu, setShowActionMenu]);

  const handleAction = (screen: any) => {
    setShowActionMenu(false);
    setCurrentScreen(screen);
  };

  const options = [
    { screen: "synced_contacts", label: "Sincronizar Agenda", icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
      </svg>
    )},
    { screen: "add_contact_manual", label: "Agregar por teléfono", icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    )},
    { screen: "qr_scanner", label: "Escanear QR", icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <rect x="7" y="7" width="5" height="5" /><rect x="14" y="7" width="5" height="5" />
        <rect x="7" y="14" width="5" height="5" /><rect x="14" y="14" width="5" height="5" />
      </svg>
    )},
    { screen: "my_qr", label: "Mi QR", icon: <QrCode className="w-4 h-4" /> },
    { screen: "create_group", label: "Nuevo Grupo", icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )},
    { screen: "calls", label: "Historial de Llamadas", icon: <Phone className="w-4 h-4" /> },
  ];

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setShowActionMenu(!showActionMenu)}
        className="absolute right-4 bottom-16 z-30 w-14 h-14 bg-[#0a4d52] hover:bg-[#10646a] text-white rounded-[8px_8px_8px_0px/8px_8px_8px_10px] flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
        title="Agregar contacto"
      >
        <Plus className={`w-5 h-5 transition-transform duration-300 ${showActionMenu ? "rotate-45" : ""}`} />
      </button>

      {/* Backdrop — absolute inset-0 covers the PhoneSimulator container */}
      <div
        className={`absolute inset-0 z-40 bg-black/30 transition-opacity duration-300 ${
          showActionMenu ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setShowActionMenu(false)}
      />

      {/* Side Panel — slides from right to 50% width */}
      <div
        className={`absolute top-0 right-0 z-50 h-full w-1/2 min-w-[220px] max-w-[300px] bg-white shadow-[-4px_0_20px_rgba(0,0,0,0.15)] flex flex-col transition-transform duration-300 ease-out ${
          showActionMenu ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">Menú</h3>
        </div>

        {/* Options */}
        <div className="flex-1 overflow-y-auto py-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {options.map((opt) => (
            <button
              key={opt.screen}
              onClick={() => handleAction(opt.screen)}
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-100 transition-colors w-full text-left cursor-pointer"
            >
              <span className="text-teal-600">{opt.icon}</span>
              <span className="text-sm font-semibold text-slate-700">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

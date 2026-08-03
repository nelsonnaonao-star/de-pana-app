import { QrCode, Search } from "lucide-react";

interface SimulatorTabHeaderProps {
  currentScreen: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  registeredUserAvatar?: string;
  onNavigateToQr: () => void;
  onNavigateToProfile: () => void;
}

export default function SimulatorTabHeader({
  currentScreen,
  searchQuery,
  onSearchChange,
  registeredUserAvatar,
  onNavigateToQr,
  onNavigateToProfile,
}: SimulatorTabHeaderProps) {
  return (
    <>
      {currentScreen === "chats" && (
        <div className="absolute top-0 left-0 right-0 text-white px-5 pt-6 pb-12 overflow-hidden z-20 h-[170px] pointer-events-none">
          <svg
            viewBox="0 0 320 180"
            className="absolute inset-0 w-full h-full z-0 select-none"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="headerGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#14b8a6" />
                <stop offset="50%" stopColor="#197a82" />
                <stop offset="100%" stopColor="#3ab3b8" />
              </linearGradient>
              <linearGradient id="headerGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0a4c51" />
                <stop offset="50%" stopColor="#10646a" />
                <stop offset="100%" stopColor="#188c94" />
              </linearGradient>
              <linearGradient id="headerGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#073337" />
                <stop offset="50%" stopColor="#0a4d52" />
                <stop offset="100%" stopColor="#116b72" />
              </linearGradient>
            </defs>
            <path d="M0,0 L0,150 C80,210 200,90 320,165 L320,0 Z" fill="url(#headerGrad1)" opacity="0.3" />
            <path d="M0,0 L0,135 C100,195 220,105 320,145 L320,0 Z" fill="url(#headerGrad2)" opacity="0.55" />
            <path d="M0,0 L0,115 C80,165 180,75 320,120 L320,0 Z" fill="url(#headerGrad3)" />
          </svg>

          <div className="relative z-10 flex justify-between items-center mb-3.5 pointer-events-auto">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-md">Messages</h1>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={onNavigateToQr}
                className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/10 text-white transition-all cursor-pointer"
                title="Escanear QR"
              >
                <QrCode className="w-4 h-4" />
              </button>
              <button
                onClick={onNavigateToProfile}
                className="w-8 h-8 rounded-full border border-white/20 overflow-hidden transition-all cursor-pointer hover:scale-110 shadow-sm"
                title="Tu Perfil"
              >
                <img
                  src={registeredUserAvatar || ""}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              </button>
            </div>
          </div>

          <div className="relative z-10 pointer-events-auto">
            <Search className="absolute left-4 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-white text-slate-800 placeholder-slate-400 text-xs pl-10 pr-4 py-2.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-100 outline-none transition-all focus:ring-2 focus:ring-teal-400/20"
            />
          </div>
        </div>
      )}

      {currentScreen === "states" && (
        <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Estados Red On</h3>
          <p className="text-[10px] text-teal-100/85">Visualiza y responde a estados</p>
        </div>
      )}

      {currentScreen === "channels" && (
        <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Canales Informativos</h3>
          <p className="text-[10px] text-teal-100/85">Sigue canales seguros y oficiales</p>
        </div>
      )}

      {currentScreen === "calls" && (
        <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Historial de Llamadas</h3>
          <p className="text-[10px] text-teal-100/85">Llamadas recientes de audio y video</p>
        </div>
      )}

      {currentScreen === "rates" && (
        <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Tasas de Cambio</h3>
          <p className="text-[10px] text-teal-100/85">Calculadora de divisas oficial</p>
        </div>
      )}

      {currentScreen === "business" && (
        <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Modo Emprendedor</h3>
          <p className="text-[10px] text-teal-100/85">Folletería digital interactiva</p>
        </div>
      )}

      {currentScreen === "profile" && (
        <div className="bg-[#0a4d52] text-white px-5 py-5 shrink-0 text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Tu Perfil Seguro</h3>
          <p className="text-[10px] text-teal-100/85">Datos e información de sesión</p>
        </div>
      )}
    </>
  );
}

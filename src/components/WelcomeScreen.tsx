import React, { useState } from "react";
import { ArrowRight, Phone, User, CheckCircle, Sparkles } from "lucide-react";

interface WelcomeScreenProps {
  onRegister: (name: string, phone: string, avatar: string) => void;
}

export default function WelcomeScreen({ onRegister }: WelcomeScreenProps) {
  const [step, setStep] = useState<"splash" | "register">("splash");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState(
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"
  );

  const avatars = [
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80",
    "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=120&q=80",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80"
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && phone.trim()) {
      onRegister(name, phone, avatar);
    }
  };

  if (step === "splash") {
    return (
      <div className="flex-1 bg-gradient-to-b from-[#073337] via-[#0a4d52] to-[#041a1c] text-white flex flex-col justify-between p-6 select-none relative overflow-hidden">
        {/* Abstract lights in background */}
        <div className="absolute top-[-10%] right-[-10%] w-56 h-56 rounded-full bg-[#14b8a6]/20 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[20%] left-[-20%] w-48 h-48 rounded-full bg-[#3ab3b8]/15 blur-2xl pointer-events-none"></div>

        {/* Top Spacer / logo */}
        <div className="flex flex-col items-center mt-12 relative z-10">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-[#14b8a6] to-[#3ab3b8] flex items-center justify-center shadow-lg shadow-[#14b8a6]/30 mb-4 animate-pulse">
            <span className="text-2xl font-black tracking-tight text-white">R</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight drop-shadow-md">Red On</h1>
          <p className="text-xs text-slate-300 font-medium mt-1 uppercase tracking-widest">
            Comunicaciones Seguras
          </p>
        </div>

        {/* Dynamic Wave in the middle */}
        <div className="flex flex-col items-center my-6 relative z-10">
          <div className="w-full h-[100px] flex items-center justify-center">
            <svg viewBox="0 0 100 20" className="w-4/5 h-full opacity-60 text-[#14b8a6]">
              <path
                d="M0 10 Q25 0, 50 10 T100 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="animate-dash"
              />
            </svg>
          </div>
          <div className="text-center px-4">
            <h2 className="text-lg font-bold text-teal-200">Llamadas Full Screen & Filtros Pro</h2>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
              Mensajería avanzada, llamadas grupales e individuales de pantalla completa con filtros, notas de video circulares y persistencia segura.
            </p>
          </div>
        </div>

        {/* Get Started Button */}
        <div className="relative z-10 mb-6">
          <button
            onClick={() => setStep("register")}
            className="w-full bg-[#14b8a6] hover:bg-[#1bc3bd] text-white font-bold text-xs py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-[#14b8a6]/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
          >
            Comenzar Ahora
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="text-center mt-3 text-[9px] text-slate-400">
            v2.4 Pro • Con tecnología de cifrado seguro
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white text-slate-800 flex flex-col p-6 select-none relative overflow-hidden">
      {/* Decorative Wave header to match "Red On" */}
      <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#0a4d52] to-[#0d5f65] p-6 text-white flex flex-col justify-end">
        <svg
          viewBox="0 0 320 180"
          className="absolute inset-0 w-full h-full z-0 pointer-events-none select-none"
          preserveAspectRatio="none"
        >
          <path
            d="M0,0 L0,140 C80,180 180,100 320,150 L320,0 Z"
            fill="#073337"
            opacity="0.4"
          />
          <path
            d="M0,0 L0,115 C80,155 180,85 320,130 L320,0 Z"
            fill="#052629"
            opacity="0.3"
          />
        </svg>

        <div className="relative z-10 mb-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-teal-300">
            Crear Cuenta
          </span>
          <h2 className="text-2xl font-black tracking-tight">Regístrate en Red On</h2>
        </div>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSubmit} className="mt-36 flex-1 flex flex-col justify-between">
        <div className="space-y-5">
          {/* Avatar Selector */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
              Selecciona tu Avatar
            </label>
            <div className="flex items-center gap-3">
              <div className="relative w-14 h-14 rounded-2xl overflow-hidden border-2 border-[#14b8a6] p-0.5 shrink-0">
                <img src={avatar} alt="Selected" className="w-full h-full object-cover rounded-xl" />
                <span className="absolute bottom-1 right-1 bg-[#14b8a6] text-white p-0.5 rounded-full">
                  <CheckCircle className="w-3 h-3" />
                </span>
              </div>
              <div className="flex gap-2">
                {avatars.map((av, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatar(av)}
                    className={`w-9 h-9 rounded-xl overflow-hidden border transition-all hover:scale-105 ${
                      avatar === av ? "border-[#14b8a6] scale-105" : "border-slate-200"
                    }`}
                  >
                    <img src={av} alt="Avatar option" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Name input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <User className="w-3 h-3 text-teal-600" /> Nombre de Usuario
            </label>
            <input
              type="text"
              required
              placeholder="Ej: Nelson Castro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-[#14b8a6] focus:bg-white text-xs px-4 py-3 rounded-xl outline-none transition-all text-slate-800 font-medium"
            />
          </div>

          {/* Phone Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <Phone className="w-3 h-3 text-teal-600" /> Número de Teléfono
            </label>
            <input
              type="tel"
              required
              placeholder="Ej: +58 412 1234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-[#14b8a6] focus:bg-white text-xs px-4 py-3 rounded-xl outline-none transition-all text-slate-800 font-mono font-medium"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="mt-8 mb-4">
          <button
            type="submit"
            className="w-full bg-[#0a4d52] hover:bg-[#10646a] text-white font-bold text-xs py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-[#0a4d52]/20 transition-all cursor-pointer"
          >
            Registrar mi Cuenta
            <Sparkles className="w-3.5 h-3.5 text-teal-300" />
          </button>
        </div>
      </form>
    </div>
  );
}

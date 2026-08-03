import React, { useState } from "react";
import { useSupabase } from "../contexts/SupabaseContext";
import { KeyRound, Lock, CheckCircle2, Eye, EyeOff } from "lucide-react";

export default function PasswordResetScreen() {
  const { completePasswordReset } = useSupabase();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("La contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await completePasswordReset(password);
      setDone(true);
    } catch (err: any) {
      console.error("[PASSWORDRESET] Error:", err);
      setError(err.message || "Error al actualizar la contraseña. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-teal-400 mx-auto" />
          <p className="text-white text-lg font-bold">¡Contraseña actualizada!</p>
          <p className="text-slate-400 text-sm">
            Tu contraseña se cambió correctamente. Inicia sesión con tu nueva contraseña.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center p-4">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-cyan-500/5 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[10%] right-[-10%] w-[450px] h-[450px] rounded-full bg-teal-500/5 blur-[130px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-teal-400 to-[#0a4d52] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-500/20">
            <span className="text-2xl font-black text-white">R</span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Nueva Contraseña</h1>
          <p className="text-sm text-slate-400 mt-1">Elige una nueva contraseña para tu cuenta</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-6">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <KeyRound className="w-3 h-3 text-teal-400" /> Nueva Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={4}
                  placeholder="Mínimo 4 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Lock className="w-3 h-3 text-teal-400" /> Confirmar Contraseña
              </label>
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={4}
                placeholder="Repite tu nueva contraseña"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-teal-400 to-[#0a4d52] hover:from-teal-500 hover:to-[#10646a] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Actualizando...
                </span>
              ) : (
                <><KeyRound className="w-3.5 h-3.5 text-teal-200" /> Actualizar Contraseña</>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

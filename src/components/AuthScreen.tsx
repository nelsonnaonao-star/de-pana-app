import React, { useState } from "react";
import { login, register, resetPassword } from "../services/auth";
import {
  Sparkles, Lock, User, Phone, Mail, AtSign, Eye, EyeOff, Smartphone, CheckCircle2, ArrowLeft, Send,
} from "lucide-react";

export default function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        await register(fullName, phone, username, password, email || undefined);
        setSuccess(true);
      } else if (mode === "forgot") {
        await resetPassword(identifier);
        setResetSent(true);
      } else {
        await login(identifier, password);
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || "Error de autenticación");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-teal-400 mx-auto" />
          <p className="text-white text-lg font-bold">¡Bienvenido a Red On!</p>
          <p className="text-slate-400 text-sm">Cargando tu información...</p>
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
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-[#14b8a6] to-[#0a4d52] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-500/20">
            <span className="text-2xl font-black text-white">R</span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Red On</h1>
          <p className="text-sm text-slate-400 mt-1">Comunicaciones Seguras</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-6">
          <div className="flex gap-2 bg-slate-950 rounded-xl p-1">
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                mode === "login"
                  ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              onClick={() => { setMode("register"); setError(""); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                mode === "register"
                  ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              Registrarse
            </button>
          </div>

          {resetSent ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center mx-auto">
                <Send className="w-7 h-7 text-teal-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-white font-bold text-sm">Revisa tu correo</h3>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Te enviamos un enlace de recuperación. Si no lo ves, revisa la carpeta de spam o promociones.
                </p>
              </div>
              <button
                onClick={() => { setMode("login"); setResetSent(false); setError(""); }}
                className="text-teal-400 hover:text-teal-300 text-xs font-semibold underline cursor-pointer"
              >
                Volver a Iniciar Sesión
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300 font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "register" ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <User className="w-3 h-3 text-teal-400" /> Nombre Completo
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Juan Pérez"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Phone className="w-3 h-3 text-teal-400" /> Teléfono Móvil
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="+58 412 1234567"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <AtSign className="w-3 h-3 text-teal-400" /> Usuario RED ON
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="juan_dev"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Mail className="w-3 h-3 text-teal-400" /> Correo electrónico (para recuperación)
                      </label>
                      <input
                        type="email"
                        placeholder="tucorreo@gmail.com (opcional)"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
                      />
                    </div>
                  </>
                ) : mode === "forgot" ? (
                  <>
                    <div className="text-center mb-2">
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        Ingresa tu usuario o teléfono y te enviaremos un enlace para restablecer tu contraseña.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-teal-400" /> Usuario o Teléfono
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="@usuario o +58 412 1234567"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Smartphone className="w-3 h-3 text-teal-400" /> Usuario o Teléfono
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="@usuario o +58 412 1234567"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Lock className="w-3 h-3 text-teal-400" /> Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required={mode !== "forgot"}
                      disabled={mode === "forgot"}
                      minLength={4}
                      placeholder="Mínimo 4 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors pr-10 disabled:opacity-40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => { setMode("forgot"); setError(""); setIdentifier(""); }}
                      className="text-[10px] text-teal-400 hover:text-teal-300 font-semibold underline cursor-pointer"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-[#14b8a6] to-[#0a4d52] hover:from-[#1bc3bd] hover:to-[#10646a] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Procesando...
                    </span>
                  ) : (
                    <>
                      {mode === "forgot" ? (
                        <><Send className="w-3.5 h-3.5 text-teal-200" /> Enviar enlace de recuperación</>
                      ) : (
                        <><Sparkles className="w-4 h-4 text-teal-200" /> {mode === "login" ? "Iniciar Sesión" : "Crear Cuenta"}</>
                      )}
                    </>
                  )}
                </button>

                {mode === "forgot" && (
                  <button
                    type="button"
                    onClick={() => { setMode("login"); setError(""); }}
                    className="w-full text-center text-[11px] text-slate-400 hover:text-slate-300 font-medium cursor-pointer flex items-center justify-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> Volver a Iniciar Sesión
                  </button>
                )}
              </form>

              <p className="text-[10px] text-slate-500 text-center">
                Al continuar, aceptas los{" "}
                <span className="text-teal-400 hover:underline cursor-pointer">Términos de Servicio</span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

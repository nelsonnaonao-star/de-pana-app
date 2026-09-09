import React, { useState } from "react";
import { login, register, sendResetCode, verifyResetCode, updatePasswordByCode } from "../services/auth";
import { normalizePhone } from "../utils/phone";
import {
  Sparkles, Lock, User, Phone, Mail, AtSign, Eye, EyeOff, Smartphone, CheckCircle2, ArrowLeft, Send, ShieldCheck, KeyRound,
} from "lucide-react";
import BrandOrb from "./BrandOrb";

const PHONE_RE = /^\+?[0-9]{0,15}$/;

function getInitialMode(): "login" | "register" {
  try {
    return localStorage.getItem("redon_has_registered") ? "login" : "register";
  } catch {
    return "login";
  }
}

export default function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register" | "forgot">(getInitialMode);
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

  // Recovery flow state
  const [forgotStep, setForgotStep] = useState<"email" | "code" | "new-password">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        await register(fullName, phone, username, password, email || undefined);
        setSuccess(true);
      } else {
        await login(identifier, password);
        setSuccess(true);
      }
    } catch (err: any) {
      console.error("[AUTHSCREEN] Error capturado:", err);
      setError(err.message || "Error de autenticación");
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await sendResetCode(resetEmail);
      setMaskedEmail(result.maskedEmail || "");
      setProfileId(result.profileId || "");
      setForgotStep("code");
    } catch (err: any) {
      setError(err.message || "Error al enviar el código.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await verifyResetCode(profileId, resetCode);
      setVerifiedEmail(result.email || "");
      setForgotStep("new-password");
    } catch (err: any) {
      setError(err.message || "Código inválido o expirado.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    try {
      await updatePasswordByCode(profileId, verifiedEmail, resetCode, newPassword);
      setResetSuccess(true);
    } catch (err: any) {
      setError(err.message || "Error al actualizar la contraseña.");
    } finally {
      setLoading(false);
    }
  };

  const resetForgotFlow = () => {
    setMode("login");
    setForgotStep("email");
    setResetEmail("");
    setMaskedEmail("");
    setProfileId("");
    setVerifiedEmail("");
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setResetSuccess(false);
  };

  if (success) {
    return (
      <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-teal-400 mx-auto" />
          <p className="text-white text-lg font-bold">¡Bienvenido a WEPA!</p>
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
          <div className="mx-auto mb-4 flex items-center justify-center">
            <BrandOrb size={64} />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">WEPA</h1>
          <p className="text-sm text-slate-400 mt-1">Comunicaciones Seguras</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-6">
          {/* Mode tabs — hidden during forgot flow */}
          {mode !== "forgot" && (
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
          )}

          {/* ─── Forgot password: reset success ─── */}
          {resetSuccess ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-teal-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-white font-bold text-sm">¡Contraseña actualizada!</h3>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Tu contraseña se cambió correctamente. Inicia sesión con tu nueva contraseña.
                </p>
              </div>
              <button
                onClick={resetForgotFlow}
                className="text-teal-400 hover:text-teal-300 text-xs font-semibold underline cursor-pointer"
              >
                Iniciar Sesión
              </button>
            </div>
          ) : mode === "forgot" ? (
            /* ─── Forgot password: 3-step flow ─── */
            <div className="space-y-4">
              {/* Step indicator */}
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  forgotStep === "email" ? "bg-teal-500 text-white" : "bg-slate-700 text-slate-400"
                }`}>1</div>
                <div className={`w-8 h-0.5 ${forgotStep === "email" ? "bg-slate-700" : "bg-teal-500"}`}></div>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  forgotStep === "code" ? "bg-teal-500 text-white" : forgotStep === "new-password" ? "bg-teal-500 text-white" : "bg-slate-700 text-slate-400"
                }`}>2</div>
                <div className={`w-8 h-0.5 ${forgotStep === "new-password" ? "bg-teal-500" : "bg-slate-700"}`}></div>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  forgotStep === "new-password" ? "bg-teal-500 text-white" : "bg-slate-700 text-slate-400"
                }`}>3</div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300 font-medium">
                  {error}
                </div>
              )}

              {/* Step 1: Email */}
              {forgotStep === "email" && (
                <form onSubmit={handleSendCode} className="space-y-4">
                  <div className="text-center mb-2">
                    <div className="w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center mx-auto mb-3">
                      <Mail className="w-6 h-6 text-teal-400" />
                    </div>
                    <h3 className="text-white font-bold text-sm">Recuperar contraseña</h3>
                    <p className="text-slate-400 text-[11px] leading-relaxed mt-1">
                      Ingresa tu correo electrónico. Enviaremos un código de verificación al mismo correo.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Mail className="w-3 h-3 text-teal-400" /> Correo Electrónico
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="tucorreo@gmail.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
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
                        Enviando...
                      </span>
                    ) : (
                      <><Send className="w-3.5 h-3.5 text-teal-200" /> Enviar Código</>
                    )}
                  </button>
                </form>
              )}

              {/* Step 2: Code verification */}
              {forgotStep === "code" && (
                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div className="text-center mb-2">
                    <div className="w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center mx-auto mb-3">
                      <ShieldCheck className="w-6 h-6 text-teal-400" />
                    </div>
                    <h3 className="text-white font-bold text-sm">Verificar código</h3>
                    <p className="text-slate-400 text-[11px] leading-relaxed mt-1">
                      Se envió un código de 4 dígitos{maskedEmail ? ` al correo ${maskedEmail}` : ""}. Introdúcelo a continuación.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-teal-400" /> Código de Verificación
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      maxLength={4}
                      placeholder="0000"
                      value={resetCode}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                        setResetCode(v);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors text-center text-lg tracking-[0.5em] font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || resetCode.length !== 4}
                    className="w-full py-3 bg-gradient-to-r from-teal-400 to-[#0a4d52] hover:from-teal-500 hover:to-[#10646a] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        Verificando...
                      </span>
                    ) : (
                      <><ShieldCheck className="w-3.5 h-3.5 text-teal-200" /> Verificar Código</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForgotStep("email"); setError(""); setResetCode(""); }}
                    className="w-full text-center text-[11px] text-slate-400 hover:text-slate-300 font-medium cursor-pointer flex items-center justify-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> Volver
                  </button>
                </form>
              )}

              {/* Step 3: New password */}
              {forgotStep === "new-password" && (
                <form onSubmit={handleUpdatePassword} className="space-y-4">
                  <div className="text-center mb-2">
                    <div className="w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center mx-auto mb-3">
                      <KeyRound className="w-6 h-6 text-teal-400" />
                    </div>
                    <h3 className="text-white font-bold text-sm">Nueva Contraseña</h3>
                    <p className="text-slate-400 text-[11px] leading-relaxed mt-1">
                      Elige una nueva contraseña para tu cuenta.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <KeyRound className="w-3 h-3 text-teal-400" /> Nueva Contraseña
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        required
                        minLength={6}
                        placeholder="Mínimo 6 caracteres"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl outline-none focus:border-teal-500/50 transition-colors pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 cursor-pointer"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Lock className="w-3 h-3 text-teal-400" /> Confirmar Contraseña
                    </label>
                    <input
                      type={showNewPassword ? "text" : "password"}
                      required
                      minLength={6}
                      placeholder="Repite tu nueva contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
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
              )}

              {/* Back to login — always visible during forgot flow */}
              {forgotStep !== "new-password" && (
                <button
                  type="button"
                  onClick={resetForgotFlow}
                  className="w-full text-center text-[11px] text-slate-400 hover:text-slate-300 font-medium cursor-pointer flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Volver a Iniciar Sesión
                </button>
              )}
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
                        placeholder="+573001234567"
                        value={phone}
                        onChange={(e) => {
                          if (PHONE_RE.test(e.target.value)) setPhone(normalizePhone(e.target.value));
                        }}
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

                {mode !== "forgot" && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Lock className="w-3 h-3 text-teal-400" /> Contraseña
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
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-teal-400 to-[#0a4d52] hover:from-teal-500 hover:to-[#10646a] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Procesando...
                    </span>
                  ) : (
                    <><Sparkles className="w-4 h-4 text-teal-200" /> {mode === "login" ? "Iniciar Sesión" : "Crear Cuenta"}</>
                  )}
                </button>
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

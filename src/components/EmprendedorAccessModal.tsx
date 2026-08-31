import React, { useState } from "react";
import {
  Crown, Check, X, MessageCircle, Loader2, Sparkles,
  Store, ShieldCheck, PartyPopper
} from "lucide-react";
import {
  EMPRENDEDOR_PLANS, EmprendedorPlanId, buildAdminWhatsAppUrl,
  activateEmprendedorCode, daysRemaining
} from "../services/emprendedorAccess";

interface EmprendedorAccessModalProps {
  open: boolean;
  onClose: () => void;
  /** Se ejecuta cuando la membresía se activó con éxito y el usuario quiere empezar a publicar */
  onActivated: () => void;
}

type FeedbackStatus = "idle" | "error" | "success";

export default function EmprendedorAccessModal({ open, onClose, onActivated }: EmprendedorAccessModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<EmprendedorPlanId>("semanal");
  const [codeInput, setCodeInput] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [feedback, setFeedback] = useState<{ status: FeedbackStatus; message: string }>({ status: "idle", message: "" });
  const [activatedInfo, setActivatedInfo] = useState<{ planName: string; days: number } | null>(null);

  if (!open) return null;

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim() || isValidating) return;

    setIsValidating(true);
    setFeedback({ status: "idle", message: "" });

    const result = await activateEmprendedorCode(codeInput);

    if (result.ok && result.expiresOn) {
      const plan = EMPRENDEDOR_PLANS.find(p => p.id === result.plan);
      setActivatedInfo({ planName: plan?.name || "Membresía", days: daysRemaining(result.expiresOn) });
      setCodeInput("");
    } else {
      setFeedback({ status: "error", message: result.message });
    }
    setIsValidating(false);
  };

  return (
    <div className="absolute inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="relative bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl max-h-[95%] flex flex-col animate-fade-in">

        {/* ===== HEADER ===== */}
        <div className="relative bg-gradient-to-br from-[#0a4d52] via-teal-700 to-teal-500 px-5 pt-6 pb-5 shrink-0 overflow-hidden">
          {/* Decoración de fondo */}
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-teal-400/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-6 w-28 h-28 bg-emerald-300/10 rounded-full blur-2xl pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative flex items-center gap-2.5 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Crown className="w-5 h-5 text-slate-900" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-teal-200 bg-white/10 border border-white/20 px-2 py-1 rounded-full">
              Wepa Negocios
            </span>
          </div>

          <h3 className="text-lg font-black text-white leading-tight">
            Publica tu negocio <br className="sm:hidden" />y véndele a todo Red On
          </h3>
          <p className="text-[10px] text-teal-100/90 mt-1 leading-relaxed">
            Activa una membresía para publicar tus flyers en el feed y que miles de usuarios vean tu emprendimiento.
          </p>
        </div>

        {/* ===== CONTENIDO ===== */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* --- Vista de ÉXITO tras activar código --- */}
          {activatedInfo ? (
            <div className="flex flex-col items-center text-center py-4 space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center">
                <PartyPopper className="w-8 h-8 text-emerald-500" />
              </div>
              <h4 className="text-base font-black text-slate-800">¡Membresía Activada!</h4>
              <p className="text-[11px] text-slate-500 leading-relaxed max-w-[240px]">
                Tu plan <strong className="text-teal-600">{activatedInfo.planName}</strong> está activo por{" "}
                <strong className="text-teal-600">{activatedInfo.days} día{activatedInfo.days !== 1 ? "s" : ""}</strong>.
                Ya puedes publicar flyers en Wepa Negocios.
              </p>
              <button
                onClick={onActivated}
                className="mt-2 w-full bg-gradient-to-r from-[#0a4d52] to-teal-600 hover:from-teal-700 hover:to-teal-500 text-white font-black text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
              >
                <Store className="w-4 h-4" /> Empezar a Publicar
              </button>
            </div>
          ) : (
            <>
              {/* --- PASO 1: PLANES --- */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Paso 1 · Elige tu plan
                </p>

                {EMPRENDEDOR_PLANS.map((plan) => {
                  const isSelected = selectedPlan === plan.id;
                  const isBestValue = plan.id === "mensual";
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`w-full flex items-center justify-between border-2 rounded-2xl px-4 py-3 text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-teal-500 bg-teal-50 shadow-sm"
                          : "border-slate-100 bg-white hover:border-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isSelected ? "border-teal-500 bg-teal-500" : "border-slate-300"
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-black ${isSelected ? "text-teal-700" : "text-slate-700"}`}>
                              Plan {plan.name}
                            </span>
                            {isBestValue && (
                              <span className="text-[7px] font-black uppercase tracking-wide bg-amber-400 text-slate-900 px-1.5 py-0.5 rounded-full">
                                Mejor precio
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400">{plan.durationLabel}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-lg font-black ${isSelected ? "text-teal-600" : "text-slate-800"}`}>
                          ${plan.price}
                        </span>
                        <p className="text-[8px] text-slate-400 leading-none">USD</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* --- PASO 2: CONTACTAR ADMINISTRADOR --- */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <MessageCircle className="w-3 h-3 text-emerald-500" /> Paso 2 · Contacta al administrador
                </p>

                <a
                  href={buildAdminWhatsAppUrl(EMPRENDEDOR_PLANS.find(p => p.id === selectedPlan))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-black text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-500/25 active:scale-[0.98]"
                >
                  <MessageCircle className="w-4 h-4" />
                  Escribir por WhatsApp
                </a>
                <p className="text-[8px] text-slate-400 text-center leading-relaxed">
                  Realiza tu pago por transferencia o pago móvil. El administrador te enviará
                  <strong className="text-slate-500"> tu código secreto</strong> para activar la publicación.
                </p>
              </div>

              {/* --- DIVISOR --- */}
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">
                  ¿Ya pagaste? Activa tu código
                </span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              {/* --- PASO 3: CÓDIGO --- */}
              <form onSubmit={handleActivate} className="space-y-2">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="EJ: REDON7-A1B2C3"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-slate-50 border-2 border-slate-100 focus:border-teal-400 focus:bg-white text-[12px] font-mono font-bold tracking-[0.15em] text-center uppercase px-3 py-3 rounded-xl outline-none transition-colors placeholder:text-slate-300 placeholder:tracking-normal placeholder:font-sans placeholder:text-[10px]"
                />

                {feedback.status === "error" && (
                  <div className="bg-red-50 border border-red-100 text-red-500 text-[9px] font-bold px-3 py-2 rounded-lg flex items-start gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
                    {feedback.message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isValidating || !codeInput.trim()}
                  className="w-full bg-gradient-to-r from-[#0a4d52] to-teal-600 hover:from-teal-700 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] cursor-pointer"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Validando código...
                    </>
                  ) : (
                    <>
                      <Crown className="w-4 h-4 text-amber-300" /> Activar Membresía
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

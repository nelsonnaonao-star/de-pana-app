import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Settings,
  X,
} from "lucide-react";
import {
  canInstallPackages,
  checkForAppUpdate,
  downloadRelease,
  installRelease,
  InstallPermissionError,
  openInstallPermissionSettings,
  type AppRelease,
} from "../services/appUpdate";
import { logger } from "../lib/logger";

type Phase =
  | "idle"
  | "downloading"
  | "ready"
  | "permission"
  | "installing"
  | "installed"
  | "error";

interface UpdateModalProps {
  enabled?: boolean;
}

export default function UpdateModal({ enabled = true }: UpdateModalProps) {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [mandatory, setMandatory] = useState(false);
  const [currentVersionName, setCurrentVersionName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const releaseRef = useRef<AppRelease | null>(null);
  const apkPathRef = useRef<string | null>(null);
  const dismissedRef = useRef(false);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (
      !Capacitor.isNativePlatform() ||
      checkingRef.current ||
      dismissedRef.current ||
      releaseRef.current
    ) {
      return;
    }

    checkingRef.current = true;
    try {
      const result = await checkForAppUpdate();
      if (result.status === "available") {
        releaseRef.current = result.release;
        setRelease(result.release);
        setMandatory(result.mandatory);
        setCurrentVersionName(result.currentVersionName);
        setPhase("idle");
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return;
    const timer = window.setTimeout(() => {
      void runCheck();
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [enabled, runCheck]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = CapacitorApp.addListener(
      "appStateChange",
      async ({ isActive }) => {
        if (!isActive) return;

        if (phase === "permission") {
          const granted = await canInstallPackages();
          if (granted) {
            setPhase("ready");
            setMessage(null);
          }
          return;
        }

        if (phase === "installing") {
          setPhase("ready");
          return;
        }

        if (!releaseRef.current && !dismissedRef.current) {
          void runCheck();
        }
      },
    );

    return () => {
      listenerPromise.then((listener) => listener.remove()).catch(() => {});
    };
  }, [phase, runCheck]);

  const tryInstall = useCallback(async () => {
    const apkPath = apkPathRef.current;
    if (!apkPath) {
      setPhase("ready");
      return;
    }

    setPhase("installing");
    setMessage(null);

    try {
      await installRelease(apkPath);
      setPhase("installed");
    } catch (error) {
      if (error instanceof InstallPermissionError) {
        setPhase("permission");
        setMessage(error.message);
      } else {
        logger.warn("[appUpdate] No se pudo instalar", {
          error: error instanceof Error ? error.message : String(error),
        });
        setPhase("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "No se pudo abrir el instalador de Android.",
        );
      }
    }
  }, []);

  const handlePrimary = useCallback(async () => {
    if (!release) return;

    if (phase === "permission") {
      const granted = await canInstallPackages();
      if (!granted) {
        await openInstallPermissionSettings();
        return;
      }
      await tryInstall();
      return;
    }

    if (apkPathRef.current) {
      await tryInstall();
      return;
    }

    setPhase("downloading");
    setProgress(0);
    setMessage(null);

    try {
      const apkPath = await downloadRelease(release, ({ percent }) =>
        setProgress(percent),
      );
      apkPathRef.current = apkPath;
      await tryInstall();
    } catch (error) {
      logger.warn("[appUpdate] No se pudo descargar la actualización", {
        error: error instanceof Error ? error.message : String(error),
      });
      setPhase("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo descargar la actualización. Revisa tu conexión.",
      );
    }
  }, [release, phase, tryInstall]);

  const dismiss = useCallback(() => {
    if (mandatory) return;
    dismissedRef.current = true;
    setRelease(null);
  }, [mandatory]);

  if (!release) return null;

  const isDownloading = phase === "downloading";
  const isInstalling = phase === "installing";
  const busy = isDownloading || isInstalling;

  const primaryLabel =
    phase === "downloading"
      ? `Descargando ${progress}%`
      : phase === "installing"
        ? "Abriendo instalador…"
        : phase === "permission"
          ? "Abrir ajustes de instalación"
          : phase === "installed"
            ? "Listo"
            : apkPathRef.current
              ? "Instalar ahora"
              : "Actualizar ahora";

  return (
    <div className="fixed inset-0 z-[1000002] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Actualización de la aplicación"
        className="w-full max-w-sm rounded-3xl border border-teal-500/20 bg-gradient-to-b from-[#0f2027] via-[#041a1c] to-[#010809] p-6 shadow-2xl shadow-teal-900/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                mandatory
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-teal-500/15 text-teal-300"
              }`}
            >
              {mandatory ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Download className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight text-white">
                {mandatory ? "Actualización obligatoria" : "Actualización disponible"}
              </h3>
              <p className="text-[11px] font-medium text-slate-400">
                Nueva versión {release.version_name} · build {release.version_code}
              </p>
            </div>
          </div>

          {!mandatory && !busy && (
            <button
              type="button"
              onClick={dismiss}
              aria-label="Cerrar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 transition-all hover:bg-white/20"
            >
              <X className="h-4 w-4 text-slate-400" />
            </button>
          )}
        </div>

        {currentVersionName && (
          <p className="mt-4 text-[11px] font-medium text-slate-500">
            Tienes instalada la versión {currentVersionName}.
          </p>
        )}

        {release.notes && (
          <div className="mt-3 max-h-32 overflow-y-auto rounded-2xl border border-white/5 bg-white/5 p-3">
            <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
              {release.notes}
            </p>
          </div>
        )}

        {isDownloading && (
          <div className="mt-4 space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-teal-400 transition-all duration-300"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
            <p className="text-center text-[11px] font-semibold text-teal-300">
              Descargando… {progress}%
            </p>
          </div>
        )}

        {phase === "permission" && (
          <div className="mt-4 flex gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
            <Settings className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-[11px] leading-relaxed text-amber-100/90">
              {message ??
                "Activa «Permitir desde esta fuente» para DE PANA en la pantalla que se abrirá y vuelve a la app."}
            </p>
          </div>
        )}

        {phase === "installed" && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-teal-500/20 bg-teal-500/10 p-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-300" />
            <p className="text-[11px] leading-relaxed text-teal-100/90">
              Instalador abierto. Confirma la instalación en la pantalla de Android.
            </p>
          </div>
        )}

        {phase === "error" && message && (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-[11px] leading-relaxed text-red-200">{message}</p>
          </div>
        )}

        <div className="mt-5 flex gap-3">
          {!mandatory && !busy && phase !== "installed" && (
            <button
              type="button"
              onClick={dismiss}
              className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-bold text-slate-300 transition-all hover:bg-white/5"
            >
              Ahora no
            </button>
          )}

          <button
            type="button"
            onClick={handlePrimary}
            disabled={busy || phase === "installed"}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all ${
              busy || phase === "installed"
                ? "cursor-not-allowed bg-teal-800/30 text-teal-700"
                : "bg-teal-500 text-white shadow-lg shadow-teal-500/20 hover:bg-teal-400"
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {phase === "permission" && <Settings className="h-4 w-4" />}
            {primaryLabel}
          </button>
        </div>

        {phase === "permission" && (
          <button
            type="button"
            onClick={handlePrimary}
            className="mt-2 w-full rounded-xl border border-teal-500/30 py-2 text-xs font-bold text-teal-300 transition-all hover:bg-teal-500/10"
          >
            Ya lo permití, instalar
          </button>
        )}

        <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-600">
          La actualización se descarga directamente desde Supabase.
        </p>
      </div>
    </div>
  );
}

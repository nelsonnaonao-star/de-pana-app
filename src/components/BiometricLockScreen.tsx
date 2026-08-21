import React, { useEffect, useState } from "react";
import { Fingerprint, ScanFace, AlertCircle } from "lucide-react";
import {
  checkBiometricAvailability,
  authenticateWithBiometric,
  getBiometricErrorMessage,
  getBiometryDisplayName,
  getAvailableBiometryNames,
} from "../services/biometricAuth";
import { BiometryType } from "@aparajita/capacitor-biometric-auth";
import { logger } from "../lib/logger";

interface BiometricLockScreenProps {
  isLocked: boolean;
  onUnlock: () => void;
}

export default function BiometricLockScreen({ isLocked, onUnlock }: BiometricLockScreenProps) {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometryType, setBiometryType] = useState<BiometryType>(BiometryType.none);
  const [availableTypes, setAvailableTypes] = useState<BiometryType[]>([]);

  useEffect(() => {
    if (isLocked) {
      checkAvailability();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  const checkAvailability = async () => {
    try {
      const info = await checkBiometricAvailability();
      setBiometryType(info.biometryType);
      setAvailableTypes(info.biometryTypes || []);
    } catch (e) {
      logger.error("[BiometricLockScreen] checkAvailability failed", { error: e });
    }
  };

  const authenticate = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setError(null);

    // allowDeviceCredential: true → Android offers PIN/pattern as fallback
    const res = await authenticateWithBiometric("Desbloquear RED ON", { allowDeviceCredential: true });

    if (res.success) {
      setIsAuthenticating(false);
      onUnlock();
    } else {
      setIsAuthenticating(false);
      setError(getBiometricErrorMessage(res.errorCode));
    }
  };

  const displayName =
    getAvailableBiometryNames(availableTypes) ||
    getBiometryDisplayName(biometryType) ||
    "Biometría";

  const isFace =
    biometryType === BiometryType.faceId || biometryType === BiometryType.faceAuthentication;

  if (!isLocked) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0b0f19] flex flex-col items-center justify-center px-8">
      {/* Tappable biometric circle */}
      <button
        onClick={authenticate}
        disabled={isAuthenticating}
        className="relative w-32 h-32 rounded-full outline-none group disabled:cursor-wait"
        aria-label={`Desbloquear con ${displayName}`}
      >
        {/* Pulse rings while authenticating */}
        {isAuthenticating && (
          <>
            <span className="absolute inset-0 rounded-full bg-teal-500/20 animate-ping"></span>
            <span
              className="absolute inset-0 rounded-full bg-teal-500/10 animate-ping"
              style={{ animationDelay: "0.4s" }}
            ></span>
          </>
        )}

        {/* Glow ring */}
        <span className="absolute -inset-1 rounded-full bg-gradient-to-tr from-teal-500/40 via-teal-400/20 to-transparent blur-md opacity-70 group-active:opacity-100 transition-opacity"></span>

        {/* Circle body */}
        <span className="absolute inset-0 rounded-full bg-gradient-to-b from-[#10333a] to-[#0b2026] border border-teal-500/30 shadow-[0_0_40px_rgba(20,184,166,0.25)] flex items-center justify-center overflow-hidden">
          {isAuthenticating ? (
            <span className="w-11 h-11 border-[3px] border-teal-500/25 border-t-teal-400 rounded-full animate-spin block"></span>
          ) : isFace ? (
            <ScanFace className="w-14 h-14 text-teal-400 transition-transform duration-200 group-active:scale-90" />
          ) : (
            <Fingerprint className="w-14 h-14 text-teal-400 transition-transform duration-200 group-active:scale-90" />
          )}
        </span>
      </button>

      {/* Title & hint */}
      <h2 className="mt-8 text-xl font-black text-white tracking-wide">RED ON bloqueado</h2>
      <p className="mt-2 text-[13px] text-slate-400 text-center max-w-[16rem] leading-relaxed">
        {isAuthenticating ? (
          "Esperando autenticación..."
        ) : (
          <>
            Toca el círculo para desbloquear con{" "}
            <span className="text-teal-400 font-bold">{displayName.toLowerCase()}</span>
          </>
        )}
      </p>

      {/* Error */}
      {error && (
        <div className="mt-5 w-full max-w-xs p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center justify-center gap-2 text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-[12px] text-center">{error}</span>
        </div>
      )}

      {/* Retry link shown after an error */}
      {!isAuthenticating && error && (
        <button
          onClick={authenticate}
          className="mt-5 text-[13px] font-black text-teal-400 active:text-teal-300"
        >
          Intentar de nuevo
        </button>
      )}

      {/* Fallback hint */}
      <p className="absolute bottom-8 left-0 right-0 text-center text-[10px] text-slate-600 px-10">
        También puedes usar tu PIN o patrón desde el diálogo de Android
      </p>
    </div>
  );
}
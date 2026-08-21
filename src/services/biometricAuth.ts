import { BiometricAuth, BiometryType, BiometryError } from "@aparajita/capacitor-biometric-auth";
import { Preferences } from "@capacitor/preferences";
import { logger } from "../lib/logger";

const BIOMETRIC_ENABLED_KEY = "redon_biometric_enabled";
const BIOMETRIC_FALLBACK_KEY = "redon_biometric_fallback_enabled";

export type BiometricType = 
  | "none"
  | "touchId"
  | "faceId"
  | "fingerprintAuthentication"
  | "faceAuthentication"
  | "irisAuthentication";

export interface BiometricInfo {
  isAvailable: boolean;
  strongBiometryIsAvailable: boolean;
  biometryType: BiometryType;
  biometryTypes: BiometryType[];
  deviceIsSecure: boolean;
  reason: string;
  code: string;
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: BIOMETRIC_ENABLED_KEY });
    return value === "true";
  } catch (e) {
    logger.warn("[BiometricAuth] Failed to get enabled state", { error: e });
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    await Preferences.set({ key: BIOMETRIC_ENABLED_KEY, value: enabled.toString() });
  } catch (e) {
    logger.warn("[BiometricAuth] Failed to set enabled state", { error: e });
  }
}

export async function isBiometricFallbackEnabled(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: BIOMETRIC_FALLBACK_KEY });
    return value === "true";
  } catch (e) {
    return false;
  }
}

export async function setBiometricFallbackEnabled(enabled: boolean): Promise<void> {
  try {
    await Preferences.set({ key: BIOMETRIC_FALLBACK_KEY, value: enabled.toString() });
  } catch (e) {
    logger.warn("[BiometricAuth] Failed to set fallback state", { error: e });
  }
}

export async function checkBiometricAvailability(): Promise<BiometricInfo> {
  try {
    const info = await BiometricAuth.checkBiometry();
    return {
      isAvailable: info.isAvailable,
      strongBiometryIsAvailable: info.strongBiometryIsAvailable,
      biometryType: info.biometryType,
      biometryTypes: info.biometryTypes,
      deviceIsSecure: info.deviceIsSecure,
      reason: info.reason,
      code: info.code,
    };
  } catch (e) {
    logger.error("[BiometricAuth] checkBiometry failed", { error: e });
    return {
      isAvailable: false,
      strongBiometryIsAvailable: false,
      biometryType: BiometryType.none,
      biometryTypes: [],
      deviceIsSecure: false,
      reason: "Error checking biometry",
      code: "biometryNotAvailable",
    };
  }
}

export interface BiometricAuthResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

// Guard: mientras hay autenticación nativa en curso, la app pasa a background
// (AuthActivity del plugin) y al volver dispara appStateChange(isActive=true).
// Ese evento NO debe volver a bloquear la app o se crea un bucle infinito de prompts.
let authInFlight = false;

export function isBiometricAuthInFlight(): boolean {
  return authInFlight;
}

export async function authenticateWithBiometric(
  reason: string = "Desbloquear RED ON",
  opts?: { allowDeviceCredential?: boolean }
): Promise<BiometricAuthResult> {
  authInFlight = true;
  try {
    const fallback = await isBiometricFallbackEnabled();
    await BiometricAuth.authenticate({
      reason,
      allowDeviceCredential: opts?.allowDeviceCredential ?? fallback,
      androidBiometryStrength: "weak",
    });
    return { success: true };
  } catch (e: any) {
    const code = typeof e?.code === "string" ? e.code : undefined;
    const msg = e instanceof Error ? e.message : String(e);
    logger.info("[BiometricAuth] Authentication failed", { code, message: msg });
    return { success: false, errorCode: code ?? "unknown", errorMessage: msg };
  } finally {
    // Gracia breve: el resume (isActive=true) puede llegar DESPUÉS de resolver la promesa
    setTimeout(() => {
      authInFlight = false;
    }, 1500);
  }
}

export function getBiometricErrorMessage(code?: string): string | null {
  switch (code) {
    case "userCancel":
    case "userFallback":
    case "systemCancel":
      return null;
    case "biometryNotEnrolled":
    case "biometryNotAvailable":
      return "No hay huella registrada en este dispositivo. Regístrala en Ajustes de Android → Seguridad.";
    case "lockout":
    case "lockoutPermanent":
      return "Demasiados intentos fallidos. Espera un momento e intenta de nuevo.";
    case "notEnrolledNoCredential":
      return "Este dispositivo no tiene huella ni PIN configurado.";
    default:
      return "Autenticación fallida. Intenta de nuevo.";
  }
}

export function getBiometryDisplayName(type: BiometryType): string {
  switch (type) {
    case BiometryType.touchId:
      return "Touch ID";
    case BiometryType.faceId:
      return "Face ID";
    case BiometryType.fingerprintAuthentication:
      return "Huella dactilar";
    case BiometryType.faceAuthentication:
      return "Reconocimiento facial";
    case BiometryType.irisAuthentication:
      return "Escaneo de iris";
    default:
      return "Biometría";
  }
}

export function getAvailableBiometryNames(types: BiometryType[]): string {
  return types.map(getBiometryDisplayName).join(" / ");
}
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileOpener } from "@capawesome-team/capacitor-file-opener";
import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

const BUCKET = "app-updates";
const APK_MIME = "application/vnd.android.package-archive";
const UPDATES_DIR = "updates";

export interface AppRelease {
  id: string;
  version_code: number;
  version_name: string;
  apk_path: string;
  apk_size: number | null;
  notes: string | null;
  mandatory: boolean;
  min_supported_code: number;
  active: boolean;
  created_at: string;
}

interface AppUpdateNativePlugin {
  canInstall(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<void>;
  installApk(options: { path: string }): Promise<void>;
  verifySignature(options: { path: string }): Promise<{ matches: boolean }>;
}

const AppUpdateNative = registerPlugin<AppUpdateNativePlugin>("AppUpdate");

export class InstallPermissionError extends Error {
  constructor(message = "Se requiere permiso para instalar aplicaciones desconocidas.") {
    super(message);
    this.name = "InstallPermissionError";
  }
}

export type UpdateCheckResult =
  | {
      status: "unsupported";
    }
  | {
      status: "up-to-date";
      currentVersionCode: number;
      currentVersionName: string;
    }
  | {
      status: "error";
      error: unknown;
    }
  | {
      status: "available";
      release: AppRelease;
      mandatory: boolean;
      currentVersionCode: number;
      currentVersionName: string;
    };

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function hasNativeInstaller(): boolean {
  return isNative() && Capacitor.isPluginAvailable("AppUpdate");
}

export async function getCurrentAppVersion(): Promise<{
  versionCode: number;
  versionName: string;
}> {
  const info = await App.getInfo();
  return {
    versionCode: Number.parseInt(info.build, 10) || 0,
    versionName: info.version || "",
  };
}

/**
 * Consulta Supabase la última release activa con versionCode mayor al instalado.
 * Nunca lanza: devuelve { status: "error" } para que el arranque no se bloquee.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isNative()) return { status: "unsupported" };

  try {
    const { versionCode, versionName } = await getCurrentAppVersion();

    const { data, error } = await supabase
      .from("app_releases")
      .select(
        "id,version_code,version_name,apk_path,apk_size,notes,mandatory,min_supported_code,active,created_at",
      )
      .eq("active", true)
      .gt("version_code", versionCode)
      .order("version_code", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return {
        status: "up-to-date",
        currentVersionCode: versionCode,
        currentVersionName: versionName,
      };
    }

    const release = data as AppRelease;
    const mandatory =
      release.mandatory || versionCode < (release.min_supported_code ?? 0);

    return {
      status: "available",
      release,
      mandatory,
      currentVersionCode: versionCode,
      currentVersionName: versionName,
    };
  } catch (error) {
    logger.warn("[appUpdate] No se pudo comprobar la actualización", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "error", error };
  }
}

export async function canInstallPackages(): Promise<boolean> {
  if (!hasNativeInstaller()) return true;
  try {
    const { granted } = await AppUpdateNative.canInstall();
    return granted;
  } catch {
    return true;
  }
}

export async function openInstallPermissionSettings(): Promise<void> {
  if (!hasNativeInstaller()) return;
  await AppUpdateNative.openInstallSettings();
}

function normalizeFilePath(path: string): string {
  if (path.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(path).pathname);
    } catch {
      return path.replace("file://", "");
    }
  }
  return path;
}

export interface DownloadProgress {
  percent: number;
  bytes: number;
  total: number;
}

/**
 * Descarga el APK a la caché de la app y valida el tamaño contra Supabase.
 * Devuelve la ruta absoluta (sin file://) lista para el instalador nativo.
 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export async function downloadRelease(
  release: AppRelease,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  // `apk_path` puede ser una ruta dentro del bucket de Supabase o una URL
  // completa (p. ej. un asset de GitHub Releases). Si ya es URL, se usa tal cual.
  const publicUrl = isHttpUrl(release.apk_path)
    ? release.apk_path
    : supabase.storage.from(BUCKET).getPublicUrl(release.apk_path).data.publicUrl;
  if (!publicUrl) throw new Error("No se pudo construir la URL del APK.");

  const fileName = `${UPDATES_DIR}/de-pana-${release.version_code}.apk`;

  try {
    await Filesystem.mkdir({
      path: UPDATES_DIR,
      directory: Directory.Cache,
      recursive: true,
    });
  } catch {
    // EEXIST: el directorio ya existe.
  }

  try {
    await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache });
  } catch {
    // No existía.
  }

  const listener = await Filesystem.addListener("progress", (status) => {
    if (!onProgress) return;
    const total = status.contentLength || release.apk_size || 0;
    const percent = total > 0 ? Math.min(100, Math.round((status.bytes / total) * 100)) : 0;
    onProgress({ percent, bytes: status.bytes, total });
  });

  try {
    const result = await Filesystem.downloadFile({
      url: publicUrl,
      path: fileName,
      directory: Directory.Cache,
      progress: true,
    });
    if (!result.path) throw new Error("La descarga no devolvió una ruta de archivo.");

    if (release.apk_size && release.apk_size > 0) {
      const stat = await Filesystem.stat({
        path: fileName,
        directory: Directory.Cache,
      });
      if (stat.size !== release.apk_size) {
        await Filesystem.deleteFile({
          path: fileName,
          directory: Directory.Cache,
        }).catch(() => {});
        throw new Error(
          "La descarga quedó incompleta o el APK cambió en el servidor. Inténtalo de nuevo.",
        );
      }
    }

    return normalizeFilePath(result.path);
  } finally {
    listener.remove();
  }
}

/**
 * Abre el instalador de Android.
 * - Si falta el permiso "Instalar apps desconocidas", lanza InstallPermissionError
 *   y deja al usuario en la pantalla exacta de DE PANA.
 * - Usa el plugin nativo AppUpdate; si no estuviera disponible (build viejo),
 *   cae a FileOpener.
 */
export async function installRelease(apkPath: string): Promise<void> {
  if (hasNativeInstaller()) {
    // Defensa de cadena de suministro: el APK descargado debe estar firmado con
    // la MISMA clave que la app instalada. Aunque el hosting se vea comprometido,
    // un APK ajeno no se puede instalar encima.
    try {
      const { matches } = await AppUpdateNative.verifySignature({ path: apkPath });
      if (!matches) {
        throw new Error(
          "El APK descargado no está firmado con la clave oficial de la app. Instalación bloqueada.",
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("clave oficial")) {
        throw error;
      }
      // Si el plugin es de una versión anterior sin verifySignature, se continúa
      // (el instalador de Android seguirá rechazando firmas distintas).
      logger.warn("[appUpdate] No se pudo verificar la firma del APK", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const granted = await canInstallPackages();
    if (!granted) {
      await openInstallPermissionSettings();
      throw new InstallPermissionError();
    }

    try {
      await AppUpdateNative.installApk({ path: apkPath });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string } | null)?.code;
      if (
        message.includes("INSTALL_PERMISSION_REQUIRED") ||
        code === "INSTALL_PERMISSION_REQUIRED"
      ) {
        await openInstallPermissionSettings();
        throw new InstallPermissionError();
      }
      logger.warn("[appUpdate] Instalador nativo falló, probando FileOpener", {
        error: message,
      });
    }
  }

  try {
    await FileOpener.openFile({ path: apkPath, mimeType: APK_MIME });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("[appUpdate] FileOpener falló", { error: message });
    await openInstallPermissionSettings();
    throw new InstallPermissionError(
      "No se pudo abrir el instalador. Habilita «Instalar apps desconocidas» para DE PANA e inténtalo de nuevo.",
    );
  }
}

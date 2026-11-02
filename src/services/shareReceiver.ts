import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Plugin nativo ShareReceiver (android/app/src/main/java/com/redon/app/ShareReceiverPlugin.java).
 * Recibe rutas absolutas de archivos ya copiados a la caché privada de la app.
 */
export interface ShareReceiverPlugin {
  getPendingShare(): Promise<{ paths: string[] }>;
  addListener(
    eventName: "shareReceived",
    listener: (data: { paths: string[] }) => void,
  ): Promise<PluginListenerHandle>;
}

const ShareReceiver = registerPlugin<ShareReceiverPlugin>("ShareReceiver");

export interface SharedImage {
  /** Ruta absoluta en la caché privada de la app. */
  path: string;
  /** URL utilizable por el WebView (<img src>, fetch, etc.). */
  url: string;
}

const seenPaths = new Set<string>();

function toSharedImages(paths: unknown): SharedImage[] {
  if (!Array.isArray(paths)) return [];
  const fresh: SharedImage[] = [];
  for (const value of paths) {
    if (typeof value !== "string" || value.length === 0 || seenPaths.has(value)) continue;
    seenPaths.add(value);
    fresh.push({ path: value, url: Capacitor.convertFileSrc(value) });
  }
  return fresh;
}

/**
 * Escucha imágenes compartidas desde Android.
 *
 * - En web/dev no hace nada.
 * - Al montar consume las pendientes (arranque en frío).
 * - Deduplica rutas para que el evento y getPendingShare no procesen dos veces.
 *
 * Devuelve una función para quitar el listener.
 */
export async function initShareReceiver(
  onImages: (images: SharedImage[]) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const handle = await ShareReceiver.addListener("shareReceived", (data) => {
    const images = toSharedImages(data?.paths);
    if (images.length > 0) onImages(images);
    // El nativo persiste las rutas ANTES de notificar (respaldo de arranque en
    // frío). Una vez entregadas en caliente hay que consumirlas para que no
    // vuelvan a aparecer en el próximo arranque. `getPendingShare` las devuelve
    // y las limpia; los duplicados ya los filtra `toSharedImages`.
    ShareReceiver.getPendingShare().catch(() => {});
  });

  try {
    const pending = await ShareReceiver.getPendingShare();
    const images = toSharedImages(pending?.paths);
    if (images.length > 0) onImages(images);
  } catch {
    // Sin pendientes: es normal.
  }

  return () => {
    void handle.remove();
  };
}

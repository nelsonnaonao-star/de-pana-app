import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Plugin nativo VideoCompressor
 * (android/app/src/main/java/com/redon/app/plugins/VideoCompressorPlugin.java).
 *
 * Usa Media3 Transformer + MediaCodec (encoder H.264 del dispositivo) para
 * recomprimir sin pasar por el WebView ni por MediaRecorder. Acepta y devuelve
 * URIs nativos (file:// o content://).
 */
export interface NativeVideoCompressOptions {
  uri: string;
  /** Lado corto objetivo en píxeles (720 = 720p). */
  height?: number;
  /** Bitrate de video objetivo en bps. */
  bitrate?: number;
}

export interface NativeVideoCompressResult {
  uri: string;
  path: string;
  size: number;
  width: number;
  height: number;
  durationMs: number;
  duration: number;
  mimeType: string;
  cancelled: boolean;
}

export interface NativeVideoProgressEvent {
  /** Progreso 0-100. */
  progress: number;
}

interface VideoCompressorNativePlugin {
  compress(options: NativeVideoCompressOptions): Promise<NativeVideoCompressResult>;
  cancel(): Promise<void>;
  delete(options: { path: string }): Promise<void>;
  addListener(
    eventName: "progress",
    listener: (event: NativeVideoProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const VideoCompressor = registerPlugin<VideoCompressorNativePlugin>("VideoCompressor");

export function isNativeVideoCompressionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("VideoCompressor");
}

export async function compressVideoNative(
  options: NativeVideoCompressOptions,
): Promise<NativeVideoCompressResult> {
  if (!isNativeVideoCompressionAvailable()) {
    throw new Error("La compresión nativa de video no está disponible en esta plataforma");
  }
  return VideoCompressor.compress(options);
}

export async function cancelNativeVideoCompression(): Promise<void> {
  if (!isNativeVideoCompressionAvailable()) return;
  try {
    await VideoCompressor.cancel();
  } catch {
    // No hay trabajo activo: cancelar es best-effort.
  }
}

export async function deleteNativeVideoFile(path: string): Promise<void> {
  if (!isNativeVideoCompressionAvailable() || !path) return;
  try {
    await VideoCompressor.delete({ path });
  } catch {
    // La limpieza de caché nunca debe romper el envío.
  }
}

export function onNativeVideoProgress(
  listener: (event: NativeVideoProgressEvent) => void,
): Promise<PluginListenerHandle> {
  return VideoCompressor.addListener("progress", listener);
}

export async function removeNativeVideoProgressListeners(): Promise<void> {
  if (!isNativeVideoCompressionAvailable()) return;
  try {
    await VideoCompressor.removeAllListeners();
  } catch {
    // Sin listeners registrados.
  }
}

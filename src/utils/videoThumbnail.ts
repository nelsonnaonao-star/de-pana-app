const MAX_EDGE = 600;

function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string {
  let w = video.videoWidth || 320;
  let h = video.videoHeight || 180;
  if (w > MAX_EDGE) {
    h = Math.floor((MAX_EDGE / w) * h);
    w = MAX_EDGE;
  }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/**
 * Genera una miniatura (data URL JPEG) del primer frame de un archivo/blob de
 * video. Usado por el emisor para notas de video y videos de galería.
 */
export function generateVideoThumbnail(source: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.src = URL.createObjectURL(source);
    video.onloadeddata = () => {
      video.currentTime = 0.5;
    };
    video.onseeked = () => {
      try {
        const dataUrl = drawFrame(video, document.createElement("canvas"));
        URL.revokeObjectURL(video.src);
        resolve(dataUrl);
      } catch (e) {
        URL.revokeObjectURL(video.src);
        reject(e);
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Error generando thumbnail"));
    };
  });
}

/**
 * Captura el frame actual de un <video> ya cargado en el DOM (primer frame
 * disponible). NO vuelve a descargar el video: usa lo que ya cargó el elemento.
 */
export async function generateVideoThumbnailFromElement(video: HTMLVideoElement): Promise<string> {
  return drawFrame(video, document.createElement("canvas"));
}
import { useEffect, useState } from "react";
import { initShareReceiver, type SharedImage } from "../services/shareReceiver";

/**
 * Hook de ejemplo para recibir imágenes compartidas desde Android.
 *
 * Uso:
 *   const { images, clear } = useSharedImages();
 *   // images[0].path -> ruta absoluta en caché
 *   // images[0].url  -> URL para <img src={images[0].url} />
 *
 * Para subir la imagen:
 *   const blob = await fetch(images[0].url).then((r) => r.blob());
 */
export function useSharedImages() {
  const [images, setImages] = useState<SharedImage[]>([]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    initShareReceiver((incoming) => {
      if (disposed || incoming.length === 0) return;
      setImages((prev) => [...prev, ...incoming]);
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          cleanup = fn;
        }
      })
      .catch(() => {
        // En web o si el plugin no está disponible, no hay nada que hacer.
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return {
    images,
    clear: () => setImages([]),
  };
}

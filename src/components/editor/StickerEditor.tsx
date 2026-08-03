import React, { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, FabricImage, IText, Shadow } from "fabric";
import { removeBackground as removeBgFromImage, preload as preloadBgModel } from "@imgly/background-removal";
import { ImageIcon, Loader2, Scissors, Type, Save, X } from "lucide-react";

export interface StickerExport {
  webpBase64: string;
  width: number;
  height: number;
  name: string;
}

interface StickerEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (sticker: StickerExport) => void;
  initialImage?: string;
}

const CANVAS_SIZE = 512;

function getBgPublicPath() {
  const origin = window.location.origin;
  return new URL("/background-removal/", `${origin}/`).toString();
}

const BG_MODEL_CONFIG = {
  publicPath: getBgPublicPath(),
  model: "isnet_quint8" as const,
  device: "cpu" as const,
  proxyToWorker: true,
  output: { format: "image/png" as const },
  progress: () => undefined,
};

const FONTS = [
  { name: "Luckiest Guy", family: '"Luckiest Guy", system-ui, sans-serif' },
  { name: "Fredoka One", family: '"Fredoka One", "Baloo 2", system-ui, sans-serif' },
  { name: "Bangers", family: '"Bangers", system-ui, sans-serif' },
  { name: "Baloo 2", family: '"Baloo 2", "Fredoka One", system-ui, sans-serif' },
];

function loadGoogleFonts() {
  try {
    const id = "sticker-google-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fredoka+One&family=Baloo+2:wght@600;800&family=Luckiest+Guy&family=Bangers&display=swap";
    document.head.appendChild(link);
  } catch {
    /* fonts are optional */
  }
}

async function waitForFont() {
  try {
    await Promise.all(FONTS.map((f) => document.fonts.load(`64px ${f.family}`)));
  } catch {
    /* fallback fonts are fine */
  }
}

async function elementToBlob(imgEl: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = imgEl.naturalWidth || imgEl.width;
  canvas.height = imgEl.naturalHeight || imgEl.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.drawImage(imgEl, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo convertir la imagen a Blob");
  return blob;
}

async function resizeImageElement(imgEl: HTMLImageElement, maxSize = 1024): Promise<Blob> {
  const w = imgEl.naturalWidth || imgEl.width;
  const h = imgEl.naturalHeight || imgEl.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("No se pudo convertir a Blob");
  return blob;
}

const ALPHA_THRESHOLD = 200;

function thresholdAlpha(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  g.drawImage(img, 0, 0);
  const imageData = g.getImageData(0, 0, w, h);
  const pixels = imageData.data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < ALPHA_THRESHOLD) pixels[i] = 0;
  }
  g.putImageData(imageData, 0, 0);
  return c;
}

function makeWhiteSilhouette(source: HTMLCanvasElement | HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  g.drawImage(source, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  return c;
}

async function createStickerOutlineBlob(blob: Blob, radius: number): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.width;
  const h = img.height;
  const cleaned = thresholdAlpha(img, w, h);
  const silhouette = makeWhiteSilhouette(cleaned, w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w + radius * 2;
  canvas.height = h + radius * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    return blob;
  }
  const cx = radius;
  const cy = radius;
  const offsets: Array<[number, number]> = [];
  const steps = Math.max(12, radius * 4);
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    offsets.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
  }
  for (const [dx, dy] of offsets) {
    ctx.drawImage(silhouette, cx + dx, cy + dy);
  }
  ctx.drawImage(cleaned, cx, cy);
  URL.revokeObjectURL(url);
  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  return out;
}

export default function StickerEditor({ isOpen, onClose, onExport, initialImage }: StickerEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removingBg, setRemovingBg] = useState(false);
  const [bgProgress, setBgProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [fontIndex, setFontIndex] = useState(0);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const fCanvas = new Canvas(canvasRef.current, {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      backgroundColor: "rgba(0,0,0,0)",
      selection: true,
      preserveObjectStacking: true,
      enableRetinaScaling: true,
      renderOnAddRemove: true,
    });

    fabricRef.current = fCanvas;
    setNotice("Carga una foto o agrega texto para crear tu sticker");

    if (initialImage) {
      FabricImage.fromURL(initialImage, { crossOrigin: "anonymous" })
        .then((img) => {
          placeImageCentered(fCanvas, img);
          setNotice("");
        })
        .catch(() => setNotice("No se pudo cargar la imagen inicial"));
    }

    preloadBgModel(BG_MODEL_CONFIG).catch((err) => {
      console.error("[StickerEditor] Modelo de fondo no pudo precargarse:", err);
    });
    console.log("[StickerEditor][diag] crossOriginIsolated:", self.crossOriginIsolated);
    console.log("[StickerEditor][diag] hardwareConcurrency:", navigator.hardwareConcurrency);
    console.log("[StickerEditor][diag] userAgent:", navigator.userAgent);
    return () => {
      fCanvas.dispose();
      fabricRef.current = null;
    };
  }, [isOpen, initialImage]);

  useEffect(() => {
    if (isOpen) loadGoogleFonts();
  }, [isOpen]);

  if (!isOpen) return null;

  function placeImageCentered(fCanvas: Canvas, img: FabricImage) {
    const w = img.width || img.getScaledWidth();
    const h = img.height || img.getScaledHeight();
    if (!w || !h) {
      fCanvas.add(img);
      fCanvas.centerObject(img);
      fCanvas.setActiveObject(img);
      fCanvas.renderAll();
      return;
    }
    const scale = Math.min(CANVAS_SIZE / w, CANVAS_SIZE / h, 1);
    img.set({
      scaleX: scale,
      scaleY: scale,
      left: (CANVAS_SIZE - w * scale) / 2,
      top: (CANVAS_SIZE - h * scale) / 2,
    });
    fCanvas.add(img);
    fCanvas.centerObject(img);
    fCanvas.setActiveObject(img);
    fCanvas.renderAll();
  }

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const fCanvas = fabricRef.current;
    if (!file || !fCanvas) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const url = ev.target?.result as string;
      try {
        const isRemote = /^https?:\/\//i.test(url);
        const img = await FabricImage.fromURL(url, isRemote ? { crossOrigin: "anonymous" } : {});
        placeImageCentered(fCanvas, img);
        setNotice("");
      } catch (err) {
        console.error("[StickerEditor] image load failed:", err);
        setNotice("No se pudo cargar la imagen");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveBg = useCallback(async () => {
    const fCanvas = fabricRef.current;
    if (!fCanvas || removingBg) return;

    const active = fCanvas.getActiveObject();
    const target =
      active && active.type === "image"
        ? (active as FabricImage)
        : (fCanvas.getObjects().filter((o) => o.type === "image").pop() as FabricImage | undefined);
    if (!target) {
      setNotice("Primero carga una imagen");
      return;
    }

    setRemovingBg(true);
    setBgProgress(0);
    setNotice("Quitando fondo…");
    try {
      const imgEl = target.getElement() as HTMLImageElement;
      const resizedBlob = await resizeImageElement(imgEl, 1024);
      console.log("[StickerEditor][diag] blob.size:", resizedBlob.size);
      console.time("[StickerEditor][diag] removeBgFromImage");
      const blob = await removeBgFromImage(resizedBlob, {
        ...BG_MODEL_CONFIG,
        progress: (key, current, total) => {
          if (total > 0) setBgProgress(Math.min(100, Math.round((current / total) * 100)));
        },
      });
      console.timeEnd("[StickerEditor][diag] removeBgFromImage");

      const sizeSrc = await createImageBitmap(blob);
      const radius = Math.max(3, Math.min(6, Math.round(Math.min(sizeSrc.width, sizeSrc.height) * 0.03)));
      sizeSrc.close();
      const outlinedBlob = await createStickerOutlineBlob(blob, radius);
      const outUrl = URL.createObjectURL(outlinedBlob);

      const displayW = target.getScaledWidth();
      const displayH = target.getScaledHeight();
      const left = target.left;
      const top = target.top;
      const angle = target.angle;

      const newImg = await FabricImage.fromURL(outUrl, {});
      URL.revokeObjectURL(outUrl);
      newImg.set({
        left,
        top,
        angle,
        stroke: "#ffffff",
        strokeWidth: 4,
        shadow: new Shadow({
          color: "rgba(0,0,0,0.45)",
          blur: 10,
          offsetX: 4,
          offsetY: 6,
        }),
      });
      newImg.scaleToWidth(displayW);
      newImg.scaleToHeight(displayH);

      fCanvas.remove(target);
      fCanvas.add(newImg);
      fCanvas.setActiveObject(newImg);
      fCanvas.renderAll();
      setNotice("Fondo eliminado ✓");
    } catch (err) {
      console.error("[StickerEditor] Background removal failed:", err);
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Error desconocido";
      if (/fetch|network|Failed to fetch|load resource|Failed to create session|wasm|onnx/i.test(message)) {
        console.error(
          "[StickerEditor] Causa probable: no se pudieron cargar los archivos del modelo local " +
            "en /background-removal/ (WASM/ONNX). Verifica que existan en public/."
        );
        setNotice("No se pudo cargar el modelo local de IA para quitar el fondo.");
      } else {
        setNotice("Error al procesar el fondo. Prueba con otra foto.");
      }
    } finally {
      setRemovingBg(false);
      setBgProgress(0);
    }
  }, [removingBg]);

  const handleAddText = useCallback(async () => {
    const fCanvas = fabricRef.current;
    if (!fCanvas) return;
    await waitForFont();
    const text = new IText("TEXTO", {
      left: CANVAS_SIZE / 2,
      top: CANVAS_SIZE / 2,
      originX: "center",
      originY: "center",
      fontSize: 64,
      fontFamily: FONTS[fontIndex].family,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 4,
      textAlign: "center",
      editable: true,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      lockMovementX: false,
      lockMovementY: false,
      lockScalingX: false,
      lockScalingY: false,
      lockRotation: false,
    });
    fCanvas.add(text);
    fCanvas.setActiveObject(text);
    fCanvas.renderAll();
    setNotice(`Texto agregado — Fuente: ${FONTS[fontIndex].name}. Toca dos veces para editarlo.`);
  }, [fontIndex]);

  const handleTextAction = useCallback(async () => {
    const fCanvas = fabricRef.current;
    if (!fCanvas) return;
    const active = fCanvas.getActiveObject();
    if (active && (active as IText).type === "i-text") {
      const nextIndex = (fontIndex + 1) % FONTS.length;
      setFontIndex(nextIndex);
      await waitForFont();
      active.set({ fontFamily: FONTS[nextIndex].family });
      fCanvas.renderAll();
      setNotice(`Fuente: ${FONTS[nextIndex].name}`);
    } else {
      handleAddText();
    }
  }, [fontIndex, handleAddText]);

  const handleExport = useCallback(() => {
    const fCanvas = fabricRef.current;
    if (!fCanvas) return;
    try {
      const dataUrl = fCanvas.toDataURL({ format: "webp", quality: 0.9, multiplier: 1 });
      const base64 = dataUrl.split(",")[1];
      if (!base64) {
        setNotice("Nada que exportar todavía");
        return;
      }
      onExport({
        webpBase64: base64,
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        name: `sticker_${Date.now()}.webp`,
      });
    } catch (err) {
      console.error("[StickerEditor] Export failed:", err);
      setNotice("Error al exportar el sticker");
    }
  }, [onExport]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Editor de Stickers"
    >
      <div className="flex items-center justify-between p-3 border-b border-white/10 bg-black/80 shrink-0">
        <h2 className="text-xs font-black text-teal-400 tracking-wider uppercase">Sticker Studio</h2>
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-3 relative overflow-hidden min-h-0">
        <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10 max-w-full">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="w-auto max-w-full max-h-[55vh] aspect-square"
            style={{ width: "min(512px, 100%)", height: "auto" }}
          />
          {removingBg && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10">
              <Loader2 className="w-10 h-10 text-teal-400 animate-spin" />
              <p className="text-sm font-bold text-white">Quitando fondo…</p>
              <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-400 transition-all duration-200"
                  style={{ width: `${bgProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {notice && (
          <p className="mt-4 text-xs text-white/70 text-center max-w-xs">{notice}</p>
        )}
      </div>

      <div className="px-3 pb-1 shrink-0 flex items-center justify-center gap-2">
        {FONTS.map((font, i) => (
          <button
            key={font.name}
            onClick={async () => {
              const fCanvas = fabricRef.current;
              if (!fCanvas) return;
              setFontIndex(i);
              await waitForFont();
              const active = fCanvas.getActiveObject();
              if (active && (active as IText).type === "i-text") {
                active.set({ fontFamily: font.family });
              }
              fCanvas.renderAll();
              setNotice(`Fuente: ${font.name}`);
            }}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
              fontIndex === i
                ? "bg-teal-500/40 border-teal-400 text-white"
                : "bg-white/10 border-white/15 text-white/70 hover:bg-white/20"
            }`}
            style={{ fontFamily: font.family }}
            aria-label={`Fuente ${font.name}`}
          >
            {font.name}
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-white/10 bg-black/80 shrink-0">
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 w-16 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white"
            aria-label="Cargar imagen"
          >
            <ImageIcon className="w-5 h-5 text-teal-300" />
            <span className="text-[9px] font-bold">Cargar</span>
          </button>
          <button
            onClick={handleRemoveBg}
            disabled={removingBg}
            className="flex flex-col items-center justify-center gap-1 w-16 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400 text-white disabled:opacity-50"
            aria-label="Quitar fondo"
          >
            {removingBg ? (
              <Loader2 className="w-5 h-5 text-purple-300 animate-spin" />
            ) : (
              <Scissors className="w-5 h-5 text-purple-300" />
            )}
            <span className="text-[9px] font-bold">Quitar fondo</span>
          </button>
          <button
            onClick={handleTextAction}
            className="flex flex-col items-center justify-center gap-1 w-16 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white"
            aria-label="Agregar texto"
          >
            <Type className="w-5 h-5 text-teal-300" />
            <span className="text-[9px] font-bold">Texto</span>
          </button>
          <button
            onClick={handleExport}
            className="flex flex-col items-center justify-center gap-1 w-16 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 border border-teal-300 text-white"
            aria-label="Exportar sticker"
          >
            <Save className="w-5 h-5" />
            <span className="text-[9px] font-bold">Exportar</span>
          </button>
        </div>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>
    </div>
  );
}

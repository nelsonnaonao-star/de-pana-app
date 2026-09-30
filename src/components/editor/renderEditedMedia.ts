// Compone la imagen final del Editor Pro (imagen base + filtros CSS + textos +
// stickers + marca de agua) en un canvas. Sin dependencias externas.
// La salida es un data URL PNG que puede subirse a Storage igual que una foto
// subida por el usuario.

export interface EditedMediaTextOverlay {
  text: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  fontSizePx: number;
  maxWidthRatio: number;
}

export interface EditedMediaBadgeOverlay {
  text: string;
  fontSizePx: number;
  fontWeight: number;
  textColor: string;
  background: string;
  gradient?: [string, string];
  borderWidthPx: number;
  borderColor: string;
  // radiusPx negativo => pastilla (altura/2)
  radiusPx: number;
  padXPx: number;
  padYPx: number;
  rotationDeg: number;
  anchor: "top-left" | "top-right";
  offsetXPx: number;
  offsetYPx: number;
}

export interface RenderEditedMediaOptions {
  source: string;
  filterCss: string;
  containerWidth: number;
  containerHeight: number;
  text?: EditedMediaTextOverlay | null;
  badges?: EditedMediaBadgeOverlay[];
  bottomGradient?: boolean;
  outputWidth?: number;
}

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen base"));
    img.src = src;
  });
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: EditedMediaTextOverlay,
  outW: number,
  outH: number,
  scale: number
): void {
  const fontSize = Math.max(8, text.fontSizePx * scale * text.scale);
  ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = fontSize * 0.35;
  ctx.shadowOffsetY = fontSize * 0.12;

  const maxWidth = outW * text.maxWidthRatio;
  const content = text.text.toUpperCase();
  const lines = wrapLines(ctx, content, maxWidth);
  const lineHeight = fontSize * 1.15;
  const widest = lines.reduce((max, line) => {
    const w = ctx.measureText(line).width;
    return w > max ? w : max;
  }, 0);
  const blockWidth = Math.min(maxWidth, widest);

  const centerX = outW / 2 + text.offsetX * scale;
  const centerY = outH / 2 + text.offsetY * scale;
  const startX = centerX - blockWidth / 2;
  let y = centerY - (lines.length * lineHeight) / 2;

  for (const line of lines) {
    ctx.fillText(line, startX, y);
    y += lineHeight;
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  badge: EditedMediaBadgeOverlay,
  outW: number,
  scale: number
): void {
  const fontSize = Math.max(6, badge.fontSizePx * scale);
  ctx.font = `${badge.fontWeight} ${fontSize}px ${FONT_STACK}`;

  const padX = badge.padXPx * scale;
  const padY = badge.padYPx * scale;
  const border = badge.borderWidthPx * scale;
  const boxW = ctx.measureText(badge.text).width + padX * 2 + border * 2;
  const boxH = fontSize * 1.2 + padY * 2 + border * 2;
  const radius = badge.radiusPx < 0 ? boxH / 2 : badge.radiusPx * scale;

  const x =
    badge.anchor === "top-left"
      ? badge.offsetXPx * scale
      : outW - badge.offsetXPx * scale - boxW;
  const y = badge.offsetYPx * scale;
  const cx = x + boxW / 2;
  const cy = y + boxH / 2;

  ctx.save();
  if (badge.rotationDeg) {
    ctx.translate(cx, cy);
    ctx.rotate((badge.rotationDeg * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  if (badge.gradient) {
    const grad = ctx.createLinearGradient(x, y, x + boxW, y);
    grad.addColorStop(0, badge.gradient[0]);
    grad.addColorStop(1, badge.gradient[1]);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = badge.background;
  }
  roundRect(ctx, x, y, boxW, boxH, radius);
  ctx.fill();

  if (border > 0 && badge.borderColor) {
    ctx.lineWidth = border;
    ctx.strokeStyle = badge.borderColor;
    roundRect(ctx, x + border / 2, y + border / 2, boxW - border, boxH - border, radius);
    ctx.stroke();
  }

  ctx.fillStyle = badge.textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge.text, cx, cy + fontSize * 0.06);
  ctx.restore();
}

export async function renderEditedMedia(
  opts: RenderEditedMediaOptions
): Promise<string> {
  const {
    source,
    filterCss,
    containerWidth,
    containerHeight,
    text = null,
    badges = [],
    bottomGradient = true,
    outputWidth = 1080,
  } = opts;

  if (!source || source.startsWith("data:video")) {
    throw new Error("El render de superposiciones sólo aplica a imágenes");
  }
  if (containerWidth < 10 || containerHeight < 10) {
    throw new Error("Lienzo del editor no disponible");
  }

  const img = await loadImage(source);
  const outW = outputWidth;
  const outH = Math.max(1, Math.round(outputWidth * (containerHeight / containerWidth)));
  const scale = outW / containerWidth;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no soportado en este dispositivo");

  // Imagen base con object-cover + los mismos filtros CSS de la vista previa.
  const coverScale = Math.max(outW / img.naturalWidth, outH / img.naturalHeight);
  const drawW = img.naturalWidth * coverScale;
  const drawH = img.naturalHeight * coverScale;
  const drawX = (outW - drawW) / 2;
  const drawY = (outH - drawH) / 2;
  ctx.filter = filterCss && filterCss.trim() ? filterCss.trim() : "none";
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.filter = "none";

  if (bottomGradient) {
    const grad = ctx.createLinearGradient(0, outH * 0.4, 0, outH);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, outH * 0.4, outW, outH * 0.6);
  }

  for (const badge of badges) {
    drawBadge(ctx, badge, outW, scale);
  }

  if (text && text.text.trim()) {
    drawText(ctx, text, outW, outH, scale);
  }

  return canvas.toDataURL("image/png");
}

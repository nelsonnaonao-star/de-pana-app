import type { CSSProperties } from "react";
import { CHAT_BACKGROUNDS } from "./chatConstants";

export interface ChatBackdropPrefs {
  selectedBgId: string;
  customBgImage: string | null;
}

export type ChatPatternTheme =
  | "stars" | "bubbles" | "dots" | "constellation" | "waves" | "sparkle";

export interface ChatBackdrop {
  containerBgStyle: CSSProperties;
  isPatternBg: boolean;
  patternTheme: ChatPatternTheme;
  patternFrom: string;
  patternTo: string;
  needsDarkOverlay: boolean;
}

// ÚNICA fuente de verdad de las preferencias de wallpaper. Las mismas claves
// que lee/escribe ChatRoom.tsx, para que el fallback de espera y el ChatRoom
// real resuelvan SIEMPRE el mismo fondo sin duplicar la lógica de selección.
export const readChatBackdropPrefs = (): ChatBackdropPrefs => ({
  selectedBgId:
    (typeof localStorage !== "undefined" && localStorage.getItem("chat_bg_id")) || "wepa",
  customBgImage:
    (typeof localStorage !== "undefined" && localStorage.getItem("chat_bg_custom")) || null,
});

// Resolución del wallpaper. Es una extracción LITERAL del bloque que ya existía
// dentro de ChatRoom.tsx, sin cambios de resultado: ese componente ahora
// consume esta función, de modo que el fallback y el chat real comparten
// una única implementación.
export function resolveChatBackdrop(
  selectedBgId: string,
  customBgImage: string | null,
): ChatBackdrop {
  const isCustomBg = selectedBgId === "custom" && !!customBgImage;
  const bgPreset = isCustomBg ? undefined : CHAT_BACKGROUNDS.find(bg => bg.id === selectedBgId);
  const rawBg = isCustomBg
    ? `url("${customBgImage}") center/cover no-repeat`
    : (bgPreset?.value || "#f8fafc");
  const isPatternBg = rawBg.startsWith("pattern:");
  const isGradientBg = rawBg.startsWith("linear-gradient");
  const isImageBg = rawBg.startsWith("url");

  const patternParts = isPatternBg ? rawBg.replace("pattern:", "").split("|") : [];
  const patternTheme = (patternParts[0] || "stars") as ChatPatternTheme;
  const patternFrom = patternParts[1] || "blue";
  const patternTo = patternParts[2] || "purple";

  const containerBgStyle: CSSProperties = isPatternBg
    ? { background: "transparent" }
    : isGradientBg
      ? { backgroundImage: rawBg }
      : isImageBg
        ? {
            backgroundImage: rawBg.replace(/ center\/cover no-repeat$/, ''),
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }
        : { backgroundColor: rawBg };

  const needsDarkOverlay =
    !isPatternBg && !isGradientBg &&
    selectedBgId !== "default" && selectedBgId !== "wepa" &&
    selectedBgId !== "wepa_light" && selectedBgId !== "wepa_neon" &&
    selectedBgId !== "minimal_white" && selectedBgId !== "olive" &&
    selectedBgId !== "pink";

  return {
    containerBgStyle,
    isPatternBg,
    patternTheme,
    patternFrom,
    patternTo,
    needsDarkOverlay,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE E3 · PREDECODIFICACIÓN DEL WALLPAPER
//
// El wallpaper del chat es un `background-image`. Hasta que el recurso se
// descarga y decodifica, ese elemento NO tiene `background-color`, así que es
// TRANSPARENTE y se ve el `bg-white` del overlay que lo envuelve. Esa es la
// última discontinuidad observable: el chat ya está revelado, pero su fondo
// todavía no existe y se transparenta a blanco.
//
// Se resuelve SIEMPRE con la misma fuente de verdad (`readChatBackdropPrefs` +
// `resolveChatBackdrop`), la misma que usa ChatRoom, y se precarga el MISMO
// recurso: no hay wallpaper alternativo ni cambio de apariencia final.
// Los patrones, gradientes y colores sólidos no tienen nada que decodificar —su
// superficie ya está lista en el primer paint— y por eso no hacen trabajo alguno.
// ─────────────────────────────────────────────────────────────────────────────

// "pending" = decodificación en vuelo, "ready" = ya decodificado. Si falla, la
// entrada se borra para que un intento posterior pueda reintentarla.
const wallpaperPreload = new Map<string, "pending" | "ready">();

// Extrae la URL real del `background-image` resuelto por `resolveChatBackdrop`.
// Devuelve null para gradientes, patrones y colores sólidos, que no son imágenes.
export function chatBackdropImageUrl(backdrop: ChatBackdrop): string | null {
  const raw = (backdrop.containerBgStyle as { backgroundImage?: string }).backgroundImage;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("url(") || !trimmed.endsWith(")")) return null;
  const inner = trimmed.slice(4, -1).trim().replace(/^['"]/, "").replace(/['"]$/, "");
  return inner || null;
}

// Decodifica por adelantado el wallpaper vigente. Es idempotente y barata: si ya
// está en vuelo o listo, no hace nada; si el decode falla, no deja el estado
// envenenado para reintentarlo más tarde.
export function warmChatBackdrop(): void {
  if (typeof window === "undefined" || typeof Image === "undefined") return;
  const prefs = readChatBackdropPrefs();
  const url = chatBackdropImageUrl(resolveChatBackdrop(prefs.selectedBgId, prefs.customBgImage));
  if (!url) return;
  if (wallpaperPreload.has(url)) return;

  wallpaperPreload.set(url, "pending");
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    if (typeof img.decode === "function") {
      img.decode()
        .then(() => { wallpaperPreload.set(url, "ready"); })
        .catch(() => { wallpaperPreload.delete(url); });
    } else {
      // WebView sin `decode()`: con `src` el recurso entra igual al caché.
      wallpaperPreload.set(url, "ready");
    }
  } catch {
    wallpaperPreload.delete(url);
  }
}

// Al volver a foreground el WebView puede haber purgado las imágenes ya
// decodificadas, así que se revalida el estado. Un `decode()` sobre una imagen
// que sigue en caché resuelve de inmediato, sin trabajo inútil.
export function invalidateChatBackdropPreload(): void {
  wallpaperPreload.clear();
}

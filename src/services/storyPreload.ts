import { logger } from "../lib/logger";

// Precarga progresiva de los videos de estados. El visor crea el <video> solo
// al abrir la historia; sin esta precarga la descarga empieza en ese instante y
// en Android WebView se ve un negro de varios segundos. Mantenemos un <video>
// oculto con `preload="auto"` por URL: el navegador bufferea los primeros
// segundos y, al abrir el visor, el mismo recurso sale de cache.
const MAX_PRELOADS = 4;

interface PreloadEntry {
  el: HTMLVideoElement;
  lastUsed: number;
}

const preloads = new Map<string, PreloadEntry>();
const failed = new Set<string>();
let pinnedUrl: string | null = null;

function isRemoteVideo(url?: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

function createPreloadElement(url: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.preload = "auto";
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.style.position = "fixed";
  el.style.width = "1px";
  el.style.height = "1px";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.style.left = "-9999px";
  el.style.top = "-9999px";
  el.src = url;
  // Algunos WebView no empiezan a buffereár si el elemento no está en el DOM.
  document.body.appendChild(el);
  el.load();
  return el;
}

function removeEntry(url: string) {
  const entry = preloads.get(url);
  if (!entry) return;
  try {
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
    entry.el.remove();
  } catch {
    // best-effort
  }
  preloads.delete(url);
}

function evictOverflow() {
  if (preloads.size <= MAX_PRELOADS) return;
  const candidates = [...preloads.entries()]
    .filter(([url]) => url !== pinnedUrl)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

  for (const [url] of candidates) {
    if (preloads.size <= MAX_PRELOADS) break;
    removeEntry(url);
  }
}

export function preloadStoryVideo(url?: string | null) {
  if (!isRemoteVideo(url) || failed.has(url)) return;

  const existing = preloads.get(url);
  if (existing) {
    existing.lastUsed = Date.now();
    return;
  }

  try {
    const el = createPreloadElement(url);
    preloads.set(url, { el, lastUsed: Date.now() });

    el.addEventListener(
      "error",
      () => {
        logger.warn("[StoryPreload] video failed", { url });
        failed.add(url);
        removeEntry(url);
      },
      { once: true },
    );

    evictOverflow();
  } catch (e) {
    logger.warn("[StoryPreload] could not create preload", { error: e });
  }
}

// `urls` debe venir en orden de reproducción: primero la historia que se abre
// y luego las siguientes. Se ignoran duplicados y URLs no http(s).
export function preloadStoryVideos(urls: Array<string | null | undefined>) {
  for (const url of urls) {
    if (!url) continue;
    if (!preloads.has(url) && preloads.size >= MAX_PRELOADS) break;
    preloadStoryVideo(url);
  }
}

// Fija el video que el usuario está viendo para que la limpieza no lo descarte
// mientras se precargan los siguientes.
export function pinStoryVideo(url?: string | null) {
  pinnedUrl = isRemoteVideo(url) ? url : null;
  const entry = pinnedUrl ? preloads.get(pinnedUrl) : null;
  if (entry) entry.lastUsed = Date.now();
}

export function releaseStoryPreloads() {
  pinnedUrl = null;
  for (const url of [...preloads.keys()]) removeEntry(url);
}

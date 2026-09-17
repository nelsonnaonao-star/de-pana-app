import React, { useRef } from "react";
import { ArrowLeft, Check, CheckCheck, Palette, Star, Upload, X } from "lucide-react";
import { CHAT_BACKGROUNDS, CHAT_BACKGROUND_CATEGORIES, BUBBLE_PRESETS_ME, BUBBLE_PRESETS_THEM } from "./chatConstants";
import ChatPatternBackground from "./ChatPatternBackground";
import { compressImage } from "../../services/storage";

export type PreviewTarget = { type: "bg"; id: string } | { type: "custom" };

type PatternTheme = "stars" | "bubbles" | "dots" | "constellation" | "waves" | "sparkle";

interface BgVisual {
  style: React.CSSProperties;
  pattern: { theme: PatternTheme; from: string; to: string } | null;
}

function resolveBgVisual(value: string): BgVisual {
  if (value.startsWith("pattern:")) {
    const [theme, from, to] = value.replace("pattern:", "").split("|");
    return {
      style: { background: "transparent" },
      pattern: { theme: (theme || "stars") as PatternTheme, from: from || "blue", to: to || "purple" },
    };
  }
  if (value.startsWith("linear-gradient")) {
    return { style: { backgroundImage: value }, pattern: null };
  }
  if (value.startsWith("url")) {
    const m = value.match(/url\((.*?)\)/);
    return {
      style: {
        backgroundImage: m ? `url(${m[1]})` : value,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      },
      pattern: null,
    };
  }
  return { style: { backgroundColor: value }, pattern: null };
}

const PATTERN_GRADIENT_MAP: Record<string, string> = {
  "blue|purple": "linear-gradient(135deg, #60a5fa, #a78bfa)",
  "teal|cyan": "linear-gradient(135deg, #2dd4bf, #22d3ee)",
  "pink|rose": "linear-gradient(135deg, #f472b6, #fb7185)",
  "emerald|teal": "linear-gradient(135deg, #34d399, #2dd4bf)",
  "orange|amber": "linear-gradient(135deg, #fb923c, #fbbf24)",
  "indigo|violet": "linear-gradient(135deg, #818cf8, #a78bfa)",
  "slate|blue": "linear-gradient(135deg, #94a3b8, #60a5fa)",
  "rose|pink": "linear-gradient(135deg, #fb7185, #f472b6)",
};

interface ChatCustomizerProps {
  showCustomizer: boolean;
  setShowCustomizer: (v: boolean) => void;
  selectedBgId: string;
  setSelectedBgId: (id: string) => void;
  bubbleColorMeId: string;
  setBubbleColorMeId: (id: string) => void;
  bubbleColorThemId: string;
  setBubbleColorThemId: (id: string) => void;
  chatName: string;
  customBgImage: string | null;
  onSetCustomBgImage: (dataUrl: string | null) => void;
  pendingBg: PreviewTarget | null;
  setPendingBg: (target: PreviewTarget | null) => void;
}

function getThumbPreviewStyle(value: string): React.CSSProperties {
  if (value.startsWith("linear-gradient")) return { background: value };
  if (value.includes("url")) return { background: value, backgroundSize: "cover", backgroundPosition: "center" };
  if (value.startsWith("pattern:")) {
    const [theme, from, to] = value.replace("pattern:", "").split("|");
    const key = `${from}|${to}`;
    const fallback = theme === "stars" || theme === "sparkle" || theme === "dots"
      ? "linear-gradient(135deg, #60a5fa, #a78bfa)"
      : "linear-gradient(135deg, #2dd4bf, #22d3ee)";
    return { background: PATTERN_GRADIENT_MAP[key] || fallback };
  }
  return { background: value };
}

const DEMO_MESSAGES = [
  { sender: "them" as const, text: "¡WEPA! 🔥 ¿Cómo va todo por allá?" },
  { sender: "me" as const, text: "¡Todo fluyendo! La mercancía nueva llegó ✨" },
  { sender: "me" as const, text: "Te envío las fotos del catálogo en un rato 📸" },
];

interface BackgroundPreviewProps {
  target: PreviewTarget;
  selectedBgId: string;
  customBgImage: string | null;
  chatName: string;
  bubbleMeCss: string;
  bubbleThemCss: string;
  onCancel: () => void;
  onUse: () => void;
}

function BackgroundPreview({
  target,
  selectedBgId,
  customBgImage,
  chatName,
  bubbleMeCss,
  bubbleThemCss,
  onCancel,
  onUse,
}: BackgroundPreviewProps) {
  const isCustom = target.type === "custom";
  const bg = isCustom ? undefined : CHAT_BACKGROUNDS.find(b => b.id === target.id);
  const visual = isCustom && customBgImage
    ? {
        style: {
          backgroundImage: `url(${customBgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        },
        pattern: null,
      }
    : resolveBgVisual(bg?.value ?? "#f8fafc");
  const esOficial = !!bg && bg.categoria === "oficiales";
  const nombre = isCustom ? "Mi foto" : (bg?.name ?? "Fondo");
  const enUso = isCustom ? selectedBgId === "custom" : selectedBgId === bg?.id;

  return (
    <div
      className="fixed inset-0 z-[220] flex flex-col overflow-hidden"
      style={visual.style}
      onClick={(e) => e.stopPropagation()}
    >
      {visual.pattern && (
        <ChatPatternBackground
          theme={visual.pattern.theme}
          gradientFrom={visual.pattern.from}
          gradientTo={visual.pattern.to}
          strokeOpacity={0.4}
          className="pointer-events-none"
        />
      )}

      <div
        className="relative z-10 flex items-center gap-2 px-3 pb-3 bg-slate-900/50 backdrop-blur-md border-b border-white/10"
        style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar y volver"
          className="text-white hover:text-teal-300 transition-colors p-1 -ml-1 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-black truncate flex items-center gap-1.5">
            {esOficial && <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300 shrink-0" />}
            <span className="truncate">{nombre}</span>
          </p>
          <p className="text-[10px] font-bold text-teal-300 tracking-wide uppercase">
            {esOficial ? "Oficial WEPA" : "Fondo · WEPA"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cerrar vista previa"
          className="text-white hover:text-teal-300 transition-colors p-1 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto w-fit bg-black/35 text-white/90 text-[10px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-sm mb-4">
          {chatName} · Demo
        </div>
        <div className="space-y-2.5">
          {DEMO_MESSAGES.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}>
              <div className={`${msg.sender === "me" ? bubbleMeCss : bubbleThemCss} px-3 py-2 rounded-2xl shadow-lg max-w-[80%] text-sm leading-snug`}>
                <p>{msg.text}</p>
                <p className={`mt-1 flex items-center justify-end gap-0.5 text-[10px] ${msg.sender === "me" ? "text-white/70" : "text-slate-400"}`}>
                  {msg.sender === "me" && <CheckCheck className="w-3 h-3" />}
                  10:24
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[10px] text-white/80 bg-black/25 w-fit mx-auto px-2.5 py-1 rounded-full backdrop-blur-sm font-medium">
          Mira cómo se ve tu fondo con mensajes reales 👀
        </p>
      </div>

      <div
        className="relative z-10 px-3 pt-3 bg-slate-900/50 backdrop-blur-md border-t border-white/10 flex items-center gap-2"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}
      >
        {enUso && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-teal-400 text-slate-900 text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-md">
            <Check className="w-3 h-3" /> En uso
          </div>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl border border-white/25 text-white text-sm font-bold bg-white/10 backdrop-blur-md cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onUse}
          className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-900 text-sm font-black cursor-pointer"
        >
          Usar este fondo
        </button>
      </div>
    </div>
  );
}

export default function ChatCustomizer({
  showCustomizer, setShowCustomizer,
  selectedBgId, setSelectedBgId,
  bubbleColorMeId, setBubbleColorMeId,
  bubbleColorThemId, setBubbleColorThemId,
  chatName,
  customBgImage,
  onSetCustomBgImage,
  pendingBg,
  setPendingBg,
}: ChatCustomizerProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCustomBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("FileReader failed"));
        reader.readAsDataURL(compressed);
      });
      onSetCustomBgImage(dataUrl);
      setSelectedBgId("custom");
    } catch (err) {
      console.error("[ChatCustomizer] custom background failed:", err);
    } finally {
      e.target.value = "";
    }
  };

  if (!showCustomizer) return null;

  const handleUsePending = () => {
    if (!pendingBg) return;
    if (pendingBg.type === "custom") setSelectedBgId("custom");
    else setSelectedBgId(pendingBg.id);
    setPendingBg(null);
  };

  const handleCancelPending = () => setPendingBg(null);

  const meCss = BUBBLE_PRESETS_ME.find(b => b.id === bubbleColorMeId)?.css ?? BUBBLE_PRESETS_ME[0].css;
  const themCss = BUBBLE_PRESETS_THEM.find(b => b.id === bubbleColorThemId)?.css ?? BUBBLE_PRESETS_THEM[0].css;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setShowCustomizer(false)}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-white space-y-3 w-[90vw] max-w-[360px] max-h-[80vh] overflow-y-auto shadow-lg" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-teal-400 flex items-center gap-1">
          <Palette className="w-3.5 h-3.5 text-teal-400 animate-pulse" /> Personalización del Chat
        </span>
        <button
          onClick={() => { setPendingBg(null); setShowCustomizer(false); }}
          className="text-slate-400 hover:text-white text-[10px] bg-slate-800 px-2 py-0.5 rounded cursor-pointer font-bold"
        >
          Cerrar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="space-y-1.5 text-left">
          <span className="text-[8px] font-extrabold text-teal-300 uppercase block">Mis Burbujas (Para Mí)</span>
          <div className="grid grid-cols-3 gap-1">
            {BUBBLE_PRESETS_ME.map((preset) => {
              const isSelected = bubbleColorMeId === preset.id;
              const bgVal = preset.id === "teal_dark" ? "#0a4d52" :
                            preset.id === "blue" ? "#2563eb" :
                            preset.id === "purple" ? "#9333ea" :
                            preset.id === "emerald" ? "#059669" :
                            preset.id === "pink" ? "#ec4899" :
                            preset.id === "orange" ? "#f97316" :
                            preset.id === "red" ? "#dc2626" :
                            preset.id === "slate" ? "#1e293b" :
                            preset.id === "glass" ? "transparent" : "#d97706";
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.name}
                  onClick={() => setBubbleColorMeId(preset.id)}
                  className={`w-full h-7 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                    isSelected ? "border-white scale-110 shadow-md ring-2 ring-teal-500/50" : "border-white/10 hover:border-white/30"
                  }`}
                  style={preset.id === "glass"
                    ? {
                        background: "repeating-conic-gradient(rgba(255,255,255,0.4) 0% 25%, rgba(255,255,255,0.1) 0% 50%) 0 0 / 8px 8px",
                        backdropFilter: "blur(4px)",
                      }
                    : { backgroundColor: bgVal }
                  }
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[4]" />}
                </button>
              );
            })}
          </div>
          <span className="text-[7px] text-slate-400 font-medium block truncate">
            {BUBBLE_PRESETS_ME.find(b => b.id === bubbleColorMeId)?.name}
          </span>
        </div>

        <div className="space-y-1.5 text-left">
          <span className="text-[8px] font-extrabold text-teal-300 uppercase block">Burbujas de {chatName}</span>
          <div className="grid grid-cols-3 gap-1">
            {BUBBLE_PRESETS_THEM.map((preset) => {
              const isSelected = bubbleColorThemId === preset.id;
              const bgVal = preset.id === "white" ? "#ffffff" :
                            preset.id === "slate_light" ? "#e2e8f0" :
                            preset.id === "emerald_dark" ? "#059669" :
                            preset.id === "blue_vibrant" ? "#2563eb" :
                            preset.id === "purple_vibrant" ? "#7c3aed" :
                            preset.id === "rose_vibrant" ? "#ec4899" :
                            preset.id === "amber_dark" ? "#d97706" :
                            preset.id === "red_vibrant" ? "#ef4444" :
                            preset.id === "glass" ? "transparent" : "#0f172a";
              const tickColor = preset.id === "white" || preset.id === "slate_light" || preset.id === "amber_dark" ? "text-slate-800" : "text-white";
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.name}
                  onClick={() => setBubbleColorThemId(preset.id)}
                  className={`w-full h-7 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                    isSelected ? "border-teal-400 scale-110 shadow-md ring-2 ring-teal-500/50" : "border-white/10 hover:border-white/30"
                  }`}
                  style={preset.id === "glass"
                    ? {
                        background: "repeating-conic-gradient(rgba(15,23,42,0.3) 0% 25%, rgba(15,23,42,0.08) 0% 50%) 0 0 / 8px 8px",
                        backdropFilter: "blur(4px)",
                      }
                    : { backgroundColor: bgVal }
                  }
                >
                  {isSelected && <Check className={`w-3.5 h-3.5 ${tickColor} stroke-[4]`} />}
                </button>
              );
            })}
          </div>
          <span className="text-[7px] text-slate-400 font-medium block truncate">
            {BUBBLE_PRESETS_THEM.find(b => b.id === bubbleColorThemId)?.name}
          </span>
        </div>
      </div>

      <div className="space-y-2.5 text-left border-t border-slate-800 pt-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-extrabold text-teal-300 uppercase flex items-center gap-1">
            <Star className="w-3 h-3 text-amber-300 fill-amber-300" />
            {CHAT_BACKGROUNDS.length} Fondos · WEPA
          </span>
        </div>

        <button
          type="button"
          title={customBgImage ? "Vista previa de mi foto subida" : "Subir mi propia foto de fondo"}
          onClick={() => {
            if (customBgImage) setPendingBg({ type: "custom" });
            else fileRef.current?.click();
          }}
          className={`w-full flex items-center gap-2 rounded-lg border overflow-hidden transition-all cursor-pointer ${
            selectedBgId === "custom" ? "border-teal-400 ring-2 ring-teal-500/40" : "border-white/10 hover:border-white/30"
          }`}
          style={customBgImage
            ? { backgroundImage: `url(${customBgImage})`, backgroundSize: "cover", backgroundPosition: "center" }
            : { background: "repeating-conic-gradient(rgba(255,255,255,0.3) 0% 25%, rgba(255,255,255,0.08) 0% 50%) 0 0 / 8px 8px" }}
        >
          {customBgImage ? (
            <>
              <span className="bg-black/60 text-white text-[8px] font-bold px-2 py-1 w-full text-left truncate">
                Mi foto de fondo
              </span>
              <button
                type="button"
                title="Quitar mi foto"
                onClick={(ev) => { ev.stopPropagation(); onSetCustomBgImage(null); setSelectedBgId("default"); }}
                className="bg-red-600 text-white px-3 py-1 text-[10px] font-bold cursor-pointer shrink-0"
              >
                Quitar
              </button>
            </>
          ) : (
            <>
              <span className="px-2 py-1.5 text-teal-300"><Upload className="w-4 h-4" /></span>
              <span className="text-[8px] font-bold text-white/90 pr-2">Subir mi foto de fondo</span>
            </>
          )}
          {selectedBgId === "custom" && (
            <div className="w-4 h-4 rounded-full bg-teal-400 flex items-center justify-center shadow-lg mr-1 ml-auto shrink-0">
              <Check className="w-2.5 h-2.5 text-white stroke-[4]" />
            </div>
          )}
        </button>

        {CHAT_BACKGROUND_CATEGORIES.map((cat) => {
          const fondos = CHAT_BACKGROUNDS.filter(bg => bg.categoria === cat.id);
          if (!fondos.length) return null;
          const esOficiales = cat.id === "oficiales";
          return (
            <div key={cat.id} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                {esOficiales && <Star className="w-3 h-3 text-amber-300 fill-amber-300" />}
                <span className={`text-[8px] font-extrabold uppercase tracking-wide ${esOficiales ? "text-amber-300" : "text-teal-300"}`}>
                  {cat.nombre}
                </span>
                <span className="text-[8px] text-slate-500 font-medium">{fondos.length}</span>
              </div>
              <div className={`grid gap-1.5 ${esOficiales ? "grid-cols-4" : "grid-cols-5"}`}>
                {fondos.map((bg, idx) => {
                  const isSelected = selectedBgId === bg.id;
                  const isPattern = bg.value.startsWith("pattern:");
                  const previewStyle = getThumbPreviewStyle(bg.value);
                  const isOficial = bg.categoria === "oficiales";
                  return (
                    <button
                      key={bg.id}
                      type="button"
                      title={bg.name}
                      onClick={() => setPendingBg({ type: "bg", id: bg.id })}
                      className={`relative aspect-square rounded-lg border flex items-center justify-center overflow-hidden transition-all cursor-pointer ${
                        isSelected
                          ? "border-teal-400 scale-105 shadow-md ring-2 ring-teal-400/50"
                          : isOficial
                            ? "border-amber-400/50 hover:border-amber-300"
                            : "border-white/10 hover:border-white/30"
                      }`}
                      style={previewStyle}
                    >
                      {isOficial && (
                        <span className="absolute top-0 left-0 bg-amber-400/90 text-slate-950 text-[7px] font-black px-1 py-px rounded-br-md flex items-center gap-px leading-none">
                          <Star className="w-2 h-2 fill-slate-950" /> Oficial
                        </span>
                      )}
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[6px] text-white text-center py-0.5 leading-none truncate px-0.5">
                        {bg.name.split(" ")[0]}
                      </span>
                      {isPattern && (
                        <span className="absolute top-0 right-0 text-[8px] opacity-80">
                          {bg.name.split(" ").pop()}
                        </span>
                      )}
                      {isSelected && (
                        <div className="w-4 h-4 rounded-full bg-teal-400 flex items-center justify-center shadow-lg absolute">
                          <Check className="w-2.5 h-2.5 text-white stroke-[4]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCustomBgFile} />

      {pendingBg && (
        <BackgroundPreview
          target={pendingBg}
          selectedBgId={selectedBgId}
          customBgImage={customBgImage}
          chatName={chatName}
          bubbleMeCss={meCss}
          bubbleThemCss={themCss}
          onCancel={handleCancelPending}
          onUse={handleUsePending}
        />
      )}
    </div>
  );
}
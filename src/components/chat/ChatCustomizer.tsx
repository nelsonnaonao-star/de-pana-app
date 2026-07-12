import React from "react";
import { Palette, Check, X } from "lucide-react";
import { CHAT_BACKGROUNDS, BUBBLE_PRESETS_ME, BUBBLE_PRESETS_THEM } from "./chatConstants";

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
}

export default function ChatCustomizer({
  showCustomizer, setShowCustomizer,
  selectedBgId, setSelectedBgId,
  bubbleColorMeId, setBubbleColorMeId,
  bubbleColorThemId, setBubbleColorThemId,
  chatName,
}: ChatCustomizerProps) {
  if (!showCustomizer) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setShowCustomizer(false)}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-white space-y-3 w-[90vw] max-w-[360px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-teal-400 flex items-center gap-1">
          <Palette className="w-3.5 h-3.5 text-teal-400 animate-pulse" /> Personalización del Chat
        </span>
        <button
          onClick={() => setShowCustomizer(false)}
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

      <div className="space-y-1.5 text-left border-t border-slate-800 pt-2.5">
        <span className="text-[8px] font-extrabold text-teal-300 uppercase block">{CHAT_BACKGROUNDS.length} Fondos para el Chat</span>
        <div className="grid grid-cols-5 gap-1.5 max-h-[140px] overflow-y-auto p-0.5">
          {CHAT_BACKGROUNDS.map((bg, idx) => {
            const isSelected = selectedBgId === bg.id;
            const isGradient = bg.value.startsWith("linear-gradient");
            const isPattern = bg.value.startsWith("pattern:");
            const isImage = bg.value.includes("url");

            const getPreviewStyle = () => {
              if (isGradient) return { background: bg.value };
              if (isImage) return { background: bg.value, backgroundSize: "cover", backgroundPosition: "center" };
              if (isPattern) {
                const parts = bg.value.replace("pattern:", "").split("|");
                const gradientMap: Record<string, string> = {
                  "blue|purple": "linear-gradient(135deg, #60a5fa, #a78bfa)",
                  "teal|cyan": "linear-gradient(135deg, #2dd4bf, #22d3ee)",
                  "pink|rose": "linear-gradient(135deg, #f472b6, #fb7185)",
                  "emerald|teal": "linear-gradient(135deg, #34d399, #2dd4bf)",
                  "orange|amber": "linear-gradient(135deg, #fb923c, #fbbf24)",
                  "indigo|violet": "linear-gradient(135deg, #818cf8, #a78bfa)",
                  "slate|blue": "linear-gradient(135deg, #94a3b8, #60a5fa)",
                  "rose|pink": "linear-gradient(135deg, #fb7185, #f472b6)",
                };
                const key = `${parts[1]}|${parts[2]}`;
                return { background: gradientMap[key] || "linear-gradient(135deg, #60a5fa, #a78bfa)" };
              }
              return { background: bg.value };
            };

            const previewStyle = getPreviewStyle();
            return (
              <button
                key={bg.id}
                type="button"
                title={bg.name}
                onClick={() => setSelectedBgId(bg.id)}
                className={`aspect-square rounded-lg border flex flex-col items-center justify-center relative overflow-hidden transition-all cursor-pointer ${
                  isSelected ? "border-white scale-105 shadow-md ring-2 ring-teal-500/50" : "border-white/10 hover:border-white/30"
                }`}
                style={previewStyle}
              >
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[6px] text-white text-center py-0.5 leading-none truncate px-0.5">
                  {idx + 1}. {bg.name.split(" ")[0]}
                </span>
                {isPattern && (
                  <span className="absolute top-0 right-0 text-[8px] opacity-80">
                    {bg.name.split(" ").pop()}
                  </span>
                )}
                {isSelected && (
                  <div className="w-4 h-4 rounded-full bg-[#14b8a6] flex items-center justify-center shadow-lg absolute">
                    <Check className="w-2.5 h-2.5 text-white stroke-[4]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}

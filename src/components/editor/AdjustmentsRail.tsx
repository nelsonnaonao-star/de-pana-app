import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MusicTrack } from "../../services/stickerService";
import VideoOptionsRow from "./VideoOptionsRow";

export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  hue: number;
  sharpness: number;
}

interface Control {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const CONTROLS: Control[] = [
  { key: "brightness", label: "Brillo", min: 50, max: 200, step: 2, unit: "%" },
  { key: "contrast", label: "Contraste", min: 50, max: 200, step: 2, unit: "%" },
  { key: "saturation", label: "Saturación", min: 0, max: 200, step: 2, unit: "%" },
  { key: "blur", label: "Desenfoque", min: 0, max: 8, step: 1, unit: "px" },
  { key: "hue", label: "Tono", min: 0, max: 360, step: 5, unit: "°" },
  { key: "sharpness", label: "Nitidez", min: 0, max: 100, step: 5, unit: "%" },
];

interface AdjustmentsRailProps {
  adjustments: Adjustments;
  setAdjustments: React.Dispatch<React.SetStateAction<Adjustments>>;
  onReset: () => void;
  editorMode: "image" | "video";
  selectedMusicId: string;
  setSelectedMusicId: (v: string) => void;
  transitionStyle: "fade" | "zoom" | "slide";
  setTransitionStyle: (v: "fade" | "zoom" | "slide") => void;
  setIsVideoPlaying: (v: boolean) => void;
  musicLibrary: MusicTrack[];
}

export default function AdjustmentsRail({
  adjustments,
  setAdjustments,
  onReset,
  editorMode,
  selectedMusicId,
  setSelectedMusicId,
  transitionStyle,
  setTransitionStyle,
  setIsVideoPlaying,
  musicLibrary,
}: AdjustmentsRailProps) {
  const [activeKey, setActiveKey] = useState<keyof Adjustments>("brightness");
  const active = CONTROLS.find((c) => c.key === activeKey) ?? CONTROLS[0];
  const value = adjustments[active.key];

  return (
    <div className="bg-[#0c1617]/95 backdrop-blur-md border-t border-teal-950/40 shadow-2xl animate-fade-in px-2 pt-2 pb-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {CONTROLS.map((control) => {
          const isActive = activeKey === control.key;
          return (
            <button
              key={control.key}
              type="button"
              onClick={() => setActiveKey(control.key)}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[8px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? "bg-teal-500/25 text-teal-200 ring-1 ring-teal-400"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {control.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onReset}
          title="Resetear todos los ajustes"
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[8px] font-bold bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" /> Reset
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-[8px] font-bold text-slate-300 w-[62px] shrink-0 truncate">
          {active.label}
        </span>
        <input
          type="range"
          min={active.min}
          max={active.max}
          step={active.step}
          value={value}
          onChange={(e) =>
            setAdjustments((prev) => ({ ...prev, [active.key]: Number(e.target.value) }))
          }
          className="flex-1 accent-teal-400 cursor-pointer"
        />
        <span className="text-[8px] font-mono text-teal-300 w-9 text-right shrink-0">
          {value}
          {active.unit}
        </span>
      </div>

      {editorMode === "video" && (
        <VideoOptionsRow
          selectedMusicId={selectedMusicId}
          setSelectedMusicId={setSelectedMusicId}
          transitionStyle={transitionStyle}
          setTransitionStyle={setTransitionStyle}
          setIsVideoPlaying={setIsVideoPlaying}
          musicLibrary={musicLibrary}
        />
      )}
    </div>
  );
}

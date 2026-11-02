import React from "react";
import { X } from "lucide-react";
import { ANIMATION_PRESETS } from "./editorConstants";
import type { MusicTrack } from "../../services/stickerService";
import VideoOptionsRow from "./VideoOptionsRow";

const SHORT_ANIMATION_LABEL: Record<string, string> = {
  none: "Estático",
  bounce: "Rebote",
  pulse: "Latido",
  typing: "Máquina",
  zoom: "Pop",
  shake: "Vibración",
  slide: "Entrada",
};

interface TextRailProps {
  bannerTitle: string;
  setBannerTitle: (v: string) => void;
  textSizePercent: number;
  setTextSizePercent: (v: number) => void;
  textAnimation: string;
  setTextAnimation: (v: string) => void;
  editorMode: "image" | "video";
  selectedMusicId: string;
  setSelectedMusicId: (v: string) => void;
  transitionStyle: "fade" | "zoom" | "slide";
  setTransitionStyle: (v: "fade" | "zoom" | "slide") => void;
  setIsVideoPlaying: (v: boolean) => void;
  musicLibrary: MusicTrack[];
}

export default function TextRail({
  bannerTitle,
  setBannerTitle,
  textSizePercent,
  setTextSizePercent,
  textAnimation,
  setTextAnimation,
  editorMode,
  selectedMusicId,
  setSelectedMusicId,
  transitionStyle,
  setTransitionStyle,
  setIsVideoPlaying,
  musicLibrary,
}: TextRailProps) {
  return (
    <div className="bg-[#0c1617]/95 backdrop-blur-md border-t border-teal-950/40 shadow-2xl animate-fade-in px-2 pt-2 pb-2">
      <div className="flex items-start gap-2">
        <textarea
          value={bannerTitle}
          onChange={(e) => setBannerTitle(e.target.value)}
          maxLength={120}
          rows={2}
          placeholder="Escribe tu texto aquí..."
          className="flex-1 bg-slate-950 border border-white/10 text-[10px] px-2 py-1.5 rounded-lg outline-none focus:border-teal-500 font-bold resize-none"
        />
        <button
          type="button"
          onClick={() => setBannerTitle("")}
          title="Borrar texto"
          className="w-8 h-8 shrink-0 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-[8px] font-bold text-slate-300 w-[46px] shrink-0">Tamaño</span>
        <input
          type="range"
          min={80}
          max={300}
          step={5}
          value={textSizePercent}
          onChange={(e) => setTextSizePercent(Number(e.target.value))}
          className="flex-1 accent-teal-400 cursor-pointer"
        />
        <span className="text-[8px] font-mono text-teal-300 w-9 text-right shrink-0">
          {textSizePercent}%
        </span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 mt-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {ANIMATION_PRESETS.map((anim) => {
          const isActive = textAnimation === anim.id;
          return (
            <button
              key={anim.id}
              type="button"
              onClick={() => setTextAnimation(anim.id)}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[8px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? "bg-teal-500/25 text-teal-200 ring-1 ring-teal-400"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {SHORT_ANIMATION_LABEL[anim.id] ?? anim.name}
            </button>
          );
        })}
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

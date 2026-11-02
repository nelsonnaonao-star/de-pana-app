import React from "react";
import { Check, Upload, RefreshCw } from "lucide-react";
import type { MusicTrack } from "../../services/stickerService";
import VideoOptionsRow from "./VideoOptionsRow";

interface FilterRailProps {
  filters: { id: string; name: string; desc: string }[];
  selectedFilterId: string;
  onSelectFilter: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasUploadedImage: boolean;
  onResetImage: () => void;
  editorMode: "image" | "video";
  selectedMusicId: string;
  setSelectedMusicId: (v: string) => void;
  transitionStyle: "fade" | "zoom" | "slide";
  setTransitionStyle: (v: "fade" | "zoom" | "slide") => void;
  setIsVideoPlaying: (v: boolean) => void;
  musicLibrary: MusicTrack[];
}

function splitName(name: string): { emoji: string; label: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { emoji: "🎨", label: name };
  const emoji = parts[parts.length - 1];
  const label = parts.slice(0, -1).join(" ");
  return { emoji, label };
}

export default function FilterRail({
  filters,
  selectedFilterId,
  onSelectFilter,
  fileInputRef,
  onFileChange,
  hasUploadedImage,
  onResetImage,
  editorMode,
  selectedMusicId,
  setSelectedMusicId,
  transitionStyle,
  setTransitionStyle,
  setIsVideoPlaying,
  musicLibrary,
}: FilterRailProps) {
  return (
    <div className="bg-[#0c1617]/95 backdrop-blur-md border-t border-teal-950/40 shadow-2xl animate-fade-in px-2 pt-2 pb-2">
      <input
        type="file"
        ref={fileInputRef}
        accept={editorMode === "video" ? "video/*" : "image/*"}
        onChange={onFileChange}
        className="hidden"
      />

      <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 w-[62px] flex flex-col items-center gap-1 cursor-pointer"
        >
          <div className="w-11 h-11 rounded-xl border border-dashed border-teal-400/50 bg-white/5 flex items-center justify-center">
            <Upload className="w-4 h-4 text-teal-400" />
          </div>
          <span className="text-[7px] font-bold text-teal-300 whitespace-nowrap">
            {hasUploadedImage ? "Cambiar" : "Subir"}
          </span>
        </button>

        {filters.map((filt) => {
          const { emoji, label } = splitName(filt.name);
          const isSelected = selectedFilterId === filt.id;
          return (
            <button
              key={filt.id}
              type="button"
              onClick={() => onSelectFilter(filt.id)}
              className="shrink-0 w-[62px] flex flex-col items-center gap-1 cursor-pointer"
            >
              <div
                className={`relative w-11 h-11 rounded-xl flex items-center justify-center text-[18px] transition-all ${
                  isSelected
                    ? "bg-teal-500/25 ring-2 ring-teal-400"
                    : "bg-white/10 hover:bg-white/15"
                }`}
              >
                <span>{emoji}</span>
                {isSelected && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-teal-400 flex items-center justify-center">
                    <Check className="w-2 h-2 text-white stroke-[4]" />
                  </span>
                )}
              </div>
              <span
                className={`text-[7px] font-bold truncate max-w-full ${
                  isSelected ? "text-teal-300" : "text-slate-400"
                }`}
              >
                {label.split(" ")[0]}
              </span>
            </button>
          );
        })}

        {hasUploadedImage && (
          <button
            type="button"
            onClick={onResetImage}
            className="shrink-0 w-[62px] flex flex-col items-center gap-1 cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-rose-500/15 flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-rose-400" />
            </div>
            <span className="text-[7px] font-bold text-rose-300 whitespace-nowrap">Restaurar</span>
          </button>
        )}
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

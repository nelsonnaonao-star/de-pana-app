import React from "react";
import { Music } from "lucide-react";
import type { MusicTrack } from "../../services/stickerService";

interface VideoOptionsRowProps {
  selectedMusicId: string;
  setSelectedMusicId: (v: string) => void;
  transitionStyle: "fade" | "zoom" | "slide";
  setTransitionStyle: (v: "fade" | "zoom" | "slide") => void;
  setIsVideoPlaying: (v: boolean) => void;
  musicLibrary: MusicTrack[];
}

/**
 * Fila compacta de Música + Transición para el modo video. Se usa en los
 * rieles de Imagen y Ajustes para no perder estos controles al simplificar
 * el panel inferior.
 */
export default function VideoOptionsRow({
  selectedMusicId,
  setSelectedMusicId,
  transitionStyle,
  setTransitionStyle,
  setIsVideoPlaying,
  musicLibrary,
}: VideoOptionsRowProps) {
  return (
    <div className="flex gap-2 mt-2">
      <label className="flex-1 flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1">
        <Music className="w-3 h-3 text-teal-400 shrink-0" />
        <select
          value={selectedMusicId}
          onChange={(e) => {
            setSelectedMusicId(e.target.value);
            setIsVideoPlaying(false);
          }}
          className="flex-1 min-w-0 bg-transparent text-white text-[8px] outline-none cursor-pointer"
        >
          <option value="none" className="bg-slate-900">Sin música</option>
          {musicLibrary.map((t) => (
            <option key={t.id} value={t.id} className="bg-slate-900">{t.title}</option>
          ))}
        </select>
      </label>
      <label className="flex-1 flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1">
        <span className="text-teal-400 text-[9px] shrink-0">⇄</span>
        <select
          value={transitionStyle}
          onChange={(e) => setTransitionStyle(e.target.value as "fade" | "zoom" | "slide")}
          className="flex-1 min-w-0 bg-transparent text-white text-[8px] outline-none cursor-pointer"
        >
          <option value="fade" className="bg-slate-900">Disolvencia</option>
          <option value="zoom" className="bg-slate-900">Zoom</option>
          <option value="slide" className="bg-slate-900">Barrido</option>
        </select>
      </label>
    </div>
  );
}

import React from "react";
import { Image, VideoIcon, File, Film, Music, BarChart2, Camera as CameraIcon, MapPin } from "lucide-react";
import { Message } from "../../../types";

interface AttachmentTrayProps {
  onPickFile: (accept: string, type: Message["type"]) => void;
  onOpenGifPicker: () => void;
  onOpenPollForm: () => void;
  onSendLocation: () => void;
}

export default function AttachmentTray({ onPickFile, onOpenGifPicker, onOpenPollForm, onSendLocation }: AttachmentTrayProps) {
  return (
    <div className="absolute bottom-20 left-4 right-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.18)] border border-slate-100 p-4 grid grid-cols-4 gap-3 z-30 animate-fade-in">
      <button
        onClick={() => onPickFile("image/*", "image")}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform shadow-sm">
          <Image className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Fotos</span>
      </button>

      <button
        onClick={() => onPickFile("video/*,video/mp4,video/x-m4v,video/quicktime", "video")}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-600 group-hover:scale-110 transition-transform shadow-sm">
          <VideoIcon className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Video</span>
      </button>

      <button
        onClick={() => onPickFile("*/*", "file")}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform shadow-sm">
          <File className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Documento</span>
      </button>

      <button
        onClick={onOpenGifPicker}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform shadow-sm">
          <Film className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">GIF / Sticker</span>
      </button>

      <button
        onClick={() => onPickFile("audio/*", "audio")}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-cyan-50 flex items-center justify-center text-cyan-600 group-hover:scale-110 transition-transform shadow-sm">
          <Music className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Música / Audio</span>
      </button>

      <button
        onClick={onOpenPollForm}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform shadow-sm">
          <BarChart2 className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Encuesta</span>
      </button>

      <button
        onClick={() => onPickFile("image/*", "image")}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform shadow-sm">
          <CameraIcon className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Cámara</span>
      </button>

      <button
        onClick={onSendLocation}
        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 group-hover:scale-110 transition-transform shadow-sm">
          <MapPin className="w-5 h-5" />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Ubicación</span>
      </button>
    </div>
  );
}

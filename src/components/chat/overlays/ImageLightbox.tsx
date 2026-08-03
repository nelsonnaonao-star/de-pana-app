import React from "react";
import { X } from "lucide-react";
import CachedImage from "../../CachedImage";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  return (
    <div
      className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>
      <div onClick={(e) => e.stopPropagation()}>
        <CachedImage
          src={src}
          alt={alt || ""}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    </div>
  );
}

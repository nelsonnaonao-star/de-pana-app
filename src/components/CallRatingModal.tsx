import React, { useState } from "react";
import { Star, X } from "lucide-react";

interface CallRatingModalProps {
  contactName: string;
  onSend: (rating: number) => void;
  onSkip: () => void;
}

export default function CallRatingModal({ contactName, onSend, onSkip }: CallRatingModalProps) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (rating === 0) return;
    setSending(true);
    try {
      await onSend(rating);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm select-none">
      <div className="bg-gradient-to-b from-[#0f2027] via-[#041a1c] to-[#010809] border border-teal-500/20 rounded-3xl p-8 mx-6 max-w-sm w-full shadow-2xl shadow-teal-900/30 animate-fade-in">
        <button
          onClick={onSkip}
          className="float-right w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all cursor-pointer"
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>

        <div className="text-center space-y-6 pt-4">
          <div className="space-y-2">
            <h3 className="text-white text-lg font-black tracking-tight">
              ¿Qué tal estuvo la calidad de la llamada?
            </h3>
            <p className="text-slate-400 text-xs font-medium">
              Con {contactName}
            </p>
          </div>

          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => {
              const filled = star <= (hovered || rating);
              return (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHovered(star)}
                  onMouseLeave={() => setHovered(0)}
                  className="transition-all duration-150 cursor-pointer p-1 hover:scale-110 active:scale-90"
                >
                  <Star
                    className={`w-8 h-8 transition-all duration-150 ${
                      filled
                        ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                        : "text-slate-600"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onSkip}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm font-bold hover:bg-white/5 transition-all cursor-pointer"
            >
              Omitir
            </button>
            <button
              onClick={handleSend}
              disabled={rating === 0 || sending}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                rating === 0
                  ? "bg-teal-800/30 text-teal-700 cursor-not-allowed"
                  : "bg-teal-500 hover:bg-teal-400 text-white shadow-lg shadow-teal-500/20"
              }`}
            >
              {sending ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

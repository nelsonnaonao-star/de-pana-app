import React from "react";
import { BarChart2, X, Check } from "lucide-react";

interface PollFormModalProps {
  isOpen: boolean;
  question: string;
  option1: string;
  option2: string;
  onQuestionChange: (value: string) => void;
  onOption1Change: (value: string) => void;
  onOption2Change: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export default function PollFormModal({
  isOpen, question, option1, option2,
  onQuestionChange, onOption1Change, onOption2Change,
  onSubmit, onClose,
}: PollFormModalProps) {
  if (!isOpen) return null;
  return (
    <div className="absolute inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="bg-white rounded-2xl p-4 w-full max-w-xs space-y-3 shadow-lg">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1">
            <BarChart2 className="w-4 h-4 text-emerald-600" /> Nueva Encuesta
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Pregunta de la encuesta"
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            required
            className="w-full bg-slate-50 p-2 text-[11px] rounded-lg border outline-none focus:border-emerald-500"
          />
          <input
            type="text"
            placeholder="Opción 1"
            value={option1}
            onChange={(e) => onOption1Change(e.target.value)}
            required
            className="w-full bg-slate-50 p-2 text-[10px] rounded-lg border outline-none focus:border-emerald-500"
          />
          <input
            type="text"
            placeholder="Opción 2"
            value={option2}
            onChange={(e) => onOption2Change(e.target.value)}
            required
            className="w-full bg-slate-50 p-2 text-[10px] rounded-lg border outline-none focus:border-emerald-500"
          />
        </div>
        <button
          type="submit"
          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition-colors"
        >
          <Check className="w-3.5 h-3.5" /> Enviar Encuesta
        </button>
      </form>
    </div>
  );
}

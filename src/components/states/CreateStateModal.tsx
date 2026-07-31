import { X, Sparkles, Award, Check, Video, Send } from "lucide-react";

interface CreateStateModalProps {
  uploadedMedia: { url: string; type: "image" | "video"; name: string };
  showPublishDecisionModal: boolean;
  publishStep: "choice" | "comment";
  publishComment: string;
  isEditingProState: boolean;
  onPublishOriginal: () => void;
  onPublishNow: () => void;
  onGoToProEditor: () => void;
  onBackToChoice: () => void;
  onSetPublishComment: (v: string) => void;
}

export default function CreateStateModal({
  uploadedMedia, showPublishDecisionModal, publishStep, publishComment,
  isEditingProState, onPublishOriginal, onPublishNow, onGoToProEditor,
  onBackToChoice, onSetPublishComment,
}: CreateStateModalProps) {
  if (!showPublishDecisionModal) return null;

  return (
    <>
      {publishStep === "choice" && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black animate-fade-in">
          {/* Full screen preview */}
          <div className="absolute inset-0">
            {uploadedMedia.type === "video" ? (
              <video src={uploadedMedia.url} muted playsInline loop autoPlay className="w-full h-full object-cover" />
            ) : (
              <img src={uploadedMedia.url} alt="Preview" className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20"></div>
          </div>

          {/* Content overlay */}
          <div className="relative z-10 flex flex-col h-full p-5 justify-end pb-8">
            <div className="mb-6 text-left">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="w-4 h-4 text-teal-400" />
                <span className="text-[9px] font-black text-teal-400 uppercase tracking-wider">Archivo cargado</span>
              </div>
              <h3 className="text-white text-sm font-black tracking-tight leading-snug mb-0.5">
                {uploadedMedia.name}
              </h3>
              <p className="text-[10px] text-slate-400 font-mono">
                {uploadedMedia.type === "video" ? "Video" : "Imagen"} listo para publicar
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={onGoToProEditor}
                className="w-full py-3 px-4 bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white font-black text-[10px] rounded-2xl shadow-lg hover:shadow-teal-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Award className="w-4 h-4 text-amber-300 fill-amber-300" />
                Editar con Editor PRO (Recomendado)
              </button>
              <button
                onClick={onPublishOriginal}
                className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 text-white font-bold text-[10px] rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4 text-teal-400" />
                Publicar Original
              </button>
            </div>

          </div>
        </div>
      )}

      {publishStep === "comment" && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
          <button
            onClick={onBackToChoice}
            className="absolute top-4 left-4 z-10 text-white/80 hover:text-white p-2 cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex-1 flex items-center justify-center min-h-0">
            {uploadedMedia.type === "video" ? (
              <video src={uploadedMedia.url} muted playsInline loop autoPlay className="w-full h-full object-contain" />
            ) : (
              <img src={uploadedMedia.url} alt="Preview" className="w-full h-full object-contain" />
            )}
          </div>

          <div className="w-full p-4 bg-black/50 backdrop-blur-md flex items-center gap-3">
            <input
              type="text"
              placeholder="Añade un comentario..."
              value={publishComment}
              onChange={(e) => onSetPublishComment(e.target.value)}
              className="flex-1 bg-gray-800 text-white text-sm rounded-full px-5 py-3 outline-none placeholder-gray-400 border border-white/10 focus:border-teal-400 transition-colors"
            />
            <button
              onClick={onPublishNow}
              className="w-11 h-11 bg-teal-500 hover:bg-teal-400 text-white rounded-full flex items-center justify-center shrink-0 transition-all shadow-lg cursor-pointer"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

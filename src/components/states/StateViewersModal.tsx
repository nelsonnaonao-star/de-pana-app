import { X } from "lucide-react";

interface StateViewersModalProps {
  viewersData: { viewers: Array<{ viewer_id: string; name: string; avatar: string; viewed_at: string; reactions: string[] }>; total: number };
  onClose: () => void;
}

export default function StateViewersModal({ viewersData, onClose }: StateViewersModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex flex-col justify-end animate-fade-in" onClick={onClose}>
      <div
        className="bg-slate-900 border-t border-slate-700/50 rounded-t-2xl max-h-[70%] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 shrink-0">
          <h3 className="text-white text-xs font-black tracking-tight">
            Visualizaciones ({viewersData.total})
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-slate-800 text-slate-400 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {viewersData.viewers.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-[10px] font-mono">
              Nadie ha visto este estado aún
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {viewersData.viewers.map(v => (
                <div key={v.viewer_id} className="flex items-center gap-3 px-4 py-2.5">
                  <img
                    src={v.avatar || ""}
                    alt={v.name}
                    className="w-7 h-7 rounded-full object-cover border border-slate-700"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-[10px] font-bold leading-tight truncate">{v.name}</p>
                    <p className="text-[7.5px] text-slate-500 font-mono mt-0.5">
                      {new Date(v.viewed_at).toLocaleString()}
                    </p>
                  </div>
                  {v.reactions.length > 0 && (
                    <div className="flex gap-0.5 shrink-0">
                      {v.reactions.map((r, i) => (
                        <span key={i} className="text-sm">{r}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

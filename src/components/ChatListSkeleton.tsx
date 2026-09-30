import React from "react";

const SkeletonRow: React.FC<{ delay?: number }> = ({ delay }) => {
  return (
    <div
      className="px-4"
      style={{ animationDelay: delay ? `${delay}ms` : undefined }}
    >
      <div className="pb-3.5">
        <div className="rounded-2xl flex items-start gap-4 px-2.5 py-2">
          {/* Avatar — tamaño real de la fila (62px) */}
          <div className="w-[62px] h-[62px] rounded-[62%_38%_55%_45%/45%_55%_40%_60%] bg-slate-200 animate-pulse shrink-0" />
          {/* Text lines */}
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="h-3 bg-slate-200 rounded-full animate-pulse w-[60%]" />
            <div className="h-2.5 bg-slate-100 rounded-full animate-pulse w-[85%]" />
          </div>
          {/* Timestamp */}
          <div className="h-2.5 bg-slate-100 rounded-full animate-pulse w-10 shrink-0" />
        </div>
      </div>
    </div>
  );
}

export default function ChatListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex-1 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} delay={i * 60} />
      ))}
    </div>
  );
}

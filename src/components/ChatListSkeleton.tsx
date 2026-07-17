import React from "react";

const SkeletonRow: React.FC<{ delay?: number }> = ({ delay }) => {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{ animationDelay: delay ? `${delay}ms` : undefined }}
    >
      {/* Avatar circle */}
      <div className="w-11 h-11 rounded-full bg-slate-200 animate-pulse shrink-0" />
      {/* Text lines */}
      <div className="flex-1 space-y-2.5">
        <div className="h-3 bg-slate-200 rounded-full animate-pulse w-[60%]" />
        <div className="h-2.5 bg-slate-100 rounded-full animate-pulse w-[85%]" />
      </div>
      {/* Timestamp */}
      <div className="h-2.5 bg-slate-100 rounded-full animate-pulse w-10 shrink-0" />
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

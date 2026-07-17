import React, { useEffect, useState } from "react";
import { Phone, Video, PhoneMissed, PhoneIncoming, PhoneOutgoing, Clock, ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";
import CachedImage from "./CachedImage";

type CallRecord = {
  id: string;
  caller_id: string;
  callee_id: string;
  status: "missed" | "ended" | "ongoing";
  type: "audio" | "video";
  started_at: string;
  ended_at?: string;
  duration: number;
  chat_id?: string;
};

type CallWithProfile = CallRecord & {
  caller_name: string;
  caller_avatar: string;
};

interface CallLogProps {
  userId: string;
  onBack: () => void;
  onStartChat: (partnerId: string, name: string, avatar: string) => void;
}

const profileCache = new Map<string, { name: string; avatar: string }>();

async function getProfile(userId: string): Promise<{ name: string; avatar: string }> {
  const cached = profileCache.get(userId);
  if (cached) return cached;
  const { data } = await supabase
    .from("profiles")
    .select("name, avatar, avatar_url")
    .eq("id", userId)
    .single();
  const result = {
    name: data?.name || "Desconocido",
    avatar: data?.avatar || data?.avatar_url || "",
  };
  profileCache.set(userId, result);
  return result;
}

export default function CallLog({ userId, onBack, onStartChat }: CallLogProps) {
  const [calls, setCalls] = useState<CallWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [sent, received] = await Promise.all([
        supabase
          .from("calls")
          .select("*")
          .eq("caller_id", userId)
          .order("started_at", { ascending: false })
          .limit(50),
        supabase
          .from("calls")
          .select("*")
          .eq("callee_id", userId)
          .order("started_at", { ascending: false })
          .limit(50),
      ]);

      const all: CallRecord[] = [
        ...(sent.data || []),
        ...(received.data || []),
      ];
      all.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      const top = all.slice(0, 50);

      const enriched = await Promise.all(
        top.map(async (call) => {
          const otherId = call.caller_id === userId ? call.callee_id : call.caller_id;
          const profile = await getProfile(otherId);
          return { ...call, caller_name: profile.name, caller_avatar: profile.avatar };
        })
      );

      setCalls(enriched);
      setLoading(false);
    })();
  }, [userId]);

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

    if (d.toDateString() === today.toDateString()) return `Hoy ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `Ayer ${time}`;
    return `${d.toLocaleDateString("es", { day: "numeric", month: "short" })} ${time}`;
  }

  function isIncoming(call: CallRecord): boolean {
    return call.callee_id === userId;
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white h-full">
      <div className="bg-[#0a4d52] text-white px-4 py-4 shrink-0 flex items-center gap-3">
        <button onClick={onBack} className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-300">Historial de Llamadas</h3>
          <p className="text-[10px] text-teal-100/85">Llamadas recientes</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Phone className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-xs font-medium">No hay llamadas recientes</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {calls.map((call) => {
              const incoming = isIncoming(call);
              const missed = call.status === "missed";
              const outgoing = !incoming;

              return (
                <div
                  key={call.id}
                  onClick={() => onStartChat(incoming ? call.caller_id : call.callee_id, call.caller_name, call.caller_avatar)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer active:bg-slate-100"
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-teal-400 to-teal-600 shrink-0 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                    {call.caller_avatar ? (
                      <CachedImage src={call.caller_avatar} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      call.caller_name.charAt(0).toUpperCase()
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-800 truncate">{call.caller_name}</p>
                      {outgoing && (
                        <span className="text-[10px] text-slate-400 font-medium">(tú)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {missed && incoming ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      ) : incoming ? (
                        <PhoneIncoming className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                      )}
                      <span className={`text-[10px] font-medium ${missed && incoming ? "text-rose-500" : "text-slate-500"}`}>
                        {call.type === "video" ? "Video" : "Voz"}
                      </span>
                      {call.status === "ended" && call.duration > 0 && (
                        <>
                          <span className="text-[9px] text-slate-300">•</span>
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="text-[10px] text-slate-500">{formatDuration(call.duration)}</span>
                        </>
                      )}
                      {missed && <span className="text-[10px] text-rose-500 font-bold">Perdida</span>}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span className="text-[9px] text-slate-400">{formatDate(call.started_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import { supabase } from "../lib/supabase";

export type Call = {
  id: string;
  caller_id: string;
  callee_id: string;
  status: "ringing" | "missed" | "ended" | "ongoing" | "accepted";
  type: "audio" | "video";
  call_type?: "audio" | "video";
  started_at: string;
  ended_at?: string;
  duration: number;
  chat_id?: string;
};

export async function getCalls(userId: string): Promise<Call[]> {
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

  if (sent.error) console.error("[CALLS] sent error:", sent.error);
  if (received.error) console.error("[CALLS] received error:", received.error);

  const all = [...(sent.data || []), ...(received.data || [])];
  all.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return all.slice(0, 50) as Call[];
}

export async function startCall(call: Partial<Call>): Promise<Call> {
  const { data, error } = await supabase
    .from("calls")
    .insert({
      caller_id: call.caller_id,
      callee_id: call.callee_id,
      status: "ringing",
      type: call.type || "audio",
      call_type: call.type || "audio",
      started_at: new Date().toISOString(),
      duration: 0,
      chat_id: call.chat_id || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Call;
}

export async function updateCallStatus(callId: string, status: "ringing" | "ongoing" | "accepted" | "ended" | "missed") {
  const { error } = await supabase
    .from("calls")
    .update({ status })
    .eq("id", callId);
  if (error) throw error;
}

export async function endCall(callId: string) {
  const endedAt = new Date();

  const { data: call, error: fetchError } = await supabase
    .from("calls")
    .select("started_at")
    .eq("id", callId)
    .single();

  let duration = 0;
  if (call?.started_at) {
    duration = Math.floor((endedAt.getTime() - new Date(call.started_at).getTime()) / 1000);
    if (duration < 0) duration = 0;
  }

  const { error } = await supabase
    .from("calls")
    .update({
      status: "ended",
      ended_at: endedAt.toISOString(),
      duration,
    })
    .eq("id", callId);
  if (error) throw error;
}

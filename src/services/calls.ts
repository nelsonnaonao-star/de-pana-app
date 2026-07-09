import { supabase } from "../lib/supabase";

export type Call = {
  id: string;
  caller_id: string;
  callee_id: string;
  status: "missed" | "ended" | "ongoing";
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
      status: "ongoing",
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

export async function endCall(callId: string) {
  const startedAt = new Date();
  const { error } = await supabase
    .from("calls")
    .update({
      status: "ended",
      ended_at: startedAt.toISOString(),
    })
    .eq("id", callId);
  if (error) throw error;
}

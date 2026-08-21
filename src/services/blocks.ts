import { supabase } from "../lib/supabase";

export type BlockedUser = {
  id: string;
  name: string;
  avatar?: string;
  blockedAt?: string;
};

export async function getBlockedUsers(userId: string): Promise<BlockedUser[]> {
  const { data: rows, error } = await supabase
    .from("blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const ids = (rows || [])
    .map(b => b.blocked_id)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", ids);
  if (profileError) throw profileError;

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const createdMap = new Map((rows || []).map((b: any) => [b.blocked_id, b.created_at]));

  return ids.map(id => {
    const profile = profileMap.get(id);
    return {
      id,
      name: profile?.name || "Usuario bloqueado",
      avatar: profile?.avatar_url || "",
      blockedAt: createdMap.get(id),
    };
  });
}

export async function unblockUser(blockedUserId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesión no encontrada");
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", blockedUserId);
  if (error) throw error;
}
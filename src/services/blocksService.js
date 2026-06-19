import { supabase } from "../lib/supabaseClient";

export class BlocksService {
  async block(blockerId, blockedId) {
    const { error } = await supabase
      .from("blocks")
      .insert({ blocker_id: blockerId, blocked_id: blockedId });
    if (error && error.code !== "23505")
      return { success: false, error: error.message };
    return { success: true };
  }

  async unblock(blockerId, blockedId) {
    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async isBlocked(blockerId, blockedId) {
    const { data } = await supabase
      .from("blocks")
      .select("id")
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId)
      .maybeSingle();
    return !!data;
  }

  async getBlockedIds(userId) {
    const { data } = await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);
    return (data || []).map((r) => r.blocked_id);
  }
}

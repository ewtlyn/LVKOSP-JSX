import { supabase } from "../lib/supabaseClient";

export class FriendsService {
  async searchUsers(query, excludeUserId) {
    try {
      if (!query || query.length < 2) return [];
      let qb = supabase
        .from("profiles")
        .select("id, username, name, avatar_url, bio, status, last_seen")
        .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
        .limit(20);
      if (excludeUserId) qb = qb.neq("id", excludeUserId);
      const { data, error } = await qb;
      if (error) return [];
      return data || [];
    } catch {
      return [];
    }
  }

  async getFriends(userId) {
    try {
      const { data, error } = await supabase
        .from("friendships")
        .select(
          `friend:profiles!friendships_friend_id_fkey(id, username, name, avatar_url, banner_url, bio, status, last_seen)`,
        )
        .eq("user_id", userId)
        .eq("status", "accepted");
      if (error) return [];
      return (data || []).map((x) => x.friend).filter(Boolean);
    } catch {
      return [];
    }
  }

  async getPendingRequests(userId) {
    try {
      const { data, error } = await supabase
        .from("friendships")
        .select(
          `user_id, created_at, requester:profiles!friendships_user_id_fkey(id, username, name, avatar_url, bio)`,
        )
        .eq("friend_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data || []).map((x) => x.requester).filter(Boolean);
    } catch {
      return [];
    }
  }

  async sendFriendRequest(userId, friendId) {
    try {
      const { error } = await supabase.from("friendships").insert({
        user_id: userId,
        friend_id: friendId,
        status: "pending",
        created_at: new Date().toISOString(),
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || "Failed to send request" };
    }
  }

  async acceptFriendRequest(currentUserId, requesterId) {
    try {
      const { error: upErr } = await supabase
        .from("friendships")
        .update({ status: "accepted" })
        .eq("user_id", requesterId)
        .eq("friend_id", currentUserId)
        .eq("status", "pending");
      if (upErr) return { success: false, error: upErr.message };

      const { error: insErr } = await supabase.from("friendships").insert({
        user_id: currentUserId,
        friend_id: requesterId,
        status: "accepted",
        created_at: new Date().toISOString(),
      });
      if (insErr) return { success: false, error: insErrс.message };
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e?.message || "Failed to accept request",
      };
    }
  }

  async declineFriendRequest(currentUserId, requesterId) {
    try {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("user_id", requesterId)
        .eq("friend_id", currentUserId);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e?.message || "Failed to decline request",
      };
    }
  }

  async removeFriend(userId, friendId) {
    try {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .or(
          `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`,
        );
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || "Failed to remove friend" };
    }
  }
}

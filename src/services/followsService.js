import { supabase } from "../lib/supabaseClient";

export class FollowsService {
  async follow(followerId, followingId) {
    const { error } = await supabase.from("follows").insert({
      follower_id: followerId,
      following_id: followingId,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async unfollow(followerId, followingId) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("following_id", followingId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async isFollowing(followerId, followingId) {
    const { data } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", followerId)
      .eq("following_id", followingId)
      .maybeSingle();
    return !!data;
  }

  async getCounts(userId) {
    const [{ count: followers }, { count: following }] = await Promise.all([
      supabase
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("following_id", userId),
      supabase
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("follower_id", userId),
    ]);
    return { followers: followers || 0, following: following || 0 };
  }

  async getFollowers(userId) {
    const { data, error } = await supabase
      .from("follows")
      .select(
        "follower:profiles!follows_follower_id_fkey(id, username, name, avatar_url, bio)",
      )
      .eq("following_id", userId);
    if (error) return [];
    return (data || []).map((x) => x.follower).filter(Boolean);
  }

  async getFollowing(userId) {
    const { data, error } = await supabase
      .from("follows")
      .select(
        "following:profiles!follows_following_id_fkey(id, username, name, avatar_url, bio)",
      )
      .eq("follower_id", userId);
    if (error) return [];
    return (data || []).map((x) => x.following).filter(Boolean);
  }

  async getMutualFollows(userId) {
    const { data: myFollowing } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId);
    if (!myFollowing?.length) return [];
    const ids = myFollowing.map((f) => f.following_id);
    const { data } = await supabase
      .from("follows")
      .select(
        "follower:profiles!follows_follower_id_fkey(id, username, name, avatar_url, bio)",
      )
      .eq("following_id", userId)
      .in("follower_id", ids);
    return (data || []).map((x) => x.follower).filter(Boolean);
  }

  async getOneWayFollowers(userId) {
    const { data: myFollowing } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId);
    const ids = (myFollowing || []).map((f) => f.following_id);
    let q = supabase
      .from("follows")
      .select(
        "follower:profiles!follows_follower_id_fkey(id, username, name, avatar_url, bio)",
      )
      .eq("following_id", userId);
    if (ids.length) q = q.not("follower_id", "in", `(${ids.join(",")})`);
    const { data } = await q;
    return (data || []).map((x) => x.follower).filter(Boolean);
  }

  async removeFollower(myId, followerId) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("following_id", myId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async getFollowingPosts(userId, limit = 20, offset = 0) {
    const { data: fData } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId);
    if (!fData?.length) return [];
    const ids = fData.map((f) => f.following_id);
    const { data, error } = await supabase
      .from("posts")
      .select(
        `id, author_id, wall_owner_id, content, media_url, created_at, author:profiles!posts_author_id_fkey(id, username, name, avatar_url), post_comments(count)`,
      )
      .in("author_id", ids)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return [];
    return (data || []).map((p) => ({
      ...p,
      _commentCount: p.post_comments?.[0]?.count ?? 0,
    }));
  }
}

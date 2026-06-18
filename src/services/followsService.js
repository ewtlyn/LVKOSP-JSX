import { supabase } from '../lib/supabaseClient'

export class FollowsService {
  async follow(followerId, followingId) {
    const { error } = await supabase.from('follows').insert({
      follower_id: followerId,
      following_id: followingId,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  async unfollow(followerId, followingId) {
    const { error } = await supabase.from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  async isFollowing(followerId, followingId) {
    const { data } = await supabase.from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle()
    return !!data
  }

  async getCounts(userId) {
    const [{ count: followers }, { count: following }] = await Promise.all([
      supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId),
      supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', userId),
    ])
    return { followers: followers || 0, following: following || 0 }
  }

  async getFollowers(userId) {
    const { data, error } = await supabase
      .from('follows')
      .select('follower:profiles!follows_follower_id_fkey(id, username, name, avatar_url, bio)')
      .eq('following_id', userId)
    if (error) return []
    return (data || []).map(x => x.follower).filter(Boolean)
  }

  async getFollowing(userId) {
    const { data, error } = await supabase
      .from('follows')
      .select('following:profiles!follows_following_id_fkey(id, username, name, avatar_url, bio)')
      .eq('follower_id', userId)
    if (error) return []
    return (data || []).map(x => x.following).filter(Boolean)
  }

  async getFollowingPosts(userId, limit = 50) {
    const { data: fData } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)
    if (!fData?.length) return []
    const ids = fData.map(f => f.following_id)
    const { data, error } = await supabase
      .from('posts')
      .select(`id, author_id, wall_owner_id, content, media_url, created_at, author:profiles!posts_author_id_fkey(id, username, name, avatar_url)`)
      .in('author_id', ids)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return []
    return data || []
  }
}

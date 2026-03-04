import { supabase } from '../lib/supabaseClient'

export class FriendsService {
  async searchUsers(query, excludeUserId) {
    try {
      if (!query || query.length < 2) return []

      let qb = supabase
        .from('profiles')
        .select('id, username, name, avatar_url, bio, status, last_seen')
        .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
        .limit(20)

      if (excludeUserId) qb = qb.neq('id', excludeUserId)

      const { data, error } = await qb
      if (error) return []
      return data || []
    } catch {
      return []
    }
  }

  async getFriends(userId) {
    try {
      const { data, error } = await supabase
        .from('friendships')
        .select(`friend:profiles!friendships_friend_id_fkey(id, username, name, avatar_url, bio, status, last_seen)`)
        .eq('user_id', userId)
        .eq('status', 'accepted')

      if (error) return []
      return (data || []).map((x) => x.friend).filter(Boolean)
    } catch {
      return []
    }
  }

  async addFriend(userId, friendId) {
    try {
      // дабл дружба
      const { error } = await supabase.from('friendships').insert([
        { user_id: userId, friend_id: friendId, status: 'accepted', created_at: new Date().toISOString() },
        { user_id: friendId, friend_id: userId, status: 'accepted', created_at: new Date().toISOString() },
      ])

      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || 'Failed to add friend' }
    }
  }

  async removeFriend(userId, friendId) {
    try {
      const { error } = await supabase
        .from('friendships')
        .delete()
        .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)

      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || 'Failed to remove friend' }
    }
  }
}
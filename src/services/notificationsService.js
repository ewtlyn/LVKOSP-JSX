import { supabase } from '../lib/supabaseClient'

export class NotificationsService {
  showNotification(title, body, type = 'info') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lvkosp:toast', { detail: { title, body, type } }))
    }
  }

  async create(userId, type, fromUserId, entityId = null, entityPreview = null) {
    if (!userId || userId === fromUserId) return
    try {
      await supabase.from('notifications').insert({
        user_id: userId, type, from_user_id: fromUserId,
        entity_id: entityId, entity_preview: entityPreview,
      })
    } catch {}
  }

  async getUnread(userId) {
    try {
      const { data } = await supabase.from('notifications')
        .select('*, from_user:profiles!notifications_from_user_id_fkey(id, name, username, avatar_url)')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
      return data || []
    } catch { return [] }
  }

  async markAllRead(userId) {
    try {
      await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    } catch {}
  }

  async getUnreadCount(userId) {
    try {
      const { count } = await supabase.from('notifications')
        .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('read', false)
      return count || 0
    } catch { return 0 }
  }
}

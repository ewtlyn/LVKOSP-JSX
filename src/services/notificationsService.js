import { supabase } from '../lib/supabaseClient'

export class NotificationsService {
  async create(userId, type, fromUserId, entityId = null, entityPreview = null) {
    if (!userId || userId === fromUserId) return
    try {
      await supabase.from('notifications').insert({
        user_id: userId, type, from_user_id: fromUserId,
        entity_id: entityId, entity_preview: entityPreview,
      })
      const titles = { like: '❤️ Лайк', comment: '💬 Комментарий', follow: '👤 Подписка', message: '💌 Сообщение', mention: '@ Упоминание' }
      const bodies = { like: 'Кто-то лайкнул ваш пост', comment: entityPreview || 'Новый комментарий', follow: 'На вас подписались', message: entityPreview || 'Новое сообщение', mention: 'Вас упомянули' }
      supabase.functions.invoke('send-push', { body: { user_id: userId, title: titles[type] || 'LVKOSP', body: bodies[type] || '', url: '/' } }).catch(() => {})
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

import { supabase } from '../lib/supabaseClient'

export class BookmarksService {
  async toggle(userId, postId) {
    const { data: existing } = await supabase.from('bookmarks')
      .select('id').eq('user_id', userId).eq('post_id', postId).maybeSingle()
    if (existing) {
      await supabase.from('bookmarks').delete().eq('id', existing.id)
      return { saved: false }
    } else {
      await supabase.from('bookmarks').insert({ user_id: userId, post_id: postId })
      return { saved: true }
    }
  }

  async isSaved(userId, postId) {
    const { data } = await supabase.from('bookmarks')
      .select('id').eq('user_id', userId).eq('post_id', postId).maybeSingle()
    return !!data
  }

  async getAll(userId) {
    const { data } = await supabase.from('bookmarks')
      .select(`post_id, posts(id, content, media_url, created_at, repost_of_id, author:profiles!posts_author_id_fkey(id, username, name, avatar_url))`)
      .eq('user_id', userId).order('created_at', { ascending: false })
    return (data || []).map(b => b.posts).filter(Boolean)
  }
}

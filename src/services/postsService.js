import { supabase } from '../lib/supabaseClient'

export class PostsService {
  async getAllPosts(limit = 50) {
    const { data, error } = await supabase
      .from('posts')
      .select(`id, author_id, content, media_url, created_at, author:profiles!posts_author_id_fkey(id, username, name, avatar_url)`)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) { console.error('[getAllPosts]', error); return [] }
    return data || []
  }

  async getPostsByUser(userId) {
    const { data, error } = await supabase
      .from('posts')
      .select(`id, author_id, wall_owner_id, content, media_url, created_at, author:profiles!posts_author_id_fkey(id, username, name, avatar_url)`)
      .or(`author_id.eq.${userId},wall_owner_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    if (error) return []
    return data || []
  }

  async uploadPostImage(file, userId) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Not an image')
    if (file.size > 5 * 1024 * 1024) throw new Error('Max 5MB')

    const ext = file.name.split('.').pop()
    const path = `${userId}/${Date.now()}.${ext}`

    const uploadTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Бакет post-media не создан в Supabase Storage')), 10000)
    )
    const { error } = await Promise.race([
      supabase.storage.from('post-media').upload(path, file, { upsert: true }),
      uploadTimeout,
    ])
    if (error) throw error

    const { data } = supabase.storage.from('post-media').getPublicUrl(path)
    return data.publicUrl
  }

  async createPost(authorId, content, file = null, wallOwnerId = null, extraFiles = []) {
    let mediaUrl = null
    if (file) mediaUrl = await this.uploadPostImage(file, authorId)

    const row = { author_id: authorId, content: content?.trim?.() || '', media_url: mediaUrl }
    if (wallOwnerId && wallOwnerId !== authorId) row.wall_owner_id = wallOwnerId

    const { data, error } = await supabase
      .from('posts')
      .insert(row)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    if (extraFiles?.length) {
      try {
        const extraUrls = await Promise.all(extraFiles.map((f, i) => this.uploadPostImage(f, authorId)))
        await supabase.from('post_media').insert(
          extraUrls.map((url, i) => ({ post_id: data.id, url, order_num: i + 1 }))
        )
      } catch {}
    }

    return { success: true, post: data }
  }

  async toggleLike(postId, userId) {
    const { data: existing } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId)
      if (error) return { success: false, error: error.message, liked: true }
      return { success: true, liked: false }
    } else {
      const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId })
      if (error) return { success: false, error: error.message, liked: false }
      return { success: true, liked: true }
    }
  }

  async getLikeCount(postId) {
    const { count } = await supabase.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId)
    return count || 0
  }

  async getComments(postId) {
    const { data, error } = await supabase
      .from('post_comments')
      .select(`id, post_id, user_id, content, created_at, user:profiles!post_comments_user_id_fkey(id, username, name, avatar_url)`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

    if (error) return []
    return data || []
  }

  async repost(userId, originalPostId) {
    const { data, error } = await supabase.from('posts')
      .insert({ author_id: userId, repost_of_id: originalPostId, content: '', media_url: null })
      .select().single()
    if (error) return { success: false, error: error.message }
    return { success: true, post: data }
  }

  async getRepostOf(postId) {
    const { data } = await supabase.from('posts')
      .select(`id, content, media_url, created_at, author:profiles!posts_author_id_fkey(id, username, name, avatar_url)`)
      .eq('id', postId).maybeSingle()
    return data || null
  }

  async deletePost(postId) {
    const { error } = await supabase.from('posts').delete().eq('id', postId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  async addComment(postId, userId, content) {
    const text = content?.trim?.()
    if (!text) return { success: false, error: 'Empty comment' }

    const { data, error } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, user_id: userId, content: text })
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, comment: data }
  }
}
import { supabase } from '../lib/supabaseClient'

export class StoriesService {
  async upload(file, userId) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Not an image')
    const ext = file.name.split('.').pop()
    const path = `${userId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('post-media').upload(path, file, { upsert: true })
    if (error) throw error
    return supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl
  }

  async create(userId, file) {
    const mediaUrl = await this.upload(file, userId)
    const { data, error } = await supabase.from('stories')
      .insert({ user_id: userId, media_url: mediaUrl })
      .select().single()
    if (error) return { success: false, error: error.message }
    return { success: true, story: data }
  }

  async getActive(userIds) {
    if (!userIds?.length) return []
    const cutoff = new Date().toISOString()
    const { data } = await supabase.from('stories')
      .select(`*, user:profiles(id, username, name, avatar_url)`)
      .in('user_id', userIds)
      .gt('expires_at', cutoff)
      .order('created_at', { ascending: false })
    return data || []
  }

  async getMyActive(userId) {
    const { data } = await supabase.from('stories')
      .select(`*, user:profiles(id, username, name, avatar_url)`)
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    return data || []
  }

  async delete(storyId) {
    await supabase.from('stories').delete().eq('id', storyId)
  }
}

import { supabase } from '../lib/supabaseClient';

export class ChannelsService {
  async getAll(limit = 30, offset = 0) {
    const { data } = await supabase
      .from('channels')
      .select('id, name, username, description, avatar_url, banner_url, created_by, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    return data || [];
  }

  async getById(channelId) {
    const { data } = await supabase
      .from('channels')
      .select('id, name, username, description, avatar_url, banner_url, created_by, created_at')
      .eq('id', channelId)
      .maybeSingle();
    return data || null;
  }

  async create(userId, { name, username, description }) {
    const slug = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!slug) return { success: false, error: 'Неверный username' };
    const { data, error } = await supabase
      .from('channels')
      .insert({ name: name.trim(), username: slug, description: description?.trim() || '', created_by: userId })
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    await supabase.from('channel_members').insert({ channel_id: data.id, user_id: userId, role: 'admin' });
    return { success: true, channel: data };
  }

  async update(channelId, updates) {
    const { error } = await supabase.from('channels').update(updates).eq('id', channelId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async delete(channelId) {
    const { error } = await supabase.from('channels').delete().eq('id', channelId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async subscribe(channelId, userId) {
    const { error } = await supabase
      .from('channel_members')
      .insert({ channel_id: channelId, user_id: userId, role: 'member' });
    if (error && !error.message.includes('duplicate')) return { success: false, error: error.message };
    return { success: true };
  }

  async unsubscribe(channelId, userId) {
    const { error } = await supabase
      .from('channel_members')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async getMembership(channelId, userId) {
    const { data } = await supabase
      .from('channel_members')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .maybeSingle();
    return data || null;
  }

  async getSubscriberCount(channelId) {
    const { count } = await supabase
      .from('channel_members')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId);
    return count || 0;
  }

  async getSubscribedChannels(userId) {
    const { data } = await supabase
      .from('channel_members')
      .select('role, channels(id, name, username, description, avatar_url)')
      .eq('user_id', userId);
    return (data || []).map(m => ({ ...m.channels, role: m.role })).filter(c => c?.id);
  }

  async getPosts(channelId, limit = 20, offset = 0) {
    const { data } = await supabase
      .from('channel_posts')
      .select(`
        id, channel_id, author_id, content, media_url, created_at,
        author:profiles!channel_posts_author_id_fkey(id, username, name, avatar_url),
        channel_post_likes(count),
        channel_post_comments(count)
      `)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    return (data || []).map(p => ({
      ...p,
      _likeCount: p.channel_post_likes?.[0]?.count ?? 0,
      _commentCount: p.channel_post_comments?.[0]?.count ?? 0,
    }));
  }

  async createPost(channelId, authorId, content, mediaUrl = null) {
    const { data, error } = await supabase
      .from('channel_posts')
      .insert({ channel_id: channelId, author_id: authorId, content: content?.trim() || '', media_url: mediaUrl })
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, post: data };
  }

  async deletePost(postId) {
    const { error } = await supabase.from('channel_posts').delete().eq('id', postId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async toggleLike(postId, userId) {
    const { data: ex } = await supabase
      .from('channel_post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();
    if (ex) {
      await supabase.from('channel_post_likes').delete().eq('post_id', postId).eq('user_id', userId);
      return { liked: false };
    }
    await supabase.from('channel_post_likes').insert({ post_id: postId, user_id: userId });
    return { liked: true };
  }

  async getLikedPostIds(userId, postIds) {
    if (!userId || !postIds?.length) return new Set();
    const { data } = await supabase
      .from('channel_post_likes')
      .select('post_id')
      .eq('user_id', userId)
      .in('post_id', postIds);
    return new Set((data || []).map(r => r.post_id));
  }

  async getComments(postId) {
    const { data } = await supabase
      .from('channel_post_comments')
      .select('id, post_id, user_id, content, created_at, user:profiles!channel_post_comments_user_id_fkey(id, username, name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    return data || [];
  }

  async addComment(postId, userId, content) {
    const text = content?.trim();
    if (!text) return { success: false };
    const { data, error } = await supabase
      .from('channel_post_comments')
      .insert({ post_id: postId, user_id: userId, content: text })
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, comment: data };
  }

  async search(query) {
    if (!query?.trim()) return [];
    const { data } = await supabase
      .from('channels')
      .select('id, name, username, description, avatar_url')
      .or(`name.ilike.%${query.trim()}%,username.ilike.%${query.trim()}%`)
      .limit(20);
    return data || [];
  }

  async uploadAvatar(channelId, file) {
    const path = `channel_${channelId}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: 'image/jpeg' });
    if (error) return { success: false, error: error.message };
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('channels').update({ avatar_url: data.publicUrl }).eq('id', channelId);
    return { success: true, avatar_url: data.publicUrl };
  }
}

export const channelsService = new ChannelsService();

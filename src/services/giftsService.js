import { supabase } from '../lib/supabaseClient';

export class GiftsService {
  async getTypes(category = null) {
    let q = supabase.from('gift_types').select('id, name, image_url, category').order('created_at', { ascending: true });
    if (category) q = q.eq('category', category);
    const { data } = await q;
    return data || [];
  }

  async getCategories() {
    const { data } = await supabase.from('gift_types').select('category');
    if (!data) return [];
    return [...new Set(data.map(r => r.category).filter(Boolean))];
  }

  async uploadGiftType(file, name, category) {
    const path = `gift_${Date.now()}.png`;
    const { error: upErr } = await supabase.storage.from('gifts').upload(path, file, { upsert: true, contentType: file.type || 'image/png' });
    if (upErr) return { success: false, error: upErr.message };
    const { data } = supabase.storage.from('gifts').getPublicUrl(path);
    const { error: dbErr } = await supabase.from('gift_types').insert({ name: name.trim(), image_url: data.publicUrl, category: category.trim() || 'Разное' });
    if (dbErr) return { success: false, error: dbErr.message };
    return { success: true };
  }

  async deleteGiftType(id) {
    const { error } = await supabase.from('gift_types').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async send(senderId, receiverId, giftTypeId, message = '') {
    const { data, error } = await supabase
      .from('gifts')
      .insert({ sender_id: senderId, receiver_id: receiverId, gift_type_id: giftTypeId, message: message.trim() })
      .select().single();
    if (error) return { success: false, error: error.message };
    // Auto-set as active gift on receiver's profile
    await supabase.from('profiles').update({ active_gift_id: data.id }).eq('id', receiverId);
    return { success: true, gift: data };
  }

  async getActiveGift(userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_gift_id')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.active_gift_id) return null;
    const { data } = await supabase
      .from('gifts')
      .select('id, message, gift_type:gift_types(id, name, image_url), sender:profiles!gifts_sender_id_fkey(id, name, username, avatar_url)')
      .eq('id', profile.active_gift_id)
      .maybeSingle();
    return data || null;
  }

  async removeActiveGift(userId) {
    const { error } = await supabase.from('profiles').update({ active_gift_id: null }).eq('id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async getReceived(userId, limit = 50) {
    const { data } = await supabase
      .from('gifts')
      .select('id, message, created_at, gift_type:gift_types(id, name, image_url, category), sender:profiles!gifts_sender_id_fkey(id, name, username, avatar_url)')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }

  async getCount(userId) {
    const { count } = await supabase.from('gifts').select('*', { count: 'exact', head: true }).eq('receiver_id', userId);
    return count || 0;
  }
}

export const giftsService = new GiftsService();

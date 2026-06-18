import { supabase } from '../lib/supabaseClient'

export class ChatService {
  constructor() {
    this.subscriptions = new Map()
    this.unreadMessages = new Map()
  }

  async getChats(userId) {
    try {
      const { data: chatMemberships, error } = await supabase
        .from('chat_members')
        .select(`chat_id, chats ( id, created_at, updated_at, last_message_content, last_message_at )`)
        .eq('user_id', userId)

      if (error || !chatMemberships?.length) return []

      let archivedMap = {}
      try {
        const { data: archData } = await supabase.from('chat_members')
          .select('chat_id, archived').eq('user_id', userId)
        if (archData) archData.forEach(r => { archivedMap[r.chat_id] = r.archived || false })
      } catch {}

      const chats = []
      for (const membership of chatMemberships) {
        const chat = membership.chats
        const { data: otherMembers } = await supabase
          .from('chat_members')
          .select(`user_id, profiles ( id, username, name, avatar_url, status, last_seen )`)
          .eq('chat_id', chat.id).neq('user_id', userId)

        const otherMember = otherMembers?.[0]?.profiles
        if (!otherMember) continue

        let status = 'offline'
        if (otherMember.status === 'online') {
          if (Date.now() - new Date(otherMember.last_seen).getTime() < 5 * 60 * 1000) status = 'online'
        }

        chats.push({
          id: chat.id,
          name: otherMember.name || 'Unknown',
          username: otherMember.username || '@unknown',
          avatarUrl: otherMember.avatar_url || '',
          lastMessage: chat.last_message_content || 'No messages yet',
          lastMessageTime: chat.last_message_at || chat.created_at,
          userId: otherMember.id,
          status, unreadCount: 0,
          archived: archivedMap[chat.id] || false,
        })
      }
      const seen = new Map()
      for (const chat of chats) {
        const ex = seen.get(chat.userId)
        if (!ex || new Date(chat.lastMessageTime) > new Date(ex.lastMessageTime)) seen.set(chat.userId, chat)
      }
      return [...seen.values()].sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime))
    } catch { return [] }
  }

  async uploadChatImage(file, chatId, userId) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Not an image')
    if (file.size > 5 * 1024 * 1024) throw new Error('Max 5MB')
    const ext = file.name.split('.').pop()
    const path = `${chatId}/${userId}_${Date.now()}.${ext}`
    const { error } = await Promise.race([
      supabase.storage.from('chat-media').upload(path, file, { upsert: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Бакет chat-media не создан в Supabase Storage')), 10000)),
    ])
    if (error) throw error
    const { data } = supabase.storage.from('chat-media').getPublicUrl(path)
    return data.publicUrl
  }

  async sendImage(chatId, senderId, file) {
    const url = await this.uploadChatImage(file, chatId, senderId)
    const { data, error } = await supabase.from('messages').insert({
      chat_id: chatId, sender_id: senderId,
      type: 'image', content: '', media_url: url,
      created_at: new Date().toISOString(), read: false,
    }).select().single()
    if (error) return { success: false, error: error.message }
    await supabase.from('chats').update({
      updated_at: new Date().toISOString(),
      last_message_content: '📷 Photo',
      last_message_at: new Date().toISOString(),
      last_message_sender: senderId,
    }).eq('id', chatId)
    return { success: true, message: data }
  }

  async sendMessage(chatId, senderId, content, replyToId = null) {
    try {
      const row = {
        chat_id: chatId, sender_id: senderId,
        content: content.trim(), created_at: new Date().toISOString(), read: false,
      }
      if (replyToId) row.reply_to_id = replyToId
      const { data, error } = await supabase.from('messages').insert(row).select().single()
      if (error) return { success: false, error: error.message }
      await supabase.from('chats').update({
        updated_at: new Date().toISOString(),
        last_message_content: content.trim(),
        last_message_at: new Date().toISOString(),
        last_message_sender: senderId,
      }).eq('id', chatId)
      return { success: true, message: data }
    } catch (e) { return { success: false, error: e?.message || 'Send failed' } }
  }

  async getMessages(chatId, userId) {
    try {
      // пробуем полный запрос с reply_to (нужна колонка reply_to_id в messages)
      let msgs = null
      const { data: full, error: fullErr } = await supabase.from('messages')
        .select(`*, sender:profiles(id, username, name, avatar_url), reply_to:messages!messages_reply_to_id_fkey(id, content, type, media_url, sender:profiles(name))`)
        .eq('chat_id', chatId).order('created_at', { ascending: true })

      if (fullErr) {
        // fallback без reply_to (если колонка не существует)
        const { data: simple, error: simpleErr } = await supabase.from('messages')
          .select(`*, sender:profiles(id, username, name, avatar_url)`)
          .eq('chat_id', chatId).order('created_at', { ascending: true })
        if (simpleErr) return []
        msgs = simple || []
      } else {
        msgs = full || []
      }

      // реакции (если таблица не существует — игнорируем)
      if (msgs.length) {
        try {
          const ids = msgs.map(m => m.id)
          const { data: rxData } = await supabase.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids)
          const rxMap = {}
          for (const r of (rxData || [])) {
            if (!rxMap[r.message_id]) rxMap[r.message_id] = []
            rxMap[r.message_id].push(r)
          }
          for (const m of msgs) m._reactions = rxMap[m.id] || []
        } catch {
          for (const m of msgs) m._reactions = []
        }
      }

      await this.markAsRead(chatId, userId)
      return msgs
    } catch { return [] }
  }

  async toggleReaction(messageId, userId, emoji) {
    const { data: existing } = await supabase.from('message_reactions')
      .select('id').eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji).maybeSingle()
    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id)
      return { added: false }
    } else {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji })
      return { added: true }
    }
  }

  async markAsRead(chatId, userId) {
    try {
      await supabase.from('messages').update({ read: true })
        .eq('chat_id', chatId).neq('sender_id', userId).eq('read', false)
      this.unreadMessages.set(chatId, 0)
    } catch {}
  }

  async createChat(userId, friendId) {
    const { data: existing } = await supabase.from('chat_members').select('chat_id').in('user_id', [userId, friendId])
    if (existing?.length) {
      const counts = {}
      existing.forEach(x => (counts[x.chat_id] = (counts[x.chat_id] || 0) + 1))
      const common = Object.entries(counts).find(([, c]) => c >= 2)
      if (common) return common[0]
    }
    const { data: newChat, error } = await supabase.from('chats')
      .insert({ created_by: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .select().single()
    if (error) throw error
    await supabase.from('chat_members').insert([
      { chat_id: newChat.id, user_id: userId, joined_at: new Date().toISOString(), last_read_at: new Date().toISOString() },
      { chat_id: newChat.id, user_id: friendId, joined_at: new Date().toISOString(), last_read_at: new Date().toISOString() },
    ])
    return newChat.id
  }

  subscribeToMessages(chatId, onNewMessage) {
    this.unsubscribeFromMessages(chatId)
    const channel = supabase.channel(`chat:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        async (payload) => {
          const { data: sender } = await supabase.from('profiles')
            .select('id, username, name, avatar_url').eq('id', payload.new.sender_id).single()
          onNewMessage?.({ ...payload.new, sender: sender || { id: payload.new.sender_id, name: 'Unknown', avatar_url: '' } })
        })
      .subscribe()
    this.subscriptions.set(chatId, channel)
  }

  unsubscribeFromMessages(chatId) {
    if (!this.subscriptions.has(chatId)) return
    supabase.removeChannel(this.subscriptions.get(chatId))
    this.subscriptions.delete(chatId)
  }

  unsubscribeFromAll() {
    for (const [chatId] of this.subscriptions.entries()) this.unsubscribeFromMessages(chatId)
  }

  async deleteChat(chatId) {
    try {
      this.unsubscribeFromMessages(chatId)
      await supabase.from('messages').delete().eq('chat_id', chatId)
      await supabase.from('chat_members').delete().eq('chat_id', chatId)
      await supabase.from('chats').delete().eq('id', chatId)
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || 'Ошибка удаления' }
    }
  }

  async setArchived(chatId, userId, archived) {
    const { error } = await supabase.from('chat_members')
      .update({ archived }).eq('chat_id', chatId).eq('user_id', userId)
    return !error
  }

  async pinMessage(chatId, messageId) {
    const { error } = await supabase.from('chats')
      .update({ pinned_message_id: messageId }).eq('id', chatId)
    return !error
  }

  async unpinMessage(chatId) {
    const { error } = await supabase.from('chats')
      .update({ pinned_message_id: null }).eq('id', chatId)
    return !error
  }

  async getPinnedMessage(chatId) {
    try {
      const { data } = await supabase.from('chats')
        .select('pinned_message_id, pinned:messages!chats_pinned_message_id_fkey(id, content, type, sender:profiles(name))')
        .eq('id', chatId).single()
      return data?.pinned || null
    } catch { return null }
  }

  async sendVoice(chatId, senderId, file) {
    try {
      const url = await this.uploadChatImage(file, chatId, senderId)
      const { data, error } = await supabase.from('messages').insert({
        chat_id: chatId, sender_id: senderId, type: 'voice',
        content: '', media_url: url, created_at: new Date().toISOString(), read: false,
      }).select().single()
      if (error) return { success: false, error: error.message }
      await supabase.from('chats').update({ updated_at: new Date().toISOString(), last_message_content: '🎙 Голосовое', last_message_at: new Date().toISOString() }).eq('id', chatId)
      return { success: true, message: data }
    } catch (e) { return { success: false, error: e?.message } }
  }

  async editMessage(messageId, content) {
    const { error } = await supabase.from('messages')
      .update({ content: content.trim(), edited: true }).eq('id', messageId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  async deleteMessage(messageId) {
    const { error } = await supabase.from('messages').delete().eq('id', messageId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }
}
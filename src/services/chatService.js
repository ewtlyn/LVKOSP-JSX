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
        .select(
          `
          chat_id,
          chats (
            id,
            created_at,
            updated_at,
            last_message_content,
            last_message_at
          )
        `
        )
        .eq('user_id', userId)

      if (error || !chatMemberships?.length) return []

      const chats = []

      for (const membership of chatMemberships) {
        const chat = membership.chats

        const { data: otherMembers } = await supabase
          .from('chat_members')
          .select(
            `
            user_id,
            profiles (
              id,
              username,
              name,
              avatar_url,
              status,
              last_seen
            )
          `
          )
          .eq('chat_id', chat.id)
          .neq('user_id', userId)

        const otherMember = otherMembers?.[0]?.profiles
        const unreadCount = this.unreadMessages.get(chat.id) || 0

        if (otherMember) {
          let status = 'offline'
          if (otherMember.status === 'online') {
            const lastSeen = new Date(otherMember.last_seen).getTime()
            if (Date.now() - lastSeen < 5 * 60 * 1000) status = 'online'
          }

          chats.push({
            id: chat.id,
            name: otherMember.name || 'Unknown',
            username: otherMember.username || '@unknown',
            avatarUrl: otherMember.avatar_url || '',
            lastMessage: chat.last_message_content || 'No messages yet',
            lastMessageTime: chat.last_message_at || chat.created_at,
            userId: otherMember.id,
            status,
            unreadCount,
          })
        }
      }

      return chats.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime))
    } catch {
      return []
    }
  }

  async sendMessage(chatId, senderId, content) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: senderId,
          content: content.trim(),
          created_at: new Date().toISOString(),
          read: false,
        })
        .select()
        .single()

      if (error) return { success: false, error: error.message }

      try {
        await supabase
          .from('chats')
          .update({
            updated_at: new Date().toISOString(),
            last_message_content: content.trim(),
            last_message_at: new Date().toISOString(),
            last_message_sender: senderId,
          })
          .eq('id', chatId)
      } catch {
      }

      return { success: true, message: data }
    } catch (e) {
      return { success: false, error: e?.message || 'Send failed' }
    }
  }

  async getMessages(chatId, userId) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(
          `
          *,
          sender:profiles (
            id,
            username,
            name,
            avatar_url
          )
        `
        )
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })

      if (error) return []
      await this.markAsRead(chatId, userId)
      return data || []
    } catch {
      return []
    }
  }

  async markAsRead(chatId, userId) {
    try {
      await supabase.from('messages').update({ read: true }).eq('chat_id', chatId).neq('sender_id', userId).eq('read', false)
      this.unreadMessages.set(chatId, 0)
    } catch {
    }
  }

  async createChat(userId, friendId) {
    const { data: existingChats } = await supabase.from('chat_members').select('chat_id').in('user_id', [userId, friendId])

    if (existingChats?.length) {
      const counts = {}
      existingChats.forEach((x) => (counts[x.chat_id] = (counts[x.chat_id] || 0) + 1))
      const common = Object.entries(counts).find(([, c]) => c === 2)
      if (common) return common[0]
    }

    const { data: newChat, error: chatError } = await supabase
      .from('chats')
      .insert({ created_by: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .select()
      .single()

    if (chatError) throw chatError

    await supabase.from('chat_members').insert({
      chat_id: newChat.id,
      user_id: userId,
      joined_at: new Date().toISOString(),
      last_read_at: new Date().toISOString(),
    })

    await supabase.from('chat_members').insert({
      chat_id: newChat.id,
      user_id: friendId,
      joined_at: new Date().toISOString(),
      last_read_at: new Date().toISOString(),
    })

    return newChat.id
  }

  subscribeToMessages(chatId, onNewMessage) {
    this.unsubscribeFromMessages(chatId)

    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        async (payload) => {
          const { data: sender } = await supabase
            .from('profiles')
            .select('id, username, name, avatar_url')
            .eq('id', payload.new.sender_id)
            .single()

          onNewMessage?.({
            ...payload.new,
            sender: sender || { id: payload.new.sender_id, name: 'Unknown', avatar_url: '' },
          })
        }
      )
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
}
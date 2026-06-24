import { supabase } from "../lib/supabaseClient";

export class ChatService {
  constructor() {
    this.subscriptions = new Map();
    this.unreadMessages = new Map();
  }

  async getChats(userId) {
    try {
      // Query 1: memberships + chat data + archived in one shot
      const { data: chatMemberships, error } = await supabase
        .from("chat_members")
        .select(
          `chat_id, archived, chats ( id, created_at, updated_at, last_message_content, last_message_at, is_group, group_name, group_avatar )`,
        )
        .eq("user_id", userId);

      if (error || !chatMemberships?.length) return [];

      const chatIds = chatMemberships.map((m) => m.chat_id).filter(Boolean);

      // Query 2: ALL members for ALL chats at once (replaces N per-chat queries)
      const { data: allMembers } = await supabase
        .from("chat_members")
        .select(
          `chat_id, user_id, profiles ( id, username, name, avatar_url, status, last_seen )`,
        )
        .in("chat_id", chatIds)
        .neq("user_id", userId);

      const membersByChatId = {};
      for (const m of allMembers || []) {
        if (!membersByChatId[m.chat_id]) membersByChatId[m.chat_id] = [];
        membersByChatId[m.chat_id].push(m);
      }

      const chats = [];
      for (const membership of chatMemberships) {
        const chat = membership.chats;
        if (!chat) continue;
        const otherMembers = membersByChatId[chat.id] || [];

        if (chat.is_group) {
          chats.push({
            id: chat.id,
            name: chat.group_name || 'Группа',
            username: '',
            avatarUrl: chat.group_avatar || '',
            lastMessage: chat.last_message_content || '',
            lastMessageTime: chat.last_message_at || chat.created_at,
            userId: null,
            status: null,
            last_seen: null,
            unreadCount: 0,
            archived: membership.archived || false,
            isGroup: true,
            memberCount: otherMembers.length + 1,
          });
          continue;
        }

        const otherMember = otherMembers[0]?.profiles;
        if (!otherMember) continue;

        let status = "offline";
        if (
          otherMember.status === "online" &&
          Date.now() - new Date(otherMember.last_seen).getTime() < 5 * 60 * 1000
        ) status = "online";

        chats.push({
          id: chat.id,
          name: otherMember.name || "Unknown",
          username: otherMember.username || "@unknown",
          avatarUrl: otherMember.avatar_url || "",
          lastMessage: chat.last_message_content || "No messages yet",
          lastMessageTime: chat.last_message_at || chat.created_at,
          userId: otherMember.id,
          status,
          last_seen: otherMember.last_seen || null,
          unreadCount: 0,
          archived: membership.archived || false,
          isGroup: false,
        });
      }

      const seen = new Map();
      for (const chat of chats) {
        const key = chat.isGroup ? `group:${chat.id}` : `dm:${chat.userId}`;
        const ex = seen.get(key);
        if (!ex || new Date(chat.lastMessageTime) > new Date(ex.lastMessageTime))
          seen.set(key, chat);
      }
      return [...seen.values()].sort(
        (a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime),
      );
    } catch {
      return [];
    }
  }

  async uploadChatImage(file, chatId, userId) {
    const mimeType = (file?.type || "").toLowerCase();
    if (!file || (!mimeType.startsWith("image/") && !mimeType.includes("heic") && !mimeType.includes("heif") && mimeType !== ""))
      throw new Error("Not an image");
    if (file.size > 15 * 1024 * 1024) throw new Error("Файл слишком большой (макс 15МБ)");
    const path = `${chatId}/${userId}_${Date.now()}.jpg`;
    const contentType = (file.type && file.type.startsWith("image/")) ? file.type : "image/jpeg";
    const { error } = await Promise.race([
      supabase.storage.from("chat-media").upload(path, file, { upsert: true, contentType }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Превышено время загрузки")), 30000)),
    ]);
    if (error) throw error;
    const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
    return data.publicUrl;
  }

  async sendImage(chatId, senderId, file) {
    const url = await this.uploadChatImage(file, chatId, senderId);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        chat_id: chatId,
        sender_id: senderId,
        type: "image",
        content: "",
        media_url: url,
        created_at: new Date().toISOString(),
        read: false,
      })
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    await supabase
      .from("chats")
      .update({
        updated_at: new Date().toISOString(),
        last_message_content: "📷 Photo",
        last_message_at: new Date().toISOString(),
        last_message_sender: senderId,
      })
      .eq("id", chatId);
    return { success: true, message: data };
  }

  async sendMessage(chatId, senderId, content, replyToId = null) {
    try {
      const row = {
        chat_id: chatId,
        sender_id: senderId,
        content: content.trim(),
        created_at: new Date().toISOString(),
        read: false,
      };
      if (replyToId) row.reply_to_id = replyToId;
      const { data, error } = await supabase
        .from("messages")
        .insert(row)
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      await supabase
        .from("chats")
        .update({
          updated_at: new Date().toISOString(),
          last_message_content: content.trim(),
          last_message_at: new Date().toISOString(),
          last_message_sender: senderId,
        })
        .eq("id", chatId);
      return { success: true, message: data };
    } catch (e) {
      return { success: false, error: e?.message || "Send failed" };
    }
  }

  async getMessages(chatId, userId) {
    try {
      // пробуем полный запрос с reply_to (нужна колонка reply_to_id в messages)
      let msgs = null;
      const { data: full, error: fullErr } = await supabase
        .from("messages")
        .select(
          `*, sender:profiles(id, username, name, avatar_url), reply_to:messages!messages_reply_to_id_fkey(id, content, type, media_url, sender:profiles(name))`,
        )
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (fullErr) {
        // fallback без reply_to (если колонка не существует)
        const { data: simple, error: simpleErr } = await supabase
          .from("messages")
          .select(`*, sender:profiles(id, username, name, avatar_url)`)
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true });
        if (simpleErr) return [];
        msgs = simple || [];
      } else {
        msgs = full || [];
      }

      // реакции (если таблица не существует — игнорируем)
      if (msgs.length) {
        try {
          const ids = msgs.map((m) => m.id);
          const { data: rxData } = await supabase
            .from("message_reactions")
            .select("message_id, user_id, emoji")
            .in("message_id", ids);
          const rxMap = {};
          for (const r of rxData || []) {
            if (!rxMap[r.message_id]) rxMap[r.message_id] = [];
            rxMap[r.message_id].push(r);
          }
          for (const m of msgs) m._reactions = rxMap[m.id] || [];
        } catch {
          for (const m of msgs) m._reactions = [];
        }
      }

      await this.markAsRead(chatId, userId);
      return msgs;
    } catch {
      return [];
    }
  }

  async toggleReaction(messageId, userId, emoji) {
    const { data: existing } = await supabase
      .from("message_reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji)
      .maybeSingle();
    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
      return { added: false };
    } else {
      await supabase
        .from("message_reactions")
        .insert({ message_id: messageId, user_id: userId, emoji });
      return { added: true };
    }
  }

  async markAsRead(chatId, userId) {
    try {
      await supabase
        .from("messages")
        .update({ read: true })
        .eq("chat_id", chatId)
        .neq("sender_id", userId)
        .eq("read", false);
      this.unreadMessages.set(chatId, 0);
    } catch {}
  }

  async createChat(userId, friendId) {
    const { data: existing } = await supabase
      .from("chat_members")
      .select("chat_id")
      .in("user_id", [userId, friendId]);
    if (existing?.length) {
      const counts = {};
      existing.forEach(
        (x) => (counts[x.chat_id] = (counts[x.chat_id] || 0) + 1),
      );
      const common = Object.entries(counts).find(([, c]) => c >= 2);
      if (common) return common[0];
    }
    const { data: newChat, error } = await supabase
      .from("chats")
      .insert({
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    await supabase.from("chat_members").insert([
      {
        chat_id: newChat.id,
        user_id: userId,
        joined_at: new Date().toISOString(),
        last_read_at: new Date().toISOString(),
      },
      {
        chat_id: newChat.id,
        user_id: friendId,
        joined_at: new Date().toISOString(),
        last_read_at: new Date().toISOString(),
      },
    ]);
    return newChat.id;
  }

  async createGroupChat(creatorId, memberIds, name) {
    const { data: newChat, error } = await supabase
      .from('chats')
      .insert({ created_by: creatorId, group_name: name, is_group: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .select().single();
    if (error) return { success: false, error: error.message };
    const allIds = [creatorId, ...memberIds.filter(id => id !== creatorId)];
    await supabase.from('chat_members').insert(allIds.map(uid => ({
      chat_id: newChat.id, user_id: uid, joined_at: new Date().toISOString(), last_read_at: new Date().toISOString()
    })));
    return { success: true, chatId: newChat.id };
  }

  async getGroupMembers(chatId) {
    const { data } = await supabase.from('chat_members')
      .select('user_id, profiles(id, name, username, avatar_url, status)')
      .eq('chat_id', chatId);
    return (data || []).map(r => r.profiles).filter(Boolean);
  }

  async addGroupMembers(chatId, userIds) {
    const rows = userIds.map(uid => ({
      chat_id: chatId, user_id: uid,
      joined_at: new Date().toISOString(), last_read_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('chat_members').upsert(rows, { onConflict: 'chat_id,user_id', ignoreDuplicates: true });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async removeGroupMember(chatId, userId) {
    const { error } = await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async updateGroupAvatar(chatId, file) {
    const path = `group-avatars/${chatId}/${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from('post-media').upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) return { success: false, error: upErr.message };
    const { data: { publicUrl } } = supabase.storage.from('post-media').getPublicUrl(path);
    const { error } = await supabase.from('chats').update({ group_avatar: publicUrl }).eq('id', chatId);
    if (error) return { success: false, error: error.message };
    return { success: true, url: publicUrl };
  }

  async updateGroupName(chatId, name) {
    const { error } = await supabase.from('chats').update({ group_name: name }).eq('id', chatId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async updateGroupDescription(chatId, description) {
    const { error } = await supabase.from('chats').update({ group_description: description }).eq('id', chatId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  subscribeToMessages(chatId, onNewMessage, onDeleteMessage, onUpdateMessage) {
    this.unsubscribeFromMessages(chatId);
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          const { data: sender } = await supabase
            .from("profiles")
            .select("id, username, name, avatar_url")
            .eq("id", payload.new.sender_id)
            .single();
          onNewMessage?.({
            ...payload.new,
            sender: sender || {
              id: payload.new.sender_id,
              name: "Unknown",
              avatar_url: "",
            },
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          onUpdateMessage?.(payload.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          onDeleteMessage?.(payload.old.id);
        },
      )
      .subscribe();
    this.subscriptions.set(chatId, channel);
  }

  async deleteForEveryone(messageId) {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  unsubscribeFromMessages(chatId) {
    if (!this.subscriptions.has(chatId)) return;
    supabase.removeChannel(this.subscriptions.get(chatId));
    this.subscriptions.delete(chatId);
  }

  unsubscribeFromAll() {
    for (const [chatId] of this.subscriptions.entries())
      this.unsubscribeFromMessages(chatId);
  }

  async deleteChat(chatId) {
    try {
      this.unsubscribeFromMessages(chatId);
      await supabase.from("messages").delete().eq("chat_id", chatId);
      await supabase.from("chat_members").delete().eq("chat_id", chatId);
      await supabase.from("chats").delete().eq("id", chatId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || "Ошибка удаления" };
    }
  }

  async setArchived(chatId, userId, archived) {
    const { error } = await supabase
      .from("chat_members")
      .update({ archived })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    return !error;
  }

  async pinMessage(chatId, messageId) {
    const { error } = await supabase
      .from("chats")
      .update({ pinned_message_id: messageId })
      .eq("id", chatId);
    return !error;
  }

  async unpinMessage(chatId) {
    const { error } = await supabase
      .from("chats")
      .update({ pinned_message_id: null })
      .eq("id", chatId);
    return !error;
  }

  async getPinnedMessage(chatId) {
    try {
      const { data } = await supabase
        .from("chats")
        .select(
          "pinned_message_id, pinned:messages!chats_pinned_message_id_fkey(id, content, type, sender:profiles(name))",
        )
        .eq("id", chatId)
        .single();
      return data?.pinned || null;
    } catch {
      return null;
    }
  }

  async sendVoice(chatId, senderId, file) {
    try {
      const url = await this.uploadChatImage(file, chatId, senderId);
      const { data, error } = await supabase
        .from("messages")
        .insert({
          chat_id: chatId,
          sender_id: senderId,
          type: "voice",
          content: "",
          media_url: url,
          created_at: new Date().toISOString(),
          read: false,
        })
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      await supabase
        .from("chats")
        .update({
          updated_at: new Date().toISOString(),
          last_message_content: "🎙 Голосовое",
          last_message_at: new Date().toISOString(),
        })
        .eq("id", chatId);
      return { success: true, message: data };
    } catch (e) {
      return { success: false, error: e?.message };
    }
  }

  async editMessage(messageId, content) {
    const { error } = await supabase
      .from("messages")
      .update({ content: content.trim(), edited: true })
      .eq("id", messageId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async deleteMessage(messageId) {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }
}

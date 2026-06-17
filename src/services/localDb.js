const STORAGE_KEY = 'lvkosp_local_db'
const MAX_AVATAR_SIZE = 2 * 1024 * 1024
const MAX_MESSAGE_IMAGE_SIZE = 5 * 1024 * 1024
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function createEmptyDatabase() {
  return {
    users: [],
    sessions: [],
    friendships: [],
    chats: [],
    chat_members: [],
    messages: [],
    posts: [],
    post_likes: [],
    post_comments: [],
  }
}

function safeDb(db) {
  if (!db || typeof db !== 'object') db = createEmptyDatabase()
  return {
    users: Array.isArray(db.users) ? db.users : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
    friendships: Array.isArray(db.friendships) ? db.friendships : [],
    chats: Array.isArray(db.chats) ? db.chats : [],
    chat_members: Array.isArray(db.chat_members) ? db.chat_members : [],
    messages: Array.isArray(db.messages) ? db.messages : [],
    posts: Array.isArray(db.posts) ? db.posts : [],
    post_likes: Array.isArray(db.post_likes) ? db.post_likes : [],
    post_comments: Array.isArray(db.post_comments) ? db.post_comments : [],
  }
}

function loadDb() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return createEmptyDatabase()
    return safeDb(JSON.parse(stored))
  } catch {
    return createEmptyDatabase()
  }
}

function saveDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeDb(db)))
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function now() {
  return new Date().toISOString()
}

export async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(String(password) + 'lvkosp_salt_2024')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function fileToDataUrl(file, maxSize = MAX_MESSAGE_IMAGE_SIZE) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please select a valid image file')
  if (file.size > maxSize) throw new Error('Image size should be less than ' + Math.round(maxSize / 1024 / 1024) + 'MB')
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function getUserByUsername(username) {
  if (!username) return null
  const db = loadDb()
  return db.users.find((u) => u.username === username.trim()) || null
}

export function getUserById(userId) {
  if (!userId) return null
  const db = loadDb()
  return db.users.find((u) => u.id === userId) || null
}

export function getPublicProfile(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar_url: user.avatar_url || '',
    bio: user.bio || '',
    status: user.status || 'offline',
    last_seen: user.last_seen || now(),
  }
}

export function createUser(user) {
  const db = loadDb()
  db.users.push(clone(user))
  saveDb(db)
  return clone(user)
}

export function updateUser(userId, updates) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user) return null
  if (typeof updates.name === 'string') user.name = updates.name.trim()
  if (typeof updates.bio === 'string') user.bio = updates.bio.trim()
  if (typeof updates.avatar_url === 'string') user.avatar_url = updates.avatar_url
  if (typeof updates.status === 'string') user.status = updates.status
  if (typeof updates.last_seen === 'string') user.last_seen = updates.last_seen
  saveDb(db)
  return clone(user)
}

export function clearSessionsForUser(userId) {
  const db = loadDb()
  db.sessions = db.sessions.filter((s) => s.user_id !== userId)
  saveDb(db)
}

export function createSession(userId, token) {
  const db = loadDb()
  const session = {
    id: createId(),
    user_id: userId,
    token,
    created_at: now(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  }
  db.sessions.push(session)
  saveDb(db)
  return clone(session)
}

export function findSession(userId, token) {
  const db = loadDb()
  const session = db.sessions.find((s) => s.user_id === userId && s.token === token)
  if (!session) return null
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((s) => s.id !== session.id)
    saveDb(db)
    return null
  }
  return clone(session)
}

export function deleteSession(userId, token) {
  const db = loadDb()
  db.sessions = db.sessions.filter((s) => !(s.user_id === userId && s.token === token))
  saveDb(db)
}

export function searchUsers(query, excludeUserId) {
  const db = loadDb()
  const normalized = String(query || '').trim().toLowerCase()
  if (!normalized || normalized.length < 2) return []
  return db.users
    .filter((user) => user.id !== excludeUserId)
    .filter((user) => user.username.toLowerCase().includes(normalized) || user.name.toLowerCase().includes(normalized))
    .map(getPublicProfile)
    .slice(0, 20)
}

export function getFriends(userId) {
  const db = loadDb()
  const friendIds = db.friendships
    .filter((row) => row.user_id === userId && row.status === 'accepted')
    .map((row) => row.friend_id)
  return friendIds.map(getUserById).filter(Boolean).map(getPublicProfile)
}

export function addFriend(userId, friendId) {
  if (!userId || !friendId || userId === friendId) return false
  const db = loadDb()
  const exists = db.friendships.some((row) => row.user_id === userId && row.friend_id === friendId)
  if (!exists) {
    db.friendships.push({ id: createId(), user_id: userId, friend_id: friendId, status: 'accepted', created_at: now() })
  }
  const reverseExists = db.friendships.some((row) => row.user_id === friendId && row.friend_id === userId)
  if (!reverseExists) {
    db.friendships.push({ id: createId(), user_id: friendId, friend_id: userId, status: 'accepted', created_at: now() })
  }
  saveDb(db)
  return true
}

export function removeFriend(userId, friendId) {
  const db = loadDb()
  db.friendships = db.friendships.filter((row) => !(
    (row.user_id === userId && row.friend_id === friendId) ||
    (row.user_id === friendId && row.friend_id === userId)
  ))
  saveDb(db)
  return true
}

export function getChats(userId) {
  const db = loadDb()
  const memberRows = db.chat_members.filter((row) => row.user_id === userId)
  const chats = memberRows
    .map((member) => db.chats.find((chat) => chat.id === member.chat_id))
    .filter(Boolean)
    .map((chat) => {
      const members = db.chat_members.filter((row) => row.chat_id === chat.id).map((row) => row.user_id)
      const otherIds = members.filter((id) => id !== userId)
      const otherUser = getUserById(otherIds[0])
      const chatMessages = db.messages.filter((msg) => msg.chat_id === chat.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const lastMessage = chatMessages[chatMessages.length - 1]
      const lastText = lastMessage
        ? lastMessage.type === 'image'
          ? '📷 Фото'
          : lastMessage.content || 'Сообщение'
        : 'Нет сообщений'
      const lastTime = lastMessage?.created_at || chat.created_at
      const status = otherUser && otherUser.status === 'online' && Date.now() - new Date(otherUser.last_seen).getTime() < 5 * 60 * 1000 ? 'online' : 'offline'
      const unreadCount = db.messages.filter((msg) => msg.chat_id === chat.id && !msg.read && msg.sender_id !== userId).length
      return {
        id: chat.id,
        name: otherUser?.name || 'Чат',
        username: otherUser?.username || '@unknown',
        avatarUrl: otherUser?.avatar_url || '',
        lastMessage: lastText,
        lastMessageTime: lastTime,
        userId: otherUser?.id || '',
        status,
        unreadCount,
      }
    })
  return chats.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime))
}

export function createChat(userId, friendId) {
  const db = loadDb()
  const userChats = db.chat_members.filter((row) => row.user_id === userId).map((row) => row.chat_id)
  const friendChats = db.chat_members.filter((row) => row.user_id === friendId).map((row) => row.chat_id)
  const common = userChats.filter((id) => friendChats.includes(id))[0]
  if (common) return common
  const chatId = createId()
  const timestamp = now()
  db.chats.push({ id: chatId, created_by: userId, created_at: timestamp, updated_at: timestamp, last_message_content: '', last_message_at: timestamp })
  db.chat_members.push({ id: createId(), chat_id: chatId, user_id: userId, joined_at: timestamp, last_read_at: timestamp })
  db.chat_members.push({ id: createId(), chat_id: chatId, user_id: friendId, joined_at: timestamp, last_read_at: timestamp })
  saveDb(db)
  return chatId
}

export function getMessages(chatId) {
  const db = loadDb()
  const messages = db.messages
    .filter((msg) => msg.chat_id === chatId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((msg) => ({
      ...clone(msg),
      sender: getPublicProfile(getUserById(msg.sender_id)) || { id: msg.sender_id, username: 'unknown', name: 'Unknown', avatar_url: '' },
    }))
  return messages
}

export function markChatAsRead(chatId, userId) {
  const db = loadDb()
  db.messages.forEach((msg) => {
    if (msg.chat_id === chatId && msg.sender_id !== userId) msg.read = true
  })
  saveDb(db)
}

export function createMessage(chatId, senderId, content, type = 'text', media_url = '') {
  const db = loadDb()
  const message = {
    id: createId(),
    chat_id: chatId,
    sender_id: senderId,
    content: String(content || '').trim(),
    type,
    media_url: media_url || '',
    created_at: now(),
    read: false,
    edited: false,
  }
  db.messages.push(message)
  const chat = db.chats.find((c) => c.id === chatId)
  if (chat) {
    chat.updated_at = now()
    chat.last_message_content = type === 'image' ? '📷 Фото' : message.content
    chat.last_message_at = message.created_at
  }
  saveDb(db)
  return clone(message)
}

export function editMessage(msgId, newContent) {
  const db = loadDb()
  const msg = db.messages.find((m) => m.id === msgId)
  if (!msg) return null
  msg.content = newContent.trim()
  msg.edited = true
  saveDb(db)
  return clone(msg)
}

export function deleteMessage(msgId) {
  const db = loadDb()
  const message = db.messages.find((m) => m.id === msgId)
  if (!message) return null
  db.messages = db.messages.filter((m) => m.id !== msgId)
  const chatId = message.chat_id
  const chat = db.chats.find((c) => c.id === chatId)
  if (chat) {
    const remaining = db.messages.filter((m) => m.chat_id === chatId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    const lastMessage = remaining[remaining.length - 1]
    chat.last_message_content = lastMessage ? (lastMessage.type === 'image' ? '📷 Фото' : lastMessage.content) : ''
    chat.last_message_at = lastMessage ? lastMessage.created_at : chat.created_at
  }
  saveDb(db)
  return clone(message)
}

export async function uploadMessageImage(file) {
  return await fileToDataUrl(file, MAX_MESSAGE_IMAGE_SIZE)
}

export function getPostsByUser(userId) {
  const db = loadDb()
  return db.posts
    .filter((post) => post.author_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((post) => ({
      ...clone(post),
      author: getPublicProfile(getUserById(post.author_id)),
    }))
}

export function createPost(authorId, content, media_url = '') {
  const db = loadDb()
  const post = {
    id: createId(),
    author_id: authorId,
    content: String(content || '').trim(),
    media_url: media_url || '',
    created_at: now(),
  }
  db.posts.push(post)
  saveDb(db)
  return clone(post)
}

export function toggleLike(postId, userId) {
  const db = loadDb()
  const existing = db.post_likes.find((row) => row.post_id === postId && row.user_id === userId)
  if (existing) {
    db.post_likes = db.post_likes.filter((row) => !(row.post_id === postId && row.user_id === userId))
    saveDb(db)
    return { success: true, liked: false }
  }
  db.post_likes.push({ id: createId(), post_id: postId, user_id: userId, created_at: now() })
  saveDb(db)
  return { success: true, liked: true }
}

export function getLikeCount(postId) {
  const db = loadDb()
  return db.post_likes.filter((row) => row.post_id === postId).length
}

export function getComments(postId) {
  const db = loadDb()
  return db.post_comments
    .filter((comment) => comment.post_id === postId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((comment) => ({
      ...clone(comment),
      user: getPublicProfile(getUserById(comment.user_id)),
    }))
}

export function addComment(postId, userId, content) {
  const db = loadDb()
  const text = String(content || '').trim()
  if (!text) return null
  const comment = {
    id: createId(),
    post_id: postId,
    user_id: userId,
    content: text,
    created_at: now(),
  }
  db.post_comments.push(comment)
  saveDb(db)
  return clone(comment)
}

export function setUserOnline(userId) {
  return updateUser(userId, { status: 'online', last_seen: now() })
}

import { supabase } from '../lib/supabaseClient'

// перенос из supabase.js =====
function isValidUserData(data) {
  if (!data) return false
  if (data.name && String(data.name).includes('C:\\fakepath\\')) return false
  if (data.username && String(data.username).includes('C:\\fakepath\\')) return false
  return true
}

function cleanupCorruptedData() {
  try {
    const userStr = localStorage.getItem('lvkosp_user')
    if (userStr) {
      const user = JSON.parse(userStr)
      if (!isValidUserData(user)) {
        localStorage.removeItem('lvkosp_user')
        localStorage.removeItem('lvkosp_token')
        localStorage.removeItem('lvkosp_user_id')
      }
    }
  } catch {
    localStorage.removeItem('lvkosp_user')
  }
}

async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'lvkosp_salt_2024')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function generateToken() {
  return 'token_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now().toString(36)
}

async function uploadAvatar(file, userId) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please select a valid image file')
  if (file.size > 2 * 1024 * 1024) throw new Error('Image size should be less than 2MB')

  const fileName = `avatar_${userId}_${Date.now()}.${file.name.split('.').pop()}`
  const filePath = `${userId}/${fileName}`

  const { error } = await supabase.storage.from('avatars').upload(filePath, file, {
    cacheControl: '3600',
    upsert: true,
  })
  if (error) throw error

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(filePath)
  return pub?.publicUrl || ''
}

async function deleteOldAvatar(avatarUrl) {
  try {
    if (!avatarUrl || !avatarUrl.includes('avatars')) return
    const urlParts = avatarUrl.split('/')
    const fileName = urlParts[urlParts.length - 1]
    const userId = urlParts[urlParts.length - 2]
    const filePath = `${userId}/${fileName}`
    await supabase.storage.from('avatars').remove([filePath]).catch(() => {})
  } catch {
  }
}

// ===== аутф =====
export class AuthService {
  constructor() {
    cleanupCorruptedData()
    this.typingUsers = new Map() 
  }

  async signUp(username, password, name, avatarFile = null, bio = '') {
    try {
      if (!username || username.length < 3) return { success: false, error: 'Username must be at least 3 characters' }
      if (!password || password.length < 6) return { success: false, error: 'Password must be at least 6 characters' }
      if (!name || name.length < 2) return { success: false, error: 'Name must be at least 2 characters' }

      const { data: existingUser, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.trim())
        .maybeSingle()

      if (checkError && checkError.code !== 'PGRST116') return { success: false, error: 'Database error' }
      if (existingUser) return { success: false, error: 'Username already exists' }

      const passwordHash = await hashPassword(password)
      const userId = crypto.randomUUID()

      let avatarUrl = ''
      if (avatarFile) {
        avatarUrl = await uploadAvatar(avatarFile, userId)
      }

      const { error: profileError } = await supabase.from('profiles').insert({
        id: userId,
        username: username.trim(),
        name: name.trim(),
        password_hash: passwordHash,
        avatar_url: avatarUrl,
        bio: bio.trim(),
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        status: 'online',
      })

      if (profileError) return { success: false, error: profileError.message || 'Registration failed' }

      //  авто логин после регистрации
      return await this.signIn(username, password)
    } catch (e) {
      return { success: false, error: e?.message || 'Registration failed' }
    }
  }

  async signIn(username, password) {
    try {
      if (!username || !password) return { success: false, error: 'Please fill all fields' }

      const { data: user, error } = await supabase.from('profiles').select('*').eq('username', username.trim()).maybeSingle()
      if (error) return { success: false, error: 'Database error' }
      if (!user) return { success: false, error: 'User not found' }

      const passwordHash = await hashPassword(password)
      if (user.password_hash !== passwordHash) return { success: false, error: 'Invalid password' }

      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString(), status: 'online' })
        .eq('id', user.id)

      await supabase.from('user_sessions').delete().eq('user_id', user.id)

      const token = generateToken()
      const { error: sessionError } = await supabase.from('user_sessions').insert({
        user_id: user.id,
        token,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      if (sessionError) return { success: false, error: 'Session creation failed' }

      localStorage.setItem('lvkosp_token', token)
      localStorage.setItem('lvkosp_user_id', user.id)
      localStorage.setItem(
        'lvkosp_user',
        JSON.stringify({
          id: user.id,
          username: user.username,
          name: user.name,
          avatar_url: user.avatar_url || '',
          bio: user.bio || '',
          status: 'online',
        })
      )

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          avatar_url: user.avatar_url || '',
          bio: user.bio || '',
          status: 'online',
        },
      }
    } catch (e) {
      return { success: false, error: e?.message || 'Login failed' }
    }
  }

  async signOut() {
    try {
      const userId = localStorage.getItem('lvkosp_user_id')
      const token = localStorage.getItem('lvkosp_token')

      if (userId) {
        await supabase.from('profiles').update({ status: 'offline', last_seen: new Date().toISOString() }).eq('id', userId)
      }

      if (userId && token) {
        await supabase.from('user_sessions').delete().eq('user_id', userId).eq('token', token)
      }

      localStorage.removeItem('lvkosp_token')
      localStorage.removeItem('lvkosp_user_id')
      localStorage.removeItem('lvkosp_user')

      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || 'Logout failed' }
    }
  }

  async getCurrentUser() {
    try {
      cleanupCorruptedData()

      const token = localStorage.getItem('lvkosp_token')
      const userId = localStorage.getItem('lvkosp_user_id')
      if (!token || !userId) return { success: false, error: 'Not authenticated' }

      const { data: session, error: sessionError } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('token', token)
        .maybeSingle()

      if (sessionError) return { success: false, error: 'Session check failed' }
      if (!session) return { success: false, error: 'Session expired' }
      if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) return { success: false, error: 'Session expired' }

      const { data: user, error: userError } = await supabase
        .from('profiles')
        .select('id, username, name, avatar_url, bio, status, last_seen')
        .eq('id', userId)
        .maybeSingle()

      if (userError) return { success: false, error: 'User fetch failed' }
      if (!user) return { success: false, error: 'User not found' }

      localStorage.setItem(
        'lvkosp_user',
        JSON.stringify({
          id: user.id,
          username: user.username,
          name: user.name,
          avatar_url: user.avatar_url || '',
          bio: user.bio || '',
          status: user.status || 'offline',
        })
      )

      return { success: true, user: { ...user, avatar_url: user.avatar_url || '', bio: user.bio || '' } }
    } catch (e) {
      return { success: false, error: e?.message || 'Auth check failed' }
    }
  }

  async updateProfile(userId, updates) {
    try {
      const safe = {
        name: updates?.name?.trim?.() ?? undefined,
        bio: updates?.bio?.trim?.() ?? undefined,
      }
      const { data, error } = await supabase.from('profiles').update(safe).eq('id', userId).select().single()
      if (error) return { success: false, error: error.message }

      const user = JSON.parse(localStorage.getItem('lvkosp_user') || '{}')
      localStorage.setItem(
        'lvkosp_user',
        JSON.stringify({
          ...user,
          name: data.name,
          bio: data.bio || '',
        })
      )

      return { success: true, user: data }
    } catch (e) {
      return { success: false, error: e?.message || 'Profile update failed' }
    }
  }

  async updateAvatar(userId, avatarFile) {
    try {
      const { data: current } = await supabase.from('profiles').select('avatar_url').eq('id', userId).maybeSingle()
      const oldUrl = current?.avatar_url || ''

      const newUrl = await uploadAvatar(avatarFile, userId)

      const { error } = await supabase.from('profiles').update({ avatar_url: newUrl }).eq('id', userId)
      if (error) return { success: false, error: error.message }

      await deleteOldAvatar(oldUrl)

      const user = JSON.parse(localStorage.getItem('lvkosp_user') || '{}')
      localStorage.setItem('lvkosp_user', JSON.stringify({ ...user, avatar_url: newUrl }))

      return { success: true, avatar_url: newUrl }
    } catch (e) {
      return { success: false, error: e?.message || 'Avatar update failed' }
    }
  }

  async updateOnlineStatus(userId) {
    try {
      await supabase.from('profiles').update({ last_seen: new Date().toISOString(), status: 'online' }).eq('id', userId)
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || 'Online update failed' }
    }
  }

  setTyping(userId, chatId, isTyping) {
    if (isTyping) {
      if (!this.typingUsers.has(chatId)) this.typingUsers.set(chatId, new Set())
      this.typingUsers.get(chatId).add(userId)
      setTimeout(() => this.setTyping(userId, chatId, false), 3000)
    } else {
      if (!this.typingUsers.has(chatId)) return
      this.typingUsers.get(chatId).delete(userId)
      if (this.typingUsers.get(chatId).size === 0) this.typingUsers.delete(chatId)
    }
  }

  getTypingUsers(chatId) {
    if (!this.typingUsers.has(chatId)) return []
    return Array.from(this.typingUsers.get(chatId))
  }
}
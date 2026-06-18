import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { authService, chatService, followsService, friendsService, notificationService, postsService } from './services'

// ─── utils ────────────────────────────────────────────────────────────────────
const safeText = (s) => String(s ?? '')

function formatTime(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function formatMessageTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  if (isToday) return hhmm
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${hhmm}`
}

function formatRelative(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'только что'
  if (diff < 3600000) return `${Math.floor(diff/60000)} мин назад`
  if (diff < 86400000) return `${Math.floor(diff/3600000)} ч назад`
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`
}

// ─── Avatar с fallback на инициалы ────────────────────────────────────────────
const COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#14b8a6','#3b82f6']

function Avatar({ url, name, size = 40, style: extra = {} }) {
  const [err, setErr] = React.useState(false)
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
  const color = COLORS[(name || '').charCodeAt(0) % COLORS.length]
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0, fontWeight: 700, fontSize: size * 0.36, color: 'white', ...extra }
  if (url && !err) {
    return (
      <img src={url} alt={name || ''} onError={() => setErr(true)}
        style={{ ...base, objectFit: 'cover', display: 'block' }} />
    )
  }
  return <div style={{ ...base, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials}</div>
}

// ─── Typing через Supabase Broadcast ──────────────────────────────────────────
function useTyping(chatId, userId, userName) {
  const [typingNames, setTypingNames] = useState([])
  const chRef = useRef(null)
  const typersRef = useRef({})

  useEffect(() => {
    if (!chatId || !userId) return
    typersRef.current = {}
    setTypingNames([])
    const ch = supabase.channel(`typing:${chatId}`, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.userId === userId) return
      typersRef.current[payload.userId] = { name: payload.name, ts: Date.now() }
      setTypingNames(Object.values(typersRef.current).map(x => x.name))
    })
    ch.subscribe()
    chRef.current = ch
    const sweep = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const id of Object.keys(typersRef.current)) {
        if (now - typersRef.current[id].ts > 3500) { delete typersRef.current[id]; changed = true }
      }
      if (changed) setTypingNames(Object.values(typersRef.current).map(x => x.name))
    }, 600)
    return () => { clearInterval(sweep); ch.unsubscribe(); chRef.current = null; typersRef.current = {} }
  }, [chatId, userId])

  const sendTyping = useCallback(() => {
    chRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId, name: userName } })
  }, [userId, userName])

  return { typingNames, sendTyping }
}

// ─── Unread счётчики через Realtime ───────────────────────────────────────────
function useUnread(userId) {
  const [counts, setCounts] = useState({})

  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel(`unread:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new
        if (msg.sender_id === userId) return
        setCounts(prev => ({ ...prev, [msg.chat_id]: (prev[msg.chat_id] || 0) + 1 }))
      })
      .subscribe()
    return () => ch.unsubscribe()
  }, [userId])

  const reset = useCallback((chatId) => setCounts(prev => ({ ...prev, [chatId]: 0 })), [])
  return { counts, reset }
}

// ─── PostCard ─────────────────────────────────────────────────────────────────
function PostCard({ post, currentUser, onShareClick, onUserClick }) {
  const [likeCount, setLikeCount] = useState(post._likeCount || 0)
  const [liked, setLiked] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentLoading, setCommentLoading] = useState(false)

  async function handleLike() {
    if (!currentUser) return
    const prev = liked
    setLiked(!prev)
    setLikeCount(c => prev ? c - 1 : c + 1)
    const res = await postsService.toggleLike(post.id, currentUser.id)
    if (!res.success) { setLiked(prev); setLikeCount(c => prev ? c + 1 : c - 1) }
  }

  async function openComments() {
    if (!commentsLoaded) {
      const data = await postsService.getComments(post.id)
      setComments(data)
      setCommentsLoaded(true)
    }
    setCommentsOpen(v => !v)
  }

  async function submitComment(e) {
    e.preventDefault()
    if (!commentText.trim() || !currentUser) return
    setCommentLoading(true)
    const res = await postsService.addComment(post.id, currentUser.id, commentText)
    if (res.success) {
      setCommentText('')
      const data = await postsService.getComments(post.id)
      setComments(data)
    }
    setCommentLoading(false)
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
        <div onClick={() => onUserClick?.(post.author)} style={{ cursor: onUserClick ? 'pointer' : undefined, flexShrink: 0 }}>
          <Avatar url={post.author?.avatar_url} name={post.author?.name} size={36} />
        </div>
        <div style={{ flex: 1 }}>
          <div onClick={() => onUserClick?.(post.author)} style={{ fontWeight: 700, fontSize: 14, cursor: onUserClick ? 'pointer' : undefined, display: 'inline-block' }}>{post.author?.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{post.author?.username} · {formatRelative(post.created_at)}</div>
        </div>
        {onShareClick && (
          <button onClick={() => onShareClick(post)} title="Поделиться" style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 6, borderRadius: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><polyline points="16 6 12 2 8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="2" x2="12" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>
      {post.content && <div style={{ padding: '0 16px 10px', fontSize: 14, lineHeight: 1.6 }}>{post.content}</div>}
      {post.media_url && <img src={post.media_url} alt="" onClick={() => window.open(post.media_url,'_blank')} style={{ width: '100%', maxHeight: 520, objectFit: 'contain', display: 'block', cursor: 'zoom-in', background: 'rgba(0,0,0,0.2)' }} />}
      <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button onClick={handleLike} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: liked ? '#ef4444' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 13, transition: 'color 0.15s' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'}><path d="M12 21s-7-4.4-9.3-9A5.7 5.7 0 0 1 12 6a5.7 5.7 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          {likeCount}
        </button>
        <button onClick={openComments} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 13 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          {commentsLoaded ? comments.length : ''}
        </button>
      </div>
      {commentsOpen && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
          {comments.length === 0 && <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, marginBottom: 10 }}>Комментариев пока нет</div>}
          {comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <Avatar url={c.user?.avatar_url} name={c.user?.name} size={28} />
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '6px 10px', flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>{c.user?.name}</div>
                <div style={{ fontSize: 13 }}>{c.content}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{formatRelative(c.created_at)}</div>
              </div>
            </div>
          ))}
          {currentUser && (
            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Написать комментарий..." style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 12px', color: 'white', fontSize: 13, outline: 'none' }} />
              <button type="submit" disabled={commentLoading || !commentText.trim()} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10, color: 'white', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                {commentLoading ? '...' : 'OK'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ─── CreatePost ───────────────────────────────────────────────────────────────
function CreatePost({ user, onCreated, wallOwnerId = null, wallOwnerName = null }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)

  function pickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setPreview(URL.createObjectURL(f)); e.target.value = ''
  }

  async function submit(e) {
    e.preventDefault()
    if (!text.trim() && !file) return
    setLoading(true)
    const res = await postsService.createPost(user.id, text, file, wallOwnerId)
    setLoading(false)
    if (res.success) { setText(''); setFile(null); setPreview(null); onCreated?.() }
    else notificationService.showNotification('Ошибка', res.error, 'error')
  }

  return (
    <form onSubmit={submit} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
      {wallOwnerId && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Написать на стене {wallOwnerName || ''}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <Avatar url={user.avatar_url} name={user.name} size={36} />
        <div style={{ flex: 1 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={wallOwnerId ? `Написать ${wallOwnerName || ''}...` : 'Что у вас нового?'} rows={2}
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: 'white', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }} />
          {preview && (
            <div style={{ position: 'relative', marginTop: 8, display: 'inline-block' }}>
              <img src={preview} alt="" style={{ maxHeight: 160, borderRadius: 10, display: 'block' }} />
              <button type="button" onClick={() => { setFile(null); setPreview(null) }} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <button type="button" onClick={() => fileRef.current?.click()} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.6"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              Фото
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickFile} />
            <button type="submit" disabled={loading || (!text.trim() && !file)} style={{ background: (loading || (!text.trim() && !file)) ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.13)', border: 'none', color: 'white', borderRadius: 10, padding: '7px 18px', cursor: (loading || (!text.trim() && !file)) ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 }}>
              {loading ? 'Публикация...' : 'Опубликовать'}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}

// ─── ProfileWall ──────────────────────────────────────────────────────────────
function ProfileWall({ profileUser, currentUser, isFriendOfUser, onShareClick, onBannerUpdate, onUserClick }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [localBannerUrl, setLocalBannerUrl] = useState(profileUser?.banner_url || '')
  const [following, setFollowing] = useState(null)
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [followLoading, setFollowLoading] = useState(false)
  const [followModal, setFollowModal] = useState(null) // 'followers' | 'following'
  const [followModalList, setFollowModalList] = useState([])
  const [followModalLoading, setFollowModalLoading] = useState(false)
  const bannerFileRef = useRef(null)
  const avatarFileRef = useRef(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [localAvatarUrl, setLocalAvatarUrl] = useState(profileUser?.avatar_url || '')
  const isMe = Boolean(currentUser?.id) && currentUser.id === profileUser?.id
  const canPost = isMe || isFriendOfUser

  useEffect(() => { setLocalBannerUrl(profileUser?.banner_url || '') }, [profileUser?.banner_url])
  useEffect(() => { setLocalAvatarUrl(profileUser?.avatar_url || '') }, [profileUser?.avatar_url])

  useEffect(() => {
    if (!profileUser?.id || !currentUser?.id) return
    followsService.getCounts(profileUser.id).then(c => {
      setFollowerCount(c.followers); setFollowingCount(c.following)
    })
    if (!isMe) {
      followsService.isFollowing(currentUser.id, profileUser.id).then(setFollowing)
    }
  }, [profileUser?.id, currentUser?.id, isMe])

  const loadPosts = useCallback(async () => {
    if (!profileUser?.id) return
    setLoading(true)
    const data = await postsService.getPostsByUser(profileUser.id)
    const enriched = await Promise.all(data.map(async p => {
      const count = await postsService.getLikeCount(p.id)
      return { ...p, _likeCount: count }
    }))
    setPosts(enriched)
    setLoading(false)
  }, [profileUser?.id])

  useEffect(() => { loadPosts() }, [loadPosts])

  async function handleFollow() {
    if (followLoading || following === null) return
    setFollowLoading(true)
    const prev = following
    setFollowing(!prev)
    setFollowerCount(c => prev ? c - 1 : c + 1)
    const res = prev
      ? await followsService.unfollow(currentUser.id, profileUser.id)
      : await followsService.follow(currentUser.id, profileUser.id)
    if (!res.success) {
      setFollowing(prev)
      setFollowerCount(c => prev ? c + 1 : c - 1)
      notificationService.showNotification('Ошибка', res.error, 'error')
    }
    setFollowLoading(false)
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAvatarUploading(true)
    const res = await authService.updateAvatar(currentUser.id, file)
    setAvatarUploading(false)
    if (!res.success) {
      notificationService.showNotification('Ошибка', res.error, 'error')
    } else {
      setLocalAvatarUrl(res.avatar_url)
      notificationService.showNotification('Готово!', 'Аватарка обновлена', 'success')
    }
  }

  async function handleBannerUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBannerUploading(true)
    const res = await authService.updateBanner(currentUser.id, file)
    setBannerUploading(false)
    if (!res.success) {
      notificationService.showNotification('Ошибка', res.error, 'error')
    } else {
      setLocalBannerUrl(res.banner_url)
      onBannerUpdate?.(res.banner_url)
      notificationService.showNotification('Готово!', 'Фон профиля обновлён', 'success')
    }
  }

  async function openFollowModal(type) {
    setFollowModal(type)
    setFollowModalLoading(true)
    const list = type === 'followers'
      ? await followsService.getFollowers(profileUser.id)
      : await followsService.getFollowing(profileUser.id)
    setFollowModalList(list)
    setFollowModalLoading(false)
  }

  const hue = (profileUser?.name || '').charCodeAt(0) * 13 % 360

  return (
    <div>
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: localBannerUrl ? 160 : 110, background: localBannerUrl ? undefined : `linear-gradient(135deg, hsl(${hue},45%,22%) 0%, hsl(${hue+100},35%,18%) 100%)`, backgroundImage: localBannerUrl ? `url(${localBannerUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center top', position: 'relative' }}>
          {isMe && (
            <>
              <input type="file" ref={bannerFileRef} accept="image/*" style={{ display: 'none' }} onChange={handleBannerUpload} />
              <button type="button" onClick={() => bannerFileRef.current?.click()} disabled={bannerUploading}
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.25)', color: 'white', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {bannerUploading ? '...' : 'Сменить фон'}
              </button>
            </>
          )}
        </div>
        <div style={{ padding: '0 18px 16px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ marginTop: -20, position: 'relative', width: 64 }}>
              {isMe && (
                <input type="file" ref={avatarFileRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
              )}
              <div onClick={isMe ? () => avatarFileRef.current?.click() : undefined}
                style={{ cursor: isMe ? 'pointer' : undefined, position: 'relative', display: 'inline-block' }}>
                <Avatar url={localAvatarUrl} name={profileUser?.name} size={64} style={{ border: '3px solid #0b0b0b' }} />
                {isMe && (
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: '1.5px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>
                    {avatarUploading ? '…' : '✎'}
                  </div>
                )}
              </div>
            </div>
            {!isMe && currentUser?.id && following !== null && (
              <button onClick={handleFollow} disabled={followLoading}
                style={{ background: following ? 'transparent' : 'rgba(255,255,255,0.13)', border: `1px solid ${following ? 'rgba(255,255,255,0.2)' : 'transparent'}`, color: 'white', borderRadius: 10, padding: '7px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                {following ? 'Отписаться' : 'Подписаться'}
              </button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{profileUser?.name}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>@{profileUser?.username}</div>
            {profileUser?.bio && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, marginBottom: 8 }}>{profileUser.bio}</div>}
            <div style={{ display: 'flex', gap: 16 }}>
              <button onClick={() => openFollowModal('followers')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 0, fontSize: 13 }}><b style={{ color: 'white' }}>{followerCount}</b> подписчиков</button>
              <button onClick={() => openFollowModal('following')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 0, fontSize: 13 }}><b style={{ color: 'white' }}>{followingCount}</b> подписок</button>
            </div>
          </div>
        </div>
      </div>

      {canPost && currentUser?.id && (
        <CreatePost
          user={currentUser}
          onCreated={loadPosts}
          wallOwnerId={isMe ? null : profileUser?.id}
          wallOwnerName={isMe ? null : profileUser?.name}
        />
      )}

      {loading
        ? <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Загрузка...</div>
        : posts.length === 0
          ? <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14, border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14 }}>
              {isMe ? 'Постов пока нет. Поделитесь чем-нибудь!' : 'Постов пока нет.'}
            </div>
          : posts.map(p => <PostCard key={p.id} post={p} currentUser={currentUser} onShareClick={onShareClick} onUserClick={onUserClick} />)
      }

      {followModal && (
        <div onClick={() => setFollowModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(380px,100%)', background: 'rgba(16,16,16,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 22, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>
              {followModal === 'followers' ? 'Подписчики' : 'Подписки'}
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {followModalLoading
                ? <div style={{ textAlign: 'center', padding: 20, color: 'rgba(255,255,255,0.4)' }}>Загрузка...</div>
                : followModalList.length === 0
                  ? <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Пусто</div>
                  : followModalList.map(u => (
                    <div key={u.id} onClick={() => { setFollowModal(null); onUserClick?.(u) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, cursor: 'pointer' }}>
                      <Avatar url={u.avatar_url} name={u.name} size={40} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{u.username}</div>
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── GlobalFeed ───────────────────────────────────────────────────────────────
function GlobalFeed({ currentUser, onShareClick, onUserClick }) {
  const [tab, setTab] = useState('all')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  const loadPosts = useCallback(async () => {
    setLoading(true)
    let all
    if (tab === 'following' && currentUser?.id) {
      all = await followsService.getFollowingPosts(currentUser.id)
    } else {
      all = await postsService.getAllPosts()
    }
    const enriched = await Promise.all(all.map(async p => {
      const count = await postsService.getLikeCount(p.id)
      return { ...p, _likeCount: count }
    }))
    setPosts(enriched)
    setLoading(false)
  }, [tab, currentUser?.id])

  useEffect(() => { loadPosts() }, [loadPosts])

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[['all', 'Все'], ['following', 'Подписки']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: tab === key ? 'rgba(255,255,255,0.13)' : 'transparent', color: tab === key ? 'white' : 'rgba(255,255,255,0.4)' }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'all' && currentUser?.id && <CreatePost user={currentUser} onCreated={loadPosts} />}
      {loading
        ? <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Загрузка...</div>
        : posts.length === 0
          ? <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14, border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14 }}>
              {tab === 'following' ? 'Подпишитесь на кого-нибудь, чтобы видеть их посты' : 'Постов пока нет. Поделитесь чем-нибудь!'}
            </div>
          : posts.map(p => <PostCard key={p.id} post={p} currentUser={currentUser} onShareClick={onShareClick} onUserClick={onUserClick} />)
      }
    </div>
  )
}

// ─── ShareModal ───────────────────────────────────────────────────────────────
function ShareModal({ post, friends, onClose, onSend }) {
  const [selected, setSelected] = useState([])
  const [sending, setSending] = useState(false)
  const toggle = (id) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function send() {
    if (!selected.length) return
    setSending(true)
    await onSend(post, selected)
    setSending(false)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(400px,100%)', background: 'rgba(16,16,16,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Поделиться с другом</div>
        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {friends.length === 0
            ? <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Нет друзей для отправки</div>
            : friends.map(f => (
              <div key={f.id} onClick={() => toggle(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: selected.includes(f.id) ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)', borderRadius: 12, cursor: 'pointer', border: `1px solid ${selected.includes(f.id) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}` }}>
                <Avatar url={f.avatar_url} name={f.name} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{f.username}</div>
                </div>
                {selected.includes(f.id) && <span style={{ color: '#22c55e' }}>✓</span>}
              </div>
            ))
          }
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'white', borderRadius: 10, padding: 10, cursor: 'pointer', fontWeight: 600 }}>Отмена</button>
          <button onClick={send} disabled={!selected.length || sending} style={{ flex: 1, background: selected.length ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.04)', border: 'none', color: 'white', borderRadius: 10, padding: 10, cursor: selected.length ? 'pointer' : 'not-allowed', fontWeight: 700 }}>
            {sending ? 'Отправка...' : `Отправить (${selected.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, isMe, searchQuery, onEdit, onDelete, onUserClick }) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.content || '')

  async function saveEdit() {
    if (!editText.trim()) return
    await onEdit(msg.id, editText.trim())
    setEditing(false)
  }

  function highlight(text) {
    if (!searchQuery) return text
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'))
    return parts.map((p, i) =>
      p.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} style={{ background: 'rgba(250,200,50,0.4)', borderRadius: 3, color: 'inherit', padding: '0 1px' }}>{p}</mark>
        : p
    )
  }

  return (
    <div className={`msgRow ${isMe ? 'me' : 'them'}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative' }}>
      {hover && isMe && !editing && (
        <div style={{ position: 'absolute', bottom: '100%', right: 0, background: 'rgba(18,18,18,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 4, display: 'flex', gap: 2, zIndex: 50, whiteSpace: 'nowrap' }}>
          <button onClick={() => { setEditing(true); setEditText(msg.content || '') }} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.75)', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>✏️ Изменить</button>
          <button onClick={() => onDelete(msg.id)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,100,100,0.85)', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>🗑 Удалить</button>
        </div>
      )}
      <div className="msgBubble">
        {!isMe && msg.sender?.name && <div className="msgSender" onClick={() => onUserClick?.(msg.sender)} style={{ cursor: onUserClick ? 'pointer' : undefined }}>{msg.sender.name}</div>}
        {msg.type === 'image' && msg.media_url
          ? <img src={msg.media_url} alt="фото" onClick={() => window.open(msg.media_url,'_blank')} style={{ maxWidth: 280, borderRadius: 10, display: 'block', cursor: 'zoom-in' }} />
          : editing
            ? (
              <div>
                <input value={editText} onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false) }}
                  autoFocus style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, padding: '4px 8px', color: 'white', fontSize: 14, outline: 'none', width: '100%' }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={saveEdit} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>Сохранить</button>
                  <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>Отмена</button>
                </div>
              </div>
            )
            : <span>{highlight(safeText(msg.content))}</span>
        }
        <div className="message-time">
          {formatMessageTime(msg.created_at)}
          {msg.edited && <span style={{ opacity: 0.5 }}> · изм.</span>}
          {isMe && <span style={{ opacity: 0.6, marginLeft: 2 }}>{msg.read ? ' ✓✓' : ' ✓'}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // auth
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authTab, setAuthTab] = useState('login')
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', name: '', bio: '' })
  const [registerAvatar, setRegisterAvatar] = useState(null)
  const [authError, setAuthError] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)

  // навигация
  const [activeTab, setActiveTab] = useState('chats')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // чаты
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const chatBodyRef = useRef(null)
  const fileInputRef = useRef(null)
  const typingTimeoutRef = useRef(null)

  // поиск по сообщениям
  const [msgSearchOpen, setMsgSearchOpen] = useState(false)
  const [msgSearchQuery, setMsgSearchQuery] = useState('')

  // друзья
  const [friends, setFriends] = useState([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])

  // профиль
  const [viewingUser, setViewingUser] = useState(null)

  // share
  const [sharePost, setSharePost] = useState(null)

  // друзья — табы и заявки
  const [friendsTab, setFriendsTab] = useState('friends')
  const [pendingRequests, setPendingRequests] = useState([])


  // realtime
  const { typingNames, sendTyping } = useTyping(activeChatId, user?.id, user?.name)
  const { counts: unreadCounts, reset: resetUnread } = useUnread(user?.id)

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId) || null, [chats, activeChatId])
  const totalUnread = useMemo(() => Object.values(unreadCounts).reduce((a, b) => a + b, 0), [unreadCounts])

  const displayMessages = useMemo(() => {
    if (!msgSearchQuery.trim()) return messages
    const q = msgSearchQuery.toLowerCase()
    return messages.filter(m => (m.content || '').toLowerCase().includes(q))
  }, [messages, msgSearchQuery])

  // init
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const res = await authService.getCurrentUser()
      if (!mounted) return
      if (res.success) { setUser(res.user); setAuthModalOpen(false) }
      else { setUser(null); setAuthModalOpen(true) }
      setAuthChecked(true)
    })()

    const onInvalidated = () => {
      setUser(null); setAuthModalOpen(true)
      setChats([]); setMessages([]); setFriends([]); setPendingRequests([])
    }
    window.addEventListener('auth:invalidated', onInvalidated)

    return () => {
      mounted = false
      chatService.unsubscribeFromAll()
      window.removeEventListener('auth:invalidated', onInvalidated)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      const [ch, fr, reqs] = await Promise.all([
        chatService.getChats(user.id),
        followsService.getMutualFollows(user.id),
        followsService.getOneWayFollowers(user.id),
      ])
      setChats(ch); setFriends(fr); setPendingRequests(reqs)
    })()
    const t = setInterval(() => authService.updateOnlineStatus(user.id), 60000)
    const poll = setInterval(async () => {
      const [newFriends, newReqs] = await Promise.all([
        followsService.getMutualFollows(user.id),
        followsService.getOneWayFollowers(user.id),
      ])
      setFriends(prev => {
        if (prev.length > 0 && newFriends.length > prev.length) {
          notificationService.showNotification('Ура!', 'У вас новый друг!', 'success')
        }
        return newFriends
      })
      setPendingRequests(prev => {
        if (newReqs.length > prev.length) {
          notificationService.showNotification('Подписчики', 'На вас подписались!', 'success')
        }
        return newReqs
      })
    }, 30000)
    return () => { clearInterval(t); clearInterval(poll) }
  }, [user?.id])

  // загрузка сообщений при смене чата
  useEffect(() => {
    if (!user?.id || !activeChatId) return
    let alive = true
    setMessages([])
    setMsgSearchQuery('')
    setMsgSearchOpen(false)

    ;(async () => {
      const msgs = await chatService.getMessages(activeChatId, user.id)
      if (!alive) return
      setMessages(msgs)
      resetUnread(activeChatId)
      scrollToBottom()
    })()

    chatService.subscribeToMessages(activeChatId, (newMsg) => {
      setMessages(prev => prev.find(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
      if (newMsg.sender_id !== user.id) resetUnread(activeChatId)
      scrollToBottom()
    })

    return () => { alive = false; chatService.unsubscribeFromMessages(activeChatId) }
  }, [user?.id, activeChatId])

  // поиск пользователей
  useEffect(() => {
    if (!user?.id || activeTab !== 'friends') return
    const q = search.trim()
    let cancelled = false
    ;(async () => {
      if (q.length < 2) { setSearchResults([]); return }
      const res = await friendsService.searchUsers(q, user.id)
      if (!cancelled) setSearchResults(res)
    })()
    return () => { cancelled = true }
  }, [search, activeTab, user?.id])

  function scrollToBottom() {
    setTimeout(() => { if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight }, 60)
  }

  async function handleSend() {
    if (!user?.id || !activeChatId || !messageText.trim()) return
    const text = messageText.trim()
    setMessageText('')
    clearTimeout(typingTimeoutRef.current)
    const res = await chatService.sendMessage(activeChatId, user.id, text)
    if (!res.success) { notificationService.showNotification('Ошибка', res.error || 'Не удалось отправить', 'error'); return }
    setMessages(prev => prev.find(m => m.id === res.message.id) ? prev : [...prev, { ...res.message, sender: { id: user.id, name: user.name, username: user.username, avatar_url: user.avatar_url || '' } }])
    scrollToBottom()
  }

  function handleTextInput(val) {
    setMessageText(val)
    if (!activeChatId) return
    sendTyping()
    clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {}, 3000)
  }

  async function handleSendImage(file) {
    if (!file || !activeChatId) return
    try {
      const res = await chatService.sendImage(activeChatId, user.id, file)
      if (!res.success) { notificationService.showNotification('Ошибка', res.error || 'Не удалось отправить фото', 'error'); return }
      setMessages(prev => prev.find(m => m.id === res.message.id) ? prev : [...prev, { ...res.message, sender: { id: user.id, name: user.name, username: user.username, avatar_url: user.avatar_url || '' } }])
      scrollToBottom()
    } catch (e) {
      notificationService.showNotification('Ошибка', e?.message || 'Не удалось отправить фото', 'error')
    }
  }

  async function handleEditMessage(msgId, newContent) {
    const { error } = await supabase.from('messages').update({ content: newContent, edited: true }).eq('id', msgId)
    if (!error) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: newContent, edited: true } : m))
    else notificationService.showNotification('Ошибка', 'Не удалось изменить сообщение', 'error')
  }

  async function handleDeleteMessage(msgId) {
    const { error } = await supabase.from('messages').delete().eq('id', msgId)
    if (!error) setMessages(prev => prev.filter(m => m.id !== msgId))
    else notificationService.showNotification('Ошибка', 'Не удалось удалить сообщение', 'error')
  }

  async function handleDeleteChat(chatId) {
    if (!window.confirm('Удалить переписку? Все сообщения исчезнут у обоих участников.')) return
    const res = await chatService.deleteChat(chatId)
    if (!res.success) { notificationService.showNotification('Ошибка', res.error, 'error'); return }
    setChats(prev => prev.filter(c => c.id !== chatId))
    if (activeChatId === chatId) { setActiveChatId(null); setMessages([]) }
  }

  function openProfile(userData) {
    if (!userData?.id) return
    if (userData.id === user?.id) setViewingUser(null)
    else setViewingUser(userData)
    setActiveTab('profile')
    setSidebarOpen(false)
  }

  async function startChatWith(targetUser) {
    try {
      const chatId = await chatService.createChat(user.id, targetUser.id)
      const updated = await chatService.getChats(user.id)
      setChats(updated); setActiveChatId(chatId); setActiveTab('chats'); setSidebarOpen(false)
    } catch (e) {
      notificationService.showNotification('Ошибка', e?.message || 'Не удалось создать чат', 'error')
    }
  }

  async function sendFriendRequest(targetId) {
    const res = await followsService.follow(user.id, targetId)
    if (!res.success) { notificationService.showNotification('Ошибка', res.error, 'error'); return }
    notificationService.showNotification('Успешно', 'Вы подписались!', 'success')
    setFriends(await followsService.getMutualFollows(user.id))
  }

  async function acceptRequest(requesterId) {
    const res = await followsService.follow(user.id, requesterId)
    if (!res.success) { notificationService.showNotification('Ошибка', res.error, 'error'); return }
    const [fr, reqs] = await Promise.all([followsService.getMutualFollows(user.id), followsService.getOneWayFollowers(user.id)])
    setFriends(fr); setPendingRequests(reqs)
    notificationService.showNotification('Ура!', 'Вы теперь друзья!', 'success')
  }

  async function declineRequest(requesterId) {
    await followsService.removeFollower(user.id, requesterId)
    setPendingRequests(await followsService.getOneWayFollowers(user.id))
  }

  async function removeFriend(friendId) {
    const res = await followsService.unfollow(user.id, friendId)
    if (!res.success) { notificationService.showNotification('Ошибка', res.error, 'error'); return }
    setFriends(await followsService.getMutualFollows(user.id))
    notificationService.showNotification('Успешно', 'Вы отписались', 'success')
  }

  const isFriend = (uid) => friends.some(f => f.id === uid)

  async function handleSharePost(post, friendIds) {
    for (const fid of friendIds) {
      try {
        const chatId = await chatService.createChat(user.id, fid)
        const text = `📎 @${post.author?.username || 'unknown'} написал:\n"${(post.content || '').slice(0,100)}${(post.content?.length || 0) > 100 ? '...' : ''}"${post.media_url ? '\n[фото]' : ''}`
        await chatService.sendMessage(chatId, user.id, text)
      } catch {}
    }
    notificationService.showNotification('Отправлено!', `Пост отправлен ${friendIds.length} друг(у)`, 'success')
  }

  async function doLogin(e) {
    e.preventDefault(); setAuthError('')
    const res = await authService.signIn(loginForm.username, loginForm.password)
    if (!res.success) { setAuthError(res.error || 'Ошибка входа'); return }
    setUser(res.user); setAuthModalOpen(false)
    notificationService.showNotification('Добро пожаловать', `Привет, ${res.user.name}!`, 'success')
  }

  async function doRegister(e) {
    e.preventDefault(); setAuthError(''); setRegisterLoading(true)
    const res = await authService.signUp(registerForm.username, registerForm.password, registerForm.name, registerAvatar, registerForm.bio)
    setRegisterLoading(false)
    if (!res.success) { setAuthError(res.error || 'Ошибка регистрации'); return }
    setUser(res.user); setAuthModalOpen(false)
    notificationService.showNotification('Готово!', `Добро пожаловать, ${res.user.name}!`, 'success')
  }

  async function doLogout() {
    await authService.signOut()
    setUser(null); setChats([]); setMessages([]); setFriends([])
    setSearchResults([]); setActiveChatId(null); setViewingUser(null)
    setPendingRequests([])
    setAuthModalOpen(true)
  }

  const filteredChats = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || activeTab !== 'chats') return chats
    return chats.filter(c => c.name.toLowerCase().includes(q) || (c.lastMessage || '').toLowerCase().includes(q))
  }, [chats, search, activeTab])

  const profileUser = viewingUser || user

  if (!authChecked) return (
    <div style={{ background: '#0b0b0b', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)' }}>
      <div id="notificationContainer" />
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontWeight: 900, fontSize: 26, color: 'white', letterSpacing: -1 }}>L</div>
        <div>Загрузка...</div>
      </div>
    </div>
  )

  return (
    <>
      <div id="notificationContainer" style={{ position: 'fixed', top: 20, right: 20, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300 }} />

      {sharePost && <ShareModal post={sharePost} friends={friends} onClose={() => setSharePost(null)} onSend={handleSharePost} />}

      <div className="app" style={{ display: user ? 'grid' : 'block', minHeight: '100vh' }}>

        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Меню">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <div className="sidebar-overlay" style={{ display: sidebarOpen ? 'block' : 'none' }} onClick={() => setSidebarOpen(false)} />

        {/* ════ SIDEBAR ════ */}
        <aside className="sidebar" style={{ transform: sidebarOpen ? 'translateX(0)' : undefined }}>
          <div className="brand"><div className="brand__title">LVKOSP MESSENGER</div></div>

          <div className="search">
            <div className="search__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10.5 18.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="1.6" /><path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </div>
            <input className="search__input" type="search" placeholder="Поиск..." autoComplete="off" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <nav className="tabs">
            <button className={`tab ${activeTab === 'chats' ? 'is-active' : ''}`} type="button" onClick={() => setActiveTab('chats')}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M7.5 18.5H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3h-5.2l-3.6 2.6a.9.9 0 0 1-1.4-.7v-1.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></span>
              <span className="tab__label">Чаты</span>
              {totalUnread > 0 && <span className="notification-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
            </button>
            <button className={`tab ${activeTab === 'friends' ? 'is-active' : ''}`} type="button" onClick={() => setActiveTab('friends')}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>
              <span className="tab__label">Друзья</span>
              {pendingRequests.length > 0 && <span className="notification-badge">{pendingRequests.length}</span>}
            </button>
            <button className={`tab ${activeTab === 'feed' ? 'is-active' : ''}`} type="button" onClick={() => { setActiveTab('feed'); setSidebarOpen(false) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="10.5" width="18" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="17" width="11" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.6"/></svg></span>
              <span className="tab__label">Лента</span>
            </button>
            <button className={`tab ${activeTab === 'profile' ? 'is-active' : ''}`} type="button" onClick={() => { setActiveTab('profile'); setViewingUser(null) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" /></svg></span>
              <span className="tab__label">Профиль</span>
            </button>
          </nav>

          <div className="sectionTitle">Сообщения</div>

          <div className="dmList">
            {filteredChats.length === 0
              ? <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Чатов пока нет</div>
              : filteredChats.map(chat => {
                const unread = unreadCounts[chat.id] || 0
                return (
                  <div key={chat.id} className={`dmItem ${chat.id === activeChatId ? 'is-active' : ''}`}
                    onClick={() => { setActiveChatId(chat.id); setActiveTab('chats'); setSidebarOpen(false) }}>
                    <div style={{ position: 'relative' }}>
                      <Avatar url={chat.avatarUrl} name={chat.name} size={44} />
                      <div className={chat.status === 'online' ? 'online-status' : 'offline-status'} />
                    </div>
                    <div className="dmMeta">
                      <div className="dmName">{safeText(chat.name)}</div>
                      <div className="dmSnippet">{safeText(chat.lastMessage || 'Нет сообщений')}</div>
                    </div>
                    <div className="dmRight">
                      <div className="dmTime">{formatTime(chat.lastMessageTime)}</div>
                      {unread > 0 && <div style={{ background: '#ef4444', color: 'white', borderRadius: 10, fontSize: 10, fontWeight: 800, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{unread > 99 ? '99+' : unread}</div>}
                    </div>
                  </div>
                )
              })
            }
          </div>

          {/* Me card — аватарка через компонент Avatar, теперь всегда отображается */}
          <div className="meCard">
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Avatar url={user?.avatar_url} name={user?.name} size={40} />
              <div className="online-status" />
            </div>
            <div className="meCard__meta">
              <div className="meCard__name">{user?.name || 'User'}</div>
              <div className="meCard__user">@{user?.username || 'user'}</div>
            </div>
            <button className="iconBtn" type="button" title="Выйти" onClick={doLogout}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><polyline points="16 17 21 12 16 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </aside>

        {/* ════ MAIN ════ */}
        <main className="main" onClick={() => sidebarOpen && setSidebarOpen(false)}>

          {/* ── ЧАТЫ ── */}
          <section className={`view ${activeTab === 'chats' ? 'is-active' : ''}`}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <header className="chatHeader">
                <div className="chatHeader__left" onClick={() => activeChat && openProfile({ id: activeChat.userId, name: activeChat.name, username: activeChat.username, avatar_url: activeChat.avatarUrl })} style={{ cursor: activeChat ? 'pointer' : undefined }}>
                  {activeChat && (
                    <div style={{ position: 'relative' }}>
                      <Avatar url={activeChat.avatarUrl} name={activeChat.name} size={44} />
                      <div className={activeChat.status === 'online' ? 'online-status' : 'offline-status'} />
                    </div>
                  )}
                  <div className="chatHeader__meta">
                    <div className="chatHeader__name">{activeChat ? safeText(activeChat.name) : 'Выберите чат'}</div>
                    {activeChat && (
                      <div className="chatHeader__status">
                        {typingNames.length > 0
                          ? <div className="typing-indicator" style={{ background: 'transparent', padding: 0, margin: 0 }}>
                              <span>{typingNames[0]} печатает...</span>
                              <div className="typing-dots"><span /><span /><span /></div>
                            </div>
                          : <><span className="dot" style={{ background: activeChat.status === 'online' ? '#22c55e' : '#6b7280' }} /><span>{activeChat.status === 'online' ? 'В сети' : 'Не в сети'}</span></>
                        }
                      </div>
                    )}
                  </div>
                </div>
                <div className="chatHeader__center">
                  {activeChat && <div className="pill">Сегодня, {formatTime(new Date())}</div>}
                </div>
                <div className="chatHeader__right">
                  {activeChat && (
                    <>
                      <button className="iconBtn" title="Поиск по сообщениям" style={{ color: msgSearchOpen ? 'white' : undefined }}
                        onClick={() => { setMsgSearchOpen(v => !v); setMsgSearchQuery('') }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10.5 18.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="1.6" /><path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                      </button>
                      <button className="iconBtn" title="Удалить переписку" style={{ color: 'rgba(255,80,80,0.7)' }}
                        onClick={() => handleDeleteChat(activeChat.id)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                      </button>
                    </>
                  )}
                </div>
              </header>

              {/* Поиск по сообщениям */}
              {msgSearchOpen && activeChat && (
                <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
                  <input value={msgSearchQuery} onChange={e => setMsgSearchQuery(e.target.value)} placeholder="Поиск в сообщениях..." autoFocus
                    style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '8px 14px', color: 'white', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                  {msgSearchQuery && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>Найдено: {displayMessages.length}</div>}
                </div>
              )}

              <div className="chatBody" ref={chatBodyRef}>
                {!activeChat
                  ? <div className="blank"><div className="blank__title">Чат не выбран</div><div className="blank__text">Выберите беседу из списка или найдите друга</div></div>
                  : displayMessages.length === 0
                    ? <div className="blank"><div className="blank__title">{msgSearchQuery ? 'Ничего не найдено' : 'Сообщений пока нет'}</div><div className="blank__text">{msgSearchQuery ? 'Попробуйте другой запрос' : 'Начните общение!'}</div></div>
                    : displayMessages.map(msg => (
                      <MessageBubble key={msg.id} msg={msg} isMe={msg.sender_id === user.id}
                        searchQuery={msgSearchQuery} onEdit={handleEditMessage} onDelete={handleDeleteMessage} onUserClick={openProfile} />
                    ))
                }
              </div>

              <footer className="chatComposer">
                <div className="composer-actions">
                  <button className="clipBtn" type="button" aria-label="Прикрепить" onClick={() => fileInputRef.current?.click()} disabled={!activeChat}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M8 12.5 14.9 5.6a3 3 0 0 1 4.2 4.2l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.7-8.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
                <input className="chatInput" placeholder={activeChat ? 'Сообщение...' : 'Выберите чат'} disabled={!activeChat}
                  value={messageText} onChange={e => handleTextInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }} />
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; handleSendImage(f) }} />
                <button className="sendBtn" type="button" onClick={handleSend} disabled={!activeChat || !messageText.trim()}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 12 21 3l-5.2 18-4.3-7.2L4 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M21 3 11.5 13.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </footer>
            </div>
          </section>

          {/* ── ДРУЗЬЯ ── */}
          <section className={`view ${activeTab === 'friends' ? 'is-active' : ''}`}>
            <div className="view-header"><div className="view-header__title">Друзья</div></div>

            {/* Под-табы */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', flexShrink: 0 }}>
              {[
                { key: 'friends', label: 'Ваши друзья', count: friends.length },
                { key: 'requests', label: 'Подписчики', count: pendingRequests.length },
              ].map(tab => (
                <button key={tab.key} onClick={() => setFriendsTab(tab.key)}
                  style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: `2px solid ${friendsTab === tab.key ? 'white' : 'transparent'}`, marginBottom: -1, color: friendsTab === tab.key ? 'white' : 'rgba(255,255,255,0.45)', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {tab.label}
                  {tab.count > 0 && (
                    <span style={{ background: tab.key === 'requests' ? '#ef4444' : 'rgba(255,255,255,0.15)', color: 'white', borderRadius: 10, fontSize: 11, fontWeight: 800, padding: '1px 7px' }}>{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="view-content" style={{ overflowY: 'auto', padding: '0 24px 24px' }}>
              {friendsTab === 'friends' ? (
                <>
                  <div style={{ marginBottom: 12, marginTop: 16, color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>Введите минимум 2 символа для поиска пользователей.</div>

                  {friends.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>Ваши друзья ({friends.length})</div>
                      {friends.map(f => (
                        <div key={f.id} className="search-result-item" style={{ justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <Avatar url={f.avatar_url} name={f.name} size={42} />
                            <div>
                              <div style={{ fontWeight: 700 }}>{safeText(f.name)}</div>
                              <div style={{ fontSize: 13, opacity: 0.5 }}>{f.bio ? safeText(f.bio) : `@${safeText(f.username)}`}</div>
                            </div>
                          </div>
                          <div className="user-actions">
                            <button className="btn is-outline" onClick={() => { setViewingUser(f); setActiveTab('profile') }}>Профиль</button>
                            <button className="btn" onClick={() => startChatWith(f)}>Написать</button>
                            <button className="btn is-outline" onClick={() => removeFriend(f.id)}>Отписаться</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {friends.length === 0 && search.trim().length < 2 && (
                    <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>Друзей пока нет. Найдите пользователей через поиск!</div>
                  )}

                  {search.trim().length >= 2 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>Результаты поиска</div>
                      {searchResults.length === 0
                        ? <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Пользователи не найдены</div>
                        : searchResults.map(u => (
                          <div key={u.id} className="search-result-item" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <Avatar url={u.avatar_url} name={u.name} size={42} />
                              <div>
                                <div style={{ fontWeight: 700 }}>{safeText(u.name)}</div>
                                <div style={{ fontSize: 13, opacity: 0.5 }}>{u.bio ? safeText(u.bio) : `@${safeText(u.username)}`}</div>
                              </div>
                            </div>
                            <div className="user-actions">
                              <button className="btn is-outline" onClick={() => { setViewingUser(u); setActiveTab('profile') }}>Профиль</button>
                              <button className="btn" onClick={() => startChatWith(u)}>Написать</button>
                              {isFriend(u.id)
                                ? <button className="btn is-outline" onClick={() => removeFriend(u.id)}>Отписаться</button>
                                : <button className="btn is-outline" onClick={() => sendFriendRequest(u.id)}>Подписаться</button>
                              }
                            </div>
                          </div>
                        ))
                      }
                    </>
                  )}
                </>
              ) : (
                <div style={{ marginTop: 16 }}>
                  {pendingRequests.length === 0
                    ? <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>Заявок в друзья пока нет</div>
                    : pendingRequests.map(u => (
                      <div key={u.id} className="search-result-item" style={{ justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <Avatar url={u.avatar_url} name={u.name} size={42} />
                          <div>
                            <div style={{ fontWeight: 700 }}>{safeText(u.name)}</div>
                            <div style={{ fontSize: 13, opacity: 0.5 }}>{u.bio ? safeText(u.bio) : `@${safeText(u.username)}`}</div>
                          </div>
                        </div>
                        <div className="user-actions">
                          <button className="btn" onClick={() => acceptRequest(u.id)}>Подписаться в ответ</button>
                          <button className="btn is-outline" onClick={() => declineRequest(u.id)}>Удалить</button>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </section>

          {/* ── ЛЕНТА ── */}
          <section className={`view ${activeTab === 'feed' ? 'is-active' : ''}`}>
            <div className="view-header"><div className="view-header__title">Лента</div></div>
            <div className="view-content" style={{ overflowY: 'auto', padding: 20 }}>
              <GlobalFeed currentUser={user} onShareClick={setSharePost} onUserClick={openProfile} />
            </div>
          </section>

          {/* ── ПРОФИЛЬ / СТЕНА ── */}
          <section className={`view ${activeTab === 'profile' ? 'is-active' : ''}`}>
            <div className="view-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {viewingUser && (
                  <button onClick={() => setViewingUser(null)} className="iconBtn" style={{ marginRight: 4 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
                <div className="view-header__title">{viewingUser ? safeText(viewingUser.name) : 'Мой профиль'}</div>
              </div>
              {!viewingUser && (
                <button onClick={doLogout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>Выйти</button>
              )}
            </div>
            {viewingUser && (
              <div style={{ padding: '12px 20px 0', display: 'flex', gap: 10, flexShrink: 0 }}>
                <button className="btn is-outline" onClick={() => startChatWith(viewingUser)}>Написать</button>
              </div>
            )}
            <div className="view-content" style={{ overflowY: 'auto', padding: 20 }}>
              <ProfileWall
                profileUser={profileUser}
                currentUser={user}
                isFriendOfUser={isFriend(profileUser?.id)}
                onShareClick={setSharePost}
                onBannerUpdate={(url) => setUser(prev => ({ ...prev, banner_url: url }))}
                onUserClick={openProfile}
              />
            </div>
          </section>

        </main>
      </div>

      {/* ════ AUTH MODAL ════ */}
      <div className="modal" style={{ display: authModalOpen ? 'flex' : 'none' }}>
        <div className="modal-content">
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontWeight: 900, fontSize: 24, color: 'white', letterSpacing: -1 }}>L</div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.3, color: 'white' }}>LVKOSP Messenger</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 5 }}>
              {authTab === 'login' ? 'Войдите в свой аккаунт' : 'Создайте новый аккаунт'}
            </div>
          </div>
          <div className="modal-tabs">
            <button className={`modal-tab ${authTab === 'login' ? 'active' : ''}`} onClick={() => { setAuthTab('login'); setAuthError('') }}>Вход</button>
            <button className={`modal-tab ${authTab === 'register' ? 'active' : ''}`} onClick={() => { setAuthTab('register'); setAuthError('') }}>Регистрация</button>
          </div>
          {authTab === 'login' && (
            <form className="auth-form" onSubmit={doLogin}>
              <label className="auth-label">Имя пользователя</label>
              <input type="text" placeholder="username" required autoComplete="username" value={loginForm.username} onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))} />
              <label className="auth-label">Пароль</label>
              <input type="password" placeholder="••••••••" required autoComplete="current-password" value={loginForm.password} onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))} />
              <button type="submit">Войти</button>
              {authError && <div className="error-message">{authError}</div>}
            </form>
          )}
          {authTab === 'register' && (
            <form className="auth-form" onSubmit={doRegister}>
              <label className="auth-label">Имя пользователя</label>
              <input type="text" placeholder="username" required autoComplete="username" value={registerForm.username} onChange={e => setRegisterForm(p => ({ ...p, username: e.target.value }))} />
              <label className="auth-label">Пароль</label>
              <input type="password" placeholder="••••••••" required autoComplete="new-password" value={registerForm.password} onChange={e => setRegisterForm(p => ({ ...p, password: e.target.value }))} />
              <label className="auth-label">Отображаемое имя</label>
              <input type="text" placeholder="Ваше имя" required value={registerForm.name} onChange={e => setRegisterForm(p => ({ ...p, name: e.target.value }))} />
              <label className="auth-label">О себе <span style={{ opacity: 0.45, fontSize: 11 }}>(необязательно)</span></label>
              <textarea placeholder="Расскажите о себе..." rows={2} value={registerForm.bio}
                onChange={e => setRegisterForm(p => ({ ...p, bio: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', margin: '0 0 14px', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', outline: 'none', resize: 'none', height: 66, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }} />
              <label className="auth-label">Аватар <span style={{ opacity: 0.45, fontSize: 11 }}>(необязательно)</span></label>
              <div className="avatar-upload">
                <div className="avatar-preview">
                  {registerAvatar && <img src={URL.createObjectURL(registerAvatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />}
                </div>
                <div>
                  <input type="file" id="avatarInput" accept="image/*" onChange={e => setRegisterAvatar(e.target.files?.[0] || null)} />
                  <label htmlFor="avatarInput">Выбрать фото</label>
                </div>
              </div>
              <button type="submit" disabled={registerLoading}>{registerLoading ? 'Создание аккаунта...' : 'Создать аккаунт'}</button>
              {authError && <div className="error-message">{authError}</div>}
            </form>
          )}
        </div>
      </div>
    </>
  )
}

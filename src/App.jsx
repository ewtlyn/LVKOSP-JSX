import React, { useEffect, useMemo, useRef, useState } from 'react'
import { authService, chatService, friendsService, notificationService } from './services'

function safeText(s) {
  return String(s ?? '')
}

function formatTime(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatMessageTime(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} ${hh}:${mi}`
}

function avatarStyle(avatarUrl) {
  if (!avatarUrl) return {}
  return { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
}

export default function App() {
  // ===== аутф =====
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState(null)

  // ===== ui =====
  const [activeTab, setActiveTab] = useState('chats')
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // ===== чаты =====
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [typingUsers, setTypingUsers] = useState([])

  // ===== друзья =====
  const [friends, setFriends] = useState([])
  const [searchResults, setSearchResults] = useState([])
  const [activeFriend, setActiveFriend] = useState(null) 

  const [messageText, setMessageText] = useState('')
  const chatBodyRef = useRef(null)

  // модалка
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authTab, setAuthTab] = useState('login')
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', name: '', bio: '' })
  const [registerAvatar, setRegisterAvatar] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId) || null, [chats, activeChatId])

  // ===== инициализация =====
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const res = await authService.getCurrentUser()
      if (!mounted) return

      if (res.success) {
        setUser(res.user)
        setAuthModalOpen(false)
      } else {
        setUser(null)
        setAuthModalOpen(true)
      }
      setAuthChecked(true)
    })()

    return () => {
      mounted = false
      chatService.unsubscribeFromAll()
    }
  }, [])

  useEffect(() => {
    if (!user?.id) return

    ;(async () => {
      const [ch, fr] = await Promise.all([chatService.getChats(user.id), friendsService.getFriends(user.id)])
      setChats(ch)
      setFriends(fr)
    })()

    // онлайн статус
    const t = setInterval(() => {
      authService.updateOnlineStatus(user.id)
    }, 60_000)

    return () => clearInterval(t)
  }, [user?.id])

  // ===== подписка на соо =====
  useEffect(() => {
    if (!user?.id || !activeChatId) return

    let alive = true

    ;(async () => {
      const msgs = await chatService.getMessages(activeChatId, user.id)
      if (!alive) return
      setMessages(msgs)
      setTimeout(() => {
        if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
      }, 50)
    })()

    chatService.subscribeToMessages(activeChatId, (newMsg) => {
      setMessages((prev) => [...prev, newMsg])
      setTimeout(() => {
        if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
      }, 50)
    })

    const typingTimer = setInterval(() => {
      const ids = authService.getTypingUsers(activeChatId)
      setTypingUsers(ids.filter((id) => id !== user.id))
    }, 400)

    return () => {
      alive = false
      clearInterval(typingTimer)
      chatService.unsubscribeFromMessages(activeChatId)
    }
  }, [user?.id, activeChatId])

  // ===== поиск друзей =====
  useEffect(() => {
    if (!user?.id) return
    if (activeTab !== 'friends') return

    const q = search.trim()
    let cancelled = false

    ;(async () => {
      if (q.length < 2) {
        setSearchResults([])
        return
      }
      const res = await friendsService.searchUsers(q, user.id)
      if (cancelled) return
      setSearchResults(res)
    })()

    return () => {
      cancelled = true
    }
  }, [search, activeTab, user?.id])

  async function handleSelectChat(chatId) {
    setActiveChatId(chatId)
    setActiveTab('chats')
    setSidebarOpen(false)
  }

  async function handleSend() {
    if (!user?.id || !activeChatId) return
    const text = messageText.trim()
    if (!text) return

    setMessageText('')
    authService.setTyping(user.id, activeChatId, false)

    const res = await chatService.sendMessage(activeChatId, user.id, text)
    if (!res.success) {
      notificationService.showNotification('Error', res.error || 'Failed to send', 'error')
      return
    }
    setMessages((prev) => [
      ...prev,
      {
        ...res.message,
        sender: { id: user.id, name: user.name, username: user.username, avatar_url: user.avatar_url || '' },
      },
    ])
  }

  function handleTyping(val) {
    if (!user?.id || !activeChatId) return
    authService.setTyping(user.id, activeChatId, Boolean(val?.trim?.()))
  }

  async function startChatWithUser(targetUser) {
    try {
      const chatId = await chatService.createChat(user.id, targetUser.id)
      const updated = await chatService.getChats(user.id)
      setChats(updated)
      setActiveChatId(chatId)
      setActiveTab('chats')
      setSidebarOpen(false)
    } catch (e) {
      notificationService.showNotification('Error', e?.message || 'Failed to create chat', 'error')
    }
  }

  async function addFriend(friendId) {
    const res = await friendsService.addFriend(user.id, friendId)
    if (!res.success) {
      notificationService.showNotification('Error', res.error || 'Failed', 'error')
      return
    }
    setFriends(await friendsService.getFriends(user.id))
    notificationService.showNotification('Success', 'Friend added successfully!', 'success')
  }

  async function removeFriend(friendId) {
    const res = await friendsService.removeFriend(user.id, friendId)
    if (!res.success) {
      notificationService.showNotification('Error', res.error || 'Failed', 'error')
      return
    }
    setFriends(await friendsService.getFriends(user.id))
    if (activeFriend?.id === friendId) setActiveFriend(null)
    notificationService.showNotification('Success', 'Friend removed', 'success')
  }

  async function doLogin(e) {
    e.preventDefault()
    setAuthError('')
    setAuthSuccess('')

    const res = await authService.signIn(loginForm.username, loginForm.password)
    if (!res.success) {
      setAuthError(res.error || 'Login failed')
      return
    }
    setUser(res.user)
    setAuthModalOpen(false)
    notificationService.showNotification('Welcome', `Hello, ${res.user.name}!`, 'success')
  }

  async function doRegister(e) {
    e.preventDefault()
    setAuthError('')
    setAuthSuccess('')
    setRegisterLoading(true)

    const res = await authService.signUp(
      registerForm.username,
      registerForm.password,
      registerForm.name,
      registerAvatar,
      registerForm.bio
    )

    setRegisterLoading(false)

    if (!res.success) {
      setAuthError(res.error || 'Registration failed')
      return
    }
    setAuthSuccess('Registered successfully!')
    setUser(res.user)
    setAuthModalOpen(false)
    notificationService.showNotification('Success', 'Account created!', 'success')
  }

  async function doLogout() {
    await authService.signOut()
    setUser(null)
    setChats([])
    setMessages([])
    setFriends([])
    setSearchResults([])
    setActiveChatId(null)
    setActiveFriend(null)
    setAuthModalOpen(true)
  }

  const filteredChats = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.lastMessage || '').toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q)
      )
    })
  }, [chats, search])

  const isFriend = useMemo(() => {
    if (!activeFriend?.id) return false
    return friends.some((f) => f.id === activeFriend.id)
  }, [friends, activeFriend?.id])

  if (!authChecked) {
    return (
      <div style={{ color: 'white', padding: 20 }}>
        Loading...
        <div id="notificationContainer" />
      </div>
    )
  }

  return (
    <>
      {}
      <div
        id="notificationContainer"
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: 300,
        }}
      />

      {}
      <div className="app" id="app" style={{ display: user ? 'grid' : 'none' }}>
        {}
        <button className="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu" onClick={() => setSidebarOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {}
        <div
          className="sidebar-overlay"
          id="sidebarOverlay"
          style={{ display: sidebarOpen ? 'block' : 'none' }}
          onClick={() => setSidebarOpen(false)}
        />

        {}
        <aside
          className="sidebar"
          id="sidebar"
          aria-label="Sidebar"
          style={{
            transform: sidebarOpen ? 'translateX(0)' : undefined,
          }}
        >
          <div className="brand">
            <div className="brand__title">LVKOSP MESSENGER</div>
            {}
            <div className="notification-badge" id="sidebarNotificationBadge" style={{ display: 'none' }}>
              0
            </div>
          </div>

          <div className="search">
            <div className="search__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M10.5 18.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="1.6" />
                <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <input
              id="searchInput"
              className="search__input"
              type="search"
              placeholder="Search..."
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <nav className="tabs" aria-label="Navigation">
            <button className={`tab ${activeTab === 'chats' ? 'is-active' : ''}`} data-tab="chats" type="button" onClick={() => setActiveTab('chats')}>
              <span className="tab__icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7.5 18.5H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3h-5.2l-3.6 2.6a.9.9 0 0 1-1.4-.7v-1.9Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="tab__label">Chats</span>
              <span className="notification-badge" id="chatsNotificationBadge" style={{ display: 'none' }}>
                0
              </span>
            </button>

            <button className={`tab ${activeTab === 'friends' ? 'is-active' : ''}`} data-tab="friends" type="button" onClick={() => setActiveTab('friends')}>
              <span className="tab__icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="tab__label">Friends</span>
              <span className="notification-badge" id="friendsNotificationBadge" style={{ display: 'none' }}>
                0
              </span>
            </button>

            <button className={`tab ${activeTab === 'profile' ? 'is-active' : ''}`} data-tab="profile" type="button" onClick={() => setActiveTab('profile')}>
              <span className="tab__icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M19 7h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M20.5 5.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="tab__label">Profile</span>
            </button>
          </nav>

          <div className="sectionTitle">DIRECT MESSAGES</div>

          <div className="dmList" id="dmList" role="listbox" aria-label="Direct Messages">
            {filteredChats.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                No chats yet. Search for users and start chatting!
              </div>
            ) : (
              filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  className={`dmItem ${chat.id === activeChatId ? 'is-active' : ''}`}
                  role="option"
                  onClick={() => handleSelectChat(chat.id)}
                >
                  <div style={{ position: 'relative' }}>
                    <div className="dmAvatar" style={avatarStyle(chat.avatarUrl)} />
                    <div className={chat.status === 'online' ? 'online-status' : 'offline-status'} />
                  </div>

                  <div className="dmMeta">
                    <div className="dmName">{safeText(chat.name)}</div>
                    <div className="dmSnippet">{safeText(chat.lastMessage || 'No messages yet')}</div>
                  </div>

                  <div className="dmRight">
                    <div className="dmTime">{formatTime(chat.lastMessageTime)}</div>
                    {chat.unreadCount > 0 ? <div className="unread-indicator" /> : null}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="meCard">
            <div className="meCard__avatar" id="meAvatar" aria-hidden="true" style={avatarStyle(user?.avatar_url || '')}>
              <div className="online-status" id="myOnlineStatus" />
            </div>
            <div className="meCard__meta">
              <div className="meCard__name" id="meName">
                {user?.name || 'User'}
              </div>
              <div className="meCard__user" id="meUser">
                @{user?.username || 'user'}
              </div>
            </div>

            <button className="iconBtn" id="settingsBtn" type="button" aria-label="Settings" onClick={doLogout} title="Logout">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M19.4 15.3 21 12l-1.6-3.3-3.6.2-2-3-3.8 1.5-3.8-1.5-2 3-3.6-.2L3 12l1.6 3.3 3.6-.2 2 3 3.8-1.5 3.8 1.5 2-3 3.6.2Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </aside>

        {}
        <main className="main" aria-label="Main">
          {}
          <section className={`view ${activeTab === 'chats' ? 'is-active' : ''}`} id="view-chats" data-view="chats">
            <div className="view-header">
              <div className="view-header__title">Chats</div>
            </div>

            <div className="view-content">
              <header className="chatHeader">
                <div className="chatHeader__left">
                  <div className="chatHeader__avatar" id="activeAvatar" aria-hidden="true" style={avatarStyle(activeChat?.avatarUrl || '')}>
                    <div className="online-status" id="activeChatOnlineStatus" style={{ display: activeChat ? 'block' : 'none' }} />
                  </div>

                  <div className="chatHeader__meta">
                    <div className="chatHeader__name" id="activeName">
                      {activeChat ? safeText(activeChat.name) : 'Select a chat'}
                    </div>

                    <div className="chatHeader__status">
                      <span className="dot" id="activeDot" aria-hidden="true" />
                      <span id="activeStatus">{activeChat ? (activeChat.status === 'online' ? 'Online' : 'Offline') : 'Offline'}</span>

                      <div className="typing-indicator" id="typingIndicator" style={{ display: typingUsers.length ? 'flex' : 'none' }}>
                        <span>{typingUsers.length ? `${activeChat?.name || 'Someone'} is typing...` : 'typing'}</span>
                        <div className="typing-dots">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="chatHeader__center">
                  <div className="pill" id="datePill">
                    Today, {formatTime(new Date().toISOString())}
                  </div>
                </div>

                <div className="chatHeader__right">
                  <button className="iconBtn" id="chatInfoBtn" type="button" aria-label="Chat info" style={{ display: activeChat ? 'block' : 'none' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M12 16v-4m0-4h.01M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </header>

              <div className="chatBody" id="chatBody" aria-label="Chat messages" ref={chatBodyRef}>
                {!activeChat ? (
                  <div className="blank">
                    <div className="blank__title">No chat selected</div>
                    <div className="blank__text">Select a conversation from the sidebar or add a friend to start chatting</div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="blank">
                    <div className="blank__title">No messages yet</div>
                    <div className="blank__text">Start the conversation!</div>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.sender_id === user.id
                    return (
                      <div key={msg.id || `${msg.sender_id}_${msg.created_at}_${Math.random()}`} className={`msgRow ${isMe ? 'me' : 'them'}`}>
                        <div className="msgBubble">
                          {!isMe && msg.sender?.name ? <div className="msgSender">{msg.sender.name}</div> : null}
                          <span>{safeText(msg.content)}</span>
                          <div className="message-time">{formatMessageTime(msg.created_at)}</div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <footer className="chatComposer">
                <div className="composer-actions">
                  <button className="clipBtn" type="button" aria-label="Attach" id="attachBtn" onClick={() => notificationService.showNotification('Info', 'Attach is not implemented yet', 'info')}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M8 12.5 14.9 5.6a3 3 0 0 1 4.2 4.2l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.7-8.7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                <input
                  className="composerInput"
                  id="messageInput"
                  placeholder="Сообщение..."
                  autoComplete="off"
                  value={messageText}
                  disabled={!activeChat}
                  onChange={(e) => {
                    setMessageText(e.target.value)
                    handleTyping(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                />

                <button className="sendBtn" id="sendButton" type="button" aria-label="Send" onClick={handleSend} disabled={!activeChat}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12 21 3l-5.2 18-4.3-7.2L4 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="M21 3 11.5 13.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </footer>
            </div>
          </section>

          {}
          <section className={`view ${activeTab === 'friends' ? 'is-active' : ''}`} id="view-friends" data-view="friends">
            <div className="view-header">
              <div className="view-header__title">Friends</div>
            </div>

            <div className="view-content">
              <div className="friends-content" style={{ padding: '0 20px 20px' }}>
                <div style={{ marginBottom: 14, color: 'rgba(255,255,255,0.7)' }}>
                  Type in search (min 2 chars) to find users. Click “Message” to start a chat.
                </div>

                {}
                <div className="friends-list">
                  {friends.length === 0 ? (
                    <div style={{ padding: 14, color: 'rgba(255,255,255,0.6)' }}>No friends yet.</div>
                  ) : (
                    friends.map((f) => (
                      <div
                        key={f.id}
                        className="search-result-item"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 10px',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 12,
                          marginBottom: 10,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <div className="dmAvatar" style={{ width: 42, height: 42, borderRadius: 14, ...avatarStyle(f.avatar_url || '') }} />
                          <div>
                            <div style={{ fontWeight: 700 }}>{safeText(f.name || 'Unknown')}</div>
                            <div style={{ opacity: 0.7 }}>@{safeText(f.username || 'user')}</div>
                          </div>
                        </div>

                        <div className="user-actions" style={{ display: 'flex', gap: 10 }}>
                          <button className="btn is-outline" type="button" onClick={() => { setActiveFriend(f); setActiveTab('profile') }}>
                            Profile
                          </button>
                          <button className="btn" type="button" onClick={() => startChatWithUser(f)}>
                            Message
                          </button>
                          <button className="btn is-outline" type="button" onClick={() => removeFriend(f.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {}
                {search.trim().length >= 2 ? (
                  <>
                    <div style={{ marginTop: 18, marginBottom: 10, fontWeight: 800 }}>Search results</div>
                    {searchResults.length === 0 ? (
                      <div style={{ padding: 10, color: 'rgba(255,255,255,0.6)' }}>No users found.</div>
                    ) : (
                      searchResults.map((u) => {
                        const alreadyFriend = friends.some((f) => f.id === u.id)
                        return (
                          <div
                            key={u.id}
                            className="search-result-item"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '12px 10px',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: 12,
                              marginBottom: 10,
                            }}
                          >
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <div className="dmAvatar" style={{ width: 42, height: 42, borderRadius: 14, ...avatarStyle(u.avatar_url || '') }} />
                              <div>
                                <div style={{ fontWeight: 700 }}>{safeText(u.name || 'Unknown')}</div>
                                <div style={{ opacity: 0.7 }}>@{safeText(u.username || 'user')}</div>
                              </div>
                            </div>

                            <div className="user-actions" style={{ display: 'flex', gap: 10 }}>
                              <button className="btn is-outline" type="button" onClick={() => { setActiveFriend(u); setActiveTab('profile') }}>
                                Profile
                              </button>

                              <button className="btn" type="button" onClick={() => startChatWithUser(u)}>
                                Message
                              </button>

                              {!alreadyFriend ? (
                                <button className="btn is-outline" type="button" onClick={() => addFriend(u.id)}>
                                  Add
                                </button>
                              ) : (
                                <button className="btn is-outline" type="button" onClick={() => removeFriend(u.id)}>
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </section>

          {}
          <section className={`view ${activeTab === 'profile' ? 'is-active' : ''}`} id="view-profile" data-view="profile">
            <div className="view-header">
              <div className="view-header__title">Profile</div>
            </div>

            <div className="view-content">
              {(() => {
                const p = activeFriend || user
                const isMe = !activeFriend || activeFriend.id === user.id
                return (
                  <>
                    <div className="profileTop">
                      <div className="profileTop__left">
                        <div className="profileAvatar" id="profileAvatar" aria-hidden="true" style={avatarStyle(p?.avatar_url || '')}>
                          <div className="online-status" id="profileOnlineStatus" style={{ display: 'none' }} />
                        </div>

                        <div className="profileMeta">
                          <div className="profileName" id="profileName">
                            {safeText(p?.name || 'Loading...')}
                          </div>
                          <div className="profileUser" id="profileUser">
                            @{safeText(p?.username || 'user')}
                          </div>
                          <div className="profileBio" id="profileBio">
                            {safeText(p?.bio || 'No bio yet')}
                          </div>
                          <div className="profileFollowers" id="profileFollowers">
                            0 followers
                          </div>
                        </div>
                      </div>

                      <div className="profileTop__actions">
                        {isMe ? (
                          <button className="btn" type="button" id="friendBtn" onClick={doLogout}>
                            Logout
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn"
                              type="button"
                              id="friendBtn"
                              onClick={() => (isFriend ? removeFriend(p.id) : addFriend(p.id))}
                            >
                              {isFriend ? 'Friend ✓ (remove)' : 'Add friend'}
                            </button>
                            <button className="btn is-outline" type="button" id="messageBtn" onClick={() => startChatWithUser(p)}>
                              Message
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="divider" />

                    <div className="postCard">
                      <div className="postCard__head">
                        <div className="postCard__avatar" id="postAvatar" aria-hidden="true" style={avatarStyle(p?.avatar_url || '')} />
                        <div className="postCard__who">
                          <div className="postCard__name" id="postName">
                            {safeText(p?.name || 'Loading...')}
                          </div>
                          <div className="postCard__user" id="postUser">
                            @{safeText(p?.username || 'user')}
                          </div>
                        </div>
                        <button className="iconBtn" type="button" aria-label="More">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M6 12h.01M12 12h.01M18 12h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>

                      <div className="postCard__text" id="postText">
                        Welcome to LVKOSP Messenger!
                      </div>

                      <div className="postCard__foot">
                        <div className="postStats">
                          <span className="stat">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M12 21s-7-4.4-9.3-9A5.7 5.7 0 0 1 12 6a5.7 5.7 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9Z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span id="likesCount">0</span>
                          </span>
                          <span className="stat">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span id="commentsCount">0</span>
                          </span>
                        </div>

                        <div className="postDate" id="postDate">
                          --.--.--
                        </div>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          </section>
        </main>
      </div>

      {}
      <div id="authModal" className="modal" style={{ display: authModalOpen ? 'flex' : 'none' }}>
        <div className="modal-content">
          <div className="modal-tabs">
            <button className={`modal-tab ${authTab === 'login' ? 'active' : ''}`} onClick={() => { setAuthTab('login'); setAuthError(''); setAuthSuccess('') }}>
              Вход
            </button>
            <button className={`modal-tab ${authTab === 'register' ? 'active' : ''}`} onClick={() => { setAuthTab('register'); setAuthError(''); setAuthSuccess('') }}>
              Регистрация
            </button>
          </div>

          {}
          <form className="auth-form" style={{ display: authTab === 'login' ? 'block' : 'none' }} onSubmit={doLogin}>
            <input
              type="text"
              placeholder="Username"
              required
              value={loginForm.username}
              onChange={(e) => setLoginForm((p) => ({ ...p, username: e.target.value }))}
            />
            <input
              type="password"
              placeholder="Password"
              required
              value={loginForm.password}
              onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
            />
            <button type="submit">Войти</button>

            {authError ? <div className="error-message">{authError}</div> : null}
            {authSuccess ? <div className="success-message">{authSuccess}</div> : null}
          </form>

          {}
          <form className="auth-form" style={{ display: authTab === 'register' ? 'block' : 'none' }} onSubmit={doRegister}>
            <input
              type="text"
              placeholder="Username"
              required
              value={registerForm.username}
              onChange={(e) => setRegisterForm((p) => ({ ...p, username: e.target.value }))}
            />
            <input
              type="password"
              placeholder="Password"
              required
              value={registerForm.password}
              onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Name"
              required
              value={registerForm.name}
              onChange={(e) => setRegisterForm((p) => ({ ...p, name: e.target.value }))}
            />

            <textarea
              id="bioInput"
              placeholder="Bio (optional)"
              rows="3"
              style={{
                background: 'rgba(14, 14, 14, 0.8)',
                border: '1px solid rgba(35, 34, 34, 0.8)',
                borderRadius: 12,
                padding: '14px 18px',
                color: 'white',
                fontSize: 15,
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 80,
                width: '100%',
                boxSizing: 'border-box',
                margin: 0,
                transition: 'border-color 0.2s',
              }}
              value={registerForm.bio}
              onChange={(e) => setRegisterForm((p) => ({ ...p, bio: e.target.value }))}
            />

            <div className="avatar-upload">
              <div className="avatar-preview" id="avatarPreview">
                {registerAvatar ? (
                  <img
                    src={URL.createObjectURL(registerAvatar)}
                    alt="Avatar preview"
                    id="avatarPreviewImg"
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
                  />
                ) : null}
              </div>

              <input
                type="file"
                id="avatarInput"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  setRegisterAvatar(f)
                }}
              />
              <label htmlFor="avatarInput">Choose avatar (optional)</label>
            </div>

            <button type="submit" id="registerSubmit" disabled={registerLoading}>
              {registerLoading ? 'Uploading avatar...' : 'Зарегистрироваться'}
            </button>

            {registerLoading ? (
              <div className="loading-message" id="registerLoading" style={{ display: 'block' }}>
                Uploading avatar...
              </div>
            ) : null}

            {authError ? <div className="error-message">{authError}</div> : null}
            {authSuccess ? <div className="success-message">{authSuccess}</div> : null}
          </form>
        </div>
      </div>
    </>
  )
}
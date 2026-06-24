import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "./lib/supabaseClient";
import {
  authService,
  blocksService,
  bookmarksService,
  channelsService,
  chatService,
  followsService,
  friendsService,
  notificationService,
  notificationsService,
  postsService,
  storiesService,
} from "./services";
import { pushService } from "./services/pushService";
import { composeStory } from "./services/storiesService";

const safeText = (s) => String(s ?? "");

// ─── ConfirmDialog ────────────────────────────────────────────────────────────
let _confirmResolve = null;
let _setConfirmState = null;

export function showConfirm(message, title = 'Подтверждение') {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    _setConfirmState?.({ open: true, message, title });
  });
}

function ConfirmDialog() {
  const [state, setState] = useState({ open: false, message: '', title: '' });
  _setConfirmState = setState;
  if (!state.open) return null;
  const handle = (v) => { setState({ open: false }); _confirmResolve?.(v); _confirmResolve = null; };
  return (
    <div onClick={() => handle(false)} style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1c1c2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '24px 22px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{state.title}</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 22, lineHeight: 1.5 }}>{state.message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => handle(false)} style={{ padding: '9px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: 'none', color: 'white', cursor: 'pointer', fontSize: 14 }}>Отмена</button>
          <button onClick={() => handle(true)} style={{ padding: '9px 18px', borderRadius: 10, background: '#ef4444', border: 'none', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Да</button>
        </div>
      </div>
    </div>
  );
}

// ─── ImageLightbox ────────────────────────────────────────────────────────────
let _setLightboxSrc = null;
export function openLightbox(src) { _setLightboxSrc?.(src); }

function ImageLightbox() {
  const [src, setSrc] = useState(null);
  _setLightboxSrc = setSrc;
  if (!src) return null;
  return (
    <div onClick={() => setSrc(null)} style={{ position: 'fixed', inset: 0, zIndex: 99998, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }} onClick={e => e.stopPropagation()} />
      <button onClick={() => setSrc(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 38, height: 38, color: 'white', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      <a href={src} download target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 10, padding: '8px 18px', color: 'white', fontSize: 13, textDecoration: 'none', cursor: 'pointer' }}>⬇ Скачать</a>
    </div>
  );
}

function LoadingScreen({ onRetry }) {
  const [seconds, setSeconds] = useState(0);
  const [showSlow, setShowSlow] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    const slow = setTimeout(() => setShowSlow(true), 8000);
    return () => { clearInterval(t); clearTimeout(slow); };
  }, []);
  return (
    <div style={{ background: '#0b0b0b', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)' }}>
      <div id="notificationContainer" />
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontWeight: 900, fontSize: 26, color: 'white' }}>L</div>
        <div style={{ fontSize: 15, marginBottom: 6 }}>Загрузка...</div>
        {showSlow && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16, maxWidth: 240, lineHeight: 1.5 }}>
            Медленное соединение. Сервер запускается, подождите ещё немного...
          </div>
        )}
        {seconds >= 20 && (
          <button onClick={onRetry} style={{ marginTop: 8, padding: '10px 24px', background: '#7c3aed', border: 'none', borderRadius: 12, color: 'white', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
            Повторить
          </button>
        )}
      </div>
    </div>
  );
}

function formatLastSeen(status, lastSeen) {
  if (status === 'online') return 'В сети';
  if (!lastSeen) return 'Не в сети';
  const diff = Date.now() - new Date(lastSeen).getTime();
  if (diff < 60000) return 'только что';
  if (diff < 3600000) return `был(а) ${Math.floor(diff / 60000)} мин назад`;
  if (diff < 86400000) return `был(а) ${Math.floor(diff / 3600000)} ч назад`;
  if (diff < 172800000) return 'был(а) вчера';
  return `был(а) ${new Date(lastSeen).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}`;
}

function formatTime(ts) {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMessageTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (isToday) return hhmm;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${hhmm}`;
}

function formatRelative(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return "только что";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  return sameYear ? `${day}.${mon}` : `${day}.${mon}.${d.getFullYear()}`;
}

function formatDateLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today - day;
  if (diff === 0) return "Сегодня";
  if (diff === 86400000) return "Вчера";
  const sameYear = d.getFullYear() === now.getFullYear();
  const months = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  return sameYear
    ? `${d.getDate()} ${months[d.getMonth()]}`
    : `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
];

function renderText(text, onMentionClick) {
  if (!text) return null
  const parts = text.split(/(@\w+)/g)
  return parts.map((part, i) => {
    if (part.match(/^@\w+$/)) {
      const username = part.slice(1)
      return (
        <span key={i} style={{ color: '#a78bfa', cursor: 'pointer', fontWeight: 600 }}
          onClick={() => onMentionClick?.(username)}>
          {part}
        </span>
      )
    }
    return part
  })
}

function Avatar({ url, name, size = 40, style: extra = {} }) {
  const [err, setErr] = React.useState(false);
  const initials = (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const color = COLORS[(name || "").charCodeAt(0) % COLORS.length];
  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    fontWeight: 700,
    fontSize: size * 0.36,
    color: "white",
    ...extra,
  };
  if (url && !err) {
    return (
      <img
        src={url}
        alt={name || ""}
        loading="lazy"
        decoding="async"
        onError={() => setErr(true)}
        style={{ ...base, objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <div
      style={{
        ...base,
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {initials}
    </div>
  );
}

// ─── Typing ──────────────────────────────────────────
function useTyping(chatId, userId, userName) {
  const [typingNames, setTypingNames] = useState([]);
  const chRef = useRef(null);
  const typersRef = useRef({});

  useEffect(() => {
    if (!chatId || !userId) return;
    typersRef.current = {};
    setTypingNames([]);
    const ch = supabase.channel(`typing:${chatId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.userId === userId) return;
      typersRef.current[payload.userId] = {
        name: payload.name,
        ts: Date.now(),
      };
      setTypingNames(Object.values(typersRef.current).map((x) => x.name));
    });
    ch.subscribe();
    chRef.current = ch;
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const id of Object.keys(typersRef.current)) {
        if (now - typersRef.current[id].ts > 3500) {
          delete typersRef.current[id];
          changed = true;
        }
      }
      if (changed)
        setTypingNames(Object.values(typersRef.current).map((x) => x.name));
    }, 600);
    return () => {
      clearInterval(sweep);
      ch.unsubscribe();
      chRef.current = null;
      typersRef.current = {};
    };
  }, [chatId, userId]);

  const sendTyping = useCallback(() => {
    chRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId, name: userName },
    });
  }, [userId, userName]);

  return { typingNames, sendTyping };
}

function useUnread(userId) {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`unread:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new;
          if (msg.sender_id === userId) return;
          setCounts((prev) => ({
            ...prev,
            [msg.chat_id]: (prev[msg.chat_id] || 0) + 1,
          }));
        },
      )
      .subscribe();
    return () => ch.unsubscribe();
  }, [userId]);

  const reset = useCallback(
    (chatId) => setCounts((prev) => ({ ...prev, [chatId]: 0 })),
    [],
  );
  return { counts, reset };
}

// ─── PostCard ─────────────────────────────────────────────────────────────────
function PostCard({
  post,
  currentUser,
  onShareClick,
  onUserClick,
  onDelete,
  onNotify,
  onMentionClick,
  onReposted,
}) {
  const [likeCount, setLikeCount] = useState(post._likeCount || 0);
  const [liked, setLiked] = useState(post._liked || false);
  const [likeAnim, setLikeAnim] = useState(false);
  const [saved, setSaved] = useState(post._saved || false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentCount, setCommentCount] = useState(post._commentCount ?? null);
  const [commentText, setCommentText] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [repostOriginal, setRepostOriginal] = useState(null);
  const [repostDone, setRepostDone] = useState(post._reposted || false);
  const [repostLoading, setRepostLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content || '');
  const [editSaving, setEditSaving] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [likers, setLikers] = useState([]);
  const doubleTapRef = useRef(null);
  const [extraMedia, setExtraMedia] = useState([]);

  useEffect(() => {
    if (post.repost_of_id)
      postsService.getRepostOf(post.repost_of_id).then(setRepostOriginal);
  }, [post.repost_of_id]);

  useEffect(() => {
    if (post.id && post.media_url) {
      postsService.getExtraMedia(post.id)
        .then(urls => { if (urls.length) setExtraMedia(urls) })
    }
  }, [post.id]);

  async function handleDeletePost() {
    if (!await showConfirm("Удалить этот пост? Это действие нельзя отменить.", "Удалить пост")) return;
    const res = await postsService.deletePost(post.id);
    if (res.success) {
      setDeleted(true);
      onDelete?.(post.id);
    }
  }

  async function handleRepost() {
    if (!currentUser || repostDone || repostLoading) return;
    if (!await showConfirm("Добавить этот пост на свою стену?", "Репост")) return;
    setRepostLoading(true);
    const res = await postsService.repost(currentUser.id, post.id);
    setRepostLoading(false);
    if (res.success) {
      setRepostDone(true);
      onReposted?.();
      notificationService.showNotification("Репост", "Пост добавлен на вашу стену", "success");
    } else {
      notificationService.showNotification("Ошибка", res.error || "Не удалось сделать репост", "error");
    }
  }

  async function handleLike() {
    if (!currentUser) return;
    const prev = liked;
    setLiked(!prev);
    setLikeCount((c) => (prev ? c - 1 : c + 1));
    if (!prev) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 400); }
    const res = await postsService.toggleLike(post.id, currentUser.id);
    if (!res.success) {
      setLiked(prev);
      setLikeCount((c) => (prev ? c + 1 : c - 1));
    } else if (!prev && post.author_id !== currentUser.id) {
      onNotify?.("like", post.author_id, post.id, post.content?.slice(0, 60));
    }
  }

  function handleDoubleTap() {
    if (!currentUser || liked) return;
    const now = Date.now();
    if (doubleTapRef.current && now - doubleTapRef.current < 350) { handleLike(); doubleTapRef.current = null; return; }
    doubleTapRef.current = now;
  }

  async function handleSaveEdit() {
    if (!editText.trim()) return;
    setEditSaving(true);
    const res = await postsService.updatePost(post.id, editText);
    if (res.success) { post.content = editText; setEditing(false); }
    else notificationService.showNotification('Ошибка', res.error, 'error');
    setEditSaving(false);
  }

  async function openLikers() {
    setLikersOpen(true);
    const data = await postsService.getLikes(post.id);
    setLikers(data);
  }

  async function handleSave() {
    if (!currentUser) return
    const prev = saved
    setSaved(!prev)
    const res = await bookmarksService.toggle(currentUser.id, post.id)
    if (typeof res.saved === 'boolean') {
      setSaved(res.saved)
      if (res.saved) notificationService.showNotification('Сохранено', 'Пост в закладках — смотри в своём профиле → вкладка Закладки', 'success')
    } else setSaved(prev)
  }

  async function openComments() {
    if (!commentsLoaded) {
      const data = await postsService.getComments(post.id);
      setComments(data);
      setCommentCount(data.length);
      setCommentsLoaded(true);
    }
    setCommentsOpen((v) => !v);
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!commentText.trim() || !currentUser) return;
    setCommentLoading(true);
    const res = await postsService.addComment(
      post.id,
      currentUser.id,
      commentText,
      post.author_id,
    );
    if (res.success) {
      setCommentText("");
      const data = await postsService.getComments(post.id);
      setComments(data);
      setCommentCount(data.length);
    }
    setCommentLoading(false);
  }

  if (deleted) return null;

  return (
    <div
      onDoubleClick={handleDoubleTap}
      onTouchEnd={handleDoubleTap}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        marginBottom: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 10px",
        }}
      >
        <div
          onClick={() => onUserClick?.(post.author)}
          style={{ cursor: onUserClick ? "pointer" : undefined, flexShrink: 0 }}
        >
          <Avatar
            url={post.author?.avatar_url}
            name={post.author?.name}
            size={36}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div
            onClick={() => onUserClick?.(post.author)}
            style={{
              fontWeight: 700,
              fontSize: 14,
              cursor: onUserClick ? "pointer" : undefined,
              display: "inline-block",
            }}
          >
            {post.author?.name}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            @{post.author?.username} · {formatRelative(post.created_at)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {currentUser?.id === post.author_id && !editing && (
            <>
              <button onClick={() => { setEditing(true); setEditText(post.content || '') }} title="Редактировать" style={{ background: 'transparent', border: 'none', color: 'rgba(160,160,255,0.55)', cursor: 'pointer', padding: 6, borderRadius: 8, fontSize: 15 }}>✏️</button>
              <button onClick={handleDeletePost} title="Удалить пост" style={{ background: "transparent", border: "none", color: "rgba(255,100,100,0.55)", cursor: "pointer", padding: 6, borderRadius: 8 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
            </>
          )}
          {onShareClick && (
            <button
              onClick={() => onShareClick(post)}
              title="Поделиться"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.4)",
                cursor: "pointer",
                padding: 6,
                borderRadius: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <polyline
                  points="16 6 12 2 8 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line
                  x1="12"
                  y1="2"
                  x2="12"
                  y2="15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {post.repost_of_id && (
        <div
          style={{
            margin: "0 12px 10px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.1)",
            overflow: "hidden",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          {repostOriginal ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px 4px",
                }}
              >
                <div
                  onClick={() => onUserClick?.(repostOriginal.author)}
                  style={{ cursor: "pointer" }}
                >
                  <Avatar
                    url={repostOriginal.author?.avatar_url}
                    name={repostOriginal.author?.name}
                    size={22}
                  />
                </div>
                <span
                  style={{ fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  onClick={() => onUserClick?.(repostOriginal.author)}
                >
                  {repostOriginal.author?.name}
                </span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                  · {formatRelative(repostOriginal.created_at)}
                </span>
              </div>
              {repostOriginal.content && (
                <div style={{ padding: "0 12px 8px", fontSize: 13 }}>
                  {repostOriginal.content}
                </div>
              )}
              {repostOriginal.media_url && (
                <img
                  src={repostOriginal.media_url}
                  alt=""
                  style={{
                    width: "100%",
                    maxHeight: 300,
                    objectFit: "contain",
                    display: "block",
                    background: "rgba(0,0,0,0.2)",
                  }}
                />
              )}
            </>
          ) : (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "rgba(255,255,255,0.3)",
              }}
            >
              Загрузка...
            </div>
          )}
        </div>
      )}
      {editing ? (
        <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: 'white', padding: '8px 10px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSaveEdit} disabled={editSaving} style={{ padding: '6px 14px', borderRadius: 8, background: '#7c3aed', border: 'none', color: 'white', cursor: 'pointer', fontSize: 13 }}>{editSaving ? '...' : 'Сохранить'}</button>
            <button onClick={() => setEditing(false)} style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: 'none', color: 'white', cursor: 'pointer', fontSize: 13 }}>Отмена</button>
          </div>
        </div>
      ) : (!post.repost_of_id && post.content && (
        <div style={{ padding: "0 16px 10px", fontSize: 14, lineHeight: 1.6 }}>
          {renderText(post.content, onMentionClick)}
        </div>
      ))}
      {!post.repost_of_id && post.media_url && (
        extraMedia.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
            {[post.media_url, ...extraMedia].map((url, i) => (
              <img key={i} src={url} alt="" loading="lazy" decoding="async" onClick={() => openLightbox(url)}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
            ))}
          </div>
        ) : (
          <img
            src={post.media_url}
            alt=""
            loading="lazy"
            decoding="async"
            onClick={() => openLightbox(post.media_url)}
            style={{
              width: "100%",
              maxHeight: 520,
              objectFit: "contain",
              display: "block",
              cursor: "zoom-in",
              background: "rgba(0,0,0,0.2)",
            }}
          />
        )
      )}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 10px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <button
          onClick={handleLike}
          className={likeAnim ? 'heart-pop' : ''}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            color: liked ? "#ef4444" : "rgba(255,255,255,0.5)",
            cursor: "pointer",
            padding: "6px 6px 6px 10px",
            borderRadius: 8,
            fontSize: 13,
            transition: "color 0.15s",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={liked ? "currentColor" : "none"}
          >
            <path
              d="M12 21s-7-4.4-9.3-9A5.7 5.7 0 0 1 12 6a5.7 5.7 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button onClick={openLikers} style={{ background: 'transparent', border: 'none', color: liked ? '#ef4444' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '6px 4px 6px 0', fontSize: 13, borderRadius: 8 }}>
          {likeCount}
        </button>
        <button
          onClick={openComments}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          {commentCount !== null ? commentCount : ""}
        </button>
        {currentUser && (
          <button onClick={handleSave} title={saved ? 'Убрать из закладок' : 'В закладки'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: saved ? '#f59e0b' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, marginLeft: 'auto' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {currentUser &&
          !post.repost_of_id &&
          currentUser.id !== post.author_id && (
            <button
              onClick={handleRepost}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                color: repostDone ? "#a78bfa" : "rgba(255,255,255,0.5)",
                cursor: repostLoading ? 'not-allowed' : 'pointer',
                opacity: repostLoading ? 0.5 : 1,
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 1l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3 11V9a4 4 0 0 1 4-4h14"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <path
                  d="M7 23l-4-4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M21 13v2a4 4 0 0 1-4 4H3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
              {repostDone ? "Репост!" : "Репост"}
            </button>
          )}
      </div>
      {commentsOpen && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "12px 16px",
          }}
        >
          {comments.length === 0 && (
            <div
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: 13,
                marginBottom: 10,
              }}
            >
              Комментариев пока нет
            </div>
          )}
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} currentUser={currentUser}
              onDeleted={() => { setComments(prev => prev.filter(x => x.id !== c.id)); setCommentCount(n => (n ?? 1) - 1); }}
              onEdited={(id, text) => setComments(prev => prev.map(x => x.id === id ? { ...x, content: text } : x))}
              onUserClick={onUserClick} />
          ))}
          {currentUser && (
            <form
              onSubmit={submitComment}
              style={{ display: "flex", gap: 8, marginTop: 6 }}
            >
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Написать комментарий..."
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  color: "white",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={commentLoading || !commentText.trim()}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: 10,
                  color: "white",
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {commentLoading ? "..." : "OK"}
              </button>
            </form>
          )}
        </div>
      )}
      {likersOpen && (
        <div onClick={() => setLikersOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a2e', borderRadius: '18px 18px 0 0', padding: 20, width: '100%', maxWidth: 480, maxHeight: '60vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>❤️ Лайки</div>
            {likers.length === 0
              ? <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Загрузка...</div>
              : likers.map(u => (
                <div key={u.id} onClick={() => { setLikersOpen(false); onUserClick?.(u); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                  <Avatar url={u.avatar_url} name={u.name} size={36} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>@{u.username}</div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CommentItem ───────────────────────────────────────────────────────────────
function CommentItem({ comment: c, currentUser, onDeleted, onEdited, onUserClick }) {
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState(c.content || '');
  const [saving, setSaving] = useState(false);
  const isOwn = currentUser?.id === c.user?.id;

  async function handleDelete() {
    if (!await showConfirm('Удалить этот комментарий?', 'Удалить')) return;
    const res = await postsService.deleteComment(c.id);
    if (res.success) onDeleted?.();
  }

  async function handleSave() {
    if (!editText.trim()) return;
    setSaving(true);
    const res = await postsService.editComment(c.id, editText);
    if (res.success) { onEdited?.(c.id, editText); setEditMode(false); }
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
      <div onClick={() => onUserClick?.(c.user)} style={{ cursor: onUserClick ? 'pointer' : undefined, flexShrink: 0 }}>
        <Avatar url={c.user?.avatar_url} name={c.user?.name} size={28} />
      </div>
      <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '6px 10px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span onClick={() => onUserClick?.(c.user)} style={{ fontWeight: 700, fontSize: 12, cursor: onUserClick ? 'pointer' : undefined }}>{c.user?.name}</span>
          {isOwn && !editMode && (
            <>
              <button onClick={() => { setEditMode(true); setEditText(c.content) }} style={{ background: 'none', border: 'none', color: 'rgba(160,160,255,0.5)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}>✏️</button>
              <button onClick={handleDelete} style={{ background: 'none', border: 'none', color: 'rgba(255,100,100,0.5)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}>✕</button>
            </>
          )}
        </div>
        {editMode ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()}
              style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '4px 8px', color: 'white', fontSize: 13 }} />
            <button onClick={handleSave} disabled={saving} style={{ background: '#7c3aed', border: 'none', borderRadius: 7, color: 'white', padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>{saving ? '...' : '✓'}</button>
            <button onClick={() => setEditMode(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 7, color: 'white', padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        ) : <div style={{ fontSize: 13 }}>{c.content}</div>}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{formatRelative(c.created_at)}</div>
      </div>
    </div>
  );
}

// ─── CreatePost ───────────────────────────────────────────────────────────────
function CreatePost({
  user,
  onCreated,
  wallOwnerId = null,
  wallOwnerName = null,
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  function pickFiles(e) {
    const picked = Array.from(e.target.files || []).slice(0, 4)
    if (!picked.length) return
    setFiles(prev => [...prev, ...picked].slice(0, 4))
    setPreviews(prev => [...prev, ...picked.map(f => URL.createObjectURL(f))].slice(0, 4))
    e.target.value = ""
  }

  function removeFile(i) {
    setFiles(prev => prev.filter((_, j) => j !== i))
    setPreviews(prev => prev.filter((_, j) => j !== i))
  }

  async function submit(e) {
    e.preventDefault();
    if (!text.trim() && files.length === 0) return;
    setLoading(true);
    const res = await postsService.createPost(user.id, text, files[0] || null, wallOwnerId, files.slice(1));
    setLoading(false);
    if (res.success) {
      setText("");
      setFiles([]);
      setPreviews([]);
      onCreated?.();
    } else notificationService.showNotification("Ошибка", res.error, "error");
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
      }}
    >
      {wallOwnerId && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 8,
          }}
        >
          Написать на стене {wallOwnerName || ""}
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <Avatar url={user.avatar_url} name={user.name} size={36} />
        <div style={{ flex: 1 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              wallOwnerId
                ? `Написать ${wallOwnerName || ""}...`
                : "Что у вас нового?"
            }
            rows={2}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12,
              padding: "10px 14px",
              color: "white",
              fontSize: 14,
              outline: "none",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
          {previews.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {previews.map((p, i) => (
                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={p} alt="" style={{ height: 100, width: 100, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  <button type="button" onClick={() => removeFile(i)} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
              ))}
              {previews.length < 4 && (
                <label htmlFor="postFileInput" style={{ width: 100, height: 100, border: '1.5px dashed rgba(255,255,255,0.2)', borderRadius: 10, background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</label>
              )}
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <label
              htmlFor="postFileInput"
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.6)",
                borderRadius: 8,
                padding: "5px 12px",
                cursor: "pointer",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <polyline points="21 15 16 10 5 21" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              Фото
            </label>
            <input
              id="postFileInput"
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={pickFiles}
            />
            <button
              type="submit"
              disabled={loading || (!text.trim() && files.length === 0)}
              style={{
                background:
                  loading || (!text.trim() && files.length === 0)
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(255,255,255,0.13)",
                border: "none",
                color: "white",
                borderRadius: 10,
                padding: "7px 18px",
                cursor:
                  loading || (!text.trim() && files.length === 0)
                    ? "not-allowed"
                    : "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {loading ? "Публикация..." : "Опубликовать"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ─── ProfileWall ──────────────────────────────────────────────────────────────
function ProfileWall({
  profileUser,
  currentUser,
  isFriendOfUser,
  onShareClick,
  onBannerUpdate,
  onUserClick,
  onDelete,
  onNotify,
  onMentionClick,
  onUserUpdate,
}) {
  const [posts, setPosts] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [profileSection, setProfileSection] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [localBannerUrl, setLocalBannerUrl] = useState(
    profileUser?.banner_url || "",
  );
  const [following, setFollowing] = useState(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);
  const [followModal, setFollowModal] = useState(null);
  const [followModalList, setFollowModalList] = useState([]);
  const [followModalLoading, setFollowModalLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [mutualFriends, setMutualFriends] = useState([]);
  const bannerFileRef = useRef(null);
  const avatarFileRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState(
    profileUser?.avatar_url || "",
  );
  const [editingProfile, setEditingProfile] = useState(false);
  const [editName, setEditName] = useState(profileUser?.name || '');
  const [editUsername, setEditUsername] = useState(profileUser?.username || '');
  const [editBio, setEditBio] = useState(profileUser?.bio || '');
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState(null);
  const isMe = Boolean(currentUser?.id) && currentUser.id === profileUser?.id;
  const canPost = isMe || isFriendOfUser;
  const isPrivateLocked = !isMe && profileUser?.is_private && !isFriendOfUser;

  useEffect(() => {
    setLocalBannerUrl(profileUser?.banner_url || "");
  }, [profileUser?.banner_url]);
  useEffect(() => {
    setLocalAvatarUrl(profileUser?.avatar_url || "");
  }, [profileUser?.avatar_url]);

  useEffect(() => {
    if (!profileUser?.id || !currentUser?.id) return;
    followsService.getCounts(profileUser.id).then((c) => {
      setFollowerCount(c.followers);
      setFollowingCount(c.following);
    });
    if (!isMe) {
      followsService.isFollowing(currentUser.id, profileUser.id).then(setFollowing);
      // общие подписки (оба подписаны на одних и тех же)
      Promise.all([
        followsService.getFollowing(currentUser.id),
        followsService.getFollowing(profileUser.id),
      ]).then(([myF, theirF]) => {
        const theirIds = new Set(theirF.map(u => u.id))
        setMutualFriends(myF.filter(u => theirIds.has(u.id)).slice(0, 5))
      })
    }
  }, [profileUser?.id, currentUser?.id, isMe]);

  const [wallHasMore, setWallHasMore] = useState(true);
  const wallOffsetRef = useRef(0);
  const wallSentinelRef = useRef(null);
  const wallLoadingRef = useRef(false);
  const WALL_PAGE = 15;

  const loadWallPage = useCallback(async (reset = false) => {
    if (!profileUser?.id) return;
    if (wallLoadingRef.current) return;
    wallLoadingRef.current = true;
    const offset = reset ? 0 : wallOffsetRef.current;
    if (reset) setLoading(true);
    const data = await postsService.getPostsByUserPaged(profileUser.id, WALL_PAGE, offset);
    const postIds = data.map(p => p.id);
    const [likedSet, repostedSet, ...likeCounts] = postIds.length
      ? await Promise.all([
          postsService.getLikedPostIds(currentUser?.id, postIds),
          postsService.getRepostedPostIds(currentUser?.id, postIds),
          ...data.map(p => postsService.getLikeCount(p.id)),
        ])
      : [new Set(), new Set()];
    const enriched = data.map((p, i) => ({
      ...p, _likeCount: likeCounts[i], _liked: likedSet.has(p.id), _reposted: repostedSet.has(p.id),
    }));
    if (reset) { setPosts(enriched); wallOffsetRef.current = enriched.length; }
    else { setPosts(prev => [...prev, ...enriched]); wallOffsetRef.current += enriched.length; }
    setWallHasMore(data.length === WALL_PAGE);
    setLoading(false);
    wallLoadingRef.current = false;
  }, [profileUser?.id, currentUser?.id]);

  useEffect(() => { wallOffsetRef.current = 0; loadWallPage(true); }, [profileUser?.id]);

  useEffect(() => {
    if (!wallSentinelRef.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && wallHasMore) loadWallPage(false); }, { threshold: 0.1 });
    obs.observe(wallSentinelRef.current);
    return () => obs.disconnect();
  }, [wallHasMore, loadWallPage]);

  useEffect(() => {
    if (!currentUser?.id || profileSection !== 'bookmarks') return
    bookmarksService.getAll(currentUser.id).then(setBookmarks)
  }, [currentUser?.id, profileSection])

  useEffect(() => {
    if (!editingProfile) {
      setEditName(profileUser?.name || '');
      setEditUsername(profileUser?.username || '');
      setEditBio(profileUser?.bio || '');
      setEditMsg(null);
    }
  }, [profileUser?.id, editingProfile]);

  async function saveProfileInline(e) {
    e.preventDefault();
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditMsg(null);
    const updates = { name: editName.trim(), bio: editBio.trim() };
    if (editUsername.trim() && editUsername.trim() !== profileUser?.username)
      updates.username = editUsername.trim();
    const res = await authService.updateProfile(currentUser.id, updates);
    setEditSaving(false);
    if (res.success) {
      setEditMsg({ ok: true, text: 'Сохранено!' });
      onUserUpdate?.({ ...currentUser, name: res.user.name, bio: res.user.bio || '', username: res.user.username });
      setTimeout(() => { setEditingProfile(false); setEditMsg(null); }, 800);
    } else {
      setEditMsg({ ok: false, text: res.error });
    }
  }

  async function handleFollow() {
    if (followLoading || following === null) return;
    setFollowLoading(true);
    const prev = following;
    setFollowing(!prev);
    setFollowerCount((c) => (prev ? c - 1 : c + 1));
    const res = prev
      ? await followsService.unfollow(currentUser.id, profileUser.id)
      : await followsService.follow(currentUser.id, profileUser.id);
    if (!res.success) {
      setFollowing(prev);
      setFollowerCount((c) => (prev ? c + 1 : c - 1));
      notificationService.showNotification("Ошибка", res.error, "error");
    }
    setFollowLoading(false);
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setAvatarUploading(true);
    const res = await authService.updateAvatar(currentUser.id, file);
    setAvatarUploading(false);
    if (!res.success) {
      notificationService.showNotification("Ошибка", res.error, "error");
    } else {
      setLocalAvatarUrl(res.avatar_url);
      notificationService.showNotification(
        "Готово!",
        "Аватарка обновлена",
        "success",
      );
    }
  }

  async function handleBannerUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setBannerUploading(true);
    const res = await authService.updateBanner(currentUser.id, file);
    setBannerUploading(false);
    if (!res.success) {
      notificationService.showNotification("Ошибка", res.error, "error");
    } else {
      setLocalBannerUrl(res.banner_url);
      onBannerUpdate?.(res.banner_url);
      notificationService.showNotification(
        "Готово!",
        "Фон профиля обновлён",
        "success",
      );
    }
  }

  async function openFollowModal(type) {
    setFollowModal(type);
    setFollowModalLoading(true);
    const list =
      type === "followers"
        ? await followsService.getFollowers(profileUser.id)
        : await followsService.getFollowing(profileUser.id);
    setFollowModalList(list);
    setFollowModalLoading(false);
  }

  const hue = ((profileUser?.name || "").charCodeAt(0) * 13) % 360;

  return (
    <div>
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            height: localBannerUrl ? 160 : 110,
            background: localBannerUrl
              ? undefined
              : `linear-gradient(135deg, hsl(${hue},45%,22%) 0%, hsl(${hue + 100},35%,18%) 100%)`,
            backgroundImage: localBannerUrl
              ? `url(${localBannerUrl})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            position: "relative",
          }}
        >
          {isMe && (
            <>
              <input
                type="file"
                id="bannerFileInput"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleBannerUpload}
              />
              <label
                htmlFor="bannerFileInput"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "rgba(0,0,0,0.55)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  color: "white",
                  borderRadius: 8,
                  padding: "4px 10px",
                  cursor: bannerUploading ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {bannerUploading ? "..." : "Сменить фон"}
              </label>
            </>
          )}
        </div>
        <div
          style={{ padding: "0 18px 16px", position: "relative", zIndex: 1 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div style={{ marginTop: -20, position: "relative", width: 64 }}>
              {isMe && (
                <input
                  type="file"
                  id="avatarFileInput"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleAvatarUpload}
                />
              )}
              <label
                htmlFor={isMe ? "avatarFileInput" : undefined}
                style={{
                  cursor: isMe ? "pointer" : undefined,
                  position: "relative",
                  display: "inline-block",
                }}
              >
                <Avatar
                  url={localAvatarUrl}
                  name={profileUser?.name}
                  size={64}
                  style={{ border: "3px solid #0b0b0b" }}
                />
                {isMe && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "rgba(0,0,0,0.7)",
                      border: "1.5px solid rgba(255,255,255,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                    }}
                  >
                    {avatarUploading ? "…" : "✎"}
                  </div>
                )}
              </label>
            </div>
            {!isMe && currentUser?.id && following !== null && (
              <button
                onClick={handleFollow}
                disabled={followLoading}
                style={{
                  background: following
                    ? "transparent"
                    : "rgba(255,255,255,0.13)",
                  border: `1px solid ${following ? "rgba(255,255,255,0.2)" : "transparent"}`,
                  color: "white",
                  borderRadius: 10,
                  padding: "7px 18px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                {following ? "Отписаться" : "Подписаться"}
              </button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            {editingProfile ? (
              <form onSubmit={saveProfileInline} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Имя" autoFocus
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 12px', color: 'white', fontSize: 15, fontWeight: 700, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                />
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>@</span>
                  <input
                    value={editUsername} onChange={e => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                    placeholder="username"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 12px 8px 24px', color: 'white', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <textarea
                  value={editBio} onChange={e => setEditBio(e.target.value)}
                  placeholder="О себе..."
                  rows={2}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 12px', color: 'white', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit' }}
                />
                {editMsg && <div style={{ fontSize: 12, color: editMsg.ok ? '#4ade80' : '#f87171' }}>{editMsg.text}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={editSaving}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.13)', border: 'none', borderRadius: 10, padding: '8px', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                    {editSaving ? '...' : 'Сохранить'}
                  </button>
                  <button type="button" onClick={() => setEditingProfile(false)}
                    style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '8px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}>
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{profileUser?.name}</div>
                  {isMe && (
                    <button onClick={() => setEditingProfile(true)} title="Редактировать профиль"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '3px 8px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                      ✏️ Изменить
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                  @{profileUser?.username}
                </div>
                {profileUser?.bio && (
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, marginBottom: 8 }}>
                    {profileUser.bio}
                  </div>
                )}
              </>
            )}
            <div style={{ display: "flex", gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: editingProfile ? 4 : 0 }}>
              <button onClick={() => openFollowModal("followers")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", padding: 0, fontSize: 13 }}>
                <b style={{ color: "white" }}>{followerCount}</b> подписчиков
              </button>
              <button onClick={() => openFollowModal("following")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", padding: 0, fontSize: 13 }}>
                <b style={{ color: "white" }}>{followingCount}</b> подписок
              </button>
              {isMe && (
                <button onClick={() => setShowQR(true)} title="QR-код профиля"
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/><rect x="5" y="5" width="3" height="3" fill="currentColor"/><rect x="16" y="5" width="3" height="3" fill="currentColor"/><rect x="5" y="16" width="3" height="3" fill="currentColor"/><path d="M14 14h3v3h-3zM17 17h3v3M17 14h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>
            {!isMe && mutualFriends.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <div style={{ display: 'flex' }}>
                  {mutualFriends.slice(0,3).map((f, i) => (
                    <div key={f.id} style={{ marginLeft: i > 0 ? -8 : 0, zIndex: 3 - i }}>
                      <Avatar url={f.avatar_url} name={f.name} size={20} style={{ border: '1.5px solid #0b0b0b' }} />
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  {mutualFriends.length} общих {mutualFriends.length === 1 ? 'подписка' : 'подписки'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {isPrivateLocked ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.35)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'rgba(255,255,255,0.7)' }}>Закрытый профиль</div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>Подпишитесь, чтобы видеть посты {profileUser?.name}</div>
        </div>
      ) : (
      <>
      {canPost && currentUser?.id && (
        <CreatePost
          user={currentUser}
          onCreated={() => loadWallPage(true)}
          wallOwnerId={isMe ? null : profileUser?.id}
          wallOwnerName={isMe ? null : profileUser?.name}
        />
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[['posts', 'Посты'], ...(isMe ? [['bookmarks', 'Закладки']] : [])].map(([key, label]) => (
          <button key={key} onClick={() => setProfileSection(key)}
            style={{ padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: profileSection === key ? 'rgba(255,255,255,0.13)' : 'transparent', color: profileSection === key ? 'white' : 'rgba(255,255,255,0.4)' }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
          Загрузка...
        </div>
      ) : profileSection === 'bookmarks' ? (
        bookmarks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14, border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14 }}>
            Закладок пока нет
          </div>
        ) : bookmarks.map(p => (
          <PostCard key={p.id} post={p} currentUser={currentUser} onShareClick={onShareClick} onUserClick={onUserClick} onDelete={onDelete} onNotify={onNotify} onMentionClick={onMentionClick} />
        ))
      ) : posts.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 30,
            color: "rgba(255,255,255,0.25)",
            fontSize: 14,
            border: "1px dashed rgba(255,255,255,0.08)",
            borderRadius: 14,
          }}
        >
          {isMe ? (
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✍️</div>
              <div>Постов пока нет.</div>
              <div style={{ fontSize: 12, marginTop: 4, color: 'rgba(255,255,255,0.18)' }}>Поделитесь чем-нибудь!</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗒️</div>
              <div>У пользователя пока нет постов.</div>
            </div>
          )}
        </div>
      ) : (
        <>
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              currentUser={currentUser}
              onShareClick={onShareClick}
              onUserClick={onUserClick}
              onDelete={onDelete}
              onNotify={onNotify}
              onMentionClick={onMentionClick}
            />
          ))}
          <div ref={wallSentinelRef} style={{ height: 1 }} />
          {!wallHasMore && posts.length > 0 && (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12, padding: '12px 0' }}>Все посты загружены</div>
          )}
        </>
      )}

      {followModal && (
        <div
          onClick={() => setFollowModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 9000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(380px,100%)",
              background: "rgba(16,16,16,0.98)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 18,
              padding: 22,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>
              {followModal === "followers" ? "Подписчики" : "Подписки"}
            </div>
            <div
              style={{
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {followModalLoading ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 20,
                    color: "rgba(255,255,255,0.4)",
                  }}
                >
                  Загрузка...
                </div>
              ) : followModalList.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                  Пусто
                </div>
              ) : (
                followModalList.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => {
                      setFollowModal(null);
                      onUserClick?.(u);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 12,
                      cursor: "pointer",
                    }}
                  >
                    <Avatar url={u.avatar_url} name={u.name} size={40} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {u.name}
                      </div>
                      <div
                        style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}
                      >
                        @{u.username}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {showQR && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowQR(false)}>
          <div style={{ background: '#1a1a2e', borderRadius: 20, padding: 24, textAlign: 'center', maxWidth: 280, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>QR-код профиля</div>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&bgcolor=1a1a2e&color=ffffff&data=${encodeURIComponent(`https://lvkosp.ru/profile/${profileUser?.username || profileUser?.id}`)}`}
              alt="QR" style={{ width: 200, height: 200, borderRadius: 12, display: 'block', margin: '0 auto 12px' }}
            />
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>@{profileUser?.username}</div>
            <button onClick={() => setShowQR(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 10, padding: '8px 20px', color: 'white', cursor: 'pointer', fontSize: 14 }}>Закрыть</button>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
function SettingsPanel({ user, onUserUpdate, onLogout }) {
  const [isPrivate, setIsPrivate] = useState(user?.is_private || false);

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState(null);

  async function savePassword(e) {
    e.preventDefault();
    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: "Пароли не совпадают" });
      return;
    }
    setPwdSaving(true);
    setPwdMsg(null);
    const res = await authService.changePassword(user.id, oldPwd, newPwd);
    setPwdSaving(false);
    if (res.success) {
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setPwdMsg({ ok: true, text: "Пароль изменён!" });
    } else {
      setPwdMsg({ ok: false, text: res.error });
    }
  }

  async function togglePrivate() {
    const next = !isPrivate
    setIsPrivate(next)
    const res = await authService.setPrivate(user.id, next)
    if (!res.success) setIsPrivate(!next)
    else onUserUpdate?.({ ...user, is_private: next })
  }

  const inp = {
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: "10px 14px",
    color: "white",
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const sec = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: "18px 20px",
    marginBottom: 16,
  };
  const label = {
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 6,
    display: "block",
    fontWeight: 600,
    letterSpacing: 0.3,
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
        Имя, username и фото — в профиле через кнопку «✏️ Изменить»
      </div>
      <div style={sec}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>
          Сменить пароль
        </div>
        <form
          onSubmit={savePassword}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div>
            <label style={label}>Текущий пароль</label>
            <input
              style={inp}
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label style={label}>Новый пароль</label>
            <input
              style={inp}
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label style={label}>Повторите новый пароль</label>
            <input
              style={inp}
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {pwdMsg && (
            <div
              style={{ fontSize: 13, color: pwdMsg.ok ? "#4ade80" : "#f87171" }}
            >
              {pwdMsg.text}
            </div>
          )}
          <button
            type="submit"
            disabled={pwdSaving || !oldPwd || !newPwd || !confirmPwd}
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "none",
              borderRadius: 11,
              padding: "10px",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {pwdSaving ? "Сохранение..." : "Изменить пароль"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5 }}>КОНФИДЕНЦИАЛЬНОСТЬ</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Закрытый профиль</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Посты видны только подписчикам</div>
          </div>
          <button onClick={togglePrivate} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: isPrivate ? '#a78bfa' : 'rgba(255,255,255,0.15)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, left: isPrivate ? 23 : 3, transition: 'left 0.2s' }} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <button onClick={onLogout}
          style={{ width: '100%', background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: 14, padding: '11px', color: 'rgba(255,120,120,0.9)', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
function ExploreView({ currentUser, onUserClick, onMentionClick, onShareClick, onNotify }) {
  const [query, setQuery] = useState('')
  const [userResults, setUserResults] = useState([])
  const [postResults, setPostResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const timerRef = useRef(null)
  const blockedIdsRef = useRef(new Set())

  useEffect(() => {
    if (currentUser?.id) blocksService.getBlockedIds(currentUser.id).then(ids => { blockedIdsRef.current = new Set(ids) })
  }, [currentUser?.id])

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!query.trim()) { setUserResults([]); setPostResults([]); setSearchError(false); return }
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(false)
      try {
        const [users, posts] = await Promise.all([
          authService.searchUsers(query),
          postsService.searchPosts(query),
        ])
        const blocked = blockedIdsRef.current
        setUserResults(users.filter(u => !blocked.has(u.id)))
        setPostResults(posts.filter(p => !blocked.has(p.author_id)))
      } catch {
        setSearchError(true)
      }
      setSearching(false)
    }, 400)
    return () => clearTimeout(timerRef.current)
  }, [query])

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск людей и постов..."
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '10px 14px 10px 38px', color: 'white', fontSize: 14, outline: 'none' }}
        />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }}><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
      </div>
      {searching && <div style={{ textAlign: 'center', padding: 20, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Поиск...</div>}
      {!searching && searchError && (
        <div style={{ textAlign: 'center', padding: 20, color: 'rgba(255,100,100,0.7)', fontSize: 13 }}>Ошибка поиска — проверьте соединение</div>
      )}
      {!searching && !searchError && !query.trim() && (
        <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>Введите запрос для поиска</div>
      )}
      {!searching && !searchError && query.trim() && userResults.length === 0 && postResults.length === 0 && (
        <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>Ничего не найдено</div>
      )}
      {userResults.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Люди</div>
          {userResults.map(u => (
            <div key={u.id} onClick={() => onUserClick(u)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
              <Avatar url={u.avatar_url} name={u.name} size={40} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{u.username}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {postResults.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Посты</div>
          {postResults.map(p => (
            <PostCard key={p.id} post={p} currentUser={currentUser} onUserClick={onUserClick} onMentionClick={onMentionClick} onShareClick={onShareClick} onNotify={onNotify} />
          ))}
        </div>
      )}
    </div>
  )
}

const STORY_DURATION = 5000

function StoryViewer({ viewer, currentUser, onClose, onNext, onPrev }) {
  const { list, index } = viewer
  const story = list[index]
  const isOwn = story.user?.id === currentUser?.id
  const [progress, setProgress] = useState(0)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState([])
  const timerRef = useRef(null)
  const startRef = useRef(null)

  useEffect(() => {
    setProgress(0)
    setShowViewers(false)
    startRef.current = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current
      const p = Math.min((elapsed / STORY_DURATION) * 100, 100)
      setProgress(p)
      if (p >= 100) {
        clearInterval(timerRef.current)
        if (index < list.length - 1) onNext()
        else onClose()
      }
    }, 50)
    return () => clearInterval(timerRef.current)
  }, [index])

  function handleViewersClick(e) {
    e.stopPropagation()
    if (!isOwn) return
    setShowViewers(v => !v)
    if (!showViewers) storiesService.getViews(story.id).then(setViewers)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 420, height: '100dvh', maxHeight: 900, display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>

        {/* прогресс-бары */}
        <div style={{ display: 'flex', gap: 3, padding: '12px 12px 0', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}>
          {list.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: 'white', width: i < index ? '100%' : i === index ? `${progress}%` : '0%', transition: i === index ? 'none' : undefined }} />
            </div>
          ))}
        </div>

        {/* шапка */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'absolute', top: 28, left: 12, right: 44, zIndex: 2 }}>
          <Avatar url={story.user?.avatar_url} name={story.user?.name} size={36} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'white', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>{story.user?.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{story.expires_at ? `до ${new Date(story.expires_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
          </div>
          {isOwn && (
            <button onClick={handleViewersClick} style={{ marginLeft: 'auto', background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 12, padding: '4px 10px', color: 'rgba(255,255,255,0.8)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              👁 <StoryViewCount storyId={story.id} />
            </button>
          )}
        </div>

        {/* фото */}
        <img src={story.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />

        {/* кнопка закрыть */}
        <button onClick={onClose} style={{ position: 'absolute', top: 28, right: 10, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', width: 34, height: 34, color: 'white', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>✕</button>

        {/* зоны тапа влево/вправо */}
        <div style={{ position: 'absolute', left: 0, top: 80, bottom: 0, width: '40%', zIndex: 1 }}
          onClick={e => { e.stopPropagation(); if (index > 0) onPrev() }} />
        <div style={{ position: 'absolute', right: 0, top: 80, bottom: 0, width: '40%', zIndex: 1 }}
          onClick={e => { e.stopPropagation(); if (index < list.length - 1) onNext(); else onClose() }} />

        {/* список просмотревших */}
        {showViewers && isOwn && (
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(14,14,14,0.97)', borderRadius: '18px 18px 0 0', padding: 16, maxHeight: '50vh', overflowY: 'auto', zIndex: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'white' }}>Просмотрели</div>
            {viewers.length === 0
              ? <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Пока никто не смотрел</div>
              : viewers.map(v => (
                <div key={v.viewer_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <Avatar url={v.viewer?.avatar_url} name={v.viewer?.name} size={36} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{v.viewer?.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>@{v.viewer?.username}</div>
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  )
}

function StoryViewCount({ storyId }) {
  const [count, setCount] = useState(null)
  useEffect(() => {
    storiesService.getViewCount(storyId).then(setCount)
  }, [storyId])
  if (count === null) return null
  return <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: '2px 6px' }}>👁 {count}</span>
}

function StoriesBar({ currentUser, followingIds, onUserClick }) {
  const [stories, setStories] = useState([])
  const [myStories, setMyStories] = useState([])
  const [viewer, setViewer] = useState(null)
  const [editorFile, setEditorFile] = useState(null)
  const fileRef = useRef(null)

  const loadStories = useCallback(async () => {
    if (!currentUser?.id) return
    const ids = [...(followingIds || []), currentUser.id]
    const [all, mine] = await Promise.all([
      storiesService.getActive(ids),
      storiesService.getMyActive(currentUser.id),
    ])
    setStories(all)
    setMyStories(mine)
  }, [currentUser?.id, followingIds?.join(',')])

  useEffect(() => { loadStories() }, [loadStories])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const s of stories) {
      if (!map.has(s.user_id)) map.set(s.user_id, { user: s.user, items: [] })
      map.get(s.user_id).items.push(s)
    }
    return [...map.values()]
  }, [stories])

  if (grouped.length === 0 && myStories.length === 0 && !currentUser) return null

  return (
    <>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '4px 0 12px', scrollbarWidth: 'none' }}>
        {currentUser && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', border: '2px dashed rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', position: 'relative' }}>
              <Avatar url={currentUser?.avatar_url} name={currentUser?.name} size={52} />
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderRadius: '50%', background: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, border: '2px solid #0b0b0b' }}>+</div>
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Мой сторис</span>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) setEditorFile(f); e.target.value = ''; }} />

        {grouped.map(({ user, items }) => (
          <div key={user.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer' }}
            onClick={() => { setViewer({ list: items, index: 0 }); if (currentUser?.id) storiesService.addView(items[0].id, currentUser.id) }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', padding: 2, background: 'linear-gradient(135deg,#a78bfa,#ec4899)', flexShrink: 0 }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', border: '2px solid #0b0b0b', overflow: 'hidden' }}>
                <Avatar url={user.avatar_url} name={user.name} size={52} />
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
          </div>
        ))}
      </div>

      {viewer && (
        <StoryViewer viewer={viewer} currentUser={currentUser} onClose={() => setViewer(null)}
          onNext={() => setViewer(v => { const next = { ...v, index: v.index + 1 }; if (current?.id) storiesService.addView(v.list[next.index]?.id, currentUser.id); return next })}
          onPrev={() => setViewer(v => { const next = { ...v, index: v.index - 1 }; if (currentUser?.id) storiesService.addView(v.list[next.index]?.id, currentUser.id); return next })} />
      )}

      {editorFile && (
        <StoryEditor file={editorFile} currentUser={currentUser}
          onClose={() => setEditorFile(null)}
          onPublished={() => { setEditorFile(null); loadStories(); notificationService.showNotification('Сторис опубликован!', '', 'success'); }} />
      )}
    </>
  )
}

// ─── StoryEditor ───────────────────────────────────────────────────────────────
const STICKER_EMOJIS = ['😂','❤️','🔥','👍','😍','🎉','💯','😭','✨','🙏','😎','💪','🫶','🥹','😢','😡','👀','💀','🤩','🥳','🌸','🍕','🎵','⭐','🚀']
const TEXT_COLORS = ['#ffffff','#000000','#ffdd57','#ff4757','#2ed573','#1e90ff','#ff6b81','#a29bfe']

function StoryEditor({ file, currentUser, onClose, onPublished }) {
  const [previewUrl] = useState(() => URL.createObjectURL(file))
  const [textLayers, setTextLayers] = useState([])
  const [stickers, setStickers] = useState([])
  const [activeText, setActiveText] = useState(null) // index
  const [showTextInput, setShowTextInput] = useState(false)
  const [newTextValue, setNewTextValue] = useState('')
  const [textColor, setTextColor] = useState('#ffffff')
  const [showStickers, setShowStickers] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const containerRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])

  function addText() {
    if (!newTextValue.trim()) return
    setTextLayers(prev => [...prev, { text: newTextValue.trim(), color: textColor, size: 28, xPct: 50, yPct: 50 }])
    setNewTextValue('')
    setShowTextInput(false)
  }

  function addSticker(emoji) {
    setStickers(prev => [...prev, { emoji, size: 48, xPct: 30 + Math.random() * 40, yPct: 30 + Math.random() * 40 }])
    setShowStickers(false)
  }

  function startDragLayer(type, idx, e) {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { type, idx }
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    function onMove(ev) {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY
      const xPct = ((cx - rect.left) / rect.width) * 100
      const yPct = ((cy - rect.top) / rect.height) * 100
      if (type === 'text') setTextLayers(prev => prev.map((l, i) => i === idx ? { ...l, xPct, yPct } : l))
      if (type === 'sticker') setStickers(prev => prev.map((s, i) => i === idx ? { ...s, xPct, yPct } : s))
    }
    function onUp() {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
  }

  async function publish() {
    if (publishing) return
    setPublishing(true)
    try {
      const composed = await composeStory(file, textLayers, stickers)
      const composedFile = new File([composed], 'story.jpg', { type: 'image/jpeg' })
      const res = await storiesService.create(currentUser.id, composedFile)
      if (res.success) onPublished()
      else { notificationService.showNotification('Ошибка', res.error, 'error'); setPublishing(false) }
    } catch (err) {
      notificationService.showNotification('Ошибка', err.message, 'error')
      setPublishing(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
        <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', userSelect: 'none', pointerEvents: 'none' }} />

        {/* Text layers */}
        {textLayers.map((t, i) => (
          <div key={i}
            onMouseDown={e => startDragLayer('text', i, e)}
            onTouchStart={e => startDragLayer('text', i, e)}
            style={{ position: 'absolute', left: `${t.xPct}%`, top: `${t.yPct}%`, transform: 'translate(-50%,-50%)', color: t.color, fontSize: t.size, fontWeight: 800, textShadow: '0 2px 8px rgba(0,0,0,0.7)', cursor: 'grab', userSelect: 'none', whiteSpace: 'pre-wrap', textAlign: 'center', padding: '4px 8px', touchAction: 'none' }}>
            {t.text}
            <button onClick={() => setTextLayers(prev => prev.filter((_, j) => j !== i))}
              style={{ position: 'absolute', top: -8, right: -8, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        ))}

        {/* Sticker layers */}
        {stickers.map((s, i) => (
          <div key={i}
            onMouseDown={e => startDragLayer('sticker', i, e)}
            onTouchStart={e => startDragLayer('sticker', i, e)}
            style={{ position: 'absolute', left: `${s.xPct}%`, top: `${s.yPct}%`, transform: 'translate(-50%,-50%)', fontSize: s.size, cursor: 'grab', userSelect: 'none', touchAction: 'none', lineHeight: 1 }}>
            {s.emoji}
            <button onClick={() => setStickers(prev => prev.filter((_, j) => j !== i))}
              style={{ position: 'absolute', top: -8, right: -8, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        ))}
      </div>

      {/* Text input overlay */}
      {showTextInput && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {TEXT_COLORS.map(c => (
              <button key={c} onClick={() => setTextColor(c)}
                style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: textColor === c ? '3px solid white' : '2px solid rgba(255,255,255,0.3)', cursor: 'pointer' }} />
            ))}
          </div>
          <textarea value={newTextValue} onChange={e => setNewTextValue(e.target.value)} placeholder="Введи текст..."
            autoFocus rows={3}
            style={{ width: '100%', maxWidth: 340, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 14, padding: '12px 14px', color: textColor, fontSize: 20, fontWeight: 700, outline: 'none', resize: 'none', textAlign: 'center', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={addText} style={{ background: 'white', color: 'black', border: 'none', borderRadius: 12, padding: '10px 24px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Добавить</button>
            <button onClick={() => setShowTextInput(false)} style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}>Отмена</button>
          </div>
        </div>
      )}

      {/* Sticker picker overlay */}
      {showStickers && (
        <div style={{ position: 'absolute', bottom: 80, left: 0, right: 0, zIndex: 10001, background: 'rgba(15,15,25,0.95)', padding: '16px 12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {STICKER_EMOJIS.map(e => (
              <button key={e} onClick={() => addSticker(e)}
                style={{ background: 'none', border: 'none', fontSize: 32, cursor: 'pointer', padding: 4, borderRadius: 8 }}>{e}</button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom toolbar */}
      <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px 20px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom,0px))', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        <button onClick={() => { setShowStickers(false); setShowTextInput(v => !v); }}
          style={{ background: showTextInput ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)', border: 'none', color: 'white', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          Аа
        </button>
        <button onClick={() => { setShowTextInput(false); setShowStickers(v => !v); }}
          style={{ background: showStickers ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)', border: 'none', color: 'white', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontSize: 20 }}>
          😊
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={publish} disabled={publishing}
          style={{ background: 'linear-gradient(135deg,#a78bfa,#ec4899)', border: 'none', color: 'white', borderRadius: 12, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: publishing ? 'default' : 'pointer', opacity: publishing ? 0.7 : 1 }}>
          {publishing ? 'Публикую...' : 'Опубликовать →'}
        </button>
      </div>
    </div>
  )
}

// ─── ChannelsView ──────────────────────────────────────────────────────────────
function ChannelsView({ currentUser, onOpenChannel }) {
  const [myChannels, setMyChannels] = useState([]);
  const [allChannels, setAllChannels] = useState([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [my, all] = await Promise.all([
        currentUser?.id ? channelsService.getSubscribedChannels(currentUser.id) : [],
        channelsService.getAll(20),
      ]);
      setMyChannels(my);
      setAllChannels(all);
      setLoading(false);
    })();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      const res = await channelsService.search(search);
      setSearchResults(res);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const displayList = searchResults ?? allChannels;
  const myIds = new Set(myChannels.map(c => c.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }}><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск каналов..."
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '9px 12px 9px 34px', color: 'white', fontSize: 14, outline: 'none' }} />
        </div>
        {currentUser && (
          <button onClick={() => setCreateOpen(true)}
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '9px 14px', color: 'white', cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
            + Создать
          </button>
        )}
      </div>

      {myChannels.length > 0 && !search && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, marginBottom: 8 }}>МОИ КАНАЛЫ</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {myChannels.map(ch => (
              <ChannelItem key={ch.id} channel={ch} isSubscribed role={ch.role} onOpen={() => onOpenChannel(ch)} currentUser={currentUser}
                onUnsubscribe={() => setMyChannels(prev => prev.filter(c => c.id !== ch.id))} />
            ))}
          </div>
        </div>
      )}

      <div>
        {!search && <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, marginBottom: 8 }}>ВСЕ КАНАЛЫ</div>}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Загрузка...</div>
        ) : displayList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
            {search ? 'Ничего не найдено' : 'Пока нет каналов — создай первый!'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {displayList.map(ch => (
              <ChannelItem key={ch.id} channel={ch} isSubscribed={myIds.has(ch.id)} onOpen={() => onOpenChannel(ch)} currentUser={currentUser}
                onSubscribe={(c) => setMyChannels(prev => [...prev, c])}
                onUnsubscribe={() => setMyChannels(prev => prev.filter(c => c.id !== ch.id))} />
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateChannelModal currentUser={currentUser} onClose={() => setCreateOpen(false)}
          onCreate={(ch) => { setMyChannels(prev => [...prev, { ...ch, role: 'admin' }]); setAllChannels(prev => [ch, ...prev]); setCreateOpen(false); onOpenChannel(ch); }} />
      )}
    </div>
  );
}

function ChannelItem({ channel, isSubscribed, role, onOpen, currentUser, onSubscribe, onUnsubscribe }) {
  const [subbed, setSubbed] = useState(isSubscribed);
  const [loading, setLoading] = useState(false);

  async function handleSub(e) {
    e.stopPropagation();
    if (!currentUser) return;
    setLoading(true);
    if (subbed) {
      await channelsService.unsubscribe(channel.id, currentUser.id);
      setSubbed(false);
      onUnsubscribe?.();
    } else {
      await channelsService.subscribe(channel.id, currentUser.id);
      setSubbed(true);
      onSubscribe?.({ ...channel, role: 'member' });
    }
    setLoading(false);
  }

  return (
    <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', transition: 'background 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: channel.avatar_url ? undefined : 'linear-gradient(135deg,#6366f1,#8b5cf6)', backgroundImage: channel.avatar_url ? `url(${channel.avatar_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 18 }}>
        {!channel.avatar_url && channel.name?.[0]?.toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>{channel.name} {role === 'admin' && <span style={{ fontSize: 10, background: 'rgba(99,102,241,0.2)', color: '#a78bfa', borderRadius: 6, padding: '1px 5px', marginLeft: 4 }}>admin</span>}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>@{channel.username}{channel.description ? ` · ${channel.description.slice(0, 40)}` : ''}</div>
      </div>
      {currentUser && role !== 'admin' && (
        <button onClick={handleSub} disabled={loading}
          style={{ padding: '5px 12px', borderRadius: 10, border: subbed ? '1px solid rgba(255,255,255,0.15)' : 'none', background: subbed ? 'transparent' : 'rgba(99,102,241,0.7)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
          {loading ? '...' : subbed ? 'Отписаться' : 'Подписаться'}
        </button>
      )}
    </div>
  );
}

function CreateChannelModal({ currentUser, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [desc, setDesc] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const avatarRef = useRef(null);

  function handleAvatarPick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !username.trim()) { setError('Заполни название и username'); return; }
    setSaving(true);
    setError('');
    const res = await channelsService.create(currentUser.id, { name, username, description: desc });
    if (!res.success) { setError(res.error); setSaving(false); return; }
    if (avatarFile) {
      try {
        const compressed = await new Promise(resolve => {
          const img = new Image(); const url = URL.createObjectURL(avatarFile);
          img.onload = () => {
            URL.revokeObjectURL(url);
            const s = 256; const canvas = document.createElement('canvas');
            canvas.width = s; canvas.height = s;
            const ctx = canvas.getContext('2d');
            const side = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0, 0, s, s);
            canvas.toBlob(b => resolve(b || avatarFile), 'image/jpeg', 0.9);
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(avatarFile); };
          img.src = url;
        });
        const path = `channel_${res.channel.id}_${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
        if (!upErr) {
          const { data } = supabase.storage.from('avatars').getPublicUrl(path);
          await supabase.from('channels').update({ avatar_url: data.publicUrl }).eq('id', res.channel.id);
          res.channel.avatar_url = data.publicUrl;
        }
      } catch {}
    }
    setSaving(false);
    onCreate(res.channel);
  }

  const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', color: 'white', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a2e', borderRadius: '20px 20px 0 0', padding: 24, width: '100%', maxWidth: 480, paddingBottom: 'calc(24px + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 18 }}>Новый канал</div>

        {/* Avatar picker */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => avatarRef.current?.click()}>
            <div style={{ width: 72, height: 72, borderRadius: 18, background: avatarPreview ? undefined : 'linear-gradient(135deg,#6366f1,#8b5cf6)', backgroundImage: avatarPreview ? `url(${avatarPreview})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 28 }}>
              {!avatarPreview && '📷'}
            </div>
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 24, height: 24, borderRadius: '50%', background: '#a78bfa', border: '2px solid #1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>+</div>
          </div>
          <input ref={avatarRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarPick} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Название канала" style={inp} autoFocus />
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>@</span>
            <input value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_]/g, '').toLowerCase())} placeholder="username" style={{ ...inp, paddingLeft: 28 }} />
          </div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Описание (необязательно)" rows={2} style={{ ...inp, resize: 'none' }} />
          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" disabled={saving} style={{ flex: 1, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: 12, padding: '11px', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              {saving ? 'Создание...' : 'Создать'}
            </button>
            <button type="button" onClick={onClose} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '11px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14 }}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ChannelPage ───────────────────────────────────────────────────────────────
function ChannelPage({ channel, currentUser, onBack, onUserClick }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState(null);
  const [subLoading, setSubLoading] = useState(false);
  const [subCount, setSubCount] = useState(0);
  const [composerText, setComposerText] = useState('');
  const [composerFile, setComposerFile] = useState(null);
  const [posting, setPosting] = useState(false);
  const [editingChannel, setEditingChannel] = useState(false);
  const [localAvatar, setLocalAvatar] = useState(channel.avatar_url || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileRef = useRef(null);
  const avatarFileRef = useRef(null);
  const isAdmin = membership?.role === 'admin';

  async function handleAvatarUpload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setAvatarUploading(true);
    try {
      const compressed = await new Promise(resolve => {
        const img = new Image(); const url = URL.createObjectURL(f);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const s = 256; const canvas = document.createElement('canvas');
          canvas.width = s; canvas.height = s;
          const ctx = canvas.getContext('2d');
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0, 0, s, s);
          canvas.toBlob(b => resolve(b || f), 'image/jpeg', 0.9);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(f); };
        img.src = url;
      });
      const path = `channel_${channel.id}_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('channels').update({ avatar_url: data.publicUrl }).eq('id', channel.id);
      setLocalAvatar(data.publicUrl);
      channel.avatar_url = data.publicUrl;
      notificationService.showNotification('Аватарка обновлена', '', 'success');
    } catch (err) {
      notificationService.showNotification('Ошибка', err.message, 'error');
    }
    setAvatarUploading(false);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [p, m, cnt] = await Promise.all([
        channelsService.getPosts(channel.id),
        currentUser?.id ? channelsService.getMembership(channel.id, currentUser.id) : null,
        channelsService.getSubscriberCount(channel.id),
      ]);
      const postIds = p.map(x => x.id);
      const liked = currentUser?.id && postIds.length ? await channelsService.getLikedPostIds(currentUser.id, postIds) : new Set();
      setPosts(p.map(x => ({ ...x, _liked: liked.has(x.id) })));
      setMembership(m);
      setSubCount(cnt);
      setLoading(false);
    })();
  }, [channel.id, currentUser?.id]);

  async function handleSubscribe() {
    if (!currentUser || subLoading) return;
    setSubLoading(true);
    if (membership) {
      await channelsService.unsubscribe(channel.id, currentUser.id);
      setMembership(null);
      setSubCount(c => c - 1);
    } else {
      await channelsService.subscribe(channel.id, currentUser.id);
      setMembership({ role: 'member' });
      setSubCount(c => c + 1);
    }
    setSubLoading(false);
  }

  async function handlePost(e) {
    e.preventDefault();
    if (!composerText.trim() && !composerFile) return;
    setPosting(true);
    let mediaUrl = null;
    if (composerFile) {
      try { mediaUrl = await postsService.uploadPostImage(composerFile, currentUser.id); } catch {}
    }
    const res = await channelsService.createPost(channel.id, currentUser.id, composerText, mediaUrl);
    if (res.success) {
      const newPost = { ...res.post, author: { id: currentUser.id, name: currentUser.name, username: currentUser.username, avatar_url: currentUser.avatar_url }, _likeCount: 0, _commentCount: 0, _liked: false };
      setPosts(prev => [newPost, ...prev]);
      setComposerText('');
      setComposerFile(null);
    }
    setPosting(false);
  }

  return (
    <div>
      {/* Channel header */}
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: 100, background: 'linear-gradient(135deg,#1e1b4b,#312e81)', position: 'relative' }}>
          {isAdmin && (
            <button onClick={() => setEditingChannel(true)}
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
              Настройки
            </button>
          )}
        </div>
        <div style={{ padding: '0 16px 16px', position: 'relative' }}>
          <div style={{ marginTop: -24, marginBottom: 10 }}>
            <div style={{ position: 'relative', display: 'inline-block', cursor: isAdmin ? 'pointer' : undefined }}
              onClick={() => isAdmin && avatarFileRef.current?.click()}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: localAvatar ? undefined : 'linear-gradient(135deg,#6366f1,#8b5cf6)', backgroundImage: localAvatar ? `url(${localAvatar})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', border: '3px solid #0b0b0b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 22 }}>
                {!localAvatar && (avatarUploading ? '…' : channel.name?.[0]?.toUpperCase())}
              </div>
              {isAdmin && (
                <div style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%', background: '#a78bfa', border: '2px solid #0b0b0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                  {avatarUploading ? '…' : '✎'}
                </div>
              )}
            </div>
            <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{channel.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>@{channel.username}</div>
              {channel.description && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 6, lineHeight: 1.5 }}>{channel.description}</div>}
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>{subCount} подписчиков</div>
            </div>
            {currentUser && membership?.role !== 'admin' && (
              <button onClick={handleSubscribe} disabled={subLoading}
                style={{ padding: '8px 16px', borderRadius: 12, border: membership ? '1px solid rgba(255,255,255,0.2)' : 'none', background: membership ? 'transparent' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                {subLoading ? '...' : membership ? 'Отписаться' : 'Подписаться'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Composer for admins */}
      {isAdmin && (
        <form onSubmit={handlePost} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea value={composerText} onChange={e => setComposerText(e.target.value)} placeholder="Новая публикация в канале..."
            rows={3} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: 'white', fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit' }} />
          {composerFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              <span>📎 {composerFile.name}</span>
              <button type="button" onClick={() => setComposerFile(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, fontSize: 14 }}>✕</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => fileRef.current?.click()}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '7px 12px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13 }}>
              📷 Фото
            </button>
            <button type="submit" disabled={posting || (!composerText.trim() && !composerFile)}
              style={{ flex: 1, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: 10, padding: '7px', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: posting ? 0.6 : 1 }}>
              {posting ? 'Публикация...' : 'Опубликовать'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { setComposerFile(e.target.files?.[0] || null); e.target.value = ''; }} />
        </form>
      )}

      {/* Posts */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.3)' }}>Загрузка...</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
          {isAdmin ? 'Опубликуй первый пост в канале' : 'Публикаций пока нет'}
        </div>
      ) : (
        posts.map(p => <ChannelPostCard key={p.id} post={p} currentUser={currentUser} isAdmin={isAdmin} onUserClick={onUserClick}
          onLike={(id, liked, delta) => setPosts(prev => prev.map(x => x.id === id ? { ...x, _liked: liked, _likeCount: x._likeCount + delta } : x))}
          onDelete={(id) => setPosts(prev => prev.filter(x => x.id !== id))} />)
      )}

      {editingChannel && (
        <ChannelSettingsModal channel={channel} currentUser={currentUser}
          onClose={() => setEditingChannel(false)}
          onUpdated={(updates) => Object.assign(channel, updates)} />
      )}
    </div>
  );
}

function ChannelPostCard({ post, currentUser, isAdmin, onLike, onDelete, onUserClick }) {
  const [liked, setLiked] = useState(post._liked || false);
  const [likeCount, setLikeCount] = useState(post._likeCount || 0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [likeAnim, setLikeAnim] = useState(false);

  async function handleLike() {
    if (!currentUser) return;
    const prev = liked;
    setLiked(!prev); setLikeCount(c => prev ? c - 1 : c + 1);
    if (!prev) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 400); }
    const res = await channelsService.toggleLike(post.id, currentUser.id);
    onLike?.(post.id, res.liked, res.liked ? 1 : -1);
  }

  async function openComments() {
    if (!commentsLoaded) { const data = await channelsService.getComments(post.id); setComments(data); setCommentsLoaded(true); }
    setCommentsOpen(o => !o);
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!commentText.trim() || !currentUser) return;
    const res = await channelsService.addComment(post.id, currentUser.id, commentText);
    if (res.success) {
      setComments(prev => [...prev, { ...res.comment, user: { id: currentUser.id, name: currentUser.name, username: currentUser.username, avatar_url: currentUser.avatar_url } }]);
      setCommentText('');
    }
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onUserClick ? 'pointer' : undefined }} onClick={() => onUserClick?.(post.author)}>
            <Avatar url={post.author?.avatar_url} name={post.author?.name} size={34} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{post.author?.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{new Date(post.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          {(isAdmin || currentUser?.id === post.author_id) && (
            <button onClick={async () => { if (await showConfirm('Удалить публикацию?')) { await channelsService.deletePost(post.id); onDelete?.(post.id); } }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,100,100,0.5)', cursor: 'pointer', padding: 4, fontSize: 14 }}>✕</button>
          )}
        </div>
        {post.content && <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)', marginBottom: post.media_url ? 10 : 0 }}>{post.content}</div>}
        {post.media_url && <img src={post.media_url} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 400, objectFit: 'cover', display: 'block', marginTop: 8 }} />}
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button onClick={handleLike} className={likeAnim ? 'heart-pop' : ''}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', color: liked ? '#ef4444' : 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: '5px 8px', borderRadius: 8, fontSize: 13 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'}><path d="M12 21s-7-4.4-9.3-9A5.7 5.7 0 0 1 12 6a5.7 5.7 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          {likeCount}
        </button>
        <button onClick={openComments}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: '5px 8px', borderRadius: 8, fontSize: 13 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          {post._commentCount || (commentsLoaded ? comments.length : 0)}
        </button>
      </div>
      {commentsOpen && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8 }}>
              <Avatar url={c.user?.avatar_url} name={c.user?.name} size={26} />
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '6px 10px', flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>{c.user?.name}</div>
                <div style={{ fontSize: 13 }}>{c.content}</div>
              </div>
            </div>
          ))}
          {currentUser && (
            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Комментарий..."
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '7px 12px', color: 'white', fontSize: 13, outline: 'none' }} />
              <button type="submit" style={{ background: 'rgba(99,102,241,0.7)', border: 'none', borderRadius: 10, padding: '7px 12px', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>→</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function ChannelSettingsModal({ channel, currentUser, onClose, onUpdated }) {
  const [name, setName] = useState(channel.name || '');
  const [desc, setDesc] = useState(channel.description || '');
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [localAvatar, setLocalAvatar] = useState(channel.avatar_url || '');
  const [error, setError] = useState('');
  const avatarFileRef = useRef(null);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setAvatarUploading(true);
    try {
      const compressed = await new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          const s = Math.min(img.width, img.height);
          const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
          ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
          canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.9);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      });
      const path = `channel_${channel.id}_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('channels').update({ avatar_url: data.publicUrl }).eq('id', channel.id);
      setLocalAvatar(data.publicUrl);
      onUpdated?.({ avatar_url: data.publicUrl });
      notificationService.showNotification('Аватарка обновлена', '', 'success');
    } catch (err) {
      notificationService.showNotification('Ошибка', err.message, 'error');
    }
    setAvatarUploading(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const res = await channelsService.update(channel.id, { name: name.trim(), description: desc.trim() });
    setSaving(false);
    if (res.success) { onUpdated?.({ name: name.trim(), description: desc.trim() }); onClose(); }
    else setError(res.error);
  }

  const inp = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', color: 'white', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a2e', borderRadius: '20px 20px 0 0', padding: 24, width: '100%', maxWidth: 480, paddingBottom: 'calc(24px + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 18 }}>Настройки канала</div>

        {/* Avatar upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => avatarFileRef.current?.click()}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: localAvatar ? undefined : 'linear-gradient(135deg,#6366f1,#8b5cf6)', backgroundImage: localAvatar ? `url(${localAvatar})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 24 }}>
              {!localAvatar && channel.name?.[0]?.toUpperCase()}
            </div>
            <div style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: '50%', background: '#a78bfa', border: '2px solid #1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
              {avatarUploading ? '…' : '✎'}
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>Нажми на аватарку,<br/>чтобы сменить фото</div>
          <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Название" style={inp} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Описание" rows={2} style={{ ...inp, resize: 'none' }} />
          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" disabled={saving} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 12, padding: '11px', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              {saving ? '...' : 'Сохранить'}
            </button>
            <button type="button" onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '11px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 }}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GlobalFeed({
  currentUser,
  onShareClick,
  onUserClick,
  onDelete,
  onNotify,
  onMentionClick,
}) {
  const PAGE = 20
  const [tab, setTab] = useState("all");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [followingIds, setFollowingIds] = useState([])
  const sentinelRef = useRef(null)

  const [blockedIds, setBlockedIds] = useState(new Set())

  useEffect(() => {
    if (currentUser?.id) {
      followsService.getFollowing(currentUser.id).then(list => setFollowingIds(list.map(u => u.id)))
      blocksService.getBlockedIds(currentUser.id).then(ids => setBlockedIds(new Set(ids)))
    }
  }, [currentUser?.id])

  const loadPosts = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setPosts([]); setOffset(0); setHasMore(true) }
    else setLoadingMore(true)
    const off = reset ? 0 : offset
    let batch;
    if (tab === "following" && currentUser?.id) {
      batch = await followsService.getFollowingPosts(currentUser.id, PAGE, off);
    } else {
      batch = await postsService.getAllPosts(PAGE, off);
    }
    const filtered = batch.filter(p => !blockedIds.has(p.author_id))
    const postIds = filtered.map(p => p.id)
    const [likedSet, repostedSet, ...likeCounts] = postIds.length ? await Promise.all([
      postsService.getLikedPostIds(currentUser?.id, postIds),
      postsService.getRepostedPostIds(currentUser?.id, postIds),
      ...filtered.map(p => postsService.getLikeCount(p.id)),
    ]) : [new Set(), new Set()];
    const enriched = filtered.map((p, i) => ({
      ...p, _likeCount: likeCounts[i], _liked: likedSet.has(p.id), _reposted: repostedSet.has(p.id),
    }));
    if (reset) { setPosts(enriched); setOffset(PAGE) }
    else { setPosts(prev => [...prev, ...enriched]); setOffset(o => o + PAGE) }
    if (batch.length < PAGE) setHasMore(false)
    if (reset) setLoading(false); else setLoadingMore(false)
  }, [tab, currentUser?.id, offset, blockedIds]);

  useEffect(() => { loadPosts(true) }, [tab, currentUser?.id]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !loadingMore && hasMore) loadPosts(false) }, { threshold: 0.1 })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loadingMore, loadPosts]);

  return (
    <div>
      <StoriesBar currentUser={currentUser} followingIds={followingIds} onUserClick={onUserClick} />
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {[
          ["all", "Все"],
          ["following", "Подписки"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              background:
                tab === key ? "rgba(255,255,255,0.13)" : "transparent",
              color: tab === key ? "white" : "rgba(255,255,255,0.4)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "all" && currentUser?.id && (
        <CreatePost user={currentUser} onCreated={loadPosts} />
      )}
      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: 30,
            color: "rgba(255,255,255,0.35)",
            fontSize: 13,
          }}
        >
          Загрузка...
        </div>
      ) : posts.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 30,
            color: "rgba(255,255,255,0.25)",
            fontSize: 14,
            border: "1px dashed rgba(255,255,255,0.08)",
            borderRadius: 14,
          }}
        >
          {tab === "following"
            ? "Подпишитесь на кого-нибудь, чтобы видеть их посты"
            : "Постов пока нет. Поделитесь чем-нибудь!"}
        </div>
      ) : (
        <>
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              currentUser={currentUser}
              onShareClick={onShareClick}
              onUserClick={onUserClick}
              onDelete={onDelete}
              onNotify={onNotify}
              onMentionClick={onMentionClick}
              onReposted={() => loadPosts(true)}
            />
          ))}
          <div ref={sentinelRef} style={{ height: 20 }} />
          {loadingMore && <div style={{ textAlign: 'center', padding: 10, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Загрузка...</div>}
          {!hasMore && posts.length > 0 && <div style={{ textAlign: 'center', padding: 14, color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>Всё загружено</div>}
        </>
      )}
    </div>
  );
}
function ShareModal({ post, friends, onClose, onSend }) {
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const toggle = (id) =>
    setSelected((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );

  async function send() {
    if (!selected.length) return;
    setSending(true);
    await onSend(post, selected);
    setSending(false);
    onClose();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "min(400px,100%)",
          background: "rgba(16,16,16,0.98)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 18,
          padding: 22,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>
          Поделиться с другом
        </div>
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {friends.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
              Нет друзей для отправки
            </div>
          ) : (
            friends.map((f) => (
              <div
                key={f.id}
                onClick={() => toggle(f.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: selected.includes(f.id)
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(255,255,255,0.04)",
                  borderRadius: 12,
                  cursor: "pointer",
                  border: `1px solid ${selected.includes(f.id) ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)"}`,
                }}
              >
                <Avatar url={f.avatar_url} name={f.name} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                    @{f.username}
                  </div>
                </div>
                {selected.includes(f.id) && (
                  <span style={{ color: "#22c55e" }}>✓</span>
                )}
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "white",
              borderRadius: 10,
              padding: 10,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Отмена
          </button>
          <button
            onClick={send}
            disabled={!selected.length || sending}
            style={{
              flex: 1,
              background: selected.length
                ? "rgba(255,255,255,0.13)"
                : "rgba(255,255,255,0.04)",
              border: "none",
              color: "white",
              borderRadius: 10,
              padding: 10,
              cursor: selected.length ? "pointer" : "not-allowed",
              fontWeight: 700,
            }}
          >
            {sending ? "Отправка..." : `Отправить (${selected.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

function LinkPreview({ url }) {
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cacheKey = `lvkosp_lp_${url}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) { try { setMeta(JSON.parse(cached)) } catch {} return }

    const proxyUrl = `https://allorigins.win/get?disableCache=true&url=${encodeURIComponent(url)}`
    const _ctrl = new AbortController(); setTimeout(() => _ctrl.abort(), 5000);
    fetch(proxyUrl, { signal: _ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const html = data.contents || ''
        const getTag = (prop) => {
          const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'))
            || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))
          return m?.[1] || ''
        }
        const title = getTag('og:title') || getTag('twitter:title') || html.match(/<title[^>]*>([^<]+)/i)?.[1] || ''
        const description = getTag('og:description') || getTag('twitter:description') || ''
        const image = getTag('og:image') || getTag('twitter:image') || ''
        const favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`
        const hostname = new URL(url).hostname.replace('www.', '')
        const result = { title: title.trim(), description: description.trim(), image, favicon, hostname }
        setMeta(result)
        sessionStorage.setItem(cacheKey, JSON.stringify(result))
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [url])

  if (error || !meta || !meta.title) return null

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 6, borderLeft: '3px solid #a78bfa', borderRadius: 8, background: 'rgba(167,139,250,0.07)', padding: '8px 10px', textDecoration: 'none', color: 'inherit' }}>
      {meta.image && <img src={meta.image} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 6, marginBottom: 6, display: 'block' }} onError={e => e.target.style.display='none'} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <img src={meta.favicon} alt="" width={14} height={14} onError={e => e.target.style.display='none'} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{meta.hostname}</span>
      </div>
      {meta.title && <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{meta.title}</div>}
      {meta.description && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4, marginTop: 2 }}>{meta.description.slice(0, 100)}</div>}
    </a>
  )
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function VoicePlayer({ src, isMe }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadError, setLoadError] = useState(false);

  function toggle() {
    const a = audioRef.current;
    if (!a || loadError) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => setLoadError(true)); }
  }

  function fmt(s) {
    const t = Math.floor(s || 0);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }

  const accent = isMe ? 'rgba(255,255,255,0.9)' : '#a78bfa';
  const trackBg = isMe ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180, maxWidth: 240 }}>
      <audio ref={audioRef} src={src} preload="metadata"
        onTimeUpdate={e => { const a = e.target; setCurrentTime(a.currentTime); setProgress(a.duration ? a.currentTime / a.duration : 0); }}
        onLoadedMetadata={e => { setDuration(e.target.duration); setLoadError(false); }}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
        onError={() => setLoadError(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button onClick={toggle} title={loadError ? 'Формат не поддерживается браузером' : undefined} style={{ width: 34, height: 34, borderRadius: '50%', background: loadError ? 'rgba(239,68,68,0.5)' : accent, border: 'none', cursor: loadError ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isMe ? '#1a1a2e' : 'white' }}>
        {loadError
          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          : playing
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ position: 'relative', height: 4, borderRadius: 2, background: trackBg, cursor: 'pointer' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            if (audioRef.current?.duration) { audioRef.current.currentTime = pct * audioRef.current.duration; setProgress(pct); }
          }}>
          <div style={{ height: '100%', borderRadius: 2, background: accent, width: `${progress * 100}%`, transition: 'width 0.1s linear' }} />
        </div>
        <div style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.4)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  isMe,
  isGroup,
  searchQuery,
  onEdit,
  onDelete,
  onDeleteForAll,
  onUserClick,
  onForward,
  onReply,
  currentUserId,
  onMentionClick,
  onPin,
  isPinned,
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content || "");
  const [reactions, setReactions] = useState(msg._reactions || []);
  const [showEmoji, setShowEmoji] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const touchStartX = useRef(0);

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function onTouchMove(e) {
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx > 0 && dx < 80) setSwipeX(dx);
  }
  function onTouchEnd() {
    if (swipeX > 50) onReply?.(msg);
    setSwipeX(0);
  }

  async function saveEdit() {
    if (!editText.trim()) return;
    await onEdit(msg.id, editText.trim());
    setEditing(false);
  }

  async function toggleReaction(emoji) {
    setShowEmoji(false);
    const res = await chatService.toggleReaction(msg.id, currentUserId, emoji);
    setReactions((prev) => {
      if (res.added)
        return [...prev, { message_id: msg.id, user_id: currentUserId, emoji }];
      return prev.filter(
        (r) => !(r.user_id === currentUserId && r.emoji === emoji),
      );
    });
  }

  function highlight(text) {
    if (!searchQuery) return text;
    const parts = text.split(new RegExp(`(${searchQuery})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark
          key={i}
          style={{
            background: "rgba(250,200,50,0.4)",
            borderRadius: 3,
            color: "inherit",
            padding: "0 1px",
          }}
        >
          {p}
        </mark>
      ) : (
        p
      ),
    );
  }

  const rxGroups = reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
    acc[r.emoji].count++;
    if (r.user_id === currentUserId) acc[r.emoji].mine = true;
    return acc;
  }, {});

  return (
    <div
      className={`msgRow ${isMe ? "me" : "them"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setShowEmoji(false); }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ position: "relative", alignItems: 'flex-end', transform: swipeX ? `translateX(${swipeX}px)` : undefined, transition: swipeX ? 'none' : 'transform 0.2s ease' }}
    >
      {swipeX > 20 && (
        <div style={{ position: 'absolute', left: -32, top: '50%', transform: 'translateY(-50%)', opacity: swipeX / 80, color: 'rgba(255,255,255,0.6)', fontSize: 18, pointerEvents: 'none' }}>↩</div>
      )}
      {isGroup && !isMe && (
        <div style={{ flexShrink: 0, alignSelf: 'flex-end', marginBottom: 2, marginRight: 6, cursor: 'pointer' }}
          onClick={() => onUserClick?.(msg.sender)}>
          <Avatar url={msg.sender?.avatar_url} name={msg.sender?.name} size={28} />
        </div>
      )}
      {hover && !editing && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', [isMe ? 'right' : 'left']: 0, display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 4, zIndex: 50 }}>
          {/* Быстрые реакции */}
          {currentUserId && (
            <div style={{ background: 'rgba(22,22,22,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '4px 8px', display: 'flex', gap: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
              {QUICK_EMOJIS.map(e => (
                <button key={e} onClick={() => toggleReaction(e)}
                  style={{ background: rxGroups[e]?.mine ? 'rgba(255,255,255,0.15)' : 'none', border: 'none', cursor: 'pointer', fontSize: 17, padding: '3px 5px', borderRadius: 20, transition: 'background 0.1s' }}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {/* Действия */}
          <div style={{ background: 'rgba(22,22,22,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '3px', display: 'flex', gap: 1, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
            {onReply && (
              <button onClick={() => onReply(msg)} title="Ответить"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.65)', cursor: 'pointer', padding: '6px 8px', borderRadius: 12, display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 10H5l7-7 7 7h-4v4a7 7 0 0 1-7 7H5a9 9 0 0 0 4-7v-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>
              </button>
            )}
            {onForward && (msg.content || msg.media_url) && (
              <button onClick={() => onForward(msg)} title="Переслать"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.65)', cursor: 'pointer', padding: '6px 8px', borderRadius: 12, display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 10h4l-7-7-7 7h4v4a7 7 0 0 0 7 7h3a9 9 0 0 1-4-7v-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>
              </button>
            )}
            {isMe && (
              <button onClick={() => { setEditing(true); setEditText(msg.content || '') }} title="Изменить"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.65)', cursor: 'pointer', padding: '6px 8px', borderRadius: 12, display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
              </button>
            )}
            {isMe && (
              <button onClick={() => onDelete(msg.id)} title="Удалить у себя"
                style={{ background: 'none', border: 'none', color: 'rgba(255,100,100,0.7)', cursor: 'pointer', padding: '6px 8px', borderRadius: 12, display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
              </button>
            )}
            {isMe && onDeleteForAll && (
              <button onClick={() => onDeleteForAll(msg.id)} title="Удалить у всех"
                style={{ background: 'none', border: 'none', color: 'rgba(255,50,50,0.9)', cursor: 'pointer', padding: '6px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, letterSpacing: -0.5 }}>
                ✕↔
              </button>
            )}
            {onPin && (
              <button onClick={() => onPin(msg)} title={isPinned ? 'Открепить' : 'Закрепить'}
                style={{ background: 'none', border: 'none', color: isPinned ? '#f59e0b' : 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: '6px 8px', borderRadius: 12, display: 'flex', alignItems: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'}><path d="M12 2v10M5 9l7-7 7 7M5 15l7 9 7-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="msgBubble">
        {!isMe && isGroup && msg.sender?.name && (
          <div
            className="msgSender"
            onClick={() => onUserClick?.(msg.sender)}
            style={{ cursor: 'pointer', color: COLORS[msg.sender.name.charCodeAt(0) % COLORS.length], fontWeight: 700, fontSize: 12, marginBottom: 3 }}
          >
            {msg.sender.name}
          </div>
        )}
        {msg.reply_to && (
          <div
            style={{
              borderLeft: "2px solid rgba(255,255,255,0.3)",
              paddingLeft: 8,
              marginBottom: 6,
              opacity: 0.65,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 1 }}>
              {msg.reply_to.sender?.name}
            </div>
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 220,
              }}
            >
              {msg.reply_to.type === "image" ? "📷 Фото" : msg.reply_to.content}
            </div>
          </div>
        )}
        {msg.type === "voice" && msg.media_url ? (
          <VoicePlayer src={msg.media_url} isMe={isMe} />
        ) : msg.type === "image" && msg.media_url ? (
          <img
            src={msg.media_url}
            alt="фото"
            onClick={() => openLightbox(msg.media_url)}
            style={{
              maxWidth: 280,
              borderRadius: 10,
              display: "block",
              cursor: "zoom-in",
            }}
          />
        ) : editing ? (
          <div>
            <input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 8,
                padding: "4px 8px",
                color: "white",
                fontSize: 14,
                outline: "none",
                width: "100%",
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                onClick={saveEdit}
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  color: "white",
                  borderRadius: 6,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Сохранить
              </button>
              <button
                onClick={() => setEditing(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "rgba(255,255,255,0.45)",
                  borderRadius: 6,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <span>{renderText(safeText(msg.content), onMentionClick)}</span>
            {(msg.content?.match(URL_REGEX) || []).slice(0, 1).map(u => <LinkPreview key={u} url={u} />)}
          </>
        )}
        {Object.keys(rxGroups).length > 0 && (
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}
          >
            {Object.entries(rxGroups).map(([emoji, { count, mine }]) => (
              <button
                key={emoji}
                onClick={() => currentUserId && toggleReaction(emoji)}
                style={{
                  background: mine
                    ? "rgba(255,255,255,0.18)"
                    : "rgba(255,255,255,0.08)",
                  border: `1px solid ${mine ? "rgba(255,255,255,0.3)" : "transparent"}`,
                  borderRadius: 20,
                  padding: "2px 8px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {emoji} <span style={{ fontSize: 11 }}>{count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="message-time">
          {formatMessageTime(msg.created_at)}
          {msg.edited && <span style={{ opacity: 0.5 }}> · изм.</span>}
          {isMe && (
            <span style={{ marginLeft: 2, color: msg.read ? '#60a5fa' : 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              {msg.read ? ' ✓✓' : ' ✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const WALLPAPERS = [
  { id: '', label: 'По умолчанию', bg: '' },
  { id: 'blue', label: 'Океан', bg: 'linear-gradient(160deg,#0a1628 0%,#0d2240 50%,#102a50 100%)' },
  { id: 'purple', label: 'Сумерки', bg: 'linear-gradient(135deg,#1a0d2e 0%,#2d1a4a 100%)' },
  { id: 'green', label: 'Лес', bg: 'linear-gradient(135deg,#0a1f0a 0%,#1a3320 100%)' },
  { id: 'red', label: 'Гранат', bg: 'linear-gradient(135deg,#2a0a0a 0%,#3d1212 100%)' },
  { id: 'grey', label: 'Туман', bg: 'linear-gradient(135deg,#141414 0%,#252530 100%)' },
  { id: 'gold', label: 'Закат', bg: 'linear-gradient(135deg,#1f1600 0%,#2e2000 50%,#1a0f00 100%)' },
  { id: 'teal', label: 'Бирюза', bg: 'linear-gradient(135deg,#001f1f 0%,#003333 100%)' },
]

// ─── Main ──────────────────────────────────────────────────────────────────
export default function App() {
  // аутф
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [serverOnline, setServerOnline] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    username: "",
    password: "",
    name: "",
    bio: "",
  });
  const [registerAvatar, setRegisterAvatar] = useState(null);
  const [authError, setAuthError] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);

  // навигация
  const [activeTab, setActiveTab] = useState("chats");
  const [feedSubTab, setFeedSubTab] = useState("feed");
  const [viewingChannel, setViewingChannel] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // чаты
  const [chats, setChats] = useState([]);
  const chatsRef = useRef(chats);
  const [showArchived, setShowArchived] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const chatBodyRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordTimerRef = useRef(null);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`chat-list:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const msg = payload.new;
          if (msg.sender_id === user.id) return;
          const currentChats = chatsRef.current;
          const chatExists = currentChats.some((c) => c.id === msg.chat_id);
          const nextLastMessage =
            msg.type === 'image'
              ? '📷 Фото'
              : msg.type === 'voice'
              ? '🎤 Голос'
              : msg.content || 'Новое сообщение';
          if (chatExists) {
            setChats((prev) => {
              const updated = [...prev].map((c) =>
                c.id === msg.chat_id
                  ? { ...c, lastMessage: nextLastMessage, lastMessageTime: msg.created_at }
                  : c,
              ).sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());
              return [...updated.filter(c => c.pinned), ...updated.filter(c => !c.pinned)];
            });
            setUnreadCounts(prev => ({ ...prev, [msg.chat_id]: (prev[msg.chat_id] || 0) + 1 }));
          } else {
            const updated = await chatService.getChats(user.id);
            setChats(updated);
            // счётчик для нового чата — добавляем после загрузки
            setUnreadCounts(prev => ({ ...prev, [msg.chat_id]: (prev[msg.chat_id] || 0) + 1 }));
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_members', filter: `user_id=eq.${user.id}` },
        async () => {
          const updated = await chatService.getChats(user.id);
          setChats(updated);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // поиск по сообщениям
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState("");

  // друзья
  const [friends, setFriends] = useState([]);
  const [chatSearch, setChatSearch] = useState("");
  const [friendsSearch, setFriendsSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // профиль
  const [viewingUser, setViewingUser] = useState(null);

  // share
  const [sharePost, setSharePost] = useState(null);
  const [focusPost, setFocusPost] = useState(null);

  // далее
  const [forwardMsg, setForwardMsg] = useState(null);
  const [forwardLoading, setForwardLoading] = useState(false);

  // reply
  const [replyTo, setReplyTo] = useState(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  useEffect(() => {
    if (!emojiPickerOpen) return;
    const handler = (e) => { if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) setEmojiPickerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiPickerOpen]);

  // обои чатов
  const [wallpaperPickerOpen, setWallpaperPickerOpen] = useState(false)
  const chatWallpaper = useMemo(() => {
    if (!activeChatId) return ''
    return localStorage.getItem(`lvkosp_wp_${activeChatId}`) || ''
  }, [activeChatId, wallpaperPickerOpen])

  // закреп и архив
  const [pinnedMsg, setPinnedMsg] = useState(null)

  // увед
  const [dbNotifs, setDbNotifs] = useState([]);
  const [dbNotifsUnread, setDbNotifsUnread] = useState(0);

  // друзья — табы и заявки
  const [friendsTab, setFriendsTab] = useState("friends");
  const [pendingRequests, setPendingRequests] = useState([]);

  // realtime
  const { typingNames, sendTyping } = useTyping(
    activeChatId,
    user?.id,
    user?.name,
  );
  const [unreadCounts, setUnreadCounts] = useState({});
  const resetUnread = useCallback((chatId) => setUnreadCounts(prev => ({ ...prev, [chatId]: 0 })), []);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) || null,
    [chats, activeChatId],
  );
  const totalUnread = useMemo(
    () => chats.reduce((a, c) => a + (unreadCounts[c.id] || 0), 0),
    [unreadCounts, chats],
  );

  const displayMessages = useMemo(() => {
    if (!msgSearchQuery.trim()) return messages;
    const q = msgSearchQuery.toLowerCase();
    return messages.filter((m) => (m.content || "").toLowerCase().includes(q));
  }, [messages, msgSearchQuery]);

  // инит
  useEffect(() => {
    supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1)
      .then(({ error }) => {
        if (!error) { setServerOnline(true); return; }
        // RLS/permission error = сервер работает, просто нет доступа без авторизации
        const msg = (error.message || '').toLowerCase();
        const isNetworkDown = msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('err_') || msg.includes('terminated');
        setServerOnline(!isNetworkDown);
      })
      .catch(() => setServerOnline(false));
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await authService.getCurrentUser();
      if (!mounted) return;
      if (res.success) {
        setUser(res.user);
        setAuthModalOpen(false);
        pushService.subscribe(res.user.id);
      } else {
        setUser(null);
        setAuthModalOpen(true);
      }
      setAuthChecked(true);
    })();

    const onInvalidated = () => {
      setUser(null);
      setAuthModalOpen(true);
      setChats([]);
      setMessages([]);
      setFriends([]);
      setPendingRequests([]);
    };
    window.addEventListener("auth:invalidated", onInvalidated);

    return () => {
      mounted = false;
      chatService.unsubscribeFromAll();
      window.removeEventListener("auth:invalidated", onInvalidated);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const setOnline = () => supabase.from('profiles').update({ status: 'online', last_seen: new Date().toISOString() }).eq('id', user.id)
    const setOffline = () => supabase.from('profiles').update({ status: 'offline', last_seen: new Date().toISOString() }).eq('id', user.id)
    setOnline()
    const heartbeat = setInterval(() => supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id), 60_000)
    const onHide = () => { if (document.visibilityState === 'hidden') setOffline(); else setOnline() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', setOffline)
    return () => {
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', setOffline)
      setOffline()
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const [ch, fr, reqs] = await Promise.all([
        chatService.getChats(user.id),
        followsService.getMutualFollows(user.id),
        followsService.getOneWayFollowers(user.id),
      ]);
      setChats(ch);
      setFriends(fr);
      setPendingRequests(reqs);
    })();
    const t = setInterval(() => authService.updateOnlineStatus(user.id), 60000);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/LVKOSP-JSX/sw.js').catch(() => {})
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    notificationsService.getUnread(user.id).then(setDbNotifs);
    notificationsService.getUnreadCount(user.id).then(setDbNotifsUnread);

    const notifSub = supabase.channel(`notifs:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        setDbNotifsUnread(n => n + 1)
      }).subscribe()

    const poll = setInterval(async () => {
      const [newFriends, newReqs, count] = await Promise.all([
        followsService.getMutualFollows(user.id),
        followsService.getOneWayFollowers(user.id),
        notificationsService.getUnreadCount(user.id),
      ]);
      setFriends((prev) => {
        if (prev.length > 0 && newFriends.length > prev.length) {
          notificationService.showNotification(
            "Ура!",
            "У вас новый друг!",
            "success",
          );
        }
        return newFriends;
      });
      setPendingRequests((prev) => {
        if (newReqs.length > prev.length) {
          notificationService.showNotification(
            "Подписчики",
            "На вас подписались!",
            "success",
          );
        }
        return newReqs;
      });
      setDbNotifsUnread(count);
    }, 15000);
    return () => {
      clearInterval(t);
      clearInterval(poll);
      supabase.removeChannel(notifSub);
    };
  }, [user?.id]);

  // загрузка сообщений при смене чата
  useEffect(() => {
    if (!user?.id || !activeChatId) return;
    let alive = true;
    setMessages([]);
    setMsgSearchQuery("");
    setMsgSearchOpen(false);
    setReplyTo(null);
    setPinnedMsg(null);
    setEmojiPickerOpen(false);
    (async () => {
      const [msgs, pinned] = await Promise.all([
        chatService.getMessages(activeChatId, user.id),
        chatService.getPinnedMessage(activeChatId).catch(() => null),
      ]);
      if (!alive) return;
      setMessages(msgs);
      setPinnedMsg(pinned);
      resetUnread(activeChatId);
      chatService.markAsRead(activeChatId, user.id);
      scrollToBottom();
    })();

    chatService.subscribeToMessages(
      activeChatId,
      (newMsg) => {
        setMessages((prev) =>
          prev.find((m) => m.id === newMsg.id) ? prev : [...prev, newMsg],
        );
        if (newMsg.sender_id !== user.id) { resetUnread(activeChatId); chatService.markAsRead(activeChatId, user.id); }
        scrollToBottom();
      },
      (deletedMsgId) => {
        setMessages((prev) => prev.filter((m) => m.id !== deletedMsgId));
      },
      (updatedMsg) => {
        setMessages((prev) => prev.map((m) => m.id === updatedMsg.id ? { ...m, read: updatedMsg.read, edited: updatedMsg.edited, content: updatedMsg.content } : m));
      }
    );

    return () => {
      alive = false;
      chatService.unsubscribeFromMessages(activeChatId);
    };
  }, [user?.id, activeChatId]);

  // поиск пользователей
  useEffect(() => {
    if (!user?.id || activeTab !== "friends") return;
    const q = friendsSearch.trim();
    let cancelled = false;
    (async () => {
      if (q.length < 2) {
        setSearchResults([]);
        return;
      }
      const res = await friendsService.searchUsers(q, user.id);
      if (!cancelled) setSearchResults(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [friendsSearch, activeTab, user?.id]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (chatBodyRef.current) {
        chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight + 9999;
      }
    });
  }

  async function handleSend() {
    if (!user?.id || !activeChatId || !messageText.trim()) return;
    const text = messageText.trim();
    const replyId = replyTo?.id || null;
    const replySnap = replyTo ? { ...replyTo } : null;
    setMessageText("");
    setReplyTo(null);
    clearTimeout(typingTimeoutRef.current);
    const res = await chatService.sendMessage(
      activeChatId,
      user.id,
      text,
      replyId,
    );
    if (!res.success) {
      notificationService.showNotification(
        "Ошибка",
        res.error || "Не удалось отправить",
        "error",
      );
      return;
    }
    setMessages((prev) =>
      prev.find((m) => m.id === res.message.id)
        ? prev
        : [
            ...prev,
            {
              ...res.message,
              reply_to: replySnap,
              _reactions: [],
              sender: {
                id: user.id,
                name: user.name,
                username: user.username,
                avatar_url: user.avatar_url || "",
              },
            },
          ],
    );
    scrollToBottom();
  }

  function handleTextInput(val) {
    setMessageText(val);
    if (!activeChatId) return;
    sendTyping();
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {}, 3000);
  }

  async function handleSendImage(file) {
    if (!file || !activeChatId) return;
    try {
      const res = await chatService.sendImage(activeChatId, user.id, file);
      if (!res.success) {
        notificationService.showNotification(
          "Ошибка",
          res.error || "Не удалось отправить фото",
          "error",
        );
        return;
      }
      setMessages((prev) =>
        prev.find((m) => m.id === res.message.id)
          ? prev
          : [
              ...prev,
              {
                ...res.message,
                sender: {
                  id: user.id,
                  name: user.name,
                  username: user.username,
                  avatar_url: user.avatar_url || "",
                },
              },
            ],
      );
      scrollToBottom();
    } catch (e) {
      notificationService.showNotification(
        "Ошибка",
        e?.message || "Не удалось отправить фото",
        "error",
      );
    }
  }

  async function startRecording() {
    if (!activeChatId) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // mp4 — самый совместимый (Safari + Chrome + Android), webm — fallback
      const preferredType = [
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].find(t => MediaRecorder.isTypeSupported(t)) || ''
      const mr = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const mimeType = mr.mimeType || preferredType || 'audio/webm'
        const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType })
        try {
          const res = await chatService.sendVoice(activeChatId, user.id, file)
          if (res.success) {
            setMessages(prev => prev.find(m => m.id === res.message.id) ? prev : [...prev, { ...res.message, sender: { id: user.id, name: user.name, avatar_url: user.avatar_url || '' } }])
            scrollToBottom()
          } else {
            notificationService.showNotification('Ошибка', res.error || 'Не удалось отправить голосовое', 'error')
          }
        } catch (e) {
          notificationService.showNotification('Ошибка', 'Не удалось отправить голосовое', 'error')
        }
      }
      mr.start(250)
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecordingTime(0)
      recordTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch {
      notificationService.showNotification('Ошибка', 'Нет доступа к микрофону', 'error')
    }
  }

  async function handlePinMessage(msg) {
    const isPinned = pinnedMsg?.id === msg.id
    if (isPinned) {
      await chatService.unpinMessage(activeChatId)
      setPinnedMsg(null)
    } else {
      await chatService.pinMessage(activeChatId, msg.id)
      setPinnedMsg({ id: msg.id, content: msg.content, type: msg.type, sender: msg.sender })
    }
  }

  function stopRecording(send = true) {
    clearInterval(recordTimerRef.current)
    setRecording(false)
    setRecordingTime(0)
    if (mediaRecorderRef.current?.state !== 'inactive') {
      if (!send) {
        mediaRecorderRef.current.onstop = () => {}
        audioChunksRef.current = []
      }
      mediaRecorderRef.current.stop()
    }
  }

  async function handleEditMessage(msgId, newContent) {
    const res = await chatService.editMessage(msgId, newContent);
    if (res.success)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: newContent, edited: true } : m,
        ),
      );
    else
      notificationService.showNotification(
        "Ошибка",
        "Не удалось изменить сообщение",
        "error",
      );
  }

  async function handleDeleteMessage(msgId) {
    const res = await chatService.deleteMessage(msgId);
    if (res.success) setMessages((prev) => prev.filter((m) => m.id !== msgId));
    else notificationService.showNotification("Ошибка", "Не удалось удалить сообщение", "error");
  }

  async function handleDeleteForAll(msgId) {
    if (!await showConfirm("Удалить сообщение у всех участников чата?", "Удалить сообщение")) return;
    const res = await chatService.deleteForEveryone(msgId);
    if (res.success) setMessages((prev) => prev.filter((m) => m.id !== msgId));
    else notificationService.showNotification("Ошибка", "Не удалось удалить", "error");
  }

  async function handleDeleteChat(chatId) {
    if (!await showConfirm("Все сообщения исчезнут у обоих участников. Это нельзя отменить.", "Удалить переписку?"))
      return;
    const res = await chatService.deleteChat(chatId);
    if (!res.success) {
      notificationService.showNotification("Ошибка", res.error, "error");
      return;
    }
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChatId === chatId) {
      setActiveChatId(null);
      setMessages([]);
    }
  }

  async function handleMentionClick(username) {
    const profile = await authService.getByUsername(username);
    if (profile) openProfile(profile);
  }

  function openProfile(userData) {
    if (!userData?.id) return;
    if (userData.id === user?.id) setViewingUser(null);
    else setViewingUser(userData);
    setActiveTab("profile");
    setSidebarOpen(false);
  }

  async function startChatWith(targetUser) {
    try {
      const chatId = await chatService.createChat(user.id, targetUser.id);
      const updated = await chatService.getChats(user.id);
      setChats(updated);
      setActiveChatId(chatId);
      setActiveTab("chats");
      setSidebarOpen(false);
    } catch (e) {
      notificationService.showNotification(
        "Ошибка",
        e?.message || "Не удалось создать чат",
        "error",
      );
    }
  }

  async function sendFriendRequest(targetId) {
    const res = await followsService.follow(user.id, targetId);
    if (!res.success) {
      notificationService.showNotification("Ошибка", res.error, "error");
      return;
    }
    notificationsService.create(targetId, "follow", user.id);
    notificationService.showNotification(
      "Успешно",
      "Вы подписались!",
      "success",
    );
    setFriends(await followsService.getMutualFollows(user.id));
  }

  async function acceptRequest(requesterId) {
    const res = await followsService.follow(user.id, requesterId);
    if (!res.success) {
      notificationService.showNotification("Ошибка", res.error, "error");
      return;
    }
    const [fr, reqs] = await Promise.all([
      followsService.getMutualFollows(user.id),
      followsService.getOneWayFollowers(user.id),
    ]);
    setFriends(fr);
    setPendingRequests(reqs);
    notificationService.showNotification(
      "Ура!",
      "Вы теперь друзья!",
      "success",
    );
  }

  async function declineRequest(requesterId) {
    await followsService.removeFollower(user.id, requesterId);
    setPendingRequests(await followsService.getOneWayFollowers(user.id));
  }

  async function removeFriend(friendId) {
    const res = await followsService.unfollow(user.id, friendId);
    if (!res.success) {
      notificationService.showNotification("Ошибка", res.error, "error");
      return;
    }
    setFriends(await followsService.getMutualFollows(user.id));
    notificationService.showNotification("Успешно", "Вы отписались", "success");
  }

  const isFriend = (uid) => friends.some((f) => f.id === uid);

  async function handleSharePost(post, friendIds) {
    for (const fid of friendIds) {
      try {
        const chatId = await chatService.createChat(user.id, fid);
        const text = `📎 @${post.author?.username || "unknown"} написал:\n"${(post.content || "").slice(0, 100)}${(post.content?.length || 0) > 100 ? "..." : ""}"${post.media_url ? "\n[фото]" : ""}`;
        await chatService.sendMessage(chatId, user.id, text);
      } catch {}
    }
    notificationService.showNotification(
      "Отправлено!",
      `Пост отправлен ${friendIds.length} друг(у)`,
      "success",
    );
  }

  async function doLogin(e) {
    e.preventDefault();
    setAuthError("");
    const res = await authService.signIn(
      loginForm.username,
      loginForm.password,
    );
    if (!res.success) {
      setAuthError(res.error || "Ошибка входа");
      return;
    }
    setUser(res.user);
    setAuthModalOpen(false);
    pushService.subscribe(res.user.id);
    notificationService.showNotification(
      "Добро пожаловать",
      `Привет, ${res.user.name}!`,
      "success",
    );
  }

  async function doRegister(e) {
    e.preventDefault();
    setAuthError("");
    setRegisterLoading(true);
    const res = await authService.signUp(
      registerForm.username,
      registerForm.password,
      registerForm.name,
      registerAvatar,
      registerForm.bio,
    );
    setRegisterLoading(false);
    if (!res.success) {
      setAuthError(res.error || "Ошибка регистрации");
      return;
    }
    setUser(res.user);
    setAuthModalOpen(false);
    pushService.subscribe(res.user.id);
    notificationService.showNotification(
      "Готово!",
      `Добро пожаловать, ${res.user.name}!`,
      "success",
    );
  }

  async function doLogout() {
    if (user?.id) {
      await supabase.from('profiles').update({ status: 'offline', last_seen: new Date().toISOString() }).eq('id', user.id)
      pushService.unsubscribe(user.id)
    }
    await authService.signOut();
    setUser(null);
    setChats([]);
    setMessages([]);
    setFriends([]);
    setSearchResults([]);
    setActiveChatId(null);
    setViewingUser(null);
    setPendingRequests([]);
    setAuthModalOpen(true);
  }

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    const base = chats.filter(c => showArchived ? c.archived : !c.archived)
    if (!q || activeTab !== "chats") return base;
    return base.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.lastMessage || "").toLowerCase().includes(q),
    );
  }, [chats, chatSearch, activeTab, showArchived]);

  const profileUser = viewingUser || user;

  useEffect(() => {
    if (activeTab === "chats") {
      setChatSearch("");
      if (user?.id && chats.length === 0) {
        chatService.getChats(user.id).then(setChats).catch(() => {});
      }
    }
    if (activeTab === "friends") {
      setFriendsSearch("");
    }
  }, [activeTab, user?.id, chats.length]);

  if (!authChecked)
    return <LoadingScreen onRetry={() => { setAuthChecked(false); authService.getCurrentUser().then(res => { if (res.success) { setUser(res.user); setAuthModalOpen(false); } else { setUser(null); setAuthModalOpen(true); } setAuthChecked(true); }) }} />;

  return (
    <>
      <ConfirmDialog />
      <ImageLightbox />
      {!serverOnline && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#dc2626', color: 'white', textAlign: 'center', fontSize: 13, padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span>⚠️</span>
          <span>Сервер недоступен — функции могут не работать. Проверьте соединение.</span>
          <button onClick={() => {
            supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1)
              .then(({ error }) => { setServerOnline(!error); })
              .catch(() => {});
          }} style={{ marginLeft: 8, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 4, color: 'white', padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>Повторить</button>
        </div>
      )}
      <div
        id="notificationContainer"
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 300,
        }}
      />

      {sharePost && (
        <ShareModal
          post={sharePost}
          friends={friends}
          onClose={() => setSharePost(null)}
          onSend={handleSharePost}
        />
      )}

      {focusPost && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.8)', overflowY: 'auto', padding: '20px 0 40px' }}
          onClick={() => setFocusPost(null)}>
          <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '0 4px' }}>
              <button onClick={() => setFocusPost(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>←</button>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Пост</span>
            </div>
            <PostCard
              post={focusPost}
              currentUser={user}
              onShareClick={setSharePost}
              onUserClick={(u) => { setFocusPost(null); openProfile(u); }}
              onDelete={() => setFocusPost(null)}
              onNotify={(type, toId, entityId, preview) => notificationsService.create(toId, type, user?.id, entityId, preview)}
              onMentionClick={(u) => { setFocusPost(null); openProfile(u); }}
            />
          </div>
        </div>
      )}

      <div
        className="app"
        style={{ display: user ? "grid" : "block", minHeight: "100vh" }}
      >
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Меню"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div
          className="sidebar-overlay"
          style={{ display: sidebarOpen ? "block" : "none" }}
          onClick={() => setSidebarOpen(false)}
        />

        {/* ════ SIDEBAR ════ */}
        <aside
          className="sidebar"
          style={{ transform: sidebarOpen ? "translateX(0)" : undefined }}
        >
          <div className="brand">
            <div className="brand__title">LVKOSP MESSENGER</div>
          </div>

          <div className="search">
            <div className="search__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M10.5 18.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M16.5 16.5 21 21"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <input
              className="search__input"
              type="search"
              placeholder="Поиск..."
              autoComplete="off"
              value={activeTab === "friends" ? friendsSearch : chatSearch}
              onChange={(e) => {
                if (activeTab === "friends") setFriendsSearch(e.target.value);
                else setChatSearch(e.target.value);
              }}
            />
          </div>

          <nav className="tabs">
            <button className={`tab ${activeTab === "profile" ? "is-active" : ""}`} type="button"
              onClick={() => { setActiveTab("profile"); setViewingUser(null); setSidebarOpen(false) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" /></svg></span>
              <span className="tab__label">Профиль</span>
            </button>
            <button className={`tab ${activeTab === "explore" ? "is-active" : ""}`} type="button"
              onClick={() => { setActiveTab("explore"); setSidebarOpen(false) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.6"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span>
              <span className="tab__label">Поиск</span>
            </button>
            <button className={`tab ${activeTab === "chats" ? "is-active" : ""}`} type="button"
              onClick={() => { setActiveTab("chats"); setActiveChatId(null); setSidebarOpen(false) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M7.5 18.5H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3h-5.2l-3.6 2.6a.9.9 0 0 1-1.4-.7v-1.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></span>
              <span className="tab__label">Чаты</span>
              {totalUnread > 0 && <span className="notification-badge">{totalUnread > 99 ? "99+" : totalUnread}</span>}
            </button>
            <button className={`tab ${activeTab === "friends" ? "is-active" : ""}`} type="button"
              onClick={() => { setActiveTab("friends"); setSidebarOpen(false) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>
              <span className="tab__label">Друзья</span>
              {pendingRequests.length > 0 && <span className="notification-badge">{pendingRequests.length}</span>}
            </button>
            <button className={`tab ${activeTab === "feed" ? "is-active" : ""}`} type="button"
              onClick={() => { setActiveTab("feed"); setSidebarOpen(false) }}>
              <span className="tab__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="10.5" width="18" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="17" width="11" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.6"/></svg></span>
              <span className="tab__label">Лента</span>
            </button>
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 4px' }}>
            <div className="sectionTitle" style={{ margin: 0 }}>Частые</div>
          </div>

          <div className="dmList">
            {chats.filter(c => !c.archived).slice(0, 5).length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
                Чатов пока нет
              </div>
            ) : (
              chats.filter(c => !c.archived).slice(0, 5).map((chat) => {
                const unread = unreadCounts[chat.id] || 0;
                return (
                  <div
                    key={chat.id}
                    className={`dmItem ${chat.id === activeChatId ? "is-active" : ""}`}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setActiveTab("chats");
                      setSidebarOpen(false);
                    }}
                  >
                    <div style={{ position: "relative" }}>
                      <Avatar url={chat.avatarUrl} name={chat.name} size={44} />
                      {chat.isGroup
                        ? <div style={{ position: 'absolute', bottom: -2, right: -2, background: '#7c3aed', borderRadius: '50%', width: 16, height: 16, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #0b0b0b' }}>👥</div>
                        : <div className={chat.status === "online" ? "online-status" : "offline-status"} />
                      }
                    </div>
                    <div className="dmMeta">
                      <div className="dmName">{safeText(chat.name)}{chat.isGroup && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginLeft: 5 }}>{chat.memberCount} чел.</span>}</div>
                      <div className="dmSnippet">{safeText(chat.lastMessage || "Нет сообщений")}</div>
                    </div>
                    <div className="dmRight">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {chat.pinned && <span style={{ fontSize: 12, color: '#f59e0b' }}>📌</span>}
                        <div className="dmTime">{formatTime(chat.lastMessageTime)}</div>
                      </div>
                      {unread > 0 && (
                        <div style={{ background: "#ef4444", color: "white", borderRadius: 10, fontSize: 10, fontWeight: 800, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>
                          {unread > 99 ? "99+" : unread}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Me card */}
          <div className="meCard">
            <div style={{ position: "relative", flexShrink: 0, cursor: 'pointer' }}
              onClick={() => { setActiveTab('profile'); setViewingUser(null); setSidebarOpen(false) }}>
              <Avatar url={user?.avatar_url} name={user?.name} size={40} />
              <div className="online-status" />
            </div>
            <div className="meCard__meta" style={{ cursor: 'pointer' }}
              onClick={() => { setActiveTab('profile'); setViewingUser(null); setSidebarOpen(false) }}>
              <div className="meCard__name">{user?.name || "User"}</div>
              <div className="meCard__user">@{user?.username || "user"}</div>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconBtn" type="button" title="Уведомления"
                style={{ position: 'relative', color: activeTab === 'notifs' ? 'white' : undefined }}
                onClick={async () => { setActiveTab("notifs"); setSidebarOpen(false); const n = await notificationsService.getUnread(user.id); setDbNotifs(n); notificationsService.markAllRead(user.id); setDbNotifsUnread(0) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                {dbNotifsUnread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: '#ef4444', border: '1.5px solid #0b0b0b' }} />}
              </button>
              <button className="iconBtn" type="button" title="Настройки"
                style={{ color: activeTab === 'settings' ? 'white' : undefined }}
                onClick={() => { setActiveTab("settings"); setSidebarOpen(false) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>
        </aside>

        {/* ════ MAIN ════ */}
        <main
          className="main"
          onClick={() => sidebarOpen && setSidebarOpen(false)}
        >
          {/* ── ЧАТЫ ── */}
          <section
            className={`view ${activeTab === "chats" ? "is-active" : ""}`}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <header className="chatHeader">
                {activeChat && (
                  <button onClick={() => setActiveChatId(null)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0 8px 0 0', fontSize: 20, flexShrink: 0 }}>
                    ←
                  </button>
                )}
                <div
                  className="chatHeader__left"
                  onClick={() =>
                    activeChat &&
                    openProfile({
                      id: activeChat.userId,
                      name: activeChat.name,
                      username: activeChat.username,
                      avatar_url: activeChat.avatarUrl,
                    })
                  }
                  style={{ cursor: activeChat ? "pointer" : undefined }}
                >
                  {activeChat && (
                    <div style={{ position: "relative" }}>
                      <Avatar url={activeChat.avatarUrl} name={activeChat.name} size={44} />
                      {activeChat.isGroup
                        ? <div style={{ position: 'absolute', bottom: -2, right: -2, background: '#7c3aed', borderRadius: '50%', width: 16, height: 16, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #0b0b0b' }}>👥</div>
                        : <div className={activeChat.status === "online" ? "online-status" : "offline-status"} />
                      }
                    </div>
                  )}
                  <div className="chatHeader__meta">
                    <div className="chatHeader__name">
                      {activeChat ? safeText(activeChat.name) : "Выберите чат"}
                    </div>
                    {activeChat && (
                      <div className="chatHeader__status">
                        {typingNames.length > 0 ? (
                          <div
                            className="typing-indicator"
                            style={{
                              background: "transparent",
                              padding: 0,
                              margin: 0,
                            }}
                          >
                            <span>{typingNames[0]} печатает...</span>
                            <div className="typing-dots">
                              <span />
                              <span />
                              <span />
                            </div>
                          </div>
                        ) : activeChat.isGroup ? (
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                            {activeChat.memberCount} участников
                          </span>
                        ) : (
                          <>
                            <span
                              className="dot"
                              style={{
                                background:
                                  activeChat.status === "online"
                                    ? "#22c55e"
                                    : "#6b7280",
                              }}
                            />
                            <span>
                              {formatLastSeen(activeChat.status, activeChat.last_seen)}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="chatHeader__center">
                  {activeChat && (
                    <div className="pill">
                      Сегодня, {formatTime(new Date())}
                    </div>
                  )}
                </div>
                <div className="chatHeader__right">
                  {activeChat && (
                    <>
                      {activeChat.isGroup && (
                        <button className="iconBtn" title="Настройки группы"
                          style={{ color: groupSettingsOpen ? '#a78bfa' : undefined }}
                          onClick={() => setGroupSettingsOpen(v => !v)}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.6"/></svg>
                        </button>
                      )}
                      <button className="iconBtn" title="Обои чата"
                        style={{ color: chatWallpaper ? 'rgba(167,139,250,0.9)' : undefined }}
                        onClick={() => setWallpaperPickerOpen(v => !v)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="m3 15 5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      <button
                        className="iconBtn"
                        title="Поиск по сообщениям"
                        style={{ color: msgSearchOpen ? "white" : undefined }}
                        onClick={() => {
                          setMsgSearchOpen((v) => !v);
                          setMsgSearchQuery("");
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <path
                            d="M10.5 18.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <path
                            d="M16.5 16.5 21 21"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <button
                        className="iconBtn"
                        title="Удалить переписку"
                        style={{ color: "rgba(255,80,80,0.7)" }}
                        onClick={() => handleDeleteChat(activeChat.id)}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <polyline
                            points="3 6 5 6 21 6"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                          <path
                            d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                          <path
                            d="M10 11v6M14 11v6"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                          <path
                            d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <button className="iconBtn" title={activeChat?.pinned ? 'Открепить' : 'Закрепить'}
                        style={{ color: activeChat?.pinned ? '#f59e0b' : 'rgba(255,255,255,0.45)' }}
                        onClick={async () => {
                          if (!activeChatId || !user?.id) return
                          const wasPinned = activeChat?.pinned
                          try { await supabase.from('chat_members').update({ pinned: !wasPinned }).eq('chat_id', activeChatId).eq('user_id', user.id) } catch {}
                          setChats(prev => {
                            const updated = prev.map(c => c.id === activeChatId ? { ...c, pinned: !wasPinned } : c)
                            return [...updated.filter(c => c.pinned), ...updated.filter(c => !c.pinned)]
                          })
                        }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill={activeChat?.pinned ? 'currentColor' : 'none'}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
                      </button>
                      <button className="iconBtn" title={activeChat?.archived ? 'Из архива' : 'В архив'}
                        style={{ color: activeChat?.archived ? '#a78bfa' : 'rgba(255,255,255,0.45)' }}
                        onClick={async () => {
                          if (!activeChatId || !user?.id) return
                          const wasArchived = activeChat?.archived
                          await chatService.setArchived(activeChatId, user.id, !wasArchived)
                          setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, archived: !wasArchived } : c))
                        }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><line x1="12" y1="12" x2="12" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M9 14l3-3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                      </button>
                    </>
                  )}
                </div>
              </header>

              {/* Поиск по сообщениям */}
              {msgSearchOpen && activeChat && (
                <div
                  style={{
                    padding: "8px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(0,0,0,0.15)",
                    flexShrink: 0,
                  }}
                >
                  <input
                    value={msgSearchQuery}
                    onChange={(e) => setMsgSearchQuery(e.target.value)}
                    placeholder="Поиск в сообщениях..."
                    autoFocus
                    style={{
                      width: "100%",
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10,
                      padding: "8px 14px",
                      color: "white",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {msgSearchQuery && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.35)",
                        marginTop: 4,
                      }}
                    >
                      Найдено: {displayMessages.length}
                    </div>
                  )}
                </div>
              )}

              {pinnedMsg && activeChat && (
                <div style={{ padding: '6px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#f59e0b', flexShrink: 0 }}><path d="M12 2v10M5 9l7-7 7 7M5 15l7 9 7-9" stroke="currentColor" fill="none" strokeWidth="1.7" strokeLinecap="round"/></svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: 0.3 }}>ЗАКРЕПЛЕНО</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pinnedMsg.type === 'image' ? '📷 Фото' : pinnedMsg.type === 'voice' ? '🎙 Голосовое' : (pinnedMsg.content || '').slice(0, 60)}
                    </div>
                  </div>
                  <button onClick={() => handlePinMessage(pinnedMsg)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4, borderRadius: 4, fontSize: 14 }}>✕</button>
                </div>
              )}
              {wallpaperPickerOpen && activeChat && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>ОБОИ ЧАТА</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {WALLPAPERS.map(w => (
                      <button key={w.id} onClick={() => {
                        if (w.id) localStorage.setItem(`lvkosp_wp_${activeChatId}`, w.bg)
                        else localStorage.removeItem(`lvkosp_wp_${activeChatId}`)
                        setWallpaperPickerOpen(false)
                      }} title={w.label}
                        style={{ width: 36, height: 36, borderRadius: 10, border: chatWallpaper === w.bg && w.id ? '2px solid #a78bfa' : '2px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: w.bg || 'rgba(255,255,255,0.06)', flexShrink: 0, position: 'relative' }}>
                        {!w.id && <span style={{ fontSize: 14 }}>✕</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="chatBody" ref={chatBodyRef} style={activeChat && chatWallpaper ? { background: chatWallpaper } : {}}>
                {!activeChat ? (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 18, color: 'white' }}>Переписки</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setCreateGroupOpen(true)}
                          title="Создать группу"
                          style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, fontSize: 13, color: '#a78bfa', cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}>
                          + Группа
                        </button>
                        <button onClick={() => setShowArchived(v => !v)}
                          style={{ background: 'none', border: 'none', fontSize: 12, color: showArchived ? '#a78bfa' : 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: '4px 8px', fontWeight: 600 }}>
                          {showArchived ? '← Назад' : 'Архив'}
                        </button>
                      </div>
                    </div>
                    <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
                      <input value={chatSearch} onChange={e => setChatSearch(e.target.value)}
                        placeholder="Поиск..."
                        style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px', color: 'white', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {filteredChats.length === 0 ? (
                        <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
                          {chatSearch ? 'Ничего не найдено' : 'Чатов пока нет'}
                        </div>
                      ) : (
                        filteredChats.map(chat => {
                          const unread = unreadCounts[chat.id] || 0;
                          return (
                            <div key={chat.id}
                              className="dmItem"
                              style={{ padding: '10px 16px', cursor: 'pointer' }}
                              onClick={() => setActiveChatId(chat.id)}
                            >
                              <div style={{ position: 'relative' }}>
                                <Avatar url={chat.avatarUrl} name={chat.name} size={46} />
                                {chat.isGroup
                                  ? <div style={{ position: 'absolute', bottom: -2, right: -2, background: '#7c3aed', borderRadius: '50%', width: 16, height: 16, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #0b0b0b' }}>👥</div>
                                  : <div className={chat.status === 'online' ? 'online-status' : 'offline-status'} />
                                }
                              </div>
                              <div className="dmMeta">
                                <div className="dmName">{safeText(chat.name)}{chat.isGroup && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginLeft: 5 }}>{chat.memberCount} чел.</span>}</div>
                                <div className="dmSnippet">{safeText(chat.lastMessage || 'Нет сообщений')}</div>
                              </div>
                              <div className="dmRight">
                                <div className="dmTime">{formatTime(chat.lastMessageTime)}</div>
                                {unread > 0 && (
                                  <div style={{ background: '#ef4444', color: 'white', borderRadius: 10, fontSize: 10, fontWeight: 800, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                                    {unread > 99 ? '99+' : unread}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : displayMessages.length === 0 ? (
                  <div className="blank">
                    <div className="blank__title">
                      {msgSearchQuery
                        ? "Ничего не найдено"
                        : "Сообщений пока нет"}
                    </div>
                    <div className="blank__text">
                      {msgSearchQuery
                        ? "Попробуйте другой запрос"
                        : "Начните общение!"}
                    </div>
                  </div>
                ) : (
                  (() => {
                    let lastDateLabel = null;
                    return displayMessages.map((msg) => {
                      const label = formatDateLabel(msg.created_at);
                      const showLabel = label !== lastDateLabel;
                      lastDateLabel = label;
                      return (
                        <React.Fragment key={msg.id}>
                          {showLabel && (
                            <div style={{ textAlign: 'center', margin: '10px 0 6px', pointerEvents: 'none' }}>
                              <span style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: '3px 12px', fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{label}</span>
                            </div>
                          )}
                          <MessageBubble
                            msg={msg}
                            isMe={msg.sender_id === user.id}
                            isGroup={activeChat?.isGroup}
                            searchQuery={msgSearchQuery}
                            onEdit={handleEditMessage}
                            onDelete={handleDeleteMessage}
                            onDeleteForAll={handleDeleteForAll}
                            onUserClick={openProfile}
                            onForward={setForwardMsg}
                            onReply={setReplyTo}
                            currentUserId={user.id}
                            onMentionClick={handleMentionClick}
                            onPin={handlePinMessage}
                            isPinned={pinnedMsg?.id === msg.id}
                          />
                        </React.Fragment>
                      );
                    });
                  })()
                )}
              </div>

              {replyTo && (
                <div
                  style={{
                    padding: "6px 16px",
                    borderTop: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(0,0,0,0.15)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      borderLeft: "2px solid rgba(255,255,255,0.35)",
                      paddingLeft: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "rgba(255,255,255,0.55)",
                        marginBottom: 1,
                      }}
                    >
                      Ответ для {replyTo.sender?.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.4)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {replyTo.type === "image" ? "📷 Фото" : replyTo.content}
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgba(255,255,255,0.4)",
                      cursor: "pointer",
                      fontSize: 18,
                      padding: 4,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
              {emojiPickerOpen && (
                <div ref={emojiPickerRef} style={{ background: 'rgba(18,18,28,0.99)', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 12px' }}>
                  {[
                    ['😀','😂','🥰','😍','🤔','😊','😎','😭','😅','🥺','😏','😘','🤣','😤','🙂','🤗'],
                    ['👍','👎','👏','🙏','💪','🤝','🫶','✌️','🤞','👀','💀','🫡','🤦','🤷','🫠','😶'],
                    ['❤️','🔥','💯','🎉','✨','💥','🥳','🎊','💔','💕','💬','👻','🍕','🍺','🎮','🚀'],
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {row.map(e => (
                        <button key={e} onClick={() => { setMessageText(t => t + e); setEmojiPickerOpen(false); }}
                          style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: '3px 4px', borderRadius: 6, lineHeight: 1 }}
                          onMouseEnter={ev => ev.currentTarget.style.background='rgba(255,255,255,0.1)'}
                          onMouseLeave={ev => ev.currentTarget.style.background='none'}>
                          {e}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <footer className="chatComposer">
                <div className="composer-actions">
                  <button type="button" className="clipBtn" onClick={() => setEmojiPickerOpen(p => !p)} title="Эмодзи" style={{ opacity: activeChat ? 1 : 0.4 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M8.5 14.5c.9 1.5 6.1 1.5 7 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  </button>
                  <label
                    className="clipBtn"
                    htmlFor={activeChat ? "chatImageInput" : undefined}
                    style={{ cursor: activeChat ? "pointer" : "default", opacity: activeChat ? 1 : 0.4 }}
                    aria-label="Прикрепить"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M8 12.5 14.9 5.6a3 3 0 0 1 4.2 4.2l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.7-8.7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </label>
                  <input
                    id="chatImageInput"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      handleSendImage(f);
                    }}
                  />
                </div>
                <input
                  className="chatInput"
                  placeholder={activeChat ? "Сообщение..." : "Выберите чат"}
                  disabled={!activeChat}
                  value={messageText}
                  onChange={(e) => handleTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                {!messageText.trim() && activeChat && (
                  recording ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#ef4444', minWidth: 36 }}>{Math.floor(recordingTime/60).toString().padStart(2,'0')}:{(recordingTime%60).toString().padStart(2,'0')}</span>
                      <button type="button" onClick={() => stopRecording(false)} style={{ background: 'rgba(255,80,80,0.15)', border: 'none', borderRadius: 8, padding: '4px 8px', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>✕</button>
                      <button type="button" onClick={() => stopRecording(true)} style={{ background: 'rgba(167,139,250,0.2)', border: 'none', borderRadius: 8, padding: '4px 8px', color: '#a78bfa', cursor: 'pointer', fontSize: 12 }}>✓</button>
                    </div>
                  ) : (
                    <button type="button" className="clipBtn" onClick={startRecording} title="Голосовое сообщение">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6"/><path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                    </button>
                  )
                )}
                <button
                  className="sendBtn"
                  type="button"
                  onClick={handleSend}
                  disabled={!activeChat || !messageText.trim()}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12 21 3l-5.2 18-4.3-7.2L4 12Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
                    <path d="M21 3 11.5 13.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                  </svg>
                </button>
              </footer>
            </div>
          </section>

          {/* ── ДРУЗЬЯ ── */}
          <section
            className={`view ${activeTab === "friends" ? "is-active" : ""}`}
          >
            <div className="view-header">
              <div className="view-header__title">Друзья</div>
            </div>

            {/* Под-табы */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                padding: "0 24px",
                flexShrink: 0,
              }}
            >
              {[
                { key: "friends", label: "Ваши друзья", count: friends.length },
                {
                  key: "requests",
                  label: "Подписчики",
                  count: pendingRequests.length,
                },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFriendsTab(tab.key)}
                  style={{
                    padding: "12px 16px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `2px solid ${friendsTab === tab.key ? "white" : "transparent"}`,
                    marginBottom: -1,
                    color:
                      friendsTab === tab.key
                        ? "white"
                        : "rgba(255,255,255,0.45)",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span
                      style={{
                        background:
                          tab.key === "requests"
                            ? "#ef4444"
                            : "rgba(255,255,255,0.15)",
                        color: "white",
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "1px 7px",
                      }}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ padding: '12px 24px 0' }}>
              <input
                value={friendsSearch}
                onChange={e => setFriendsSearch(e.target.value)}
                placeholder="Поиск людей..."
                style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 14px', color: 'white', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div
              className="view-content"
              style={{ overflowY: "auto", padding: "0 24px 24px" }}
            >
              {friendsTab === "friends" ? (
                <>
                  <div
                    style={{
                      marginBottom: 12,
                      marginTop: 16,
                      color: "rgba(255,255,255,0.45)",
                      fontSize: 13,
                    }}
                  >
                    {friendsSearch.trim().length < 2 ? 'Введите минимум 2 символа для поиска пользователей.' : `Результаты поиска:`}
                  </div>

                  {friends.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 1,
                          opacity: 0.4,
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Ваши друзья ({friends.length})
                      </div>
                      {friends.map((f) => (
                        <div
                          key={f.id}
                          className="search-result-item"
                          style={{ justifyContent: "space-between", cursor: 'pointer' }}
                          onClick={() => { setViewingUser(f); setActiveTab("profile"); setSidebarOpen(false); }}
                        >
                          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <Avatar url={f.avatar_url} name={f.name} size={42} />
                            <div>
                              <div style={{ fontWeight: 700 }}>{safeText(f.name)}</div>
                              <div style={{ fontSize: 13, opacity: 0.5 }}>
                                {f.bio ? safeText(f.bio) : `@${safeText(f.username)}`}
                              </div>
                            </div>
                          </div>
                          <div className="user-actions" onClick={e => e.stopPropagation()}>
                            <button className="btn" onClick={() => startChatWith(f)}>Написать</button>
                            <button className="btn is-outline" onClick={() => removeFriend(f.id)}>Отписаться</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {friends.length === 0 && friendsSearch.trim().length < 2 && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: 30,
                        color: "rgba(255,255,255,0.25)",
                        fontSize: 14,
                      }}
                    >
                      Друзей пока нет. Найдите пользователей через поиск!
                    </div>
                  )}

                  {friendsSearch.trim().length >= 2 && (
                    <>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 1,
                          opacity: 0.4,
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Результаты поиска
                      </div>
                      {searchResults.length === 0 ? (
                        <div
                          style={{
                            color: "rgba(255,255,255,0.4)",
                            fontSize: 13,
                          }}
                        >
                          Пользователи не найдены
                        </div>
                      ) : (
                        searchResults.map((u) => (
                          <div
                            key={u.id}
                            className="search-result-item"
                            style={{ justifyContent: "space-between" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: 12,
                                alignItems: "center",
                              }}
                            >
                              <Avatar
                                url={u.avatar_url}
                                name={u.name}
                                size={42}
                              />
                              <div>
                                <div style={{ fontWeight: 700 }}>
                                  {safeText(u.name)}
                                </div>
                                <div style={{ fontSize: 13, opacity: 0.5 }}>
                                  {u.bio
                                    ? safeText(u.bio)
                                    : `@${safeText(u.username)}`}
                                </div>
                              </div>
                            </div>
                            <div className="user-actions">
                              <button
                                className="btn is-outline"
                                onClick={() => {
                                  setViewingUser(u);
                                  setActiveTab("profile");
                                }}
                              >
                                Профиль
                              </button>
                              <button
                                className="btn"
                                onClick={() => startChatWith(u)}
                              >
                                Написать
                              </button>
                              {isFriend(u.id) ? (
                                <button
                                  className="btn is-outline"
                                  onClick={() => removeFriend(u.id)}
                                >
                                  Отписаться
                                </button>
                              ) : (
                                <button
                                  className="btn is-outline"
                                  onClick={() => sendFriendRequest(u.id)}
                                >
                                  Подписаться
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </>
              ) : (
                <div style={{ marginTop: 16 }}>
                  {pendingRequests.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: 30,
                        color: "rgba(255,255,255,0.25)",
                        fontSize: 14,
                      }}
                    >
                      Заявок в друзья пока нет
                    </div>
                  ) : (
                    pendingRequests.map((u) => (
                      <div
                        key={u.id}
                        className="search-result-item"
                        style={{ justifyContent: "space-between" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          <Avatar url={u.avatar_url} name={u.name} size={42} />
                          <div>
                            <div style={{ fontWeight: 700 }}>
                              {safeText(u.name)}
                            </div>
                            <div style={{ fontSize: 13, opacity: 0.5 }}>
                              {u.bio
                                ? safeText(u.bio)
                                : `@${safeText(u.username)}`}
                            </div>
                          </div>
                        </div>
                        <div className="user-actions">
                          <button
                            className="btn"
                            onClick={() => acceptRequest(u.id)}
                          >
                            Подписаться в ответ
                          </button>
                          <button
                            className="btn is-outline"
                            onClick={() => declineRequest(u.id)}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── ЛЕНТА ── */}
          <section
            className={`view ${activeTab === "feed" ? "is-active" : ""}`}
          >
            <div className="view-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {feedSubTab === 'channels' && viewingChannel && (
                  <button className="iconBtn" onClick={() => setViewingChannel(null)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
                <div className="view-header__title">
                  {feedSubTab === 'feed' ? 'Лента' : viewingChannel ? viewingChannel.name : 'Каналы'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => { setFeedSubTab('feed'); setViewingChannel(null); }}
                  style={{ padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: feedSubTab === 'feed' ? 'rgba(255,255,255,0.13)' : 'transparent', color: feedSubTab === 'feed' ? 'white' : 'rgba(255,255,255,0.4)' }}>
                  Лента
                </button>
                <button onClick={() => setFeedSubTab('channels')}
                  style={{ padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: feedSubTab === 'channels' ? 'rgba(255,255,255,0.13)' : 'transparent', color: feedSubTab === 'channels' ? 'white' : 'rgba(255,255,255,0.4)' }}>
                  Каналы
                </button>
              </div>
            </div>
            <div className="view-content" style={{ overflowY: "auto", padding: 20 }}>
              {feedSubTab === 'feed' ? (
                <GlobalFeed
                  currentUser={user}
                  onShareClick={setSharePost}
                  onUserClick={openProfile}
                  onMentionClick={handleMentionClick}
                  onNotify={(type, toId, entityId, preview) =>
                    notificationsService.create(toId, type, user?.id, entityId, preview)
                  }
                />
              ) : viewingChannel ? (
                <ChannelPage
                  channel={viewingChannel}
                  currentUser={user}
                  onBack={() => setViewingChannel(null)}
                  onUserClick={openProfile}
                />
              ) : (
                <ChannelsView
                  currentUser={user}
                  onOpenChannel={setViewingChannel}
                />
              )}
            </div>
          </section>

          {/* ── ПОИСК / EXPLORE ── */}
          <section className={`view ${activeTab === "explore" ? "is-active" : ""}`}>
            <div className="view-header">
              <div className="view-header__title">Поиск</div>
            </div>
            <div className="view-content" style={{ overflowY: "auto", padding: 16 }}>
              {activeTab === "explore" && <ExploreView currentUser={user} onUserClick={openProfile} onMentionClick={handleMentionClick} onShareClick={setSharePost} onNotify={(type, toId, entityId, preview) => notificationsService.create(toId, type, user?.id, entityId, preview)} />}
            </div>
          </section>

          {/* ── ПРОФИЛЬ / СТЕНА ── */}
          <section
            className={`view ${activeTab === "profile" ? "is-active" : ""}`}
          >
            <div className="view-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {viewingUser && (
                  <button
                    onClick={() => setViewingUser(null)}
                    className="iconBtn"
                    style={{ marginRight: 4 }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M19 12H5M12 5l-7 7 7 7"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
                <div className="view-header__title">
                  {viewingUser ? safeText(viewingUser.name) : "Мой профиль"}
                </div>
              </div>
              {!viewingUser && (
                <button className="iconBtn" title="Уведомления" style={{ position: 'relative', color: activeTab === 'notifs' ? 'white' : undefined }}
                  onClick={async () => { setActiveTab("notifs"); setSidebarOpen(false); const n = await notificationsService.getUnread(user.id); setDbNotifs(n); notificationsService.markAllRead(user.id); setDbNotifsUnread(0) }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  {dbNotifsUnread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: '#ef4444', border: '1.5px solid #0b0b0b' }} />}
                </button>
              )}
            </div>
            {viewingUser && (
              <div
                style={{
                  padding: "12px 20px 0",
                  display: "flex",
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <button
                  className="btn is-outline"
                  onClick={() => startChatWith(viewingUser)}
                >
                  Написать
                </button>
                <button
                  className="btn is-outline"
                  style={{
                    color: "rgba(255,100,100,0.8)",
                    borderColor: "rgba(255,100,100,0.3)",
                  }}
                  onClick={async () => {
                    if (!await showConfirm(`${viewingUser.name} не сможет видеть ваши посты и писать вам.`, `Заблокировать ${viewingUser.name}?`))
                      return;
                    const res = await blocksService.block(
                      user.id,
                      viewingUser.id,
                    );
                    if (res.success) {
                      notificationService.showNotification(
                        "Готово",
                        `${viewingUser.name} заблокирован`,
                        "success",
                      );
                      setViewingUser(null);
                    } else
                      notificationService.showNotification(
                        "Ошибка",
                        res.error,
                        "error",
                      );
                  }}
                >
                  Заблокировать
                </button>
                <button
                  className="btn is-outline"
                  style={{ fontSize: 13, padding: '7px 14px', color: 'rgba(255,180,0,0.8)', borderColor: 'rgba(255,180,0,0.3)' }}
                  onClick={async () => {
                    if (!await showConfirm(`Отправить жалобу на ${viewingUser.name}?`, 'Пожаловаться')) return;
                    supabase.from('reports').insert({ from_user_id: user.id, on_user_id: viewingUser.id, reason: 'user_report' }).then(() => {});
                    notificationService.showNotification('Жалоба отправлена', 'Мы рассмотрим её в ближайшее время', 'success');
                  }}
                >
                  Пожаловаться
                </button>
              </div>
            )}
            <div
              className="view-content"
              style={{ overflowY: "auto", padding: 20 }}
            >
              <ProfileWall
                profileUser={profileUser}
                currentUser={user}
                isFriendOfUser={isFriend(profileUser?.id)}
                onShareClick={setSharePost}
                onBannerUpdate={(url) =>
                  setUser((prev) => ({ ...prev, banner_url: url }))
                }
                onUserClick={openProfile}
                onMentionClick={handleMentionClick}
                onUserUpdate={(u) => setUser(u)}
                onNotify={(type, toId, entityId, preview) =>
                  notificationsService.create(
                    toId,
                    type,
                    user?.id,
                    entityId,
                    preview,
                  )
                }
              />
            </div>
          </section>

          {/* ── УВЕДОМЛЕНИЯ ── */}
          <section
            className={`view ${activeTab === "notifs" ? "is-active" : ""}`}
          >
            <div className="view-header">
              <div className="view-header__title">Уведомления</div>
            </div>
            <div
              className="view-content"
              style={{ overflowY: "auto", padding: 20 }}
            >
              {dbNotifs.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "rgba(255,255,255,0.25)",
                    fontSize: 14,
                  }}
                >
                  Уведомлений пока нет
                </div>
              ) : (
                dbNotifs.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "12px 16px",
                      background: n.read
                        ? "rgba(255,255,255,0.02)"
                        : "rgba(255,255,255,0.06)",
                      borderRadius: 14,
                      marginBottom: 8,
                      border: `1px solid ${n.read ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.14)"}`,
                      cursor: "pointer",
                    }}
                    onClick={async () => {
                      if (n.type === 'message' && n.entity_id) {
                        setActiveTab('chats');
                        setActiveChatId(n.entity_id);
                      } else if ((n.type === 'like' || n.type === 'comment' || n.type === 'mention') && n.entity_id) {
                        const post = await postsService.getById(n.entity_id);
                        if (post) { setFocusPost(post); } else if (n.from_user) { openProfile(n.from_user); }
                      } else if (n.type === 'follow' && n.from_user) {
                        openProfile(n.from_user);
                      }
                    }}
                  >
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <Avatar url={n.from_user?.avatar_url} name={n.from_user?.name} size={40} />
                      <div style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 14, lineHeight: 1 }}>
                        {n.type === 'like' && '❤️'}
                        {n.type === 'comment' && '💬'}
                        {n.type === 'follow' && '👤'}
                        {n.type === 'message' && '💌'}
                        {n.type === 'mention' && '@'}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                        <b>{n.from_user?.name}</b>
                        {n.type === "like" && " оценил ваш пост"}
                        {n.type === "comment" && " прокомментировал ваш пост"}
                        {n.type === "follow" && " подписался на вас"}
                        {n.type === "message" && " написал вам"}
                        {n.type === "mention" && " упомянул вас"}
                      </div>
                      {n.entity_preview && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "rgba(255,255,255,0.4)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {n.entity_preview}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.3)",
                          marginTop: 2,
                        }}
                      >
                        {formatRelative(n.created_at)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── НАСТРОЙКИ ── */}
          <section
            className={`view ${activeTab === "settings" ? "is-active" : ""}`}
          >
            <div className="view-header">
              <div className="view-header__title">Пароль и безопасность</div>
            </div>
            <div
              className="view-content"
              style={{ overflowY: "auto", padding: 20 }}
            >
              <SettingsPanel user={user} onUserUpdate={(u) => setUser(u)} onLogout={doLogout} />
            </div>
          </section>
        </main>
      </div>

      {/* ════ AUTH MODAL ════ */}
      <div
        className="modal"
        style={{ display: authModalOpen ? "flex" : "none" }}
      >
        <div className="modal-content">
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontWeight: 900,
                fontSize: 24,
                color: "white",
                letterSpacing: -1,
              }}
            >
              L
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 20,
                letterSpacing: -0.3,
                color: "white",
              }}
            >
              LVKOSP Messenger
            </div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.35)",
                marginTop: 5,
              }}
            >
              {authTab === "login"
                ? "Войдите в свой аккаунт"
                : "Создайте новый аккаунт"}
            </div>
          </div>
          <div className="modal-tabs">
            <button
              className={`modal-tab ${authTab === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthTab("login");
                setAuthError("");
              }}
            >
              Вход
            </button>
            <button
              className={`modal-tab ${authTab === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthTab("register");
                setAuthError("");
              }}
            >
              Регистрация
            </button>
          </div>
          {authTab === "login" && (
            <form className="auth-form" onSubmit={doLogin}>
              <label className="auth-label">Имя пользователя</label>
              <input
                type="text"
                placeholder="username"
                required
                autoComplete="username"
                value={loginForm.username}
                onChange={(e) =>
                  setLoginForm((p) => ({ ...p, username: e.target.value }))
                }
              />
              <label className="auth-label">Пароль</label>
              <input
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(e) =>
                  setLoginForm((p) => ({ ...p, password: e.target.value }))
                }
              />
              <button type="submit">Войти</button>
              {authError && <div className="error-message">{authError}</div>}
            </form>
          )}
          {authTab === "register" && (
            <form className="auth-form" onSubmit={doRegister}>
              <label className="auth-label">Имя пользователя</label>
              <input
                type="text"
                placeholder="username"
                required
                autoComplete="username"
                value={registerForm.username}
                onChange={(e) =>
                  setRegisterForm((p) => ({ ...p, username: e.target.value }))
                }
              />
              <label className="auth-label">Пароль</label>
              <input
                type="password"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                value={registerForm.password}
                onChange={(e) =>
                  setRegisterForm((p) => ({ ...p, password: e.target.value }))
                }
              />
              <label className="auth-label">Отображаемое имя</label>
              <input
                type="text"
                placeholder="Ваше имя"
                required
                value={registerForm.name}
                onChange={(e) =>
                  setRegisterForm((p) => ({ ...p, name: e.target.value }))
                }
              />
              <label className="auth-label">
                О себе{" "}
                <span style={{ opacity: 0.45, fontSize: 11 }}>
                  (необязательно)
                </span>
              </label>
              <textarea
                placeholder="Расскажите о себе..."
                rows={2}
                value={registerForm.bio}
                onChange={(e) =>
                  setRegisterForm((p) => ({ ...p, bio: e.target.value }))
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  margin: "0 0 14px",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  outline: "none",
                  resize: "none",
                  height: 66,
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              />
              <label className="auth-label">
                Аватар{" "}
                <span style={{ opacity: 0.45, fontSize: 11 }}>
                  (необязательно)
                </span>
              </label>
              <div className="avatar-upload">
                <div className="avatar-preview">
                  {registerAvatar && (
                    <img
                      src={URL.createObjectURL(registerAvatar)}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: 12,
                      }}
                    />
                  )}
                </div>
                <div>
                  <input
                    type="file"
                    id="avatarInput"
                    accept="image/*"
                    onChange={(e) =>
                      setRegisterAvatar(e.target.files?.[0] || null)
                    }
                  />
                  <label htmlFor="avatarInput">Выбрать фото</label>
                </div>
              </div>
              <button type="submit" disabled={registerLoading}>
                {registerLoading ? "Создание аккаунта..." : "Создать аккаунт"}
              </button>
              {authError && <div className="error-message">{authError}</div>}
            </form>
          )}
        </div>
      </div>

      {/* ════ FORWARD MODAL ════ */}
      {forwardMsg && (
        <div
          onClick={() => setForwardMsg(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 9100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(360px,100%)",
              background: "rgba(16,16,16,0.98)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 18,
              padding: 22,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              Переслать в...
              {forwardLoading && <div style={{ width: 16, height: 16, border: '2px solid #a78bfa', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
                background: "rgba(255,255,255,0.05)",
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              {forwardMsg.type === "image" ? "📷 Фото" : forwardMsg.content}
            </div>
            <div
              style={{
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {chats.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
                  Нет доступных чатов
                </div>
              ) : (
                chats.map((c) => (
                  <div
                    key={c.id}
                    onClick={async () => {
                      if (forwardLoading) return;
                      setForwardLoading(true);
                      try {
                        const msg = forwardMsg;
                        if (msg.type === "image" && msg.media_url) {
                          try {
                            const res = await fetch(msg.media_url);
                            const blob = await res.blob();
                            const file = new File([blob], "forwarded.jpg", { type: "image/jpeg" });
                            await chatService.sendImage(c.id, user.id, file);
                          } catch {
                            await chatService.sendMessage(c.id, user.id, `📷 ${msg.media_url}`);
                          }
                        } else if (msg.type === "voice" && msg.media_url) {
                          try {
                            const res = await fetch(msg.media_url);
                            const blob = await res.blob();
                            const file = new File([blob], "forwarded.ogg", { type: "audio/ogg" });
                            await chatService.sendVoice(c.id, user.id, file);
                          } catch {
                            await chatService.sendMessage(c.id, user.id, "🎤 Голосовое сообщение");
                          }
                        } else {
                          const senderName = msg.sender?.name || 'Неизвестный';
                          const text = msg.content?.trim() || "📎 Вложение";
                          await chatService.sendMessage(c.id, user.id, `⬆️ Переслано от ${senderName}:\n${text}`);
                        }
                        const updated = await chatService.getChats(user.id);
                        setChats(updated);
                        setActiveChatId(c.id);
                        setActiveTab("chats");
                        setForwardMsg(null);
                        notificationService.showNotification("Переслано", `В чат с ${c.name}`, "success");
                      } catch {
                        notificationService.showNotification("Ошибка", "Не удалось переслать", "error");
                      }
                      setForwardLoading(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 12,
                      cursor: "pointer",
                    }}
                  >
                    <Avatar url={c.avatarUrl} name={c.name} size={38} />
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {c.name}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {createGroupOpen && (
        <CreateGroupModal
          currentUser={user}
          friends={friends}
          onClose={() => setCreateGroupOpen(false)}
          onCreate={async (name, memberIds) => {
            const res = await chatService.createGroupChat(user.id, memberIds, name);
            if (res.success) {
              setCreateGroupOpen(false);
              const updated = await chatService.getChats(user.id);
              setChats(updated);
              setActiveChatId(res.chatId);
            } else {
              notificationService.showNotification('Ошибка', res.error, 'error');
            }
          }}
        />
      )}
      {groupSettingsOpen && activeChat?.isGroup && (
        <GroupSettingsModal
          chat={activeChat}
          currentUser={user}
          friends={friends}
          onClose={() => setGroupSettingsOpen(false)}
          onUpdated={async () => {
            const updated = await chatService.getChats(user.id);
            setChats(updated);
          }}
        />
      )}
    </>
  );
}

// ─── GroupSettingsModal ───────────────────────────────────────────────────────
function GroupSettingsModal({ chat, currentUser, friends, onClose, onUpdated }) {
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('members'); // 'members' | 'add'
  const [toAdd, setToAdd] = useState([]);
  const [adding, setAdding] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [groupName, setGroupName] = useState(chat.name || '');
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [description, setDescription] = useState(chat.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    chatService.getGroupMembers(chat.id).then(setMembers);
  }, [chat.id]);

  const memberIds = new Set(members.map(m => m.id));
  const addableFriends = friends.filter(f => !memberIds.has(f.id));

  function toggleAdd(id) {
    setToAdd(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleAdd() {
    if (!toAdd.length) return;
    setAdding(true);
    const res = await chatService.addGroupMembers(chat.id, toAdd);
    if (res.success) {
      const updated = await chatService.getGroupMembers(chat.id);
      setMembers(updated);
      setToAdd([]);
      setTab('members');
      onUpdated?.();
      notificationService.showNotification('Готово', 'Участники добавлены', 'success');
    } else {
      notificationService.showNotification('Ошибка', res.error, 'error');
    }
    setAdding(false);
  }

  async function handleRemove(userId) {
    if (!await showConfirm('Удалить участника из группы?', 'Удалить')) return;
    const res = await chatService.removeGroupMember(chat.id, userId);
    if (res.success) {
      setMembers(prev => prev.filter(m => m.id !== userId));
      onUpdated?.();
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    const res = await chatService.updateGroupAvatar(chat.id, file);
    if (res.success) {
      onUpdated?.();
      notificationService.showNotification('Готово', 'Фото группы обновлено', 'success');
    } else {
      notificationService.showNotification('Ошибка', res.error, 'error');
    }
    setAvatarUploading(false);
  }

  async function handleSaveName() {
    if (!groupName.trim()) return;
    setSavingName(true);
    const res = await chatService.updateGroupName(chat.id, groupName.trim());
    if (res.success) { setEditingName(false); onUpdated?.(); }
    else notificationService.showNotification('Ошибка', res.error, 'error');
    setSavingName(false);
  }

  async function handleSaveDesc() {
    setSavingDesc(true);
    const res = await chatService.updateGroupDescription(chat.id, description.trim());
    if (res.success) { setEditingDesc(false); onUpdated?.(); }
    else notificationService.showNotification('Ошибка', res.error || 'Колонка group_description не найдена в БД', 'error');
    setSavingDesc(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9997, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#15152a', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          {/* Аватар группы */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar url={chat.avatarUrl} name={chat.name} size={56} />
            <button onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'white' }}>
              {avatarUploading ? '...' : '📷'}
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          </div>
          {/* Название */}
          <div style={{ flex: 1 }}>
            {editingName ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={groupName} onChange={e => setGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                  style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '6px 10px', color: 'white', fontSize: 15, fontWeight: 700 }} autoFocus />
                <button onClick={handleSaveName} disabled={savingName} style={{ background: '#7c3aed', border: 'none', borderRadius: 10, color: 'white', padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>{savingName ? '...' : '✓'}</button>
                <button onClick={() => setEditingName(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 10, color: 'white', padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{chat.name}</div>
                <button onClick={() => setEditingName(true)} style={{ background: 'none', border: 'none', color: 'rgba(160,160,255,0.6)', cursor: 'pointer', fontSize: 14, padding: 2 }}>✏️</button>
              </div>
            )}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{members.length} участников</div>
            {/* Описание */}
            {editingDesc ? (
              <div style={{ marginTop: 6, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                  style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '5px 8px', color: 'white', fontSize: 12, resize: 'none', fontFamily: 'inherit' }} autoFocus />
                <button onClick={handleSaveDesc} disabled={savingDesc} style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: 'white', padding: '4px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>{savingDesc ? '...' : '✓'}</button>
                <button onClick={() => setEditingDesc(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, color: 'white', padding: '4px 7px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)} style={{ marginTop: 4, fontSize: 12, color: description ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)', cursor: 'pointer', fontStyle: description ? 'normal' : 'italic' }}>
                {description || '+ Добавить описание группы'}
              </div>
            )}
          </div>
        </div>

        {/* Табы */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {[['members', 'Участники'], ['add', `+ Добавить (${addableFriends.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ flex: 1, padding: '7px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === key ? '#7c3aed' : 'rgba(255,255,255,0.07)', color: 'white' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Список участников */}
        {tab === 'members' && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px' }}>
                <Avatar url={m.avatar_url} name={m.name} size={38} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}{m.id === currentUser?.id && <span style={{ fontSize: 11, color: '#a78bfa', marginLeft: 6 }}>вы</span>}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{m.username}</div>
                </div>
                {m.id !== currentUser?.id && (
                  <button onClick={() => handleRemove(m.id)} style={{ background: 'rgba(255,80,80,0.12)', border: 'none', borderRadius: 8, color: 'rgba(255,100,100,0.8)', cursor: 'pointer', padding: '5px 10px', fontSize: 12 }}>Удалить</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Добавить участников */}
        {tab === 'add' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {addableFriends.length === 0
                ? <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '16px 0' }}>Все друзья уже в группе</div>
                : addableFriends.map(f => (
                  <div key={f.id} onClick={() => toggleAdd(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', cursor: 'pointer', borderRadius: 10, background: toAdd.includes(f.id) ? 'rgba(124,58,237,0.15)' : 'transparent' }}>
                    <Avatar url={f.avatar_url} name={f.name} size={38} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{f.username}</div>
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${toAdd.includes(f.id) ? '#7c3aed' : 'rgba(255,255,255,0.2)'}`, background: toAdd.includes(f.id) ? '#7c3aed' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {toAdd.includes(f.id) && <span style={{ color: 'white', fontSize: 13 }}>✓</span>}
                    </div>
                  </div>
                ))
              }
            </div>
            {toAdd.length > 0 && (
              <button onClick={handleAdd} disabled={adding}
                style={{ marginTop: 12, padding: '12px', borderRadius: 12, background: '#7c3aed', border: 'none', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                {adding ? 'Добавляем...' : `Добавить ${toAdd.length} чел.`}
              </button>
            )}
          </>
        )}

        <button onClick={async () => {
          if (!await showConfirm('Вы покинете группу и больше не будете видеть её сообщения.', 'Покинуть группу?')) return;
          const res = await chatService.removeGroupMember(chat.id, currentUser.id);
          if (res.success) { onUpdated?.(); onClose(); }
          else notificationService.showNotification('Ошибка', res.error, 'error');
        }} style={{ marginTop: 14, padding: '11px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Покинуть группу
        </button>
      </div>
    </div>
  );
}

// ─── CreateGroupModal ─────────────────────────────────────────────────────────
function CreateGroupModal({ currentUser, friends, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [creating, setCreating] = useState(false);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleCreate() {
    if (!name.trim() || selected.length < 1) return;
    setCreating(true);
    await onCreate(name.trim(), selected);
    setCreating(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9997, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#15152a', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Новая группа</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Название группы"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', color: 'white', fontSize: 14, outline: 'none' }} />
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Участники ({selected.length})</div>
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {friends.length === 0
            ? <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Нет друзей для добавления</div>
            : friends.map(f => (
              <div key={f.id} onClick={() => toggle(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', cursor: 'pointer', borderRadius: 10, background: selected.includes(f.id) ? 'rgba(124,58,237,0.15)' : 'transparent' }}>
                <Avatar url={f.avatar_url} name={f.name} size={38} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>@{f.username}</div>
                </div>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${selected.includes(f.id) ? '#7c3aed' : 'rgba(255,255,255,0.2)'}`, background: selected.includes(f.id) ? '#7c3aed' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {selected.includes(f.id) && <span style={{ color: 'white', fontSize: 13 }}>✓</span>}
                </div>
              </div>
            ))
          }
        </div>
        <button onClick={handleCreate} disabled={!name.trim() || selected.length < 1 || creating}
          style={{ padding: '12px', borderRadius: 12, background: name.trim() && selected.length > 0 ? '#7c3aed' : 'rgba(255,255,255,0.08)', border: 'none', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          {creating ? 'Создаём...' : `Создать группу (${selected.length + 1} чел.)`}
        </button>
      </div>
    </div>
  );
}

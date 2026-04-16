import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

const TYPE_ICONS = {
  comment_reply: '💬',
  post_upvote:   '▲',
  comment_upvote: '▲',
  follow:        '👤',
  mention:       '@',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [count, setCount]           = useState(0);
  const [notifs, setNotifs]         = useState([]);
  const [open, setOpen]             = useState(false);
  const [loading, setLoading]       = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Poll unread count every 30s — only when logged in
  useEffect(() => {
    if (!user) return;
    function fetchCount() {
      api.get('/notifications/unread-count').then(d => setCount(d.count || 0)).catch(() => {});
    }
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleOpen() {
    setOpen(v => !v);
    if (!open) {
      setLoading(true);
      api.get('/notifications').then(setNotifs).catch(() => {}).finally(() => setLoading(false));
    }
  }

  async function handleReadAll() {
    await api.post('/notifications/read-all').catch(() => {});
    setNotifs(n => n.map(x => ({ ...x, read: true })));
    setCount(0);
  }

  async function handleClick(notif) {
    if (!notif.read) {
      await api.post(`/notifications/read/${notif.id}`).catch(() => {});
      setNotifs(n => n.map(x => x.id === notif.id ? { ...x, read: true } : x));
      setCount(c => Math.max(0, c - 1));
    }
    // Navigate to the relevant content
    if (notif.post_id) navigate(`/forum/post/${notif.post_id}`);
    else if (notif.actor?.username) navigate(`/profile/${notif.actor.username}`);
    setOpen(false);
  }

  return (
    <div className="notif-bell-wrap" ref={panelRef}>
      <button className="notif-bell-btn" onClick={handleOpen} type="button" title="Notifications">
        🔔
        {count > 0 && <span className="notif-bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <h3>Notifications</h3>
            {count > 0 && <button className="notif-read-all-btn" onClick={handleReadAll} type="button">Mark all read</button>}
          </div>

          {loading ? <div className="notif-loading">Loading...</div>
          : notifs.length === 0 ? (
            <div className="notif-empty">
              <p>🔕</p>
              <p>No notifications yet</p>
            </div>
          ) : (
            <div className="notif-list">
              {notifs.map(n => (
                <button key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => handleClick(n)} type="button">
                  <span className="notif-icon">{TYPE_ICONS[n.type] || '🔔'}</span>
                  <div className="notif-content">
                    <p className="notif-message">{n.message}</p>
                    <span className="notif-time">{timeAgo(n.created_at)}</span>
                  </div>
                  {!n.read && <span className="notif-dot" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

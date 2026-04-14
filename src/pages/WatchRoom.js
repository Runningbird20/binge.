import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

function timeAgo(d) {
  const diff = Math.floor((Date.now() - new Date(d)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

// ── Create Room Modal ─────────────────────────────────────────
function CreateRoomModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!title.trim()) return setError('Title required');
    setLoading(true);
    try {
      const room = await api.post('/watchroom', { title: title.trim(), media_type: 'movie' });
      onCreated(room);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="forum-modal" onClick={e => e.stopPropagation()}>
        <div className="forum-modal-header">
          <h2>🎬 Watch Together</h2>
          <button onClick={onClose} type="button" className="modal-close-btn">✕</button>
        </div>
        <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Create a room and share the code with friends. Everyone chooses their own stream — you're just syncing the vibe.
        </p>
        {error && <div className="forum-error">{error}</div>}
        <label className="forum-field-label">Room Name</label>
        <input className="forum-input" placeholder="Movie night 🍿" value={title} onChange={e => setTitle(e.target.value)} />
        <div className="forum-modal-actions">
          <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={loading || !title.trim()} type="button">
            {loading ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Room View ─────────────────────────────────────────────────
function RoomView({ roomId }) {
  const { user } = useAuth();
  const [room, setRoom]         = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage]   = useState('');
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const messagesEndRef          = useRef(null);
  const lastTsRef               = useRef(Date.now());
  const pollRef                 = useRef(null);

  useEffect(() => {
    api.get(`/watchroom/${roomId}`)
      .then(data => { setRoom(data.room); setMessages(data.messages || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [roomId]);

  // Poll for new messages every 3s
  const pollMessages = useCallback(async () => {
    try {
      const newMsgs = await api.get(`/watchroom/${roomId}/messages/since/${lastTsRef.current}`);
      if (newMsgs.length > 0) {
        setMessages(prev => [...prev, ...newMsgs]);
        lastTsRef.current = Date.now();
      }
    } catch { /* ignore */ }
  }, [roomId]);

  useEffect(() => {
    pollRef.current = setInterval(pollMessages, 3000);
    return () => clearInterval(pollRef.current);
  }, [pollMessages]);

  // Scroll to bottom on new messages
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const msg = await api.post(`/watchroom/${roomId}/message`, { message });
      setMessages(prev => [...prev, msg]);
      setMessage('');
      lastTsRef.current = Date.now();
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  function copyCode() {
    navigator.clipboard?.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="loading-state">Loading room...</div>;
  if (!room)   return <div className="empty-state">Room not found or has ended.</div>;

  return (
    <div className="watchroom-layout">
      {/* Header */}
      <div className="watchroom-header">
        <div>
          <h1 className="watchroom-title">{room.title}</h1>
          <p className="watchroom-host">Hosted by u/{room.host?.username}</p>
        </div>
        <div className="watchroom-code-wrap">
          <span className="watchroom-code-label">Room code:</span>
          <button className="watchroom-code" onClick={copyCode} type="button">
            {roomId} {copied ? '✓' : '📋'}
          </button>
        </div>
      </div>

      <div className="watchroom-body">
        {/* Hint */}
        <div className="watchroom-hint">
          <p>🎬 Everyone opens the movie/show they want to watch — use the player buttons on the Movies or TV Shows page.</p>
          <p>📡 Use this chat to coordinate: "3... 2... 1... Play!"</p>
        </div>

        {/* Chat */}
        <div className="watchroom-chat">
          <div className="watchroom-messages">
            {messages.length === 0 && <p className="watchroom-empty">No messages yet. Say hello!</p>}
            {messages.map((msg, i) => {
              const isMe = user?.id === msg.user_id;
              return (
                <div key={msg.id || i} className={`watchroom-msg ${isMe ? 'mine' : ''}`}>
                  {!isMe && <span className="watchroom-msg-author">{msg.profiles?.username}</span>}
                  <div className="watchroom-msg-bubble">{msg.message}</div>
                  <span className="watchroom-msg-time">{timeAgo(msg.created_at)}</span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {user ? (
            <form className="watchroom-input-row" onSubmit={handleSend}>
              <input
                className="watchroom-input"
                placeholder="Say something..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                autoComplete="off"
              />
              <button className="btn-primary btn-sm" type="submit" disabled={sending || !message.trim()}>
                {sending ? '...' : 'Send'}
              </button>
            </form>
          ) : (
            <p className="watchroom-login">Log in to chat</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── WatchRoom Home ────────────────────────────────────────────
export default function WatchRoom() {
  const { roomId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode]     = useState('');

  function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length >= 4) navigate(`/watch-room/${code}`);
  }

  if (roomId) {
    return (
      <div className="app-layout">
        <Navbar />
        <main className="page-content watchroom-page">
          <Link to="/watch-room" className="forum-back-link">← Watch Together</Link>
          <RoomView roomId={roomId} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content watchroom-page">
        <div className="watchroom-home">
          <div className="watchroom-hero">
            <h1>🎬 Watch Together</h1>
            <p>Create a room, share the code, and watch movies & shows in sync with friends. Chat in real time while you watch.</p>
          </div>

          <div className="watchroom-actions">
            {user && (
              <button className="btn-primary watchroom-create-btn" onClick={() => setShowCreate(true)} type="button">
                + Create Room
              </button>
            )}
            <div className="watchroom-join-row">
              <input
                className="forum-input"
                placeholder="Enter room code (e.g. AB1C23)"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                maxLength={10}
                style={{ marginBottom: 0 }}
              />
              <button className="btn-primary" onClick={handleJoin} disabled={joinCode.length < 4} type="button">Join</button>
            </div>
          </div>

          <div className="watchroom-how">
            <h2>How it works</h2>
            <div className="watchroom-steps">
              <div className="watchroom-step"><span className="watchroom-step-num">1</span><p>Create a room and share the 6-character code with your friends</p></div>
              <div className="watchroom-step"><span className="watchroom-step-num">2</span><p>Everyone navigates to a movie or show on the site and opens the player</p></div>
              <div className="watchroom-step"><span className="watchroom-step-num">3</span><p>Use the room chat to count down and press play at the same time</p></div>
              <div className="watchroom-step"><span className="watchroom-step-num">4</span><p>Chat and react together in real time while you watch</p></div>
            </div>
          </div>
        </div>

        {showCreate && (
          <CreateRoomModal
            onClose={() => setShowCreate(false)}
            onCreated={room => navigate(`/watch-room/${room.id}`)}
          />
        )}
      </main>
    </div>
  );
}

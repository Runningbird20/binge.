import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';

const INTENT_LABELS = {
  recommendation: '🎯 Recommendation',
  thematic: '🎭 Analysis',
  factual: '📋 Factual',
  general: '💬 General',
};

const SUGGESTED_PROMPTS = [
  'Recommend something based on my ratings',
  'What are the best drama TV shows?',
  'Who directed The Dark Knight?',
  'What themes does Dune explore?',
  'Best sci-fi movies of all time?',
  'What should I read if I like mystery?',
];

// ─── Request Modal ─────────────────────────────────────────────────────────────

function RequestModal({ prefill, onClose }) {
  const [title, setTitle]         = useState(prefill?.title || '');
  const [mediaType, setMediaType] = useState(prefill?.media_type || 'movie');
  const [year, setYear]           = useState('');
  const [reason, setReason]       = useState('');
  const [status, setStatus]       = useState(null);
  const [error, setError]         = useState('');

  async function submit() {
    if (!title.trim()) { setError('Please enter a title.'); return; }
    setStatus('loading');
    setError('');
    try {
      await api.post('/requests', { title: title.trim(), media_type: mediaType, year: year || undefined, reason });
      setStatus('success');
    } catch (err) {
      const message = String(err?.message || '').trim();
      if (/unauthorized|invalid token/i.test(message)) {
        setError('Media requests still use the legacy backend session. General chat works, but requesting new titles needs the old backend login.');
      } else {
        setError(message || 'Something went wrong.');
      }
      setStatus(null);
    }
  }

  return (
    <div className="req-overlay" onClick={onClose}>
      <div className="req-modal" onClick={e => e.stopPropagation()}>
        {status === 'success' ? (
          <div className="req-success">
            <div className="req-success-icon">✨</div>
            <h3>Request submitted!</h3>
            <p>An admin will review your request for <em>"{title}"</em>.</p>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="req-header">
              <div>
                <p className="req-eyebrow">Can't find it?</p>
                <h3 className="req-title">Request Media</h3>
              </div>
              <button className="req-close" onClick={onClose}>✕</button>
            </div>
            <p className="req-subtitle">Ask an admin to add something to binge.</p>

            {error && <div className="req-error">{error}</div>}

            <div className="req-form">
              <div className="req-field">
                <label>Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Interstellar"
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  autoFocus
                />
              </div>

              <div className="req-field-row">
                <div className="req-field">
                  <label>Type</label>
                  <select value={mediaType} onChange={e => setMediaType(e.target.value)}>
                    <option value="movie">🎬 Movie</option>
                    <option value="tv_show">📺 TV Show</option>
                    <option value="book">📚 Book</option>
                  </select>
                </div>
                <div className="req-field">
                  <label>Year <span className="req-optional">(optional)</span></label>
                  <input
                    type="number"
                    value={year}
                    onChange={e => setYear(e.target.value)}
                    placeholder="e.g. 2014"
                    min="1888" max="2030"
                  />
                </div>
              </div>

              <div className="req-field">
                <label>Why do you want it? <span className="req-optional">(optional)</span></label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. It's a classic everyone should see"
                  rows={2}
                />
              </div>

              <button
                className="req-submit"
                onClick={submit}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Submitting...' : 'Submit Request →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Source badges ─────────────────────────────────────────────────────────────

function SiteBadge({ source }) {
  const icon = source.media_type === 'movie' ? '🎬' : source.media_type === 'tv_show' ? '📺' : '📚';
  return (
    <a href={source.siteUrl} className="chat-source-badge chat-source-badge--site"
       title={`View on binge.: ${source.title}${source.year ? ` (${source.year})` : ''}`}>
      {icon} {source.title}
    </a>
  );
}

function WebBadge({ source }) {
  return (
    <a href={source.url} target="_blank" rel="noreferrer"
       className="chat-source-badge chat-source-badge--web"
       title={source.snippet || source.title}>
      🌐 {source.source || 'Web'}
    </a>
  );
}

// ─── Message ───────────────────────────────────────────────────────────────────

function Message({ msg }) {
  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      {msg.role === 'assistant' && (
        <div className="chat-message-header">
          <span className="chat-avatar">🦉</span>
          {msg.intent && <span className="chat-intent-badge">{INTENT_LABELS[msg.intent] || msg.intent}</span>}
          {msg.latency && <span className="chat-latency">{(msg.latency / 1000).toFixed(1)}s</span>}
        </div>
      )}
      {msg.role === 'user' && (
        <div className="chat-message-header">
          <span className="chat-avatar chat-avatar--user">👤</span>
        </div>
      )}
      <div className="chat-message-body">
        <p className="chat-message-text">{msg.content}</p>

        {(msg.siteSources?.length > 0 || msg.webSources?.length > 0) && (
          <div className="chat-sources-row">
            {msg.siteSources?.length > 0 && (
              <div className="chat-sources">
                <span className="chat-sources-label">On binge.</span>
                <div className="chat-sources-list">
                  {msg.siteSources.map(s => <SiteBadge key={`${s.media_type}:${s.id}`} source={s} />)}
                </div>
              </div>
            )}
            {msg.webSources?.length > 0 && (
              <div className="chat-sources">
                <span className="chat-sources-label">Sources</span>
                <div className="chat-sources-list">
                  {msg.webSources.map((s, i) => <WebBadge key={i} source={s} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ChatBot ──────────────────────────────────────────────────────────────

export default function ChatBot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen]             = useState(false);
  const [isMinimized, setIsMinimized]   = useState(false);
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [apiStatus, setApiStatus]       = useState(null);
  const [requestModal, setRequestModal] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const runStatusCheck = useCallback(async () => {
    try {
      const data = await api.get('/chat/status');
      setApiStatus(data.ok);
      if (data.ok && messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hey ${user?.username || 'there'}! ðŸ¦‰ Ask me anything about movies, TV shows, or books â€” reviews, themes, cast, recommendations, you name it. I'll search the web and show you what's available on binge.!`,
        }]);
      }
    } catch {
      setApiStatus(false);
    }
  }, [messages.length, user?.username]);

  useEffect(() => {
    if (!isOpen || apiStatus !== null) return;
    runStatusCheck();
  }, [isOpen, apiStatus, runStatusCheck]);

  async function checkStatus() {
    try {
      const data = await api.get('/chat/status');
      setApiStatus(data.ok);
      if (data.ok && messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hey ${user?.username || 'there'}! 🦉 Ask me anything about movies, TV shows, or books — reviews, themes, cast, recommendations, you name it. I'll search the web and show you what's available on binge.!`,
        }]);
      }
    } catch {
      setApiStatus(false);
    }
  }

  useEffect(() => {
    if (isOpen && !isMinimized) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, isMinimized]);

  useEffect(() => {
    if (isOpen && !isMinimized && apiStatus) inputRef.current?.focus();
  }, [isOpen, isMinimized, apiStatus]);

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;
    setInput('');

    const userMsg = { id: Date.now(), role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const conversationHistory = messages
      .filter(m => m.id !== 'welcome')
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const data = await api.post('/chat', { message: trimmed, conversationHistory });
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.response,
        intent: data.intent,
        siteSources: data.siteSources || data.sources || [],
        webSources: data.webSources || [],
        latency: data.latency,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: `⚠️ ${err?.message || 'Something went wrong. Please try again.'}`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function clearChat() { setMessages([]); setApiStatus(null); }

  if (!user) return null;

  return (
    <>
      {/* FAB */}
      <button
        className={`chatbot-fab ${isOpen ? 'chatbot-fab--open' : ''}`}
        onClick={() => { setIsOpen(o => !o); setIsMinimized(false); }}
        aria-label="Open AI media assistant"
      >
        {isOpen ? '✕' : '🦉'}
        {!isOpen && <span className="chatbot-fab-label">Ask AI</span>}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className={`chatbot-panel ${isMinimized ? 'chatbot-panel--minimized' : ''}`}>

          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-title">
              <span className="chatbot-header-owl">🦉</span>
              <div>
                <strong>Media Assistant</strong>
                <span className={`chatbot-status-dot chatbot-status-dot--${apiStatus ? 'online' : apiStatus === false ? 'offline' : 'checking'}`} />
              </div>
            </div>
            <div className="chatbot-header-actions">
              <button
                onClick={() => setRequestModal({})}
                className="chatbot-request-trigger"
                title="Request media"
              >
                + Request
              </button>
              <button onClick={clearChat} title="Clear chat" className="chatbot-icon-btn">🗑</button>
              <button onClick={() => setIsMinimized(m => !m)} className="chatbot-icon-btn">{isMinimized ? '▲' : '▼'}</button>
              <button onClick={() => setIsOpen(false)} className="chatbot-icon-btn">✕</button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {apiStatus === false && (
                <div className="chatbot-offline-banner">
                  <strong>⚠️ AI not available.</strong>
                  <p>Make sure <code>GROQ_API_KEY</code> is set in your <code>.env</code> file.</p>
                  <button className="chatbot-retry-btn" onClick={() => { setApiStatus(null); checkStatus(); }}>Retry</button>
                </div>
              )}

              <div className="chatbot-messages">
                {messages.map(msg => <Message key={msg.id} msg={msg} />)}
                {loading && (
                  <div className="chat-message chat-message--assistant">
                    <div className="chat-message-header"><span className="chat-avatar">🦉</span></div>
                    <div className="chat-message-body">
                      <div className="chat-typing-indicator"><span /><span /><span /></div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {messages.length <= 1 && !loading && apiStatus && (
                <div className="chatbot-suggestions">
                  {SUGGESTED_PROMPTS.map(p => (
                    <button key={p} className="chatbot-suggestion-chip" onClick={() => sendMessage(p)}>{p}</button>
                  ))}
                </div>
              )}

              <div className="chatbot-input-row">
                <textarea
                  ref={inputRef}
                  className="chatbot-input"
                  placeholder="Ask anything about movies, books, TV..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading || !apiStatus}
                  rows={1}
                />
                <button
                  className="chatbot-send-btn"
                  onClick={() => sendMessage()}
                  disabled={loading || !input.trim() || !apiStatus}
                >
                  {loading ? '⏳' : '➤'}
                </button>
              </div>
              <p className="chatbot-footer-note">Web search enabled · binge. catalog cross-referenced</p>
            </>
          )}
        </div>
      )}

      {requestModal && (
        <RequestModal prefill={requestModal} onClose={() => setRequestModal(null)} />
      )}
    </>
  );
}

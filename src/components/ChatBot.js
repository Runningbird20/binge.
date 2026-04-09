import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';

const INTENT_LABELS = {
  recommendation: '🎯 Recommendation',
  thematic: '🎭 Thematic Analysis',
  factual: '📋 Factual Lookup',
  general: '💬 General',
};

const SUGGESTED_PROMPTS = [
  'Recommend something based on my ratings',
  'What themes does Inception share with other films?',
  'Who directed The Dark Knight?',
  'Suggest books similar to ones I\'ve enjoyed',
  'What are some highly rated sci-fi movies?',
  'Compare two books I might like',
];

function SourceBadge({ source }) {
  const icon = source.media_type === 'movie' ? '🎬' : source.media_type === 'tv_show' ? '📺' : '📚';
  const label = `${source.title}${source.year ? ` (${source.year})` : ''}`;
  if (source.siteUrl) {
    return (
      <a href={source.siteUrl} className="chat-source-badge chat-source-badge--link"
         title={`View ${label} on binge.`}>
        {icon} {source.title}
      </a>
    );
  }
  return (
    <span className="chat-source-badge" title={label}>
      {icon} {source.title}
    </span>
  );
}

function Message({ msg }) {
  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      {msg.role === 'assistant' && (
        <div className="chat-message-header">
          <span className="chat-avatar">🤖</span>
          {msg.intent && (
            <span className="chat-intent-badge">{INTENT_LABELS[msg.intent] || msg.intent}</span>
          )}
          {msg.latency && (
            <span className="chat-latency">{(msg.latency / 1000).toFixed(1)}s</span>
          )}
        </div>
      )}
      {msg.role === 'user' && (
        <div className="chat-message-header">
          <span className="chat-avatar chat-avatar--user">👤</span>
        </div>
      )}
      <div className="chat-message-body">
        <p className="chat-message-text">{msg.content}</p>
        {msg.sources && msg.sources.length > 0 && (
          <div className="chat-sources">
            <span className="chat-sources-label">Sources used:</span>
            <div className="chat-sources-list">
              {msg.sources.map((s) => (
                <SourceBadge key={`${s.media_type}:${s.id}`} source={s} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatBot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState(null); // null=checking, true=ok, false=down
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Check Ollama status when panel opens
  useEffect(() => {
    if (!isOpen || ollamaStatus !== null) return;
    checkStatus();
  }, [isOpen, ollamaStatus]);

  async function checkStatus() {
    try {
      const data = await api.get('/chat/status');
      setOllamaStatus(data.ok);
      if (data.ok && messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hi ${user?.username || 'there'}! 👋 I'm your media assistant. I can help you discover movies, TV shows, and books — ask me anything! Try asking for recommendations based on your ratings, or explore themes across different works.`,
        }]);
      }
    } catch {
      setOllamaStatus(false);
    }
  }

  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isMinimized]);

  useEffect(() => {
    if (isOpen && !isMinimized && ollamaStatus) {
      inputRef.current?.focus();
    }
  }, [isOpen, isMinimized, ollamaStatus]);

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    setInput('');
    setError(null);

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Build conversation history (exclude welcome message)
    const conversationHistory = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const data = await api.post('/chat', {
        message: trimmed,
        conversationHistory,
      });

      const assistantMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.response,
        intent: data.intent,
        sources: data.sources || [],
        latency: data.latency,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg = err?.message || 'Something went wrong. Please try again.';
      setError(errMsg);
      setMessages((prev) => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: `⚠️ ${errMsg}`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([]);
    setOllamaStatus(null); // re-check and re-add welcome
  }

  if (!user) return null;

  return (
    <>
      {/* Floating toggle button */}
      <button
        className={`chatbot-fab ${isOpen ? 'chatbot-fab--open' : ''}`}
        onClick={() => { setIsOpen((o) => !o); setIsMinimized(false); }}
        aria-label="Open AI media assistant"
        title="Ask your media assistant"
      >
        {isOpen ? '✕' : '🤖'}
        {!isOpen && <span className="chatbot-fab-label">Ask AI</span>}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className={`chatbot-panel ${isMinimized ? 'chatbot-panel--minimized' : ''}`}>
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-title">
              <span>🤖</span>
              <div>
                <strong>Media Assistant</strong>
                <span className={`chatbot-status-dot ${ollamaStatus ? 'chatbot-status-dot--online' : ollamaStatus === false ? 'chatbot-status-dot--offline' : 'chatbot-status-dot--checking'}`} />
              </div>
            </div>
            <div className="chatbot-header-actions">
              <button onClick={clearChat} title="Clear chat" className="chatbot-icon-btn">🗑</button>
              <button onClick={() => setIsMinimized((m) => !m)} title="Minimize" className="chatbot-icon-btn">
                {isMinimized ? '▲' : '▼'}
              </button>
              <button onClick={() => setIsOpen(false)} title="Close" className="chatbot-icon-btn">✕</button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Ollama offline warning */}
              {ollamaStatus === false && (
                <div className="chatbot-offline-banner">
                  <strong>⚠️ Ollama not detected.</strong>
                  <p>
                    To use the AI assistant, install <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> and run:
                  </p>
                  <code>ollama pull llama3.2</code>
                  <br />
                  <code>ollama serve</code>
                  <button className="chatbot-retry-btn" onClick={() => { setOllamaStatus(null); checkStatus(); }}>
                    Retry connection
                  </button>
                </div>
              )}

              {/* Messages */}
              <div className="chatbot-messages">
                {messages.map((msg) => (
                  <Message key={msg.id} msg={msg} />
                ))}
                {loading && (
                  <div className="chat-message chat-message--assistant">
                    <div className="chat-message-header">
                      <span className="chat-avatar">🤖</span>
                    </div>
                    <div className="chat-message-body">
                      <div className="chat-typing-indicator">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggested prompts — only shown when chat is empty */}
              {messages.length <= 1 && !loading && ollamaStatus && (
                <div className="chatbot-suggestions">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      className="chatbot-suggestion-chip"
                      onClick={() => sendMessage(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="chatbot-input-row">
                <textarea
                  ref={inputRef}
                  className="chatbot-input"
                  placeholder={ollamaStatus ? 'Ask about movies, books, TV shows...' : 'AI offline — start Ollama to chat'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading || !ollamaStatus}
                  rows={1}
                />
                <button
                  className="chatbot-send-btn"
                  onClick={() => sendMessage()}
                  disabled={loading || !input.trim() || !ollamaStatus}
                >
                  {loading ? '⏳' : '➤'}
                </button>
              </div>
              <p className="chatbot-footer-note">Powered by Ollama · Runs locally · Free &amp; private</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

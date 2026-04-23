import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import MediaDetailsModal from './MediaDetailsModal';
import { isSupabaseConfigured, supabase } from '../utils/supabase';
import { checkChatbotStatus, sendChatbotMessage } from '../utils/chatbotApi';
import { submitSupabaseRequest } from '../utils/supabaseData';

const INTENT_LABELS = {
  recommendation: '🎯 Recommendation',
  thematic: '🎭 Analysis',
  factual: '📋 Factual',
  general: '💬 General',
};

const MAX_CATALOG_LINKS = 5;
const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'answer',
  'best',
  'book',
  'books',
  'here',
  'heres',
  'i',
  'it',
  'movie',
  'movies',
  'show',
  'shows',
  'some',
  'that',
  'the',
  'these',
  'this',
  'tv',
  'what',
  'you',
]);

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
      await submitSupabaseRequest({ title: title.trim(), media_type: mediaType, year: year || undefined, reason });
      setStatus('success');
    } catch (err) {
      const message = String(err?.message || '').trim();
      setError(message || 'Something went wrong.');
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

// ─── Utility function to extract titles from text ──────────────────────────────

function normalizeTitleKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildCatalogSearchPattern(value) {
  const normalized = String(value || '')
    .replace(/[,%_"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .join('%');

  return normalized ? `%${normalized}%` : '';
}

function buildSiteUrl(mediaType, id) {
  if (mediaType === 'movie') return `/movies?open=${id}`;
  if (mediaType === 'tv_show') return `/tv-shows?open=${id}`;
  return `/books?open=${id}`;
}

function sanitizeExtractedTitle(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
    .replace(/\s+\(\d{4}\)\s*$/, '')
    .replace(/[.,:;!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addUniqueTitle(titles, seenTitles, candidate) {
  const title = sanitizeExtractedTitle(candidate);
  const key = normalizeTitleKey(title);

  if (!key || key.length < 2 || TITLE_STOP_WORDS.has(key) || seenTitles.has(key)) {
    return;
  }

  titles.push(title);
  seenTitles.add(key);
}

function extractTitlesFromText(text) {
  const titles = [];
  const seenTitles = new Set();
  const quotedPattern = /"([^"\n]{2,120})"/g;
  const boldPattern = /\*\*([^*\n]{2,120})\*\*/g;
  let match;

  while ((match = quotedPattern.exec(text || '')) !== null) {
    addUniqueTitle(titles, seenTitles, match[1]);
  }

  while ((match = boldPattern.exec(text || '')) !== null) {
    addUniqueTitle(titles, seenTitles, match[1]);
  }

  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const bulletMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (!bulletMatch) return;

      const candidate = bulletMatch[1]
        .split(/\s+-\s+/)[0]
        .split(/\s+by\s+/i)[0]
        .trim();

      addUniqueTitle(titles, seenTitles, candidate);
    });

  return titles.slice(0, MAX_CATALOG_LINKS);
}

function scoreCatalogMatch(candidateTitle, requestedTitle) {
  const candidateKey = normalizeTitleKey(candidateTitle);
  const requestedKey = normalizeTitleKey(requestedTitle);

  if (!candidateKey || !requestedKey) {
    return 0;
  }

  if (candidateKey === requestedKey) {
    return 100;
  }

  if (candidateKey.startsWith(`${requestedKey} `) || candidateKey.startsWith(`${requestedKey}:`)) {
    return 90;
  }

  if (requestedKey.startsWith(`${candidateKey} `) || candidateKey.includes(requestedKey)) {
    return 75;
  }

  return 0;
}

function mapCatalogRowToSource(row, mediaType) {
  return {
    id: row.id,
    title: row.title,
    year: row.year || null,
    media_type: mediaType,
    siteUrl: buildSiteUrl(mediaType, row.id),
  };
}

async function searchCatalogByTitle(title) {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const pattern = buildCatalogSearchPattern(title);
  if (!pattern) {
    return null;
  }

  const queries = [
    supabase.from('movies').select('id, title, year').ilike('title', pattern).limit(3),
    supabase.from('tv_shows').select('id, title, year').ilike('title', pattern).limit(3),
    supabase.from('books').select('id, title, year').ilike('title', pattern).limit(3),
  ];

  const [movieResult, tvResult, bookResult] = await Promise.allSettled(queries);
  const candidates = [];

  if (movieResult.status === 'fulfilled' && !movieResult.value.error) {
    candidates.push(...(movieResult.value.data || []).map((row) => mapCatalogRowToSource(row, 'movie')));
  }

  if (tvResult.status === 'fulfilled' && !tvResult.value.error) {
    candidates.push(...(tvResult.value.data || []).map((row) => mapCatalogRowToSource(row, 'tv_show')));
  }

  if (bookResult.status === 'fulfilled' && !bookResult.value.error) {
    candidates.push(...(bookResult.value.data || []).map((row) => mapCatalogRowToSource(row, 'book')));
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCatalogMatch(candidate.title, title),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || (Number(right.year) || 0) - (Number(left.year) || 0))[0] || null;
}

function mergeSiteSources(...groups) {
  const merged = [];
  const seenSources = new Set();

  groups.flat().filter(Boolean).forEach((source) => {
    const key = `${source.media_type}:${source.id}`;
    if (seenSources.has(key)) {
      return;
    }

    seenSources.add(key);
    merged.push(source);
  });

  return merged.slice(0, MAX_CATALOG_LINKS);
}

function stripLinkedTitleList(text, siteSources) {
  if (!text || !(siteSources || []).length) {
    return text;
  }

  const sourceTitleKeys = new Set(siteSources.map((source) => normalizeTitleKey(source.title)));
  const lines = String(text).split(/\r?\n/);
  const filteredLines = lines.filter((line) => {
    const candidate = sanitizeExtractedTitle(line);
    const normalizedCandidate = normalizeTitleKey(candidate);
    const looksLikeListItem = /^\s*(?:[-*]|\d+\.)\s+/.test(line);

    if (!looksLikeListItem || !normalizedCandidate) {
      return true;
    }

    return !sourceTitleKeys.has(normalizedCandidate);
  });

  const cleaned = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || text;
}

function humanizeAssistantText(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Search Supabase for media matching extracted titles ──────────────────────

async function searchMediaByTitles(titles) {
  const uniqueTitles = [...new Set((titles || []).map((title) => sanitizeExtractedTitle(title)).filter(Boolean))]
    .slice(0, MAX_CATALOG_LINKS);

  const results = await Promise.all(uniqueTitles.map((title) => searchCatalogByTitle(title)));
  const seenSources = new Set();

  return results
    .filter(Boolean)
    .filter((source) => {
      const key = `${source.media_type}:${source.id}`;
      if (seenSources.has(key)) {
        return false;
      }

      seenSources.add(key);
      return true;
    });
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
                <span className="chat-sources-label">Open on binge.</span>
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
  const [apiError, setApiError]         = useState('');
  const [requestModal, setRequestModal] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const runStatusCheck = useCallback(async () => {
    try {
      await checkChatbotStatus();
      setApiStatus(true);
      setApiError('');
      if (messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hey ${user?.username || 'there'}! 🦉 Ask me anything about movies, TV shows, or books — reviews, themes, cast, recommendations, you name it.`,
        }]);
      }
    } catch (error) {
      setApiStatus(false);
      setApiError(String(error?.message || '').trim() || 'The AI assistant is unavailable right now.');
    }
  }, [messages.length, user?.username]);

  useEffect(() => {
    if (!isOpen || apiStatus !== null) return;
    runStatusCheck();
  }, [isOpen, apiStatus, runStatusCheck]);

  async function checkStatus() {
    try {
      await checkChatbotStatus();
      setApiStatus(true);
      setApiError('');
      if (messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Hey ${user?.username || 'there'}! 🦉 Ask me anything about movies, TV shows, or books — reviews, themes, cast, recommendations, you name it.`,
        }]);
      }
    } catch (error) {
      setApiStatus(false);
      setApiError(String(error?.message || '').trim() || 'The AI assistant is unavailable right now.');
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

    const startTime = Date.now();
    try {
      const data = await sendChatbotMessage({
        message: trimmed,
        conversationHistory,
      });
      setApiStatus(true);
      setApiError('');

      const latencyMs = Date.now() - startTime;
      const rawAssistantContent = data?.content || data?.choices?.[0]?.message?.content || data?.response || 'No response.';
      const extractedTitles = extractTitlesFromText(rawAssistantContent);
      const resolvedSiteSources = mergeSiteSources(
        Array.isArray(data?.siteSources) ? data.siteSources : [],
        await searchMediaByTitles(extractedTitles)
      );
      const assistantContent = humanizeAssistantText(
        stripLinkedTitleList(rawAssistantContent, resolvedSiteSources) || 'I found these on binge.'
      );

      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: assistantContent,
        intent: data?.intent || null,
        siteSources: resolvedSiteSources,
        webSources: data?.webSources || [],
      }]);

      if (supabase && user?.id) {
        supabase.from('chat_logs').insert({
          user_id: user.id,
          query: trimmed.slice(0, 500),
          intent: data?.intent || null,
          response_length: rawAssistantContent.length,
          sources_count: resolvedSiteSources.length + (data?.webSources?.length || 0),
          latency_ms: latencyMs,
        }).then(() => {}).catch(() => {});
      }
    } catch (err) {
      setApiError(String(err?.message || '').trim() || 'Something went wrong. Please try again.');
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: `⚠️ ${err?.message || 'Something went wrong. Please try again.'}`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, user?.id]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function clearChat() { setMessages([]); setApiStatus(null); setApiError(''); }

  function handleOpenModal(item) {
    setSelectedItem(item);
  }

  function handleCloseModal() {
    setSelectedItem(null);
  }

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
                  <p>{apiError || 'The chatbot could not reach either the Supabase edge function or the /api/chat backend.'}</p>
                  <p>Supported backends are the Supabase <code>ai-chatbot</code> function and the server <code>/api/chat</code> route.</p>
                  <button className="chatbot-retry-btn" onClick={() => { setApiStatus(null); checkStatus(); }}>Retry</button>
                </div>
              )}

              <div className="chatbot-messages">
                {messages.map(msg => <Message key={msg.id} msg={msg} onOpenModal={handleOpenModal} />)}
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

      {selectedItem && (
        <MediaDetailsModal
          item={selectedItem}
          mediaType={selectedItem.mediaType}
          onClose={handleCloseModal}
          allowActions={false}
          browseOnlyMessage="Chat preview mode - view only"
        />
      )}
    </>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ThemedSelect from './ThemedSelect';
import { submitSupabaseRequest } from '../utils/supabaseData';
import { generateSupabaseTypeRecommendations } from '../utils/recommendations';

const MEDIA_ICONS = { movie: '🎬', tv_show: '📺', book: '📚' };
const MEDIA_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };

// The FAB floats over video content, so keep it off pages built around a video player.
const HIDDEN_PATHS = ['/sports', '/live-tv'];

const TYPE_TABS = [
  { id: 'movie', label: 'Movies', icon: '🎬' },
  { id: 'tv_show', label: 'TV', icon: '📺' },
  { id: 'book', label: 'Books', icon: '📚' },
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
                  <ThemedSelect
                    label="Type"
                    value={mediaType}
                    options={[
                      { value: 'movie', label: 'Movie' },
                      { value: 'tv_show', label: 'TV Show' },
                      { value: 'book', label: 'Book' },
                    ]}
                    onChange={e => setMediaType(e.target.value)}
                  />
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

// ─── Recommendation card ───────────────────────────────────────────────────────

function RecommendationCard({ rec }) {
  return (
    <a href={rec.siteUrl} className="foryou-card">
      <div className="foryou-card-poster">
        {rec.posterUrl ? (
          <img src={rec.posterUrl} alt={rec.title} />
        ) : (
          <div className="foryou-card-placeholder">
            {MEDIA_ICONS[rec.media_type]}
          </div>
        )}
      </div>
      <div className="foryou-card-body">
        <div className="foryou-card-type">
          {MEDIA_ICONS[rec.media_type]} {MEDIA_LABELS[rec.media_type]}
          {rec.year && <span className="foryou-card-year">{rec.year}</span>}
        </div>
        <h4 className="foryou-card-title">{rec.title}</h4>
        {rec.genre && <p className="foryou-card-genre">{rec.genre.split(',')[0].trim()}</p>}
        <p className="foryou-card-reason">✨ {rec.reason}</p>
      </div>
    </a>
  );
}

// ─── Recommender panel ─────────────────────────────────────────────────────────

const IDLE_TAB_STATE = { movie: 'idle', tv_show: 'idle', book: 'idle' };

export default function ChatBot() {
  const { user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen]             = useState(false);
  const [isMinimized, setIsMinimized]   = useState(false);
  const [activeType, setActiveType]     = useState('movie');
  const [tabState, setTabState]         = useState(IDLE_TAB_STATE); // idle | loading | done | empty | error
  const [tabData, setTabData]           = useState({});
  const [tabError, setTabError]         = useState({});
  const [requestModal, setRequestModal] = useState(null);

  const fetchType = useCallback(async (mediaType) => {
    setTabState((prev) => ({ ...prev, [mediaType]: 'loading' }));
    setTabError((prev) => ({ ...prev, [mediaType]: '' }));
    try {
      const result = await generateSupabaseTypeRecommendations(mediaType);
      setTabData((prev) => ({ ...prev, [mediaType]: result }));
      setTabState((prev) => ({ ...prev, [mediaType]: result.recommendations?.length ? 'done' : 'empty' }));
    } catch (err) {
      setTabError((prev) => ({ ...prev, [mediaType]: String(err?.message || '').trim() || 'Something went wrong.' }));
      setTabState((prev) => ({ ...prev, [mediaType]: 'error' }));
    }
  }, []);

  // Fetch a tab's recommendations the first time it's viewed.
  useEffect(() => {
    if (isOpen && tabState[activeType] === 'idle') fetchType(activeType);
  }, [isOpen, activeType, tabState, fetchType]);

  // Allow the mobile bottom nav "For You" tab to open the recommender.
  useEffect(() => {
    const handler = () => { setIsOpen(true); setIsMinimized(false); };
    window.addEventListener('binge:openAI', handler);
    return () => window.removeEventListener('binge:openAI', handler);
  }, []);

  if (!user || HIDDEN_PATHS.includes(location.pathname)) return null;

  const state = tabState[activeType];
  const data = tabData[activeType];
  const error = tabError[activeType];

  return (
    <>
      {/* FAB */}
      <button
        className={`chatbot-fab ${isOpen ? 'chatbot-fab--open' : ''}`}
        onClick={() => { setIsOpen(o => !o); setIsMinimized(false); }}
        aria-label="Open your recommendations"
      >
        {isOpen ? '✕' : '🍿'}
        {!isOpen && <span className="chatbot-fab-label">For You</span>}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className={`chatbot-panel ${isMinimized ? 'chatbot-panel--minimized' : ''}`}>

          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-title">
              <span className="chatbot-header-owl">🍿</span>
              <div>
                <strong>For You</strong>
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
              {state === 'done' && (
                <button onClick={() => fetchType(activeType)} title="Refresh recommendations" className="chatbot-icon-btn">↻</button>
              )}
              <button onClick={() => setIsMinimized(m => !m)} className="chatbot-icon-btn">{isMinimized ? '▲' : '▼'}</button>
              <button onClick={() => setIsOpen(false)} className="chatbot-icon-btn">✕</button>
            </div>
          </div>

          {!isMinimized && (
            <div className="chatbot-tabs">
              {TYPE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`chatbot-tab ${activeType === tab.id ? 'chatbot-tab--active' : ''}`}
                  onClick={() => setActiveType(tab.id)}
                >
                  <span>{tab.icon}</span> {tab.label}
                </button>
              ))}
            </div>
          )}

          {!isMinimized && (
            <div className="chatbot-messages">
              {state === 'loading' && (
                <div className="foryou-loading">
                  <div className="foryou-loading-owl">🍿</div>
                  <p>Matching your taste...</p>
                  <div className="foryou-loading-dots"><span /><span /><span /></div>
                </div>
              )}

              {state === 'error' && (
                <div className="foryou-error">
                  <p>⚠️ {error}</p>
                  <button type="button" className="foryou-generate-btn" onClick={() => fetchType(activeType)}>Try again</button>
                </div>
              )}

              {state === 'empty' && (
                <div className="foryou-idle">
                  <p className="foryou-idle-text">
                    {data?.message || 'Rate some movies, TV shows, or books first to unlock personalized recommendations!'}
                  </p>
                  <a href="/movies" className="foryou-generate-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
                    Browse & Rate Media
                  </a>
                </div>
              )}

              {state === 'done' && data && (
                <>
                  {data.tasteProfile && (
                    <div className="foryou-taste-profile">
                      <span className="foryou-taste-label">Your taste</span>
                      <p>{data.tasteProfile}</p>
                    </div>
                  )}
                  <div className="foryou-grid">
                    {data.recommendations.map(rec => (
                      <RecommendationCard key={`${rec.media_type}:${rec.id}`} rec={rec} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {requestModal && (
        <RequestModal prefill={requestModal} onClose={() => setRequestModal(null)} />
      )}
    </>
  );
}

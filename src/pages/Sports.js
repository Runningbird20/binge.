import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../components/Navbar';

const POLL_INTERVAL = 60 * 1000; // 60 s per API docs

const CATEGORY_ICONS = {
  'Basketball':     '🏀',
  'Soccer':         '⚽',
  'Football':       '🏈',
  'Baseball':       '⚾',
  'Hockey':         '🏒',
  'Combat Sports':  '🥊',
  'Boxing':         '🥊',
  'MMA':            '🥊',
  'Wrestling':      '🤼',
  'Tennis':         '🎾',
  'Golf':           '⛳',
  'Racing':         '🏎️',
  'Rugby':          '🏉',
  'Cricket':        '🏏',
  'Volleyball':     '🏐',
  'Olympics':       '🏅',
  'Esports':        '🎮',
  'Athletics':      '🏃',
  'Cycling':        '🚴',
  'Motorsport':     '🏎️',
};

function getCatIcon(cat) {
  if (!cat) return '🏆';
  for (const [k, v] of Object.entries(CATEGORY_ICONS)) {
    if (cat.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return '🏆';
}

function formatTime(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const today    = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString())    return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeUntil(unix) {
  const diff = unix * 1000 - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Sports() {
  const [streams, setStreams]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [selected, setSelected]         = useState(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow]                   = useState(Date.now());
  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const pollRef   = useRef(null);

  const fetchStreams = useCallback(async () => {
    try {
      const res = await fetch('/api/sports/streams');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStreams(data.streams || []);
      setError('');
    } catch (err) {
      setError('Could not load sports streams. ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreams();
    // Tick "now" every 30s so live status updates without a re-fetch
    const ticker = setInterval(() => setNow(Date.now()), 30000);
    // Poll API every 60 s
    pollRef.current = setInterval(fetchStreams, POLL_INTERVAL);
    return () => { clearInterval(ticker); clearInterval(pollRef.current); };
  }, [fetchStreams]);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      (iframeRef.current || playerRef.current)?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // Derive live/upcoming status from current time (updates every 30s)
  function getLiveStatus(s) {
    const nowSec = Math.floor(now / 1000);
    if (s.alwaysLive) return 'live';
    if (s.startsAt <= nowSec && s.endsAt >= nowSec) return 'live';
    if (s.startsAt > nowSec) return 'upcoming';
    return 'replay';
  }

  const categories = ['All', ...Array.from(
    new Set(streams.map(s => s.category).filter(Boolean))
  ).sort()];

  const liveCount = streams.filter(s => getLiveStatus(s) === 'live').length;

  const filtered = streams.filter(s => {
    return activeCategory === 'All' || s.category === activeCategory;
  });

  const iframeSrc = selected?.iframeSrc;

  return (
    <div className="app-layout">
      <Navbar />
      <div className="sports-shell">

        {/* ── Sidebar ── */}
        <aside className={`sports-sidebar ${sidebarOpen ? '' : 'sports-sidebar--hidden'}`}>
          <div className="sports-sidebar-header">
            <div className="sports-sidebar-title">
              <span>🏆</span>
              <h2>Sports</h2>
              {!loading && liveCount > 0 && (
                <span className="sports-live-count">{liveCount} LIVE</span>
              )}
            </div>
            <button className="sports-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>‹</button>
          </div>

          <div className="sports-categories">
            {categories.map(cat => {
              const count = cat === 'All'
                ? filtered.length
                : streams.filter(s => s.category === cat).length;
              return (
                <button
                  key={cat}
                  className={`sports-cat-btn ${activeCategory === cat ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat !== 'All' ? getCatIcon(cat) + ' ' : ''}{cat}
                  <span className="sports-cat-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="sports-stream-list">
            {loading ? (
              <div className="sports-loading">
                <div className="sports-loading-dots"><span /><span /><span /></div>
                <p>Loading streams...</p>
              </div>
            ) : error ? (
              <div className="sports-error">
                <p>⚠️ {error}</p>
                <button className="sports-retry-btn" onClick={fetchStreams}>Retry</button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="sports-empty">No streams available right now.</p>
            ) : (
              filtered.map(s => {
                const status = getLiveStatus(s);
                return (
                  <button
                    key={s.id}
                    className={`sports-stream-btn ${selected?.id === s.id ? 'active' : ''}`}
                    onClick={() => setSelected(s)}
                  >
                    {s.poster ? (
                      <img src={s.poster} alt={s.name} className="sports-stream-poster"
                        onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="sports-stream-poster sports-stream-poster--placeholder">
                        {getCatIcon(s.category)}
                      </div>
                    )}
                    <div className="sports-stream-info">
                      <span className="sports-stream-name">{s.name}</span>
                      {s.tag && <span className="sports-stream-tag">{s.tag}</span>}
                      <div className="sports-stream-meta">
                        {status === 'live' && (
                          <span className="sports-badge sports-badge--live">● LIVE</span>
                        )}
                        {status === 'upcoming' && (
                          <span className="sports-badge sports-badge--upcoming">
                            {formatDate(s.startsAt)} {formatTime(s.startsAt)}
                            {timeUntil(s.startsAt) && ` · ${timeUntil(s.startsAt)}`}
                          </span>
                        )}
                        {status === 'replay' && (
                          <span className="sports-badge sports-badge--replay">REPLAY</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="sports-sidebar-footer">
            <span>Powered by ppv.to</span>
            <button className="sports-refresh-btn" onClick={fetchStreams} title="Refresh streams">↻</button>
          </div>
        </aside>

        {/* ── Player ── */}
        <main className="sports-player-area" ref={playerRef}>
          {!sidebarOpen && (
            <button className="sports-sidebar-show-btn" onClick={() => setSidebarOpen(true)}>
              ☰ Streams
            </button>
          )}

          {selected ? (
            <>
              <div className="sports-now-playing">
                <div className="sports-now-info">
                  {getLiveStatus(selected) === 'live' && (
                    <span className="sports-live-badge">● LIVE</span>
                  )}
                  <span className="sports-now-name">{selected.name}</span>
                  {selected.tag && <span className="sports-now-tag">{selected.tag}</span>}
                  <span className="sports-now-cat">
                    {getCatIcon(selected.category)} {selected.category}
                  </span>
                </div>
                <button className="sports-fullscreen-btn" onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  {isFullscreen ? '↙' : '↗'}
                </button>
              </div>

              <div className="sports-frame-wrap">
                {iframeSrc ? (
                  /* Render WITHOUT sandbox — required by ppv.to terms */
                  <iframe
                    key={selected.id}
                    ref={iframeRef}
                    src={iframeSrc}
                    className="sports-frame"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope"
                    referrerPolicy="no-referrer-when-downgrade"
                    scrolling="no"
                    title={selected.name}
                  />
                ) : (
                  <div className="sports-no-stream">
                    <div style={{ fontSize: '3rem' }}>{getCatIcon(selected.category)}</div>
                    <h3>{selected.name}</h3>
                    {getLiveStatus(selected) === 'upcoming' && (
                      <p>Starts {formatDate(selected.startsAt)} at {formatTime(selected.startsAt)}
                        {timeUntil(selected.startsAt) && ` (in ${timeUntil(selected.startsAt)})`}
                      </p>
                    )}
                    {getLiveStatus(selected) === 'upcoming' && (
                      <p className="sports-no-stream-note">Stream link will appear when the event goes live.</p>
                    )}
                    {getLiveStatus(selected) !== 'upcoming' && (
                      <p className="sports-no-stream-note">Stream unavailable — try refreshing.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : !loading && (
            <div className="sports-no-selection">
              <div style={{ fontSize: '5rem' }}>🏆</div>
              <h2>Live Sports</h2>
              <p>Select a stream from the sidebar to start watching.</p>
              {liveCount > 0 && <p className="sports-live-hint">{liveCount} event{liveCount > 1 ? 's' : ''} live now</p>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

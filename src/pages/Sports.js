import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../components/Navbar';

const POLL_MS = 60_000;

const CAT_ICONS = {
  Basketball: '🏀', Soccer: '⚽', Football: '🏈', Baseball: '⚾',
  Hockey: '🏒', Boxing: '🥊', MMA: '🥊', 'Combat Sports': '🥊',
  Wrestling: '🤼', Tennis: '🎾', Golf: '⛳', Racing: '🏎️',
  Rugby: '🏉', Cricket: '🏏', Volleyball: '🏐', Olympics: '🏅',
  Esports: '🎮', Athletics: '🏃', Cycling: '🚴', Motorsport: '🏎️',
  'American Football': '🏈', 'Australian Football': '🏈',
};

function catIcon(cat) {
  if (!cat) return '🏆';
  for (const [k, v] of Object.entries(CAT_ICONS)) {
    if (cat.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return '🏆';
}

function fmtTime(unix) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const today = new Date();
  const tom   = new Date(today); tom.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tom.toDateString())   return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeUntil(unix) {
  const diff = unix * 1000 - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getStatus(s, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  if (s.alwaysLive) return 'live';
  if (s.startsAt <= nowSec && s.endsAt >= nowSec) return 'live';
  if (s.startsAt > nowSec) return 'upcoming';
  return 'replay';
}

export default function Sports() {
  const [streams, setStreams]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [selected, setSelected]     = useState(null);
  const [category, setCategory]     = useState('All');
  const [sidebarOpen, setSidebar]   = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [nowMs, setNowMs]           = useState(Date.now());
  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sports/streams');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStreams(data.streams || []);
      setError('');
    } catch (e) {
      setError('Could not load sports streams. ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const tick  = setInterval(() => setNowMs(Date.now()), 30_000);
    const poll  = setInterval(load, POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load]);

  useEffect(() => {
    const fn = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  function toggleFs() {
    if (!document.fullscreenElement) {
      (iframeRef.current || playerRef.current)?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  const categories = ['All', ...Array.from(
    new Set(streams.map(s => s.category).filter(Boolean))
  ).sort()];

  const liveCount = streams.filter(s => getStatus(s, nowMs) === 'live').length;

  const filtered = category === 'All'
    ? streams
    : streams.filter(s => s.category === category);

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
            <button className="sports-sidebar-toggle" onClick={() => setSidebar(o => !o)}>‹</button>
          </div>

          <div className="sports-categories">
            {categories.map(cat => {
              const count = cat === 'All'
                ? streams.length
                : streams.filter(s => s.category === cat).length;
              return (
                <button
                  key={cat}
                  className={`sports-cat-btn ${category === cat ? 'active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat !== 'All' ? catIcon(cat) + ' ' : ''}{cat}
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
                <button className="sports-retry-btn" onClick={load}>Retry</button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="sports-empty">No streams in this category.</p>
            ) : (
              filtered.map(s => {
                const status = getStatus(s, nowMs);
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
                        {catIcon(s.category)}
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
                            {fmtDate(s.startsAt)} {fmtTime(s.startsAt)}
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
            <button className="sports-refresh-btn" onClick={load} title="Refresh">↻</button>
          </div>
        </aside>

        {/* ── Player ── */}
        <main className="sports-player-area" ref={playerRef}>
          {!sidebarOpen && (
            <button className="sports-sidebar-show-btn" onClick={() => setSidebar(true)}>
              ☰ Streams
            </button>
          )}

          {selected ? (
            <>
              <div className="sports-now-playing">
                <div className="sports-now-info">
                  {getStatus(selected, nowMs) === 'live' && (
                    <span className="sports-live-badge">● LIVE</span>
                  )}
                  <span className="sports-now-name">{selected.name}</span>
                  {selected.tag && <span className="sports-now-tag">{selected.tag}</span>}
                  <span className="sports-now-cat">
                    {catIcon(selected.category)} {selected.category}
                  </span>
                </div>
                <button className="sports-fullscreen-btn" onClick={toggleFs}
                  title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  {fullscreen ? '↙' : '↗'}
                </button>
              </div>

              <div className="sports-frame-wrap">
                {selected.iframeSrc ? (
                  <iframe
                    key={selected.id}
                    ref={iframeRef}
                    src={selected.iframeSrc}
                    className="sports-frame"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope"
                    referrerPolicy="no-referrer-when-downgrade"
                    scrolling="no"
                    title={selected.name}
                  />
                ) : (
                  <div className="sports-no-stream">
                    <div style={{ fontSize: '3rem' }}>{catIcon(selected.category)}</div>
                    <h3>{selected.name}</h3>
                    {getStatus(selected, nowMs) === 'upcoming' ? (
                      <>
                        <p>Starts {fmtDate(selected.startsAt)} at {fmtTime(selected.startsAt)}
                          {timeUntil(selected.startsAt) && ` (in ${timeUntil(selected.startsAt)})`}
                        </p>
                        <p className="sports-no-stream-note">Stream link will appear when the event goes live.</p>
                      </>
                    ) : (
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
              {liveCount > 0 && (
                <p className="sports-live-hint">{liveCount} event{liveCount !== 1 ? 's' : ''} live now</p>
              )}
            </div>
          )}
        </main>

      </div>
    </div>
  );
}

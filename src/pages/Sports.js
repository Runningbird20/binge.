import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../components/Navbar';
import useDeviceType from '../hooks/useDeviceType';

const POLL_MS = 60_000;
const PPV_API = 'https://api.ppv.st/api/streams';

const PPV_PROVIDERS = [
  { id: 'ppv.st',  label: 'PPV.st'  },
  { id: 'ppv.cx',  label: 'PPV.cx'  },
  { id: 'ppv.is',  label: 'PPV.is'  },
  { id: 'ppv.lc',  label: 'PPV.lc'  },
];

function buildStreamUrl(stream, providerDomain) {
  if (!stream.iframeSrc && !stream.uriName) return null;
  if (providerDomain === 'ppv.st') return stream.iframeSrc || null;
  if (stream.iframeSrc) {
    try {
      const url = new URL(stream.iframeSrc);
      url.hostname = providerDomain;
      url.pathname = url.pathname.replace('/embed/', '/live/');
      url.searchParams.delete('gid');
      return url.toString();
    } catch { /* fall through */ }
  }
  if (stream.uriName) return `https://${providerDomain}/live/${stream.uriName}`;
  return null;
}

function truthy(v) { return v === 1 || v === true || v === '1'; }

function parsePpvResponse(data) {
  const now = Math.floor(Date.now() / 1000);
  const streams = [];
  for (const cat of data.streams || []) {
    const catLive = truthy(cat.always_live);
    for (const s of cat.streams || []) {
      const alwaysLive = catLive || truthy(s.always_live);
      const live     = alwaysLive || (s.starts_at <= now && s.ends_at >= now);
      const upcoming = !alwaysLive && s.starts_at > now;
      const ended    = !alwaysLive && s.ends_at < now;
      if (ended && !truthy(s.allowpaststreams)) continue;
      streams.push({
        id:         s.id,
        name:       s.name,
        tag:        s.tag        || null,
        poster:     s.poster     || null,
        category:   s.category_name || cat.category,
        uriName:    s.uri_name,
        startsAt:   s.starts_at,
        endsAt:     s.ends_at,
        alwaysLive,
        live,
        upcoming,
        replay:     ended && truthy(s.allowpaststreams),
        iframeSrc:  s.iframe || null,
      });
    }
  }
  streams.sort((a, b) => {
    if (a.live !== b.live)         return a.live ? -1 : 1;
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.startsAt - b.startsAt;
  });
  return streams;
}

async function fetchStreams() {
  // 1. Try server-side proxy route
  try {
    const res = await fetch('/api/sports/streams', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (!data.error && Array.isArray(data.streams) && data.streams.length > 0) {
        return data.streams;
      }
    }
  } catch { /* fall through */ }

  // 2. Direct browser call — ppv.st allows Access-Control-Allow-Origin: *
  const res = await fetch(PPV_API, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ppv.st ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error('ppv.st error');
  return parsePpvResponse(data);
}

const CAT_ICONS = {
  'American Football': '🏈', 'Australian Football': '🏉',
  Basketball: '🏀', Soccer: '⚽', Football: '⚽', Baseball: '⚾',
  Hockey: '🏒', Boxing: '🥊', MMA: '🥊', 'Combat Sports': '🥊',
  Wrestling: '🤼', Tennis: '🎾', Golf: '⛳', Racing: '🏎️',
  Rugby: '🏉', Cricket: '🏏', Volleyball: '🏐', Olympics: '🏅',
  Esports: '🎮', Athletics: '🏃', Cycling: '🚴', Motorsport: '🏎️',
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
  const { isMobile } = useDeviceType();
  const [streams, setStreams]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [selected, setSelected]         = useState(null);
  const [category, setCategory]         = useState('All');
  const [fullscreen, setFullscreen]     = useState(false);
  const [nowMs, setNowMs]               = useState(Date.now());
  const [sportsProvider, setSportsProvider] = useState('ppv.st');
  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const streams = await fetchStreams();
      setStreams(streams);
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

  // ── Mobile layout ────────────────────────────────────────────
  if (isMobile) {
    // Full-screen player when a stream is selected
    if (selected) {
      const status = getStatus(selected, nowMs);
      return (
        <div className="sp-shell">
          {/* Header bar */}
          <div className="sp-header">
            <button className="sp-back-btn" onClick={() => setSelected(null)} type="button">
              ← Back
            </button>
            <div className="sp-header-title">
              {status === 'live' && <span className="sp-badge-live">● LIVE</span>}
              <span className="sp-title-text">{selected.name}</span>
            </div>
            <button className="mp-btn" onClick={toggleFs} type="button">
              {fullscreen ? '↙' : '↗'}
            </button>
          </div>

          {/* Video */}
          <div className="sp-video-wrap" ref={playerRef}>
            {buildStreamUrl(selected, sportsProvider) ? (
              <iframe
                key={`${selected.id}-${sportsProvider}`}
                ref={iframeRef}
                src={buildStreamUrl(selected, sportsProvider)}
                className="mp-iframe"
                allowFullScreen
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                referrerPolicy="no-referrer-when-downgrade"
                title={selected.name}
              />
            ) : (
              <div className="mp-no-url">
                <span style={{ fontSize: '3rem' }}>{catIcon(selected.category)}</span>
                {status === 'upcoming' ? (
                  <p>Starts {fmtDate(selected.startsAt)} at {fmtTime(selected.startsAt)}</p>
                ) : (
                  <p>Stream unavailable — try refreshing.</p>
                )}
                <button className="sp-refresh-btn" onClick={load} type="button">↻ Refresh</button>
              </div>
            )}
          </div>

          {/* Event info + other streams */}
          <div className="sp-player-info">
            <div className="sp-now-meta">
              <span className="sp-cat-pill">{catIcon(selected.category)} {selected.category}</span>
              {selected.tag && <span className="sp-tag">{selected.tag}</span>}
              {status === 'upcoming' && (
                <span className="sp-upcoming-time">{fmtDate(selected.startsAt)} {fmtTime(selected.startsAt)}</span>
              )}
            </div>
            <p className="sp-section-label">More Streams</p>
            {filtered.filter(s => s.id !== selected.id).slice(0, 8).map(s => {
              const st = getStatus(s, nowMs);
              return (
                <button key={s.id} className="sp-mini-card" onClick={() => setSelected(s)} type="button">
                  <span className={`sp-dot ${st === 'live' ? 'live' : st === 'upcoming' ? 'upcoming' : 'replay'}`} />
                  <span className="sp-mini-name">{s.name}</span>
                  <span className="sp-mini-cat">{catIcon(s.category)}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // Stream list view
    return (
      <div className="app-layout">
        <Navbar />
        <div className="sp-feed-shell">
          {/* Category filter chips */}
          <div className="sp-cat-strip">
            {liveCount > 0 && (
              <span className="sp-live-pill">● {liveCount} LIVE</span>
            )}
            {categories.map(cat => (
              <button
                key={cat}
                className={`sp-cat-chip ${category === cat ? 'active' : ''}`}
                onClick={() => setCategory(cat)}
                type="button"
              >
                {cat !== 'All' ? catIcon(cat) + ' ' : ''}{cat}
              </button>
            ))}
          </div>

          {/* Provider selector */}
          <div className="sp-provider-row">
            {PPV_PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`sp-provider-btn ${sportsProvider === p.id ? 'active' : ''}`}
                onClick={() => setSportsProvider(p.id)}
                type="button"
              >{p.label}</button>
            ))}
          </div>

          {/* Stream cards */}
          <div className="sp-feed">
            {loading && (
              <div className="sp-feed-loading">
                {[1,2,3,4,5].map(i => <div key={i} className="sp-skeleton-card" />)}
              </div>
            )}
            {error && (
              <div className="sp-feed-error">
                <p>⚠️ {error}</p>
                <button className="sp-refresh-btn" onClick={load} type="button">↻ Retry</button>
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="sp-feed-empty">
                <p style={{ fontSize: '2.5rem', margin: 0 }}>🏆</p>
                <p>No streams in this category.</p>
              </div>
            )}
            {filtered.map(s => {
              const status = getStatus(s, nowMs);
              return (
                <button
                  key={s.id}
                  className="sp-card"
                  onClick={() => setSelected(s)}
                  type="button"
                >
                  <div className="sp-card-left">
                    {s.poster ? (
                      <img src={s.poster} alt={s.name} className="sp-card-poster"
                        onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="sp-card-poster sp-card-poster--icon">
                        {catIcon(s.category)}
                      </div>
                    )}
                  </div>
                  <div className="sp-card-body">
                    <div className="sp-card-badges">
                      {status === 'live' && <span className="sp-badge-live">● LIVE</span>}
                      {status === 'replay' && <span className="sp-badge-replay">REPLAY</span>}
                      {status === 'upcoming' && (
                        <span className="sp-badge-upcoming">
                          {fmtDate(s.startsAt)} · {fmtTime(s.startsAt)}
                          {timeUntil(s.startsAt) && ` · ${timeUntil(s.startsAt)}`}
                        </span>
                      )}
                    </div>
                    <p className="sp-card-name">{s.name}</p>
                    <p className="sp-card-cat">{catIcon(s.category)} {s.category}</p>
                  </div>
                  <span className="sp-card-arrow">›</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop layout ───────────────────────────────────────────
  return (
    <div className="app-layout">
      <Navbar />
      <div className="sports-shell">

        {/* ── Sport type filter, along the top like the genre bar ── */}
        <div className="genre-bar-wrap">
          <div className="genre-bar" role="tablist" aria-label="Sport categories">
            {liveCount > 0 && (
              <span className="sports-live-pill">● {liveCount} LIVE</span>
            )}
            {categories.map(cat => (
              <button
                key={cat}
                type="button"
                className={`genre-chip${category === cat ? ' active' : ''}`}
                onClick={() => setCategory(cat)}
              >
                {cat !== 'All' ? catIcon(cat) + ' ' : ''}{cat}
              </button>
            ))}
          </div>
        </div>

        <div className="sports-main">

          {/* ── Games, on the left ── */}
          <aside className="sports-games-panel">
            <div className="sports-games-header">
              <h2>Games</h2>
              <button className="sports-refresh-btn" onClick={load} title="Refresh" type="button">↻</button>
            </div>

            <div className="sports-provider-row">
              {PPV_PROVIDERS.map(p => (
                <button
                  key={p.id}
                  className={`sports-provider-btn ${sportsProvider === p.id ? 'active' : ''}`}
                  onClick={() => setSportsProvider(p.id)}
                  type="button"
                >{p.label}</button>
              ))}
            </div>

            <div className="sports-games-divider" />

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
          </aside>

          {/* ── Player, on the right ── */}
          <main className="sports-player-area" ref={playerRef}>
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
                  {buildStreamUrl(selected, sportsProvider) ? (
                    <iframe
                      key={`${selected.id}-${sportsProvider}`}
                      ref={iframeRef}
                      src={buildStreamUrl(selected, sportsProvider)}
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
                <p>Select a game from the list to start watching.</p>
                {liveCount > 0 && (
                  <p className="sports-live-hint">{liveCount} event{liveCount !== 1 ? 's' : ''} live now</p>
                )}
              </div>
            )}
          </main>

        </div>
      </div>
    </div>
  );
}

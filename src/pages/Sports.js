import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import useDeviceType from '../hooks/useDeviceType';
import { fetchSportsStreams, resolveProviderEmbedUrl, providerLabel } from '../utils/sportsProviders';

const POLL_MS = 60_000;
// Failover timeout: how long we give a provider's iframe to fire `load`
// before silently advancing to the next one. This only catches network-
// level failures (DNS, connection refused, timeout) — a cross-origin iframe
// that loads successfully but shows a dead/ad-only player looks identical
// to a working one from the outside, so that residual case still needs the
// manual "next source" control.
const LOAD_TIMEOUT_MS = 8_000;

const CAT_ICONS = {
  'American Football': '🏈', 'Australian Football': '🏉',
  Basketball: '🏀', Soccer: '⚽', Football: '⚽', Baseball: '⚾',
  Hockey: '🏒', Boxing: '🥊', MMA: '🥊', 'Combat Sports': '🥊',
  Wrestling: '🤼', Tennis: '🎾', Golf: '⛳', Racing: '🏎️',
  Rugby: '🏉', Cricket: '🏏', Volleyball: '🏐', Olympics: '🏅',
  Esports: '🎮', Athletics: '🏃', Cycling: '🚴', Motorsport: '🏎️',
  Billiards: '🎱', Darts: '🎯',
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

function StreamListCard({ stream, nowMs, onSelect }) {
  const status = getStatus(stream, nowMs);
  return (
    <button className="sp-card" onClick={() => onSelect(stream)} type="button">
      <div className="sp-card-left">
        {stream.poster ? (
          <img src={stream.poster} alt={stream.name} className="sp-card-poster"
            onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="sp-card-poster sp-card-poster--icon">
            {catIcon(stream.category)}
          </div>
        )}
      </div>
      <div className="sp-card-body">
        <div className="sp-card-badges">
          {status === 'live' && <span className="sp-badge-live">● LIVE</span>}
          {status === 'replay' && <span className="sp-badge-replay">REPLAY</span>}
          {status === 'upcoming' && (
            <span className="sp-badge-upcoming">
              {fmtDate(stream.startsAt)} · {fmtTime(stream.startsAt)}
              {timeUntil(stream.startsAt) && ` · ${timeUntil(stream.startsAt)}`}
            </span>
          )}
        </div>
        <p className="sp-card-name">{stream.name}</p>
        <p className="sp-card-cat">{catIcon(stream.category)} {stream.category}</p>
      </div>
      <span className="sp-card-arrow">›</span>
    </button>
  );
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
  const [showReplays, setShowReplays] = useState(false);
  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  // Provider failover — each merged stream carries a `providers` array
  // (1-3 entries: PPV.st, Streamed.pk, StreamFree, and Streamed.pk itself
  // can contribute more than one). providerIndex is which one we're
  // currently trying; retryNonce forces an iframe remount without changing
  // providers (used when there's only one, or to re-try from scratch).
  const [providerIndex, setProviderIndex] = useState(0);
  const [retryNonce, setRetryNonce]       = useState(0);
  const [embedUrl, setEmbedUrl]           = useState(null);
  const [resolving, setResolving]         = useState(false);
  const [exhausted, setExhausted]         = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const streams = await fetchSportsStreams();
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

  // Reset failover state whenever a different event is selected.
  useEffect(() => {
    setProviderIndex(0);
    setRetryNonce(0);
    setExhausted(false);
  }, [selected?.id]);

  const advanceProvider = useCallback(() => {
    setProviderIndex((i) => {
      const providers = selected?.providers || [];
      if (i + 1 < providers.length) return i + 1;
      setExhausted(true);
      return i;
    });
  }, [selected]);

  // Resolve the current provider's actual embed URL (instant for PPV.st /
  // StreamFree, one extra request for Streamed.pk) whenever the selection
  // or the active provider changes.
  useEffect(() => {
    const providers = selected?.providers || [];
    const provider = providers[providerIndex];
    if (!provider) { setEmbedUrl(null); return undefined; }
    let cancelled = false;
    setResolving(true);
    setEmbedUrl(null);
    resolveProviderEmbedUrl(provider).then((url) => {
      if (cancelled) return;
      setResolving(false);
      if (url) setEmbedUrl(url);
      else advanceProvider();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, providerIndex]);

  // Failover watchdog — if the iframe never fires `load` within
  // LOAD_TIMEOUT_MS, treat this provider as dead and silently move on.
  useEffect(() => {
    loadedRef.current = false;
    if (!embedUrl) return undefined;
    const timer = setTimeout(() => {
      if (!loadedRef.current) advanceProvider();
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [embedUrl, advanceProvider]);

  function handlePlayerLoad() { loadedRef.current = true; }
  function handlePlayerError() { advanceProvider(); }

  const currentProviders = selected?.providers || [];
  const currentProvider = currentProviders[providerIndex] || null;
  const sourceLabel = currentProvider ? providerLabel(currentProvider) : '';
  const sourceCountLabel = currentProviders.length > 1
    ? `${sourceLabel} · ${providerIndex + 1}/${currentProviders.length}`
    : null;

  // Manually cycle to the next known source for this event (wrapping back
  // to the first), or just force a fresh connection attempt if there's only
  // one — covers the case a provider "loads" but shows a dead/blank player,
  // which the load-timeout watchdog above can't detect on its own.
  function switchSource() {
    if (currentProviders.length > 1) {
      setExhausted(false);
      setProviderIndex((i) => (i + 1) % currentProviders.length);
    } else {
      setRetryNonce((n) => n + 1);
    }
  }

  function retryFromStart() {
    setExhausted(false);
    setProviderIndex(0);
    setRetryNonce((n) => n + 1);
  }

  const categories = ['All', ...Array.from(
    new Set(streams.map(s => s.category).filter(Boolean))
  ).sort()];

  const liveCount = streams.filter(s => getStatus(s, nowMs) === 'live').length;

  const filtered = category === 'All'
    ? streams
    : streams.filter(s => s.category === category);

  const liveNow    = filtered.filter(s => getStatus(s, nowMs) === 'live');
  const upcoming   = filtered.filter(s => getStatus(s, nowMs) === 'upcoming');
  const replays    = filtered.filter(s => getStatus(s, nowMs) === 'replay');

  // ── Mobile layout ────────────────────────────────────────────
  if (isMobile) {
    // Full-screen player when a stream is selected
    if (selected) {
      const status = getStatus(selected, nowMs);
      const otherStreams = filtered.filter(s => s.id !== selected.id);
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
            {embedUrl ? (
              <iframe
                key={`${selected.id}-${providerIndex}-${retryNonce}`}
                ref={iframeRef}
                src={embedUrl}
                className="mp-iframe"
                allowFullScreen
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                referrerPolicy="no-referrer-when-downgrade"
                title={selected.name}
                onLoad={handlePlayerLoad}
                onError={handlePlayerError}
              />
            ) : resolving ? (
              <div className="mp-no-url">
                <span style={{ fontSize: '3rem' }}>{catIcon(selected.category)}</span>
                <p>Connecting{sourceLabel ? ` via ${sourceLabel}` : ''}...</p>
              </div>
            ) : (
              <div className="mp-no-url">
                <span style={{ fontSize: '3rem' }}>{catIcon(selected.category)}</span>
                {status === 'upcoming' ? (
                  <p>Starts {fmtDate(selected.startsAt)} at {fmtTime(selected.startsAt)}</p>
                ) : exhausted ? (
                  <p>All sources unavailable right now.</p>
                ) : (
                  <p>Stream unavailable — try refreshing.</p>
                )}
                <button className="sp-refresh-btn" onClick={exhausted ? retryFromStart : load} type="button">↻ Refresh</button>
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
            <button
              type="button"
              className="sp-source-btn"
              onClick={switchSource}
            >
              {sourceCountLabel ? `↻ Next source (${sourceCountLabel})` : '↻ Retry connection'}
            </button>
            {otherStreams.length > 0 && (
              <>
                <p className="sp-section-label">More Streams</p>
                {otherStreams.map(s => {
                  const st = getStatus(s, nowMs);
                  return (
                    <button key={s.id} className="sp-mini-card" onClick={() => setSelected(s)} type="button">
                      <span className={`sp-dot ${st === 'live' ? 'live' : st === 'upcoming' ? 'upcoming' : 'replay'}`} />
                      <span className="sp-mini-name">{s.name}</span>
                      <span className="sp-mini-cat">{catIcon(s.category)}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      );
    }

    // Stream list view — grouped by status like a "Live TV" streaming home
    return (
      <div className="app-layout">
        <Navbar />
        <div className="sp-feed-shell">
          {/* Category filter chips */}
          <div className="sp-cat-strip-wrap">
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
          </div>

          {loading && (
            <>
              <div className="sp-skeleton-hero" />
              <div className="sp-skeleton-rail">
                {[1, 2, 3].map(i => <div key={i} className="sp-skeleton-rail-card" />)}
              </div>
              <div className="sp-feed-loading">
                {[1, 2, 3].map(i => <div key={i} className="sp-skeleton-card" />)}
              </div>
            </>
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

          {!loading && !error && liveNow.length > 0 && (
            <div className="sp-live-section">
              <p className="sp-section-label" style={{ paddingLeft: '1rem' }}>Live Now</p>
              <button type="button" className="sp-live-hero" onClick={() => setSelected(liveNow[0])}>
                {liveNow[0].poster ? (
                  <img src={liveNow[0].poster} alt={liveNow[0].name} className="sp-live-hero-img"
                    onError={e => { e.target.style.display = 'none'; }} />
                ) : (
                  <div className="sp-live-hero-icon">{catIcon(liveNow[0].category)}</div>
                )}
                <div className="sp-live-hero-grad" />
                <div className="sp-live-hero-info">
                  <span className="sp-badge-live">● LIVE</span>
                  <p className="sp-live-hero-name">{liveNow[0].name}</p>
                  <p className="sp-live-hero-cat">{catIcon(liveNow[0].category)} {liveNow[0].category}</p>
                </div>
              </button>

              {liveNow.length > 1 && (
                <div className="sp-live-row-wrap">
                  <div className="sp-live-row">
                    {liveNow.slice(1).map(s => (
                      <button key={s.id} type="button" className="sp-live-card" onClick={() => setSelected(s)}>
                        {s.poster ? (
                          <img src={s.poster} alt={s.name}
                            onError={e => { e.target.style.display = 'none'; }} />
                        ) : (
                          <div className="sp-live-card-icon">{catIcon(s.category)}</div>
                        )}
                        <span className="sp-badge-live sp-badge-live--sm">● LIVE</span>
                        <p className="sp-live-card-name">{s.name}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && !error && upcoming.length > 0 && (
            <div className="sp-section">
              <p className="sp-section-label" style={{ paddingLeft: '1rem' }}>Upcoming</p>
              <div className="sp-list">
                {upcoming.map(s => (
                  <StreamListCard key={s.id} stream={s} nowMs={nowMs} onSelect={setSelected} />
                ))}
              </div>
            </div>
          )}

          {!loading && !error && replays.length > 0 && (
            <div className="sp-section">
              <button
                type="button"
                className="sp-disclosure"
                onClick={() => setShowReplays(v => !v)}
              >
                <span>Replays ({replays.length})</span>
                <span className={`sp-disclosure-chevron${showReplays ? ' open' : ''}`}>›</span>
              </button>
              {showReplays && (
                <div className="sp-list">
                  {replays.map(s => (
                    <StreamListCard key={s.id} stream={s} nowMs={nowMs} onSelect={setSelected} />
                  ))}
                </div>
              )}
            </div>
          )}
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
        <GenreScrollBar ariaLabel="Sport categories">
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
        </GenreScrollBar>

        <div className="sports-main">

          {/* ── Games, on the left ── */}
          <aside className="sports-games-panel">
            <div className="sports-games-header">
              <h2>Games</h2>
              <button className="sports-refresh-btn" onClick={load} title="Refresh" type="button">↻</button>
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
                  <button
                    className="sports-fullscreen-btn"
                    onClick={switchSource}
                    title={sourceCountLabel ? `Next source (${sourceCountLabel})` : 'Retry connection'}
                  >
                    ↻
                  </button>
                  <button className="sports-fullscreen-btn" onClick={toggleFs}
                    title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {fullscreen ? '↙' : '↗'}
                  </button>
                </div>

                {sourceCountLabel && (
                  <p className="sports-source-indicator">Source: {sourceCountLabel}</p>
                )}

                <div className="sports-frame-wrap">
                  {embedUrl ? (
                    <iframe
                      key={`${selected.id}-${providerIndex}-${retryNonce}`}
                      ref={iframeRef}
                      src={embedUrl}
                      className="sports-frame"
                      allowFullScreen
                      allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope"
                      referrerPolicy="no-referrer-when-downgrade"
                      scrolling="no"
                      title={selected.name}
                      onLoad={handlePlayerLoad}
                      onError={handlePlayerError}
                    />
                  ) : resolving ? (
                    <div className="sports-no-stream">
                      <div style={{ fontSize: '3rem' }}>{catIcon(selected.category)}</div>
                      <h3>{selected.name}</h3>
                      <p className="sports-no-stream-note">Connecting{sourceLabel ? ` via ${sourceLabel}` : ''}...</p>
                    </div>
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
                      ) : exhausted ? (
                        <>
                          <p className="sports-no-stream-note">All sources unavailable right now.</p>
                          <button className="sports-retry-btn" onClick={retryFromStart} type="button">↻ Try again</button>
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

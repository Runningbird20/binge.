import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

// ── Constants ─────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'vidsrc-embed-ru', label: 'Vidsrc'           },
  { id: 'vidsrc2',         label: 'Vidsrc 2'         },
  { id: '2embed',          label: '2Embed ★ anime'   },
  { id: 'autoembed',       label: 'AutoEmbed ★ anime' },
  { id: 'vidlink',         label: 'VidLink'           },
  { id: 'superembed',      label: 'SuperEmbed'        },
  { id: 'vsrc-su',         label: 'Vidsrc 3'          },
];

const REACTIONS = ['😂','🔥','😮','❤️','👏','😭','🤯','👀','💀','🎉'];

function buildEmbedUrl(tmdbId, mediaType, provider, season, episode) {
  if (!tmdbId) return null;
  const isTV = mediaType === 'tv_show';
  const id = { kind: 'tmdb', value: String(tmdbId) };

  switch (provider) {
    case 'vidsrc-embed-ru': {
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vidsrc-embed.ru');
      url.searchParams.set('tmdb', id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
      url.searchParams.set('autoplay', '1');
      return url.toString();
    }
    case 'vidsrc2': {
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vidsrc-embed.su');
      url.searchParams.set('tmdb', id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
      url.searchParams.set('autoplay', '1');
      return url.toString();
    }
    case '2embed':
      return isTV
        ? `https://www.2embed.stream/embed/tv/${id.value}/${season}/${episode}`
        : `https://www.2embed.stream/embed/movie/${id.value}`;
    case 'autoembed':
      return isTV
        ? `https://autoembed.co/tv/tmdb/${id.value}-${season}-${episode}`
        : `https://autoembed.co/movie/tmdb/${id.value}`;
    case 'vidlink':
      return isTV
        ? `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=true`
        : `https://vidlink.pro/movie/${id.value}?autoplay=true`;
    case 'superembed':
      return isTV
        ? `https://multiembed.mov/?video_id=${id.value}&tmdb=1&s=${season}&e=${episode}`
        : `https://multiembed.mov/?video_id=${id.value}&tmdb=1`;
    case 'vsrc-su': {
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vsrc.su');
      url.searchParams.set('tmdb', id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
      url.searchParams.set('autoplay', '1');
      return url.toString();
    }
    default: return null;
  }
}

function timeAgo(d) {
  const diff = Math.floor((Date.now() - new Date(d)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ── Floating Reactions ────────────────────────────────────────
function FloatingReactions({ reactions }) {
  return (
    <div className="wr-reactions-float">
      {reactions.map(r => (
        <div key={r.id} className="wr-reaction-float" style={{ left: `${r.x}%` }}>
          {r.emoji}
        </div>
      ))}
    </div>
  );
}

// ── Media Picker ──────────────────────────────────────────────
function MediaPicker({ roomId, onMediaSet }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await api.get(`/search?q=${encodeURIComponent(query)}&types=movies,tv`);
      setResults([
        ...(data.movies || []).map(m => ({ ...m, _type: 'movie' })),
        ...(data.tv || []).map(t => ({ ...t, _type: 'tv_show' })),
      ]);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  async function handleSelect(item) {
    let tmdbId = null;
    if (item.source_key) {
      const m = item.source_key.match(/^tmdb:(?:movie|tv):(\d+)$/);
      if (m) tmdbId = m[1];
    }
    if (!tmdbId && item.external_id) tmdbId = String(item.external_id).replace(/^tmdb:/, '');
    if (!tmdbId) return alert("Couldn't find a TMDB ID for this title. Try another.");

    try {
      const updated = await api.patch(`/watchroom/${roomId}/media`, {
        tmdb_id: tmdbId, media_type: item._type,
        media_title: item.title, media_poster: item.poster_url || item.cover_url,
      });
      onMediaSet(updated);
      setResults(null); setQuery('');
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="wr-media-picker">
      <h3 className="wr-picker-heading">🔍 Change what's playing</h3>
      <form className="wr-picker-form" onSubmit={handleSearch}>
        <input className="forum-input" placeholder="Search movies or TV shows..." value={query} onChange={e => setQuery(e.target.value)} style={{ marginBottom: 0 }} />
        <button className="btn-primary btn-sm" type="submit" disabled={loading}>{loading ? '...' : 'Search'}</button>
      </form>
      {results !== null && (
        <div className="wr-picker-results">
          {results.length === 0 && <p className="wr-picker-empty">No results. Try a different title.</p>}
          {results.map(item => (
            <button key={`${item._type}-${item.id}`} className="wr-picker-item" onClick={() => handleSelect(item)} type="button">
              {item.poster_url
                ? <img src={item.poster_url} alt="" className="wr-picker-poster" referrerPolicy="no-referrer" />
                : <div className="wr-picker-poster-placeholder">{item._type === 'tv_show' ? '📺' : '🎬'}</div>
              }
              <div>
                <p className="wr-picker-title">{item.title}</p>
                <p className="wr-picker-meta">{item._type === 'tv_show' ? '📺 TV Show' : '🎬 Movie'} · {item.year || '—'}</p>
              </div>
              <span className="wr-picker-select-hint">Watch this →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Room View ─────────────────────────────────────────────────
function RoomView({ roomId }) {
  const { user } = useAuth();

  const [room, setRoom]           = useState(null);
  const [messages, setMessages]   = useState([]);
  const [viewers, setViewers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [message, setMessage]     = useState('');
  const [sending, setSending]     = useState(false);
  const [copied, setCopied]       = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [showPicker, setShowPicker]   = useState(false);
  const [floatReactions, setFloatReactions] = useState([]);
  const [seasonCount, setSeasonCount]       = useState(1);
  const [episodeCounts, setEpisodeCounts]   = useState({});
  const [loadingEps, setLoadingEps]         = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [showTransfer, setShowTransfer]     = useState(false);

  // Local sync state (mirrors server, host is authoritative)
  const [syncState, setSyncState] = useState({
    sync_is_playing: false, sync_current_time: 0,
    sync_provider: 'vidsrc-embed-ru', sync_season: 1, sync_episode: 1,
  });

  const messagesEndRef  = useRef(null);
  const playerWrapRef   = useRef(null);
  const iframeRef       = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastMsgTsRef   = useRef(Date.now());
  const localTimeRef   = useRef(0);
  const playingRef     = useRef(false);

  const isHost = user?.id === room?.host_id;

  // Fullscreen
  useEffect(() => {
    function onFsChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      const el = iframeRef.current || playerWrapRef.current;
      el?.requestFullscreen().catch(() => playerWrapRef.current?.requestFullscreen());
    } else {
      document.exitFullscreen();
    }
  }
  const tmdbId = room?.tmdb_id;
  const mediaType = room?.media_type || 'movie';
  const isTV = mediaType === 'tv_show';

  // Initial load
  useEffect(() => {
    api.get(`/watchroom/${roomId}`)
      .then(data => {
        setRoom(data.room);
        setMessages(data.messages || []);
        setViewers(data.viewers || []);
        const s = data.room;
        setSyncState({
          sync_is_playing:   s.sync_is_playing   || false,
          sync_current_time: s.sync_current_time || 0,
          sync_provider:     s.sync_provider     || 'vidsrc-embed-ru',
          sync_season:       s.sync_season       || 1,
          sync_episode:      s.sync_episode      || 1,
        });
        localTimeRef.current = s.sync_current_time || 0;
        playingRef.current   = s.sync_is_playing   || false;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [roomId]);

  // Fetch season/episode counts when TV show loads
  useEffect(() => {
    if (!tmdbId || !isTV) return;
    setLoadingEps(true);
    // Get season 1 episode count first, then total seasons from TMDB show details
    Promise.all([
      api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=1`),
      fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.REACT_APP_TMDB_API_KEY || ''}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([seasonData, showData]) => {
      const epCount = seasonData?.episodeCount || seasonData?.episode_count || 1;
      const seasons = showData?.number_of_seasons || seasonData?.total_seasons || 1;
      setSeasonCount(seasons);
      setEpisodeCounts({ 1: epCount });
    }).catch(() => {
      // Fallback: just try the season endpoint
      api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=1`).then(data => {
        setEpisodeCounts({ 1: data?.episodeCount || 1 });
      }).catch(() => {});
    }).finally(() => setLoadingEps(false));
  }, [tmdbId, isTV]);

  // Fetch episode count when season changes
  const fetchSeasonEps = useCallback(async (season) => {
    if (!tmdbId || !isTV || episodeCounts[season]) return;
    try {
      const data = await api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=${season}`);
      setEpisodeCounts(prev => ({ ...prev, [season]: data?.episodeCount || data?.episode_count || 1 }));
    } catch { /* ignore */ }
  }, [tmdbId, isTV, episodeCounts]);

  // Host: advance local time + periodic sync push
  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(() => {
      if (playingRef.current) {
        localTimeRef.current += 5;
        setSyncState(s => ({ ...s, sync_current_time: localTimeRef.current }));
        // Push to server every 5s
        api.post(`/watchroom/${roomId}/sync`, {
          is_playing: true,
          current_time: localTimeRef.current,
        }).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isHost, roomId]);

  // Guest: poll sync state every 3s
  useEffect(() => {
    if (isHost || !room) return;
    const interval = setInterval(async () => {
      try {
        const sync = await api.get(`/watchroom/${roomId}/sync`);
        setSyncState({
          sync_is_playing:   sync.sync_is_playing   || false,
          sync_current_time: sync.sync_current_time || 0,
          sync_provider:     sync.sync_provider     || 'vidsrc-embed-ru',
          sync_season:       sync.sync_season       || 1,
          sync_episode:      sync.sync_episode      || 1,
        });
        localTimeRef.current = sync.sync_current_time || 0;
        playingRef.current   = sync.sync_is_playing   || false;

        // Update room media if changed
        if (sync.tmdb_id !== room?.tmdb_id || sync.media_type !== room?.media_type) {
          setRoom(r => r ? { ...r, tmdb_id: sync.tmdb_id, media_type: sync.media_type, media_title: sync.media_title, media_poster: sync.media_poster } : r);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [isHost, room, roomId]);

  // Poll chat + viewers every 3s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [newMsgs, newViewers] = await Promise.all([
          api.get(`/watchroom/${roomId}/messages/since/${lastMsgTsRef.current}`),
          api.get(`/watchroom/${roomId}/viewers`),
        ]);
        if (newMsgs.length > 0) {
          setMessages(prev => [...prev, ...newMsgs]);
          lastMsgTsRef.current = Date.now();
        }
        setViewers(newViewers || []);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [roomId]);

  // Heartbeat every 10s
  useEffect(() => {
    if (!user) return;
    api.post(`/watchroom/${roomId}/heartbeat`).catch(() => {});
    const interval = setInterval(() => {
      api.post(`/watchroom/${roomId}/heartbeat`).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [user, roomId]);

  // Scroll chat to bottom
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Host controls ──
  async function pushSync(patch) {
    const newState = { ...syncState, ...patch };
    setSyncState(newState);
    if ('sync_is_playing' in patch) playingRef.current = patch.sync_is_playing;
    if ('sync_current_time' in patch) localTimeRef.current = patch.sync_current_time;
    await api.post(`/watchroom/${roomId}/sync`, {
      is_playing:   newState.sync_is_playing,
      current_time: newState.sync_current_time,
      provider:     newState.sync_provider,
      season:       newState.sync_season,
      episode:      newState.sync_episode,
    }).catch(() => {});
  }

  function handlePlayPause() { pushSync({ sync_is_playing: !syncState.sync_is_playing }); }
  function handleProviderChange(provider) { pushSync({ sync_provider: provider }); }
  function handleSeasonChange(season) {
    fetchSeasonEps(season);
    pushSync({ sync_season: season, sync_episode: 1, sync_is_playing: false, sync_current_time: 0 });
  }
  function handleEpisodeChange(episode) {
    pushSync({ sync_episode: episode, sync_is_playing: false, sync_current_time: 0 });
  }
  function handleSeek(secs) { pushSync({ sync_current_time: secs }); }

  // ── Chat ──
  async function handleSend(e) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const msg = await api.post(`/watchroom/${roomId}/message`, { message });
      setMessages(prev => [...prev, msg]);
      setMessage('');
      lastMsgTsRef.current = Date.now();
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  // ── Reactions ──
  function sendReaction(emoji) {
    const id = Date.now();
    const x  = 10 + Math.random() * 80;
    setFloatReactions(prev => [...prev, { id, emoji, x }]);
    setTimeout(() => setFloatReactions(prev => prev.filter(r => r.id !== id)), 2500);
    // Send as a special chat message
    api.post(`/watchroom/${roomId}/message`, { message: `reacted ${emoji}` }).catch(() => {});
  }

  // ── Transfer host ──
  async function handleTransferHost() {
    if (!transferTarget.trim()) return;
    try {
      await api.patch(`/watchroom/${roomId}/host`, { new_host_username: transferTarget });
      setRoom(r => r ? { ...r, host_id: '__transferred__' } : r);
      setShowTransfer(false);
      alert(`Host transferred to u/${transferTarget}`);
    } catch (err) { alert(err.message); }
  }

  function copyCode() {
    navigator.clipboard?.writeText(roomId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const embedUrl = tmdbId
    ? buildEmbedUrl(tmdbId, mediaType, syncState.sync_provider, syncState.sync_season, syncState.sync_episode)
    : null;

  const epCount = episodeCounts[syncState.sync_season];

  if (loading) return <div className="loading-state">Loading room...</div>;
  if (!room) return (
    <div className="forum-empty">
      <p className="forum-empty-icon">🚪</p>
      <h3>Room not found or has ended</h3>
      <Link to="/watch-room" className="btn-primary" style={{ display: 'inline-block', marginTop: '1rem' }}>← Go back</Link>
    </div>
  );

  const playerSection = (
    <div className={`wr-player-section ${theaterMode ? 'theater' : ''}`}>
      {/* Now Playing card */}
      {room.media_title && (
        <div className="wr-now-playing">
          {room.media_poster && <img src={room.media_poster} alt="" className="wr-now-playing-poster" referrerPolicy="no-referrer" />}
          <div className="wr-now-playing-info">
            <span className="wr-now-playing-label">Now Playing</span>
            <strong className="wr-now-playing-title">{room.media_title}</strong>
            {isTV && <span className="wr-now-playing-ep">S{syncState.sync_season} E{syncState.sync_episode}</span>}
            <span className={`wr-now-playing-status ${syncState.sync_is_playing ? 'playing' : 'paused'}`}>
              {syncState.sync_is_playing ? '▶ Playing' : '⏸ Paused'} · {formatTime(syncState.sync_current_time)}
            </span>
          </div>
        </div>
      )}

      {/* Player frame */}
      <div className="wr-player-frame-wrap" ref={playerWrapRef}>
        {embedUrl ? (
          <>
            <iframe
              ref={iframeRef}
              key={`${syncState.sync_provider}-${tmdbId}-${syncState.sync_season}-${syncState.sync_episode}`}
              src={embedUrl}
              className="wr-player-frame"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              referrerPolicy="no-referrer"
              title="Watch Together"
            />
            <button className="wr-fullscreen-btn" onClick={toggleFullscreen} type="button" title="Fullscreen">
              {isFullscreen ? '⊡' : '⛶'}
            </button>
            <FloatingReactions reactions={floatReactions} />
            {/* Sync status badge */}
            <div className="wr-sync-badge">
              {isHost
                ? <span className="wr-badge-host">👑 Host · {formatTime(syncState.sync_current_time)}</span>
                : <span className="wr-badge-guest">📡 Synced · {syncState.sync_is_playing ? '▶' : '⏸'} {formatTime(syncState.sync_current_time)}</span>
              }
            </div>
          </>
        ) : (
          <div className="wr-no-media">
            <p>🎬</p>
            <h3>{tmdbId ? 'Loading player...' : 'No media selected'}</h3>
            {isHost
              ? <p>Search below to pick a movie or TV show to watch</p>
              : <p>Waiting for the host to pick something...</p>
            }
          </div>
        )}
      </div>

      {/* Provider selector */}
      <div className="wr-provider-bar">
        <span className="wr-provider-label">Server:</span>
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            className={`wr-provider-btn ${syncState.sync_provider === p.id ? 'active' : ''}`}
            onClick={() => isHost ? handleProviderChange(p.id) : null}
            type="button"
            title={isHost ? `Switch to ${p.label}` : 'Only the host can change server'}
            style={{ opacity: isHost ? 1 : 0.5, cursor: isHost ? 'pointer' : 'not-allowed' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* TV Season/Episode picker */}
      {isTV && (
        <div className="wr-tv-controls">
          <div className="wr-tv-group">
            <span className="wr-tv-label">Season</span>
            <div className="wr-ep-buttons">
              {Array.from({ length: seasonCount }, (_, i) => i + 1).map(s => (
                <button
                  key={s}
                  className={`wr-ep-btn ${syncState.sync_season === s ? 'active' : ''}`}
                  onClick={() => isHost && handleSeasonChange(s)}
                  type="button"
                  disabled={!isHost}
                >S{s}</button>
              ))}
            </div>
          </div>
          <div className="wr-tv-group">
            <span className="wr-tv-label">Episode {loadingEps && '...'}</span>
            <div className="wr-ep-buttons">
              {epCount
                ? Array.from({ length: epCount }, (_, i) => i + 1).map(e => (
                    <button
                      key={e}
                      className={`wr-ep-btn ${syncState.sync_episode === e ? 'active' : ''}`}
                      onClick={() => isHost && handleEpisodeChange(e)}
                      type="button"
                      disabled={!isHost}
                    >E{e}</button>
                  ))
                : <span className="wr-ep-loading">{loadingEps ? 'Loading...' : 'Select a season'}</span>
              }
            </div>
          </div>
          {!isHost && <p className="wr-guest-notice">👑 Only the host can change episode</p>}
        </div>
      )}

      {/* Host playback controls */}
      {isHost && (
        <div className="wr-host-controls">
          <button className={`wr-play-pause-btn ${syncState.sync_is_playing ? 'playing' : ''}`} onClick={handlePlayPause} type="button">
            {syncState.sync_is_playing ? '⏸ Pause for Everyone' : '▶ Play for Everyone'}
          </button>
          <div className="wr-seek-group">
            <span className="wr-seek-label">Jump to:</span>
            <input
              className="wr-seek-input"
              type="number"
              placeholder="seconds"
              onKeyDown={e => {
                if (e.key === 'Enter' && !isNaN(Number(e.target.value))) {
                  handleSeek(Number(e.target.value));
                  e.target.value = '';
                }
              }}
            />
            <span className="wr-time-display">{formatTime(syncState.sync_current_time)}</span>
          </div>

        </div>
      )}

      {!isHost && (
        <div className="wr-guest-bar">
          <span className="wr-guest-status-text">
            {syncState.sync_is_playing ? '▶ Playing' : '⏸ Paused'} · {formatTime(syncState.sync_current_time)}
          </span>
          <span className="wr-guest-desc">The host controls playback for everyone</span>

        </div>
      )}

      {/* Reaction bar */}
      <div className="wr-reaction-bar">
        {REACTIONS.map(emoji => (
          <button key={emoji} className="wr-reaction-btn" onClick={() => sendReaction(emoji)} type="button">{emoji}</button>
        ))}
      </div>

      {/* Host: media picker */}
      {isHost && (
        <>
          <button className="wr-change-media-btn" onClick={() => setShowPicker(v => !v)} type="button">
            {showPicker ? '✕ Close' : '🔍 Change Movie / Show'}
          </button>
          {showPicker && (
            <MediaPicker roomId={roomId} onMediaSet={updated => {
              setRoom(r => r ? { ...r, ...updated } : r);
              setSyncState(s => ({ ...s, sync_season: 1, sync_episode: 1 }));
              setShowPicker(false);
            }} />
          )}
        </>
      )}

      {/* Host: transfer + close */}
      {isHost && (
        <div className="wr-host-utils">
          <button className="wr-util-btn" onClick={() => setShowTransfer(v => !v)} type="button">👑 Transfer Host</button>
          {showTransfer && (
            <div className="wr-transfer-form">
              <input className="forum-input" placeholder="Username to transfer to" value={transferTarget} onChange={e => setTransferTarget(e.target.value)} style={{ marginBottom: 0 }} />
              <button className="btn-primary btn-sm" onClick={handleTransferHost} type="button">Transfer</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const chatSection = (
    <div className={`wr-chat-section ${theaterMode ? 'theater' : ''}`}>
      {/* Viewers */}
      <div className="wr-viewers">
        <span className="wr-viewers-label">👥 {viewers.length} watching</span>
        <div className="wr-viewers-list">
          {viewers.map(v => (
            <div key={v.user_id} className="wr-viewer-chip" title={v.profiles?.username}>
              {v.profiles?.avatar_url
                ? <img src={v.profiles.avatar_url} alt="" className="wr-viewer-avatar" />
                : <span className="wr-viewer-initial">{v.profiles?.username?.charAt(0).toUpperCase() || '?'}</span>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="wr-messages">
        {messages.length === 0 && <p className="wr-no-msgs">No messages yet — say something!</p>}
        {messages.map((msg, i) => {
          const isMe = user?.id === msg.user_id;
          const isReaction = msg.message?.startsWith('reacted ');
          if (isReaction) {
            return (
              <div key={msg.id || i} className="wr-reaction-msg">
                <span>{msg.profiles?.username}</span> reacted {msg.message.slice(8)}
              </div>
            );
          }
          return (
            <div key={msg.id || i} className={`wr-msg ${isMe ? 'mine' : ''}`}>
              {!isMe && (
                <span className="wr-msg-author">
                  {msg.profiles?.avatar_url && <img src={msg.profiles.avatar_url} alt="" className="wr-msg-avatar" />}
                  {msg.profiles?.username}
                </span>
              )}
              <div className="wr-msg-bubble">{msg.message}</div>
              <span className="wr-msg-time">{timeAgo(msg.created_at)}</span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {user
        ? <form className="wr-input-row" onSubmit={handleSend}>
            <input className="wr-input" placeholder="Chat..." value={message} onChange={e => setMessage(e.target.value)} autoComplete="off" />
            <button className="btn-primary btn-sm" type="submit" disabled={sending || !message.trim()}>
              {sending ? '...' : 'Send'}
            </button>
          </form>
        : <p className="wr-login-hint">Log in to chat</p>
      }
    </div>
  );

  return (
    <div className="wr-room-page">
      {/* Header */}
      <div className="wr-room-header">
        <div className="wr-room-header-left">
          <h1 className="wr-room-title">
            {room.media_title ? `🎬 ${room.media_title}` : `🎬 ${room.title}`}
          </h1>
          <p className="wr-room-meta">
            Hosted by u/{room.host?.username}
            {isHost && <span className="wr-host-tag">👑 You're the host</span>}
          </p>
        </div>
        <div className="wr-room-header-right">
          <button className="wr-code-pill" onClick={copyCode} type="button">
            Room: <strong>{roomId}</strong> {copied ? '✓ Copied' : '📋'}
          </button>
        </div>
      </div>

      {/* Layout */}
      <div className={`wr-room-body ${theaterMode ? 'theater' : ''}`}>
        {playerSection}
        {chatSection}
      </div>
    </div>
  );
}

// ── Create Room Modal ─────────────────────────────────────────
function CreateRoomModal({ onClose, onCreated }) {
  const [title, setTitle]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleCreate() {
    if (!title.trim()) return setError('Give your room a name');
    setLoading(true);
    try {
      const room = await api.post('/watchroom', { title: title.trim() });
      onCreated(room);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="forum-modal" onClick={e => e.stopPropagation()}>
        <div className="forum-modal-header">
          <h2>🎬 Create Watch Room</h2>
          <button onClick={onClose} type="button" className="modal-close-btn">✕</button>
        </div>
        <p style={{ color:'#666', fontSize:'0.85rem', marginBottom:'1rem', lineHeight:1.6 }}>
          You'll be the host — you control what plays and when. Guests join with the room code and stay in sync automatically.
        </p>
        {error && <div className="forum-error">{error}</div>}
        <label className="forum-field-label">Room Name</label>
        <input
          className="forum-input" placeholder="Friday Movie Night 🍿"
          value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          autoFocus
        />
        <div className="forum-modal-actions">
          <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={loading || !title.trim()} type="button">
            {loading ? 'Creating...' : '+ Create Room'}
          </button>
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

  if (roomId) {
    return (
      <div className="app-layout">
        <Navbar />
        <main className="page-content wr-page">
          <Link to="/watch-room" className="forum-back-link">← Watch Together</Link>
          <RoomView roomId={roomId} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content wr-page">
        <div className="wr-home">
          <div className="wr-hero">
            <h1>🎬 Watch Together</h1>
            <p>Create a room, pick any movie or TV show, and watch in sync with friends. The host controls play, pause, episode, and server — everyone stays locked in.</p>
          </div>

          <div className="wr-home-actions">
            {user
              ? <button className="btn-primary wr-create-btn" onClick={() => setShowCreate(true)} type="button">+ Create Room</button>
              : <Link to="/login" className="btn-primary" style={{padding:'0.75rem 2rem'}}>Log in to host</Link>
            }
            <div className="wr-join-row">
              <input
                className="forum-input"
                placeholder="Enter 6-character room code"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && joinCode.trim().length >= 4 && navigate(`/watch-room/${joinCode.trim()}`)}
                maxLength={10}
                style={{ marginBottom: 0 }}
              />
              <button className="btn-primary" onClick={() => navigate(`/watch-room/${joinCode.trim()}`)} disabled={joinCode.trim().length < 4} type="button">Join →</button>
            </div>
          </div>

          <div className="wr-features">
            <div className="wr-feature"><span>🎬</span><div><strong>Any movie or show</strong><p>Search and pick anything from the catalog</p></div></div>
            <div className="wr-feature"><span>📡</span><div><strong>7 stream servers</strong><p>Switch server if one doesn't load</p></div></div>
            <div className="wr-feature"><span>🔄</span><div><strong>True sync</strong><p>Host controls play/pause/episode for everyone</p></div></div>
            <div className="wr-feature"><span>📺</span><div><strong>TV show support</strong><p>Pick any season and episode together</p></div></div>
            <div className="wr-feature"><span>💬</span><div><strong>Live chat</strong><p>React and talk as you watch</p></div></div>
            <div className="wr-feature"><span>😂</span><div><strong>Reactions</strong><p>Send floating emoji reactions</p></div></div>
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

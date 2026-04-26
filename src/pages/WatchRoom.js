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

const PLAYBACK_TICK_MS = 1000;
const GUEST_SYNC_POLL_MS = 2500;
const CHAT_POLL_MS = 3000;

function getMessageKey(message) {
  return message?.id || `${message?.user_id || 'anon'}-${message?.created_at || ''}-${message?.message || ''}`;
}

function mergeUniqueMessages(current, incoming) {
  const merged = [...current];
  const seen = new Set(current.map(getMessageKey));

  (incoming || []).forEach((message) => {
    const key = getMessageKey(message);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(message);
    }
  });

  return merged.sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
}

function getLatestMessageTimestamp(messages) {
  return (messages || []).reduce((latest, message) => {
    const createdAt = new Date(message.created_at || 0).getTime();
    return Number.isFinite(createdAt) ? Math.max(latest, createdAt) : latest;
  }, 0);
}

function normalizeSyncState(source = {}) {
  const updatedAt = source.sync_updated_at || new Date().toISOString();
  const baseTime = Number(source.sync_current_time) || 0;
  const updatedAtMs = new Date(updatedAt).getTime();
  const elapsed = source.sync_is_playing && Number.isFinite(updatedAtMs)
    ? Math.max(0, (Date.now() - updatedAtMs) / 1000)
    : 0;

  return {
    sync_is_playing: Boolean(source.sync_is_playing),
    sync_current_time: baseTime + elapsed,
    sync_provider: source.sync_provider || 'vidsrc-embed-ru',
    sync_season: source.sync_season || 1,
    sync_episode: source.sync_episode || 1,
    sync_updated_at: updatedAt,
  };
}

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
  const [theaterMode] = useState(false);
  const [showPicker, setShowPicker]   = useState(false);
  const [floatReactions, setFloatReactions] = useState([]);
  const [seasonCount, setSeasonCount]       = useState(1);
  const [episodeCounts, setEpisodeCounts]   = useState({});
  const [loadingEps, setLoadingEps]         = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [showTransfer, setShowTransfer]     = useState(false);

  // Local sync state mirrors the latest room-wide playback state.
  const [syncState, setSyncState] = useState({
    sync_is_playing: false, sync_current_time: 0,
    sync_provider: 'vidsrc-embed-ru', sync_season: 1, sync_episode: 1,
    sync_updated_at: null,
  });

  const messagesEndRef  = useRef(null);
  const playerWrapRef   = useRef(null);
  const iframeRef       = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastMsgTsRef   = useRef(0);
  const localTimeRef   = useRef(0);
  const playingRef     = useRef(false);
  const syncStateRef   = useRef(syncState);
  const roomRef        = useRef(room);

  const isHost = user?.id === room?.host_id;

  useEffect(() => { syncStateRef.current = syncState; }, [syncState]);
  useEffect(() => { roomRef.current = room; }, [room]);

  const getProjectedPlaybackTime = useCallback(() => {
    const projected = normalizeSyncState({
      ...syncStateRef.current,
      sync_current_time: localTimeRef.current,
    });
    return projected.sync_current_time;
  }, []);

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
        const initialMessages = mergeUniqueMessages([], data.messages || []);
        setMessages(initialMessages);
        lastMsgTsRef.current = getLatestMessageTimestamp(initialMessages);
        setViewers(data.viewers || []);
        const normalizedSync = normalizeSyncState(data.room);
        setSyncState(normalizedSync);
        syncStateRef.current = normalizedSync;
        localTimeRef.current = normalizedSync.sync_current_time;
        playingRef.current   = normalizedSync.sync_is_playing;
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

  const applyRemoteSync = useCallback((sync) => {
    const currentUpdatedAt = new Date(syncStateRef.current?.sync_updated_at || 0).getTime();
    const incomingUpdatedAt = new Date(sync?.sync_updated_at || 0).getTime();
    if (Number.isFinite(currentUpdatedAt) && Number.isFinite(incomingUpdatedAt) && incomingUpdatedAt < currentUpdatedAt) {
      return;
    }

    const normalizedSync = normalizeSyncState(sync);
    setSyncState(normalizedSync);
    syncStateRef.current = normalizedSync;
    localTimeRef.current = normalizedSync.sync_current_time;
    playingRef.current   = normalizedSync.sync_is_playing;
  }, []);

  // Keep the visible timestamp moving locally without rebroadcasting remote updates.
  useEffect(() => {
    const interval = setInterval(() => {
      if (playingRef.current) {
        const currentTime = getProjectedPlaybackTime();
        localTimeRef.current = currentTime;
        setSyncState(s => {
          const nextState = { ...s, sync_current_time: currentTime };
          syncStateRef.current = nextState;
          return nextState;
        });
      }
    }, PLAYBACK_TICK_MS);
    return () => clearInterval(interval);
  }, [getProjectedPlaybackTime]);

  // Poll shared room playback state. Applying remote state never writes it back.
  useEffect(() => {
    if (!room) return;
    const interval = setInterval(async () => {
      try {
        const sync = await api.get(`/watchroom/${roomId}/sync`);
        applyRemoteSync(sync);

        // Update room media if changed
        const currentRoom = roomRef.current;
        if (sync.tmdb_id !== currentRoom?.tmdb_id || sync.media_type !== currentRoom?.media_type) {
          setRoom(r => r ? { ...r, tmdb_id: sync.tmdb_id, media_type: sync.media_type, media_title: sync.media_title, media_poster: sync.media_poster } : r);
        }
      } catch { /* ignore */ }
    }, GUEST_SYNC_POLL_MS);
    return () => clearInterval(interval);
  }, [applyRemoteSync, room, roomId]);

  // Poll chat + viewers every 3s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [newMsgs, newViewers] = await Promise.all([
          api.get(`/watchroom/${roomId}/messages/since/${lastMsgTsRef.current}`),
          api.get(`/watchroom/${roomId}/viewers`),
        ]);
        if ((newMsgs || []).length > 0) {
          setMessages(prev => {
            const merged = mergeUniqueMessages(prev, newMsgs);
            lastMsgTsRef.current = getLatestMessageTimestamp(merged);
            return merged;
          });
        }
        setViewers(newViewers || []);
      } catch { /* ignore */ }
    }, CHAT_POLL_MS);
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

  // ── Shared playback controls ──
  async function pushSync(patch) {
    if (!user) return;
    const currentTime = 'sync_current_time' in patch ? patch.sync_current_time : getProjectedPlaybackTime();
    const syncUpdatedAt = new Date().toISOString();
    const newState = {
      ...syncStateRef.current,
      ...patch,
      sync_current_time: currentTime,
      sync_updated_at: syncUpdatedAt,
    };
    setSyncState(newState);
    syncStateRef.current = newState;
    if ('sync_is_playing' in patch) playingRef.current = patch.sync_is_playing;
    localTimeRef.current = currentTime;
    const savedState = await api.post(`/watchroom/${roomId}/sync`, {
      is_playing:   newState.sync_is_playing,
      current_time: newState.sync_current_time,
      provider:     newState.sync_provider,
      season:       newState.sync_season,
      episode:      newState.sync_episode,
    }).catch(() => {});
    if (savedState) {
      applyRemoteSync(savedState);
    }
  }

  function handlePlayPause() { pushSync({ sync_is_playing: !syncStateRef.current.sync_is_playing }); }
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
      setMessages(prev => {
        const merged = mergeUniqueMessages(prev, [msg]);
        lastMsgTsRef.current = getLatestMessageTimestamp(merged);
        return merged;
      });
      setMessage('');
    } catch (err) {
      console.error('Unable to send room message:', err);
    }
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

      {/* Shared playback controls */}
      <div className="wr-host-controls">
          <button className={`wr-play-pause-btn ${syncState.sync_is_playing ? 'playing' : ''}`} onClick={handlePlayPause} disabled={!user} type="button">
            {syncState.sync_is_playing ? '⏸ Pause for Everyone' : '▶ Play for Everyone'}
          </button>
          <div className="wr-seek-group">
            <span className="wr-seek-label">Jump to:</span>
            <input
              className="wr-seek-input"
              type="number"
              placeholder="seconds"
              disabled={!user}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isNaN(Number(e.target.value))) {
                  handleSeek(Number(e.target.value));
                  e.target.value = '';
                }
              }}
            />
            <span className="wr-time-display">{formatTime(syncState.sync_current_time)}</span>
          </div>
          {!user && <span className="wr-guest-desc">Log in to control playback</span>}

      </div>

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
            <p>Create a room, pick any movie or TV show, and watch in sync with friends. Anyone in the room can play, pause, and jump the shared timestamp.</p>
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
            <div className="wr-feature"><span>🔄</span><div><strong>True sync</strong><p>Everyone shares play, pause, and timestamp control</p></div></div>
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

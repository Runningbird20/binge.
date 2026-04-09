import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

const PROVIDERS = [
  { id: 'vidsrc',     label: 'Vidsrc'     },
  { id: 'vidsrc2',    label: 'Vidsrc 2'   },
  { id: 'superembed', label: 'SuperEmbed' },
  { id: '2embed',     label: '2Embed'     },
];

function buildUrl(provider, tmdbId, mediaType, season, episode) {
  const isTV = mediaType === 'tv_show';
  if (!tmdbId) return null;
  if (provider === 'vidsrc') {
    if (isTV) return `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
    return `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;
  }
  if (provider === 'vidsrc2') {
    if (isTV) return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`;
    return `https://vidsrc.to/embed/movie/${tmdbId}`;
  }
  if (provider === 'superembed') {
    if (isTV) return `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
    return `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`;
  }
  if (provider === '2embed') {
    if (isTV) return `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`;
    return `https://www.2embed.cc/embed/${tmdbId}`;
  }
  return null;
}

export default function EmbedPlayer({ item, mediaType, onClose }) {
  const [provider, setProvider]         = useState('vidsrc');
  const [season, setSeason]             = useState(1);
  const [episode, setEpisode]           = useState(1);
  const [tmdbId, setTmdbId]             = useState(null);
  const [lookupState, setLookupState]   = useState('loading');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Episode data
  const [seasonEpisodeCounts, setSeasonEpisodeCounts] = useState({}); // { 1: 8, 2: 10, ... }
  const [loadingEpisodes, setLoadingEpisodes]         = useState(false);

  // Progress tracking
  const [watched, setWatched]           = useState(new Set()); // Set of "season:episode" strings
  const [markingWatched, setMarkingWatched] = useState(false);

  const modalRef = useRef(null);
  const iframeRef = useRef(null);
  const isTV = mediaType === 'tv_show';
  const watchTimerRef = useRef(null);
  const watchSecondsRef = useRef(0);
  const AUTO_WATCH_SECONDS = 5 * 60; // 5 minutes = auto-mark watched
  const [realSeasonCount, setRealSeasonCount] = useState(null); // fetched from TMDB
  const totalSeasons = realSeasonCount ?? item.seasons ?? 1;

  // Fullscreen listener
  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Auto-track watch time — mark watched after 5 minutes on same episode
  useEffect(() => {
    if (!isTV || !item.id) return;

    // Reset timer when episode changes
    watchSecondsRef.current = 0;
    if (watchTimerRef.current) clearInterval(watchTimerRef.current);

    // Only start tracking if not already watched
    const key = `${season}:${episode}`;
    if (watched.has(key)) return;

    watchTimerRef.current = setInterval(() => {
      watchSecondsRef.current += 1;
      if (watchSecondsRef.current >= AUTO_WATCH_SECONDS) {
        clearInterval(watchTimerRef.current);
        // Auto-mark as watched
        api.post('/media/episode-progress', { media_id: item.id, season, episode })
          .then(() => {
            setWatched(prev => new Set([...prev, key]));
          })
          .catch(() => {});
      }
    }, 1000);

    return () => {
      if (watchTimerRef.current) clearInterval(watchTimerRef.current);
    };
  }, [season, episode, isTV, item.id, watched]);

  // TMDB ID lookup
  useEffect(() => {
    async function fetchTmdbId() {
      setLookupState('loading');
      try {
        const params = new URLSearchParams({
          title: item.title,
          type: mediaType,
          ...(item.year ? { year: item.year } : {}),
        });
        const data = await api.get(`/media/tmdb-id?${params}`);
        if (data.id) {
          setTmdbId(data.id);
          setLookupState('done');
          // Also fetch real season count from TMDB
          if (mediaType === 'tv_show') {
            try {
              const showData = await api.get(`/media/tmdb-show?tmdbId=${data.id}`);
              if (showData.numberOfSeasons) setRealSeasonCount(showData.numberOfSeasons);
            } catch { /* use DB value as fallback */ }
          }
        } else {
          setLookupState('error');
        }
      } catch (err) {
        setLookupState(err.message?.includes('503') ? 'no-key' : 'error');
      }
    }
    fetchTmdbId();
  }, [item.title, item.year, mediaType]);

  // Fetch episode count for a season when TMDB ID is ready
  const fetchSeasonEpisodes = useCallback(async (s) => {
    if (!tmdbId || !isTV || seasonEpisodeCounts[s] !== undefined) return;
    setLoadingEpisodes(true);
    try {
      const data = await api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=${s}`);
      setSeasonEpisodeCounts(prev => ({ ...prev, [s]: data.episodeCount || 1 }));
    } catch {
      // Fallback to 12 if TMDB fails
      setSeasonEpisodeCounts(prev => ({ ...prev, [s]: 12 }));
    } finally {
      setLoadingEpisodes(false);
    }
  }, [tmdbId, isTV, seasonEpisodeCounts]);

  // Fetch episode count whenever season or tmdbId changes
  useEffect(() => {
    if (tmdbId && isTV) fetchSeasonEpisodes(season);
  }, [tmdbId, season, isTV, fetchSeasonEpisodes]);

  // Pre-fetch all seasons' episode counts once tmdbId is known
  useEffect(() => {
    if (!tmdbId || !isTV) return;
    for (let s = 1; s <= totalSeasons; s++) {
      fetchSeasonEpisodes(s);
    }
  }, [tmdbId, isTV, totalSeasons, fetchSeasonEpisodes]);

  // Load watched episodes for this show
  useEffect(() => {
    if (!item.id || !isTV) return;
    api.get(`/media/episode-progress/${item.id}`)
      .then(rows => {
        setWatched(new Set(rows.map(r => `${r.season}:${r.episode}`)));
      })
      .catch(() => {});
  }, [item.id, isTV]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      (iframeRef.current || modalRef.current)?.requestFullscreen().catch(() => {
        modalRef.current?.requestFullscreen();
      });
    } else {
      document.exitFullscreen();
    }
  }

  async function markWatched(s, e) {
    const key = `${s}:${e}`;
    setMarkingWatched(true);
    try {
      if (watched.has(key)) {
        await api.delete('/media/episode-progress', { media_id: item.id, season: s, episode: e });
        setWatched(prev => { const n = new Set(prev); n.delete(key); return n; });
      } else {
        await api.post('/media/episode-progress', { media_id: item.id, season: s, episode: e });
        setWatched(prev => new Set([...prev, key]));
      }
    } catch { /* non-fatal */ }
    finally { setMarkingWatched(false); }
  }

  function getFallbackUrl() {
    const title = encodeURIComponent(item.title);
    if (isTV) return `https://vidsrc.me/embed/tv?tmdb=${title}&season=${season}&episode=${episode}`;
    return `https://vidsrc.me/embed/movie?tmdb=${title}`;
  }

  const episodeCount = seasonEpisodeCounts[season];
  const embedUrl = tmdbId
    ? buildUrl(provider, tmdbId, mediaType, season, episode)
    : getFallbackUrl();

  // Count watched in current season
  const watchedInSeason = Array.from(watched).filter(k => k.startsWith(`${season}:`)).length;

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="player-header">
          <div className="player-title">
            <span>{isTV ? '📺' : '🎬'}</span>
            <div>
              <strong>{item.title}</strong>
              {item.year && <span className="player-year">{item.year}</span>}
              {tmdbId && <span className="player-tmdb-badge">TMDB ✓</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="player-close" onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? '↙' : '↗'}
            </button>
            <button className="player-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        {/* Status bar */}
        {lookupState === 'loading' && (
          <div className="player-lookup-bar">
            <span className="player-lookup-dot" /> Looking up media ID...
          </div>
        )}
        {lookupState === 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            ⚠️ Could not find TMDB ID for "{item.title}" — stream may not load.
          </div>
        )}
        {lookupState === 'no-key' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            ⚠️ Add <code>TMDB_API_KEY</code> to your .env for accurate episode counts.
          </div>
        )}

        {/* TV Controls */}
        {isTV && (
          <div className="player-tv-controls">

            {/* Season row */}
            <div className="player-control-group">
              <label>Season</label>
              <div className="player-episode-btns">
                {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => {
                  const watchedCount = Array.from(watched).filter(k => k.startsWith(`${s}:`)).length;
                  const total = seasonEpisodeCounts[s];
                  const allWatched = total && watchedCount === total;
                  return (
                    <button
                      key={s}
                      className={`player-ep-btn ${season === s ? 'active' : ''} ${allWatched ? 'ep-all-watched' : watchedCount > 0 ? 'ep-partial-watched' : ''}`}
                      onClick={() => { setSeason(s); setEpisode(1); }}
                      title={watchedCount > 0 ? `${watchedCount}${total ? '/'+total : ''} watched` : ''}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Episode row */}
            <div className="player-control-group">
              <label>
                Episode
                {episodeCount !== undefined && (
                  <span className="player-ep-meta">
                    {loadingEpisodes ? ' ...' : ` (${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''})`}
                  </span>
                )}
              </label>
              <div className="player-episode-btns">
                {episodeCount === undefined ? (
                  <span className="player-ep-loading">Loading episodes...</span>
                ) : (
                  Array.from({ length: episodeCount }, (_, i) => i + 1).map(e => {
                    const isWatched = watched.has(`${season}:${e}`);
                    const isCurrent = episode === e;
                    return (
                      <button
                        key={e}
                        className={`player-ep-btn ${isCurrent ? 'active' : ''} ${isWatched && !isCurrent ? 'ep-watched' : ''}`}
                        onClick={() => setEpisode(e)}
                        title={isWatched ? 'Watched — click to unmark' : 'Click to watch'}
                      >
                        {e}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Mark watched button */}
            <div className="player-mark-row">
              <button
                className={`player-mark-btn ${watched.has(`${season}:${episode}`) ? 'player-mark-btn--watched' : ''}`}
                onClick={() => markWatched(season, episode)}
                disabled={markingWatched}
                title={watched.has(`${season}:${episode}`) ? 'Click to unmark as watched' : 'Click to manually mark as watched (auto-marks after 5 min)'}
              >
                {watched.has(`${season}:${episode}`) ? '✓ Watched' : '+ Mark as watched'}
              </button>
              <span className="player-mark-hint">
                S{season} E{episode}
                {!watched.has(`${season}:${episode}`) && ' · auto-tracks after 5 min'}
              </span>
            </div>
          </div>
        )}

        {/* Provider switcher */}
        <div className="player-providers">
          <span className="player-providers-label">Source:</span>
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              className={`player-provider-btn ${provider === p.id ? 'active' : ''}`}
              onClick={() => setProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* iframe */}
        <div className="player-frame-wrap">
          {embedUrl ? (
            <iframe
              key={`${provider}-${tmdbId}-${season}-${episode}`}
              ref={iframeRef}
              src={embedUrl}
              className="player-frame"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              referrerPolicy="no-referrer"
              title={`Watch ${item.title}`}
            />
          ) : (
            <div className="player-no-url"><p>⏳ Preparing stream...</p></div>
          )}
        </div>

        <p className="player-note">
          If the video doesn't load, try switching sources above.
        </p>
      </div>
    </div>
  );
}

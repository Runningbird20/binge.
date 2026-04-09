<<<<<<< HEAD
import { useEffect, useRef, useState } from 'react';
=======
import { useState, useEffect, useRef, useCallback } from 'react';
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
import { api } from '../api';

const PROVIDERS = [
  { id: 'vidsrc-embed-ru', label: 'vidsrc-embed.ru', baseUrl: 'https://vidsrc-embed.ru' },
  { id: 'vidsrc-embed-su', label: 'vidsrc-embed.su', baseUrl: 'https://vidsrc-embed.su' },
  { id: 'vidsrcme-su', label: 'vidsrcme.su', baseUrl: 'https://vidsrcme.su' },
  { id: 'vsrc-su', label: 'vsrc.su', baseUrl: 'https://vsrc.su' },
];

<<<<<<< HEAD
function normalizeExternalId(kind, value) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  if (kind === 'tmdb' && /^\d+$/.test(normalized)) {
    return { kind: 'tmdb', value: normalized };
=======
function buildUrl(provider, tmdbId, mediaType, season, episode) {
  const isTV = mediaType === 'tv_show';
  if (!tmdbId) return null;
  if (provider === 'vidsrc') {
    if (isTV) return `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
    return `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
  }

  if (kind === 'imdb' && /^tt\d+$/i.test(normalized)) {
    return { kind: 'imdb', value: normalized.toLowerCase() };
  }

  return null;
}

function getEmbeddedId(item) {
  const candidates = [
    normalizeExternalId('tmdb', item?.tmdbId),
    normalizeExternalId('tmdb', item?.tmdb_id),
    normalizeExternalId('tmdb', item?.tmdb),
    normalizeExternalId('imdb', item?.imdbId),
    normalizeExternalId('imdb', item?.imdb_id),
    normalizeExternalId('imdb', item?.imdb),
  ];

  return candidates.find(Boolean) || null;
}

function buildUrl(providerId, externalId, mediaType, season, episode) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId) || PROVIDERS[0];
  const isTV = mediaType === 'tv_show';

  if (!provider || !externalId) return null;

  const url = new URL(isTV ? '/embed/tv' : '/embed/movie', provider.baseUrl);
  url.searchParams.set(externalId.kind, externalId.value);
  url.searchParams.set('autoplay', '1');

  if (isTV) {
    url.searchParams.set('season', String(season));
    url.searchParams.set('episode', String(episode));
    url.searchParams.set('autonext', '1');
  }

  return url.toString();
}

export default function EmbedPlayer({ item, mediaType, onClose }) {
<<<<<<< HEAD
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [externalId, setExternalId] = useState(() => getEmbeddedId(item));
  const [lookupState, setLookupState] = useState(() => (getEmbeddedId(item) ? 'done' : 'loading'));
  const [lookupError, setLookupError] = useState('');
=======
  const [provider, setProvider]         = useState('vidsrc');
  const [season, setSeason]             = useState(1);
  const [episode, setEpisode]           = useState(1);
  const [tmdbId, setTmdbId]             = useState(null);
  const [lookupState, setLookupState]   = useState('loading');
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
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

<<<<<<< HEAD
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

=======
  // Fullscreen listener
  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

<<<<<<< HEAD
=======
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
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
  useEffect(() => {
    const embeddedId = getEmbeddedId(item);

    if (embeddedId) {
      setExternalId(embeddedId);
      setLookupState('done');
      setLookupError('');
      return undefined;
    }

    let cancelled = false;

    async function fetchEmbedId() {
      setExternalId(null);
      setLookupState('loading');
      setLookupError('');

      try {
        const params = new URLSearchParams({
          title: item.title,
          type: mediaType,
          ...(item.year ? { year: item.year } : {}),
        });
        const data = await api.get(`/media/embed-id?${params}`);

        if (cancelled) return;

        if (data?.kind && data?.value) {
          setExternalId({ kind: data.kind, value: String(data.value) });
          setLookupState('done');
<<<<<<< HEAD
          setLookupError('');
=======
          // Also fetch real season count from TMDB
          if (mediaType === 'tv_show') {
            try {
              const showData = await api.get(`/media/tmdb-show?tmdbId=${data.id}`);
              if (showData.numberOfSeasons) setRealSeasonCount(showData.numberOfSeasons);
            } catch { /* use DB value as fallback */ }
          }
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
        } else {
          setLookupState('error');
          setLookupError(`Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`);
        }
      } catch (err) {
<<<<<<< HEAD
        if (cancelled) return;
        setLookupState('error');
        if (err.message?.includes('Unable to reach the API')) {
          setLookupError('Unable to reach the API. Make sure the backend server is running on port 5001.');
        } else {
          setLookupError(err.message || 'The stream lookup failed.');
        }
=======
        setLookupState(err.message?.includes('503') ? 'no-key' : 'error');
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
      }
    }

    fetchEmbedId();

    return () => {
      cancelled = true;
    };
  }, [item, mediaType]);

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
<<<<<<< HEAD
      const element = iframeRef.current || modalRef.current;
      element?.requestFullscreen().catch(() => {
=======
      (iframeRef.current || modalRef.current)?.requestFullscreen().catch(() => {
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
        modalRef.current?.requestFullscreen();
      });
      return;
    }

    document.exitFullscreen();
  }

<<<<<<< HEAD
  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode);
  const totalSeasons = item.seasons || 3;
=======
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
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={(event) => event.stopPropagation()}>
        <div className="player-header">
          <div className="player-title">
            <span>{isTV ? 'TV' : 'Movie'}</span>
            <div>
              <strong>{item.title}</strong>
              {item.year && <span className="player-year">{item.year}</span>}
              {externalId && (
                <span className="player-tmdb-badge">{externalId.kind.toUpperCase()} OK</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
<<<<<<< HEAD
            <button
              className="player-close"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? '<' : '>'}
=======
            <button className="player-close" onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? '↙' : '↗'}
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
            </button>
            <button className="player-close" onClick={onClose} title="Close">X</button>
          </div>
        </div>

<<<<<<< HEAD
=======
        {/* Status bar */}
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
        {lookupState === 'loading' && (
          <div className="player-lookup-bar">
            <span className="player-lookup-dot" /> Looking up a stream ID...
          </div>
        )}
        {lookupState === 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
<<<<<<< HEAD
            {lookupError || `Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`}
=======
            ⚠️ Could not find TMDB ID for "{item.title}" — stream may not load.
          </div>
        )}
        {lookupState === 'no-key' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            ⚠️ Add <code>TMDB_API_KEY</code> to your .env for accurate episode counts.
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
          </div>
        )}

        {isTV && (
          <div className="player-tv-controls">

            {/* Season row */}
            <div className="player-control-group">
              <label>Season</label>
              <div className="player-episode-btns">
<<<<<<< HEAD
                {Array.from({ length: totalSeasons }, (_, index) => index + 1).map((value) => (
                  <button
                    key={value}
                    className={`player-ep-btn ${season === value ? 'active' : ''}`}
                    onClick={() => {
                      setSeason(value);
                      setEpisode(1);
                    }}
                  >
                    {value}
                  </button>
                ))}
=======
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
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
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
<<<<<<< HEAD
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <button
                    key={value}
                    className={`player-ep-btn ${episode === value ? 'active' : ''}`}
                    onClick={() => setEpisode(value)}
                  >
                    {value}
                  </button>
                ))}
=======
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
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
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

        <div className="player-providers">
          <span className="player-providers-label">Source:</span>
          {PROVIDERS.map((entry) => (
            <button
              key={entry.id}
              className={`player-provider-btn ${provider === entry.id ? 'active' : ''}`}
              onClick={() => setProvider(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

<<<<<<< HEAD
=======
        {/* iframe */}
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
        <div className="player-frame-wrap">
          {embedUrl ? (
            <iframe
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}`}
              ref={iframeRef}
              src={embedUrl}
              className="player-frame"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
<<<<<<< HEAD
              allowFullScreen
=======
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
              referrerPolicy="no-referrer"
              title={`Watch ${item.title}`}
            />
          ) : (
<<<<<<< HEAD
            <div className="player-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream...' : 'Stream unavailable right now.'}</p>
            </div>
=======
            <div className="player-no-url"><p>⏳ Preparing stream...</p></div>
>>>>>>> 1d8c1acf16b405b8035ed2093b8e806278078e41
          )}
        </div>

        <p className="player-note">
          VidSrc needs an IMDb or TMDB ID. This player now tries direct item IDs first, then an IMDb title lookup.
        </p>
      </div>
    </div>
  );
}

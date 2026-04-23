import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  fetchEpisodeProgress,
  markEpisodeWatched,
  unmarkEpisodeWatched,
  updateWatchlistProgress,
} from '../utils/supabaseData';

const PROVIDERS = [
  {
    id: 'vidsrc-embed-ru',
    label: 'Vidsrc',
    buildUrl(id, mediaType, season, episode) {
      const base = 'https://vidsrc-embed.ru';
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', base);
      url.searchParams.set(id.kind, id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); url.searchParams.set('autonext', '1'); }
      url.searchParams.set('autoplay', '1');
      return url.toString();
    },
  },
  {
    id: 'vidsrc2',
    label: 'Vidsrc 2',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vidsrc-embed.su');
      url.searchParams.set(id.kind, id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
      url.searchParams.set('autoplay', '1');
      return url.toString();
    },
  },
  {
    id: '2embed',
    label: '2Embed ★ anime',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      if (isTV) return `https://www.2embed.stream/embed/tv/${id.value}/${season}/${episode}`;
      return `https://www.2embed.stream/embed/movie/${id.value}`;
    },
  },
  {
    id: 'autoembed',
    label: 'AutoEmbed ★ anime',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      if (isTV) return `https://autoembed.co/tv/${id.kind}/${id.value}-${season}-${episode}`;
      return `https://autoembed.co/movie/${id.kind}/${id.value}`;
    },
  },
  {
    id: 'vidlink',
    label: 'VidLink',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      if (isTV) return `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=true`;
      return `https://vidlink.pro/movie/${id.value}?autoplay=true`;
    },
  },
  {
    id: 'superembed',
    label: 'SuperEmbed',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      const tmdbFlag = id.kind === 'tmdb' ? '&tmdb=1' : '';
      if (isTV) return `https://multiembed.mov/?video_id=${id.value}${tmdbFlag}&s=${season}&e=${episode}`;
      return `https://multiembed.mov/?video_id=${id.value}${tmdbFlag}`;
    },
  },
  {
    id: 'vsrc-su',
    label: 'Vidsrc 3',
    buildUrl(id, mediaType, season, episode) {
      const base = 'https://vsrc.su';
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', base);
      url.searchParams.set(id.kind, id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
      url.searchParams.set('autoplay', '1');
      return url.toString();
    },
  },
];

const AUTO_WATCH_SECONDS = 5 * 60;
const EPISODES_PER_SEASON = 20;

function normalizeExternalId(kind, value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (kind === 'tmdb' && /^\d+$/.test(normalized)) return { kind: 'tmdb', value: normalized };
  if (kind === 'imdb' && /^tt\d+$/i.test(normalized)) return { kind: 'imdb', value: normalized.toLowerCase() };
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
    normalizeExternalId(
      'tmdb',
      typeof item?.source_key === 'string' && /^tmdb:(movie|tv):\d+$/i.test(item.source_key)
        ? item.source_key.split(':')[2]
        : null
    ),
  ];
  return candidates.find(Boolean) || null;
}

function buildUrl(providerId, externalId, mediaType, season, episode) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId) || PROVIDERS[0];
  if (!provider || !externalId) return null;
  try {
    return provider.buildUrl(externalId, mediaType, season, episode);
  } catch {
    return null;
  }
}

export default function EmbedPlayer({ item, mediaType, onClose }) {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [externalId, setExternalId] = useState(() => getEmbeddedId(item));
  const [lookupState, setLookupState] = useState(() => (getEmbeddedId(item) ? 'done' : 'loading'));
  const [lookupError, setLookupError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seasonEpisodeCounts, setSeasonEpisodeCounts] = useState({});
  const [watched, setWatched] = useState(new Set());
  const [markingWatched, setMarkingWatched] = useState(false);

  const modalRef = useRef(null);
  const iframeRef = useRef(null);
  const watchTimerRef = useRef(null);
  const watchSecondsRef = useRef(0);
  const autoAddedRef = useRef(false);

  const isTV = mediaType === 'tv_show';
  const itemSeasonCount = Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null;
  const totalSeasons = Math.max(1, itemSeasonCount ?? 1);
  const currentEpisodeKey = `${season}:${episode}`;
  const canTrackEpisodes = Boolean(item?.id);
  const episodeCount = isTV ? (seasonEpisodeCounts[season] ?? undefined) : undefined;
  const watchedInSeason = Array.from(watched).filter((key) => key.startsWith(`${season}:`)).length;

  // Reset state when item changes
  useEffect(() => {
    setProvider(PROVIDERS[0].id);
    setSeason(1);
    setEpisode(1);
    setSeasonEpisodeCounts({});
    setWatched(new Set());
  }, [item?.id, item?.title, mediaType]);

  // Build episode counts — hardcoded to 20 per season
  useEffect(() => {
    if (!isTV) return;
    const counts = {};
    for (let s = 1; s <= totalSeasons; s++) {
      counts[s] = EPISODES_PER_SEASON;
    }
    setSeasonEpisodeCounts(counts);
  }, [isTV, totalSeasons]);

  // Fullscreen listener
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Auto-mark episode watched after 5 minutes
  useEffect(() => {
    if (!isTV || !item?.id) return undefined;

    watchSecondsRef.current = 0;
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }

    const key = `${season}:${episode}`;
    if (watched.has(key)) return undefined;

    watchTimerRef.current = setInterval(() => {
      watchSecondsRef.current += 1;
      if (watchSecondsRef.current >= AUTO_WATCH_SECONDS) {
        clearInterval(watchTimerRef.current);
        watchTimerRef.current = null;
        markEpisodeWatched({ mediaId: item.id, season, episode })
          .then(() => {
            setWatched((previous) => new Set([...previous, key]));
            updateWatchlistProgress({
              mediaType: 'tv_show',
              mediaId: item.id,
              currentSeason: season,
              currentEpisode: episode,
              status: 'watching',
            }).catch(() => {});
          })
          .catch(() => {});
      }
    }, 1000);

    return () => {
      if (watchTimerRef.current) {
        clearInterval(watchTimerRef.current);
        watchTimerRef.current = null;
      }
    };
  }, [episode, isTV, item?.id, season, watched]);

  // Auto-add movies to watchlist after 2 minutes
  useEffect(() => {
    if (isTV || !item?.id || autoAddedRef.current) return;
    const timer = setTimeout(() => {
      if (autoAddedRef.current) return;
      autoAddedRef.current = true;
      updateWatchlistProgress({ mediaType: 'movie', mediaId: item.id, status: 'watching' }).catch(() => {});
    }, 2 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isTV, item?.id]);

  // Look up external ID if not already on the item
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
          setLookupError('');
        } else {
          setLookupState('error');
          setLookupError(`Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`);
        }
      } catch (err) {
        if (cancelled) return;
        setLookupState('error');
        if (err.message?.includes('Unable to reach the API')) {
          setLookupError('Unable to reach the API server. Make sure the backend is running.');
        } else {
          setLookupError(err.message || 'The stream lookup failed.');
        }
      }
    }

    fetchEmbedId();
    return () => { cancelled = true; };
  }, [item, mediaType]);

  // Load watched episodes
  useEffect(() => {
    if (!item?.id || !isTV) return;
    fetchEpisodeProgress(item.id)
      .then((rows) => setWatched(new Set(rows.map((row) => `${row.season}:${row.episode}`))))
      .catch(() => {});
  }, [item?.id, isTV]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      const element = iframeRef.current || modalRef.current;
      element?.requestFullscreen().catch(() => modalRef.current?.requestFullscreen());
      return;
    }
    document.exitFullscreen();
  }

  async function markWatched(selectedSeason, selectedEpisode) {
    if (!item?.id) return;
    const key = `${selectedSeason}:${selectedEpisode}`;
    setMarkingWatched(true);
    try {
      if (watched.has(key)) {
        await unmarkEpisodeWatched({ mediaId: item.id, season: selectedSeason, episode: selectedEpisode });
        setWatched((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      } else {
        await markEpisodeWatched({ mediaId: item.id, season: selectedSeason, episode: selectedEpisode });
        setWatched((previous) => new Set([...previous, key]));
        updateWatchlistProgress({
          mediaType: 'tv_show',
          mediaId: item.id,
          currentSeason: selectedSeason,
          currentEpisode: selectedEpisode,
          status: 'watching',
        }).catch(() => {});
      }
    } catch {
      // keep playback usable
    } finally {
      setMarkingWatched(false);
    }
  }

  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode);

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={(event) => event.stopPropagation()}>
        <div className="player-header">
          <div className="player-title">
            <span>{isTV ? 'TV' : 'Movie'}</span>
            <div>
              <strong>{item.title}</strong>
              {item.year && <span className="player-year">{item.year}</span>}
              {externalId && <span className="player-tmdb-badge">{externalId.kind.toUpperCase()} OK</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="player-close" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} type="button">
              {isFullscreen ? '<' : '>'}
            </button>
            <button className="player-close" onClick={onClose} title="Close" type="button">X</button>
          </div>
        </div>

        {lookupState === 'loading' && (
          <div className="player-lookup-bar">
            <span className="player-lookup-dot" /> Looking up a stream ID...
          </div>
        )}
        {lookupState === 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            {lookupError || `Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`}
          </div>
        )}

        {isTV && (
          <div className="player-tv-controls">
            <div className="player-control-group">
              <label>Season</label>
              <div className="player-episode-btns">
                {Array.from({ length: totalSeasons }, (_, i) => i + 1).map((value) => {
                  const watchedCount = Array.from(watched).filter((key) => key.startsWith(`${value}:`)).length;
                  const totalEpisodes = seasonEpisodeCounts[value];
                  const allWatched = totalEpisodes && watchedCount === totalEpisodes;
                  return (
                    <button
                      key={value}
                      className={`player-ep-btn ${season === value ? 'active' : ''} ${allWatched ? 'ep-all-watched' : watchedCount > 0 ? 'ep-partial-watched' : ''}`}
                      onClick={() => { setSeason(value); setEpisode(1); }}
                      title={watchedCount > 0 ? `${watchedCount}${totalEpisodes ? `/${totalEpisodes}` : ''} watched` : ''}
                      type="button"
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="player-control-group">
              <label>
                Episode
                {episodeCount !== undefined && (
                  <span className="player-ep-meta">
                    {` (${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''})`}
                  </span>
                )}
              </label>
              <div className="player-episode-btns">
                {episodeCount === undefined ? (
                  <span className="player-ep-loading">Loading episodes...</span>
                ) : (
                  Array.from({ length: episodeCount }, (_, i) => i + 1).map((value) => {
                    const isWatched = watched.has(`${season}:${value}`);
                    const isCurrent = episode === value;
                    return (
                      <button
                        key={value}
                        className={`player-ep-btn ${isCurrent ? 'active' : ''} ${isWatched && !isCurrent ? 'ep-watched' : ''}`}
                        onClick={() => setEpisode(value)}
                        title={isWatched ? 'Watched' : 'Click to watch'}
                        type="button"
                      >
                        {value}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="player-mark-row">
              <button
                className={`player-mark-btn ${watched.has(currentEpisodeKey) ? 'player-mark-btn--watched' : ''}`}
                onClick={() => markWatched(season, episode)}
                disabled={!canTrackEpisodes || markingWatched}
                title={
                  !canTrackEpisodes
                    ? 'Watch tracking is unavailable for this item.'
                    : watched.has(currentEpisodeKey)
                      ? 'Click to unmark as watched'
                      : 'Click to manually mark as watched (auto-marks after 5 min)'
                }
                type="button"
              >
                {watched.has(currentEpisodeKey) ? '\u2713 Watched' : '+ Mark as watched'}
              </button>
              <span className="player-mark-hint">
                S{season} E{episode}
                {!watched.has(currentEpisodeKey) && canTrackEpisodes && ' | auto-tracks after 5 min'}
                {!canTrackEpisodes && ' | tracking unavailable'}
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
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="player-anime-hint">
          For anime try <strong>2Embed</strong> or <strong>AutoEmbed</strong> — they have the best anime coverage.
        </p>

        <div className="player-frame-wrap">
          {embedUrl ? (
            <iframe
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}`}
              ref={iframeRef}
              src={embedUrl}
              className="player-frame"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="no-referrer"
              title={`Watch ${item.title}`}
            />
          ) : (
            <div className="player-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream...' : 'Stream unavailable right now.'}</p>
            </div>
          )}
        </div>

        <p className="player-note">
          VidSrc needs an IMDb or TMDB ID. This player now tries direct item IDs first, then an IMDb title lookup.
        </p>
      </div>
    </div>
  );
}
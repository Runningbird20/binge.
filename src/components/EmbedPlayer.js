import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const AUTO_WATCH_SECONDS = 5 * 60;

// Each provider has a buildUrl function for full control over URL format
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
    id: 'vidsrc3',
    label: 'Vidsrc 3',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      if (id.kind === 'tmdb') {
        if (isTV) return `https://vidsrc.xyz/embed/tv?tmdb=${id.value}&season=${season}&episode=${episode}`;
        return `https://vidsrc.xyz/embed/movie?tmdb=${id.value}`;
      }
      if (isTV) return `https://vidsrc.xyz/embed/tv?imdb=${id.value}&season=${season}&episode=${episode}`;
      return `https://vidsrc.xyz/embed/movie?imdb=${id.value}`;
    },
  },
];

function normalizeExternalId(kind, value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (kind === 'tmdb' && /^\d+$/.test(normalized)) return { kind: 'tmdb', value: normalized };
  if (kind === 'imdb' && /^tt\d+$/i.test(normalized)) return { kind: 'imdb', value: normalized.toLowerCase() };
  return null;
}

function getEmbeddedId(item) {
  // Parse TMDB ID from source_key (format: "tmdb:movie:12345" or "tmdb:tv:12345")
  // This is how items stored via the Express/SQLite pipeline are keyed
  let fromSourceKey = null;
  if (item?.source_key) {
    const match = item.source_key.match(/^tmdb:(?:movie|tv):(\d+)$/);
    if (match) fromSourceKey = normalizeExternalId('tmdb', match[1]);
  }

  // external_id field from Supabase (stored as "tmdb:12345" or just "12345")
  let fromExternalId = null;
  if (item?.external_id) {
    const cleaned = String(item.external_id).replace(/^tmdb:/, '').trim();
    fromExternalId = normalizeExternalId('tmdb', cleaned);
  }

  const candidates = [
    fromSourceKey,
    fromExternalId,
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
  const provider = PROVIDERS.find((e) => e.id === providerId) || PROVIDERS[0];
  if (!provider || !externalId) return null;
  try { return provider.buildUrl(externalId, mediaType, season, episode); }
  catch { return null; }
}

export default function EmbedPlayer({ item, mediaType, onClose }) {
  const [provider, setProvider]   = useState(PROVIDERS[0].id);
  const [season, setSeason]       = useState(1);
  const [episode, setEpisode]     = useState(1);
  const [externalId, setExternalId] = useState(() => getEmbeddedId(item));
  const [lookupState, setLookupState] = useState(() => (getEmbeddedId(item) ? 'done' : 'loading'));
  const [lookupError, setLookupError] = useState('');
  const [metadataWarning, setMetadataWarning] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seasonEpisodeCounts, setSeasonEpisodeCounts] = useState({});
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [watched, setWatched]     = useState(new Set());
  const [markingWatched, setMarkingWatched] = useState(false);
  const [realSeasonCount, setRealSeasonCount] = useState(null);

  const modalRef        = useRef(null);
  const iframeRef       = useRef(null);
  const watchTimerRef   = useRef(null);
  const watchSecondsRef = useRef(0);
  const autoAddedRef    = useRef(false);

  const isTV            = mediaType === 'tv_show';
  const tmdbId          = externalId?.kind === 'tmdb' ? externalId.value : null;
  const itemSeasonCount = Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null;
  const totalSeasons    = Math.max(1, realSeasonCount ?? itemSeasonCount ?? 1);
  const currentEpisodeKey = `${season}:${episode}`;
  const canTrackEpisodes  = Boolean(item?.id);

  // Reset on item change
  useEffect(() => {
    setProvider(PROVIDERS[0].id);
    setSeason(1);
    setEpisode(1);
    setSeasonEpisodeCounts({});
    setRealSeasonCount(null);
    setWatched(new Set());
    setMetadataWarning('');
    autoAddedRef.current = false;
  }, [item?.id, item?.title, mediaType]);

  // Fullscreen listener
  useEffect(() => {
    function onFsChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Auto-track episode after 5 min
  useEffect(() => {
    if (!isTV || !item?.id) return undefined;
    watchSecondsRef.current = 0;
    if (watchTimerRef.current) { clearInterval(watchTimerRef.current); watchTimerRef.current = null; }
    const key = `${season}:${episode}`;
    if (watched.has(key)) return undefined;
    watchTimerRef.current = setInterval(() => {
      watchSecondsRef.current += 1;
      if (watchSecondsRef.current >= AUTO_WATCH_SECONDS) {
        clearInterval(watchTimerRef.current);
        watchTimerRef.current = null;
        api.post('/media/episode-progress', { media_id: item.id, season, episode })
          .then(() => {
            setWatched((prev) => new Set([...prev, key]));
            api.patch('/watchlist/progress', { media_type: 'tv_show', media_id: item.id, current_season: season, current_episode: episode, status: 'watching' }).catch(() => {});
          })
          .catch(() => {});
      }
    }, 1000);
    return () => { if (watchTimerRef.current) { clearInterval(watchTimerRef.current); watchTimerRef.current = null; } };
  }, [episode, isTV, item?.id, season, watched]);

  // Auto-add movies to watchlist after 2 min
  useEffect(() => {
    if (isTV || !item?.id || autoAddedRef.current) return;
    const timer = setTimeout(() => {
      if (autoAddedRef.current) return;
      autoAddedRef.current = true;
      api.patch('/watchlist/progress', { media_type: 'movie', media_id: item.id, status: 'watching' }).catch(() => {});
    }, 2 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isTV, item?.id]);

  // Look up embed ID if not embedded directly
  useEffect(() => {
    const embeddedId = getEmbeddedId(item);
    if (embeddedId) { setExternalId(embeddedId); setLookupState('done'); setLookupError(''); return undefined; }
    let cancelled = false;
    async function fetchEmbedId() {
      setExternalId(null); setLookupState('loading'); setLookupError('');
      try {
        const params = new URLSearchParams({ title: item.title, type: mediaType, ...(item.year ? { year: item.year } : {}) });
        const data = await api.get(`/media/embed-id?${params}`);
        if (cancelled) return;
        if (data?.kind && data?.value) { setExternalId({ kind: data.kind, value: String(data.value) }); setLookupState('done'); setLookupError(''); }
        else { setLookupState('error'); setLookupError(`Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`); }
      } catch (err) {
        if (cancelled) return;
        setLookupState('error');
        setLookupError(err.message?.includes('Unable to reach the API')
          ? 'Unable to reach the API. Make sure the backend server is running on port 5001.'
          : err.message || 'The stream lookup failed.');
      }
    }
    fetchEmbedId();
    return () => { cancelled = true; };
  }, [item, mediaType]);

  // Fetch real season count from TMDB
  useEffect(() => {
    if (!isTV || !tmdbId) return undefined;
    let cancelled = false;
    api.get(`/media/tmdb-show?tmdbId=${tmdbId}`)
      .then((data) => { if (!cancelled && data?.numberOfSeasons) setRealSeasonCount(data.numberOfSeasons); })
      .catch((err) => { if (!cancelled && err.message?.includes('TMDB_API_KEY')) setMetadataWarning('Add TMDB_API_KEY to your .env for accurate episode counts.'); });
    return () => { cancelled = true; };
  }, [isTV, tmdbId]);

  // Fetch episode count for the current season (on-demand)
  const fetchSeasonEpisodes = useCallback(async (seasonNumber) => {
    if (!tmdbId || !isTV || seasonEpisodeCounts[seasonNumber] !== undefined) return;
    setLoadingEpisodes(true);
    try {
      const data = await api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=${seasonNumber}`);
      const count = Math.max(1, Number(data?.episodeCount) || 1);
      setSeasonEpisodeCounts((prev) => ({ ...prev, [seasonNumber]: count }));
    } catch (err) {
      if (err.message?.includes('TMDB_API_KEY')) setMetadataWarning('Add TMDB_API_KEY to your .env for accurate episode counts.');
      setSeasonEpisodeCounts((prev) => ({ ...prev, [seasonNumber]: prev[seasonNumber] ?? null }));
    } finally { setLoadingEpisodes(false); }
  }, [tmdbId, isTV, seasonEpisodeCounts]);

  useEffect(() => {
    if (tmdbId && isTV) fetchSeasonEpisodes(season);
  }, [fetchSeasonEpisodes, isTV, season, tmdbId]);

  // Load already-watched episodes
  useEffect(() => {
    if (!item?.id || !isTV) return;
    api.get(`/media/episode-progress/${item.id}`)
      .then((rows) => setWatched(new Set(rows.map((r) => `${r.season}:${r.episode}`))))
      .catch(() => {});
  }, [item?.id, isTV]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) (iframeRef.current || modalRef.current)?.requestFullscreen().catch(() => modalRef.current?.requestFullscreen());
    else document.exitFullscreen();
  }

  async function markWatched(selectedSeason, selectedEpisode) {
    if (!item?.id) return;
    const key = `${selectedSeason}:${selectedEpisode}`;
    setMarkingWatched(true);
    try {
      if (watched.has(key)) {
        await api.delete('/media/episode-progress', { media_id: item.id, season: selectedSeason, episode: selectedEpisode });
        setWatched((prev) => { const next = new Set(prev); next.delete(key); return next; });
      } else {
        await api.post('/media/episode-progress', { media_id: item.id, season: selectedSeason, episode: selectedEpisode });
        setWatched((prev) => new Set([...prev, key]));
        api.patch('/watchlist/progress', { media_type: 'tv_show', media_id: item.id, current_season: selectedSeason, current_episode: selectedEpisode, status: 'watching' }).catch(() => {});
      }
    } catch { /* keep playback usable */ }
    finally { setMarkingWatched(false); }
  }

  const embedUrl       = buildUrl(provider, externalId, mediaType, season, episode);
  const episodeCount   = isTV ? (seasonEpisodeCounts[season] ?? undefined) : undefined;
  const watchedInSeason = Array.from(watched).filter((k) => k.startsWith(`${season}:`)).length;

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
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
            <button className="player-close" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} type="button">{isFullscreen ? '<' : '>'}</button>
            <button className="player-close" onClick={onClose} title="Close" type="button">X</button>
          </div>
        </div>

        {lookupState === 'loading' && <div className="player-lookup-bar"><span className="player-lookup-dot" /> Looking up a stream ID...</div>}
        {lookupState === 'error'   && <div className="player-lookup-bar player-lookup-bar--warn">{lookupError || `Could not find ID for "${item.title}".`}</div>}
        {metadataWarning && lookupState !== 'error' && <div className="player-lookup-bar player-lookup-bar--warn">{metadataWarning}</div>}

        {isTV && (
          <div className="player-tv-controls">
            {/* Season buttons */}
            <div className="player-control-group">
              <label>Season</label>
              <div className="player-episode-btns">
                {Array.from({ length: totalSeasons }, (_, i) => i + 1).map((val) => {
                  const wc = Array.from(watched).filter((k) => k.startsWith(`${val}:`)).length;
                  const te = seasonEpisodeCounts[val];
                  const allWatched = te && wc === te;
                  return (
                    <button
                      key={val}
                      className={`player-ep-btn ${season === val ? 'active' : ''} ${allWatched ? 'ep-all-watched' : wc > 0 ? 'ep-partial-watched' : ''}`}
                      onClick={() => { setSeason(val); setEpisode(1); }}
                      title={wc > 0 ? `${wc}${te ? `/${te}` : ''} watched` : ''}
                      type="button"
                    >{val}</button>
                  );
                })}
              </div>
            </div>

            {/* Episode buttons */}
            <div className="player-control-group">
              <label>
                Episode
                {episodeCount !== undefined && (
                  <span className="player-ep-meta">
                    {loadingEpisodes && tmdbId ? ' ...' : ` (${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''})`}
                  </span>
                )}
              </label>
              <div className="player-episode-btns">
                {episodeCount === undefined ? (
                  <span className="player-ep-loading">Loading episodes...</span>
                ) : (
                  Array.from({ length: episodeCount }, (_, i) => i + 1).map((val) => {
                    const isWatched = watched.has(`${season}:${val}`);
                    const isCurrent = episode === val;
                    return (
                      <button
                        key={val}
                        className={`player-ep-btn ${isCurrent ? 'active' : ''} ${isWatched && !isCurrent ? 'ep-watched' : ''}`}
                        onClick={() => setEpisode(val)}
                        title={isWatched ? 'Watched' : 'Click to watch'}
                        type="button"
                      >{val}</button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Mark as watched */}
            <div className="player-mark-row">
              <button
                className={`player-mark-btn ${watched.has(currentEpisodeKey) ? 'player-mark-btn--watched' : ''}`}
                onClick={() => markWatched(season, episode)}
                disabled={!canTrackEpisodes || markingWatched}
                title={watched.has(currentEpisodeKey) ? 'Click to unmark as watched' : 'Click to mark as watched (auto-marks after 5 min)'}
                type="button"
              >
                {watched.has(currentEpisodeKey) ? '✓ Watched' : '+ Mark as watched'}
              </button>
              <span className="player-mark-hint">
                S{season} E{episode}{!watched.has(currentEpisodeKey) && canTrackEpisodes && ' | auto-tracks after 5 min'}
              </span>
            </div>
          </div>
        )}

        <div className="player-providers">
          <span className="player-providers-label">Source:</span>
          {PROVIDERS.map((e) => (
            <button key={e.id} className={`player-provider-btn ${provider === e.id ? 'active' : ''}`} onClick={() => setProvider(e.id)} type="button">{e.label}</button>
          ))}
        </div>
        <p className="player-anime-hint">For anime try <strong>2Embed</strong> or <strong>AutoEmbed</strong> — they have the best anime coverage.</p>

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
        <p className="player-note">VidSrc needs an IMDb or TMDB ID. This player tries direct item IDs first, then a title lookup.</p>
      </div>
    </div>
  );
}

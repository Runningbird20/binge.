import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  fetchEpisodeProgress,
  markEpisodeWatched,
  unmarkEpisodeWatched,
  upsertSupabaseContinueWatching,
} from '../utils/supabaseData';
import useDeviceType from '../hooks/useDeviceType';
import { useMiniPlayer } from '../contexts/MiniPlayerContext';

// Each provider has a buildUrl function for full control over URL format
const PROVIDERS = [
  {
    id: 'vidsrc-embed-ru',
    label: 'Vidsrc',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vsembed.ru');
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
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vsembed.su');
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
      // 2embed.stream — great anime coverage, uses TMDB or IMDB
      const isTV = mediaType === 'tv_show';
      if (isTV) {
        return `https://www.2embed.stream/embed/tv/${id.value}/${season}/${episode}`;
      }
      return `https://www.2embed.stream/embed/movie/${id.value}`;
    },
  },
  {
    id: 'autoembed',
    label: 'AutoEmbed ★ anime',
    buildUrl(id, mediaType, season, episode) {
      // autoembed.co — explicitly supports anime via TMDB or IMDB ID
      const isTV = mediaType === 'tv_show';
      if (isTV) {
        return `https://autoembed.co/tv/${id.kind}/${id.value}-${season}-${episode}`;
      }
      return `https://autoembed.co/movie/${id.kind}/${id.value}`;
    },
  },
  {
    id: 'vidlink',
    label: 'VidLink',
    buildUrl(id, mediaType, season, episode) {
      // vidlink.pro — clean player, good anime support
      const isTV = mediaType === 'tv_show';
      if (isTV) {
        return `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=true`;
      }
      return `https://vidlink.pro/movie/${id.value}?autoplay=true`;
    },
  },
  {
    id: 'superembed',
    label: 'SuperEmbed',
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      const tmdbFlag = id.kind === 'tmdb' ? '&tmdb=1' : '';
      if (isTV) {
        return `https://multiembed.mov/?video_id=${id.value}${tmdbFlag}&s=${season}&e=${episode}`;
      }
      return `https://multiembed.mov/?video_id=${id.value}${tmdbFlag}`;
    },
  },
];

const AUTO_WATCH_SECONDS = 5 * 60;

function normalizeExternalId(kind, value) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  if (kind === 'tmdb' && /^\d+$/.test(normalized)) {
    return { kind: 'tmdb', value: normalized };
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
  if (!provider) return null;
  if (!externalId) return null;
  try {
    return provider.buildUrl(externalId, mediaType, season, episode, null);
  } catch {
    return null;
  }
}

function normalizeStartAt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default function EmbedPlayer({ item, mediaType, onClose, initialSeason, initialEpisode }) {
  const { isMobile, isLandscape } = useDeviceType();
  const { showMini, closeMini } = useMiniPlayer();
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [season, setSeason] = useState(() => normalizeStartAt(initialSeason));
  const [episode, setEpisode] = useState(() => normalizeStartAt(initialEpisode));
  const [externalId, setExternalId] = useState(() => getEmbeddedId(item));
  const [lookupState, setLookupState] = useState(() => (getEmbeddedId(item) ? 'done' : 'loading'));
  const [lookupError, setLookupError] = useState('');
  const [metadataWarning, setMetadataWarning] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seasonEpisodeCounts, setSeasonEpisodeCounts] = useState({});
  const [watched, setWatched] = useState(new Set());
  const [markingWatched, setMarkingWatched] = useState(false);
  const [realSeasonCount, setRealSeasonCount] = useState(null);
  const [lsControlsOpen, setLsControlsOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const modalRef = useRef(null);
  const frameWrapRef = useRef(null);
  const iframeRef = useRef(null);
  const watchTimerRef = useRef(null);
  const watchSecondsRef = useRef(0);
  const hideControlsTimerRef = useRef(null);

  const isTV = mediaType === 'tv_show';
  const tmdbId = externalId?.kind === 'tmdb' ? externalId.value : null;
  const itemSeasonCount = Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null;
  const totalSeasons = Math.max(1, realSeasonCount ?? itemSeasonCount ?? 1);
  const currentEpisodeKey = `${season}:${episode}`;
  const canTrackEpisodes = Boolean(item?.id);

  useEffect(() => {
    setProvider(PROVIDERS[0].id);
    setSeason(normalizeStartAt(initialSeason));
    setEpisode(normalizeStartAt(initialEpisode));
    setSeasonEpisodeCounts({});
    setRealSeasonCount(null);
    setWatched(new Set());
    setMetadataWarning('');
  }, [item?.id, item?.title, mediaType, initialSeason, initialEpisode]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Only one video should ever be audible at once — opening this (full)
  // player always wins over whatever the mini-player widget was doing.
  useEffect(() => {
    closeMini();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLandscape) setLsControlsOpen(false);
  }, [isLandscape]);

  // Keyboard shortcuts — refs avoid stale closures without re-binding on every render
  const kbSeason = useRef(season);
  const kbEpisode = useRef(episode);
  const kbTotalSeasons = useRef(totalSeasons);
  const kbEpCounts = useRef(seasonEpisodeCounts);
  useEffect(() => { kbSeason.current = season; }, [season]);
  useEffect(() => { kbEpisode.current = episode; }, [episode]);
  useEffect(() => { kbTotalSeasons.current = totalSeasons; }, [totalSeasons]);
  useEffect(() => { kbEpCounts.current = seasonEpisodeCounts; }, [seasonEpisodeCounts]);

  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); return; }
      if (!isTV) return;
      const s = kbSeason.current;
      const ep = kbEpisode.current;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const epCount = kbEpCounts.current[s] ?? null;
        if (epCount && ep < epCount) { setEpisode(ep + 1); }
        else if (s < kbTotalSeasons.current) { setSeason(s + 1); setEpisode(1); }
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (ep > 1) { setEpisode(ep - 1); }
        else if (s > 1) { setSeason(s - 1); setEpisode(1); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTV, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

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

    return () => {
      cancelled = true;
    };
  }, [item, mediaType]);

  useEffect(() => {
    if (!isTV || !tmdbId) return undefined;

    let cancelled = false;

    async function fetchShowDetails() {
      try {
        const showData = await api.get(`/media/tmdb-show?tmdbId=${tmdbId}`);
        if (cancelled) return;
        if (showData?.numberOfSeasons) {
          setRealSeasonCount(showData.numberOfSeasons);
        }
      } catch (err) {
        if (cancelled) return;
        if (err.message?.includes('TMDB_API_KEY')) {
          setMetadataWarning('Add TMDB_API_KEY to your .env for accurate episode counts.');
        }
      }
    }

    fetchShowDetails();

    return () => {
      cancelled = true;
    };
  }, [isTV, tmdbId]);

  const fetchSeasonEpisodes = useCallback(async (seasonNumber) => {
    if (!tmdbId || !isTV || seasonEpisodeCounts[seasonNumber] !== undefined) return;

    try {
      const data = await api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=${seasonNumber}`);
      const nextCount = Math.max(1, Number(data?.episodeCount) || 1);
      setSeasonEpisodeCounts((previous) => ({ ...previous, [seasonNumber]: nextCount }));
    } catch (err) {
      if (err.message?.includes('TMDB_API_KEY')) {
        setMetadataWarning('Add TMDB_API_KEY to your .env for accurate episode counts.');
      }
      // Don't fall back to a hardcoded number — leave as null so UI shows "Loading..."
      // Only set a fallback if we have NO other info at all
      setSeasonEpisodeCounts((previous) => ({
        ...previous,
        [seasonNumber]: previous[seasonNumber] ?? null,
      }));
    }
  }, [tmdbId, isTV, seasonEpisodeCounts]);

  useEffect(() => {
    if (tmdbId && isTV) {
      fetchSeasonEpisodes(season);
    }
  }, [fetchSeasonEpisodes, isTV, season, tmdbId]);

  // Removed: pre-fetching all seasons at once causes rate limiting and slow loads
  // Episodes are now fetched on-demand when a season is selected

  useEffect(() => {
    if (!item?.id || !isTV) return;

    fetchEpisodeProgress(item.id)
      .then((rows) => {
        setWatched(new Set(rows.map((row) => `${row.season}:${row.episode}`)));
      })
      .catch(() => {});
  }, [item?.id, isTV]);

  // Starting playback records/updates Continue Watching — independent of
  // whether this title is in the library. Adding to the library stays a
  // separate, explicit action (the "Add to Watchlist" button).
  useEffect(() => {
    if (!item?.id || !buildUrl(provider, externalId, mediaType, season, episode)) return;

    upsertSupabaseContinueWatching({
      mediaType,
      mediaId: item.id,
      ...(isTV ? { currentSeason: season, currentEpisode: episode } : {}),
    }).catch(() => {});
  }, [item?.id, mediaType, isTV, season, episode, provider, externalId]);

  // Floating controls overlay (desktop only) — auto-hides a few seconds after
  // the cursor enters the video area, matching Netflix/YouTube-style players.
  // A cross-origin iframe swallows mousemove events once the cursor is over
  // its content, so we can only reliably react to entering/leaving the frame
  // itself, not continuous movement within it — leaving and re-entering the
  // frame is what brings the overlay back once it's auto-hidden.
  const scheduleHideControls = useCallback(() => {
    clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    revealControls();
    return () => clearTimeout(hideControlsTimerRef.current);
  }, [item?.id, season, episode, revealControls]);

  function toggleFullscreen() {
    if (isMobile) {
      // On mobile, use Screen Orientation API to rotate to landscape.
      // requestFullscreen() doesn't work on iframes in iOS Safari.
      try {
        if (isLandscape) {
          window.screen.orientation?.unlock?.();
        } else {
          window.screen.orientation?.lock?.('landscape').catch(() => {});
        }
      } catch {}
      return;
    }
    if (!document.fullscreenElement) {
      // Fullscreen the frame wrapper (iframe + our overlay), not the raw
      // iframe — requestFullscreen() only renders the target element's own
      // subtree, so fullscreening the iframe directly would make our
      // sibling overlay/toggle button impossible to show at all.
      const element = frameWrapRef.current || modalRef.current;
      element?.requestFullscreen().catch(() => {
        modalRef.current?.requestFullscreen();
      });
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
        await unmarkEpisodeWatched({
          mediaId: item.id,
          season: selectedSeason,
          episode: selectedEpisode,
        });
        setWatched((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      } else {
        await markEpisodeWatched({
          mediaId: item.id,
          season: selectedSeason,
          episode: selectedEpisode,
        });
        setWatched((previous) => new Set([...previous, key]));
      }
    } catch {
      // Keep playback usable even if watch tracking fails.
    } finally {
      setMarkingWatched(false);
    }
  }

  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode);
  const episodeCount = isTV ? (seasonEpisodeCounts[season] ?? undefined) : undefined;
  const watchedInSeason = Array.from(watched).filter((key) => key.startsWith(`${season}:`)).length;

  // Hand off to the persistent global mini-player, then close this (full)
  // view the same way the close button would — the mini widget carries on
  // with its own copy of the embed, independent of this component now.
  function handleMinimize() {
    showMini({
      embedUrl,
      title: item.title,
      subtitle: isTV ? `S${season} E${episode}` : (item.year || ''),
      poster: item.poster_url || item.cover_url || item.image_url || null,
    });
    onClose?.();
  }

  // ── Mobile player ────────────────────────────────────────────
  const epChipsRef = useRef(null);
  useEffect(() => {
    if (!epChipsRef.current) return;
    const active = epChipsRef.current.querySelector('.mp-chip.active');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [episode, season]);

  if (isMobile) {
    return (
      <div className={`mp-shell${isLandscape ? ' mp-shell--ls' : ''}`}>
        {/* Header — hidden in landscape via CSS */}
        <div className="mp-header">
          <div className="mp-title">
            <span className="mp-title-text">{item.title}</span>
            {isTV && <span className="mp-title-ep">S{season} E{episode}</span>}
          </div>
          <div className="mp-header-btns">
            <button className="mp-btn" onClick={handleMinimize} type="button" title="Minimize">⌄</button>
            <button className="mp-btn" onClick={toggleFullscreen} type="button" title="Go landscape">
              ⤢
            </button>
            <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close">✕</button>
          </div>
        </div>

        {/* Video — expands to fill shell in landscape */}
        <div className="mp-video-wrap" ref={modalRef}>
          {embedUrl ? (
            <iframe
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}`}
              ref={iframeRef}
              src={embedUrl}
              className="mp-iframe"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              title={`Watch ${item.title}`}
            />
          ) : (
            <div className="mp-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream…' : 'Stream unavailable.'}</p>
            </div>
          )}
          {/* Landscape overlay — top-right corner buttons, hidden in portrait via CSS */}
          <div className="mp-ls-overlay">
            {isTV && (
              <button
                className="mp-btn"
                onClick={() => setLsControlsOpen(v => !v)}
                type="button"
                title="Episodes"
              >
                {lsControlsOpen ? '✕' : '⋮'}
              </button>
            )}
            {isTV && <span className="mp-ls-ep-badge">S{season} E{episode}</span>}
            <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close">✕</button>
          </div>

          {/* Landscape episode/source picker — slides up from bottom of video area */}
          {isLandscape && lsControlsOpen && (
            <div className="mp-ls-controls">
              {isTV && (
                <>
                  <div className="mp-row">
                    <span className="mp-row-label">Season</span>
                    <div className="mp-chips">
                      {Array.from({ length: totalSeasons }, (_, i) => i + 1).map((s) => {
                        const wc = Array.from(watched).filter(k => k.startsWith(`${s}:`)).length;
                        const tc = seasonEpisodeCounts[s];
                        return (
                          <button
                            key={s}
                            className={`mp-chip ${season === s ? 'active' : ''} ${tc && wc === tc ? 'mp-chip-done' : wc > 0 ? 'mp-chip-partial' : ''}`}
                            onClick={() => { setSeason(s); setEpisode(1); }}
                            type="button"
                          >{s}</button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mp-row">
                    <span className="mp-row-label">
                      Episode{episodeCount !== undefined ? ` · ${episodeCount} total` : ''}
                    </span>
                    <div className="mp-chips">
                      {episodeCount === undefined ? (
                        <span className="mp-loading">Loading episodes…</span>
                      ) : (
                        Array.from({ length: episodeCount }, (_, i) => i + 1).map((ep) => {
                          const isWatched = watched.has(`${season}:${ep}`);
                          const isCurrent = episode === ep;
                          return (
                            <button
                              key={ep}
                              className={`mp-chip ${isCurrent ? 'active' : ''} ${isWatched && !isCurrent ? 'mp-chip-watched' : ''}`}
                              onClick={() => { setEpisode(ep); setLsControlsOpen(false); }}
                              type="button"
                            >{ep}</button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="mp-row">
                <span className="mp-row-label">Source</span>
                <div className="mp-chips">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={`mp-chip ${provider === p.id ? 'active' : ''}`}
                      onClick={() => setProvider(p.id)}
                      type="button"
                    >{p.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="mp-controls">
          {lookupState === 'loading' && (
            <div className="mp-status">Looking up stream ID…</div>
          )}
          {lookupState === 'error' && (
            <div className="mp-status mp-status--err">{lookupError || `Could not find stream for "${item.title}".`}</div>
          )}
          {isTV && (
            <>
              {/* Season */}
              <div className="mp-row">
                <span className="mp-row-label">Season</span>
                <div className="mp-chips">
                  {Array.from({ length: totalSeasons }, (_, i) => i + 1).map((s) => {
                    const wc = Array.from(watched).filter(k => k.startsWith(`${s}:`)).length;
                    const tc = seasonEpisodeCounts[s];
                    return (
                      <button
                        key={s}
                        className={`mp-chip ${season === s ? 'active' : ''} ${tc && wc === tc ? 'mp-chip-done' : wc > 0 ? 'mp-chip-partial' : ''}`}
                        onClick={() => { setSeason(s); setEpisode(1); }}
                        type="button"
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Episode */}
              <div className="mp-row">
                <span className="mp-row-label">
                  Episode{episodeCount !== undefined ? ` · ${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''}` : ''}
                </span>
                <div className="mp-chips" ref={epChipsRef}>
                  {episodeCount === undefined ? (
                    <span className="mp-loading">Loading episodes…</span>
                  ) : (
                    Array.from({ length: episodeCount }, (_, i) => i + 1).map((ep) => {
                      const isWatched = watched.has(`${season}:${ep}`);
                      const isCurrent = episode === ep;
                      return (
                        <button
                          key={ep}
                          className={`mp-chip ${isCurrent ? 'active' : ''} ${isWatched && !isCurrent ? 'mp-chip-watched' : ''}`}
                          onClick={() => setEpisode(ep)}
                          type="button"
                        >
                          {ep}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Mark watched */}
              <div className="mp-mark-row">
                <button
                  className={`mp-watch-btn ${watched.has(currentEpisodeKey) ? 'marked' : ''}`}
                  onClick={() => markWatched(season, episode)}
                  disabled={!canTrackEpisodes || markingWatched}
                  type="button"
                >
                  {watched.has(currentEpisodeKey) ? '✓ Watched' : '+ Mark as watched'}
                </button>
              </div>
            </>
          )}

          <div className="mp-divider" />

          {/* Source */}
          <div className="mp-row">
            <span className="mp-row-label">Source</span>
            <div className="mp-chips">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  className={`mp-chip ${provider === p.id ? 'active' : ''}`}
                  onClick={() => setProvider(p.id)}
                  type="button"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop player ───────────────────────────────────────────
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
              {isTV && (
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
                  {watched.has(currentEpisodeKey) ? '✓ Watched' : '+ Mark as watched'}
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="player-close" onClick={handleMinimize} title="Minimize" type="button">
              ⌄
            </button>
            <button className="player-close" onClick={onClose} title="Close" type="button">
              X
            </button>
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
        {metadataWarning && lookupState !== 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            {metadataWarning}
          </div>
        )}
        <div
          className="player-frame-wrap"
          ref={frameWrapRef}
          onMouseEnter={revealControls}
          onMouseLeave={() => { clearTimeout(hideControlsTimerRef.current); setControlsVisible(false); }}
        >
          {embedUrl ? (
            <iframe
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}`}
              ref={iframeRef}
              src={embedUrl}
              className="player-frame"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              title={`Watch ${item.title}`}
            />
          ) : (
            <div className="player-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream...' : 'Stream unavailable right now.'}</p>
            </div>
          )}

          <div
            className={`player-controls-overlay ${controlsVisible ? 'visible' : ''}`}
            onMouseEnter={() => clearTimeout(hideControlsTimerRef.current)}
            onMouseLeave={revealControls}
          >
            {isFullscreen && (
              <div className="player-overlay-fs-btns">
                <button
                  className="player-close"
                  onClick={toggleFullscreen}
                  title="Exit fullscreen"
                  type="button"
                >
                  {'<'}
                </button>
                <button className="player-close" onClick={onClose} title="Close" type="button">
                  X
                </button>
              </div>
            )}

            <div className="player-controls-top-row">
              <div className="player-providers">
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

              {isTV && (
                <div className="player-se-select-group">
                  <select
                    className="player-se-select"
                    value={season}
                    onChange={(event) => {
                      setSeason(Number(event.target.value));
                      setEpisode(1);
                    }}
                    aria-label="Season"
                  >
                    {Array.from({ length: totalSeasons }, (_, index) => index + 1).map((value) => {
                      const watchedCount = Array.from(watched).filter(
                        (key) => key.startsWith(`${value}:`),
                      ).length;
                      const totalEpisodes = seasonEpisodeCounts[value];

                      return (
                        <option key={value} value={value}>
                          Season {value}{totalEpisodes ? ` (${watchedCount}/${totalEpisodes})` : ''}
                        </option>
                      );
                    })}
                  </select>

                  <select
                    className="player-se-select"
                    value={episode}
                    onChange={(event) => setEpisode(Number(event.target.value))}
                    aria-label="Episode"
                    disabled={episodeCount === undefined}
                  >
                    {episodeCount === undefined ? (
                      <option>Loading\u2026</option>
                    ) : (
                      Array.from({ length: episodeCount }, (_, index) => index + 1).map((value) => (
                        <option key={value} value={value}>
                          {watched.has(`${season}:${value}`) ? '\u2713 ' : ''}Episode {value}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

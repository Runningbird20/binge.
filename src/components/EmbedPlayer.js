import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsIn, CaretDown, Check, Plus, X } from '@phosphor-icons/react';
import { api } from '../api';
import {
  fetchEpisodeProgress,
  markEpisodeWatched,
  unmarkEpisodeWatched,
  upsertSupabaseContinueWatching,
  updateWatchlistProgress,
} from '../utils/supabaseData';
import useDeviceType from '../hooks/useDeviceType';
import { useMiniPlayer } from '../contexts/MiniPlayerContext';
import { getEmbeddedId } from '../utils/embedPlayability';
import { fetchTmdbLanguageInfo } from '../utils/tmdb';
import {
  fetchReportSummary,
  getPlaybackPrefs,
  getServerMemory,
  rankServers,
  savePlaybackPrefs,
  submitStreamReport,
  wantedAudio,
} from '../utils/streamPreferences';
import PlaybackOptions, { PlaybackOptionsPanel } from './PlaybackOptions';

// Embed servers, best first. VidLink leads because it had the broadest
// coverage of new episodes when tested (e.g. a 2026 K-drama that vidsrc.ru
// and 2Embed didn't have yet — confirmed identical on their own sites, so
// it's catalog coverage, not our embed). Verified 2026-10-07 by loading each in a real
// browser, embedded in an iframe on a non-provider origin, and watching for
// an actual HLS/MP4 stream (a 200 page proves nothing — vsembed.ru serves
// its page but shows "This media is unavailable": its stream backend,
// data.vidsrc.sh, resets every connection). vidsrc.ru is a different
// service from vsembed.ru despite the name.
// Removed that day: vsembed.su (domain now DNS-sinkholed as malicious),
// multiembed.mov (connection reset), autoembed.co (no stream).
//   events:    sends PLAYER_EVENT postMessages (play/timeupdate), so the
//              player can confirm real playback instead of guessing
//   subtitles: accepts a default subtitle language parameter
//   idKinds:   which external ids the URL accepts
//   types:     media types it actually streams
const PROVIDERS = [
  {
    id: 'vidlink',
    label: 'VidLink',
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      return isTV
        ? `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=true&nextbutton=true`
        : `https://vidlink.pro/movie/${id.value}?autoplay=true`;
    },
  },
  {
    // https://vidsrc.ru/docs — movie/{tmdb|imdb}, tv/{id}/{s}/{e}. Posts
    // MEDIA_DATA progress messages to the parent window.
    id: 'vidsrc-ru',
    label: 'VidSrc',
    events: true,
    idKinds: ['tmdb', 'imdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidsrc.ru');
      url.searchParams.set('autoplay', 'true');
      url.searchParams.set('colour', 'f4f6f8');
      url.searchParams.set('pausescreen', 'true');
      if (isTV) url.searchParams.set('autonextepisode', 'true');
      return url.toString();
    },
  },
  {
    id: 'vidsrc-su',
    label: 'VidSrc SU',
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      return mediaType === 'tv_show'
        ? `https://vidsrc.su/embed/tv/${id.value}/${season}/${episode}`
        : `https://vidsrc.su/embed/movie/${id.value}`;
    },
  },
  {
    id: 'videasy',
    label: 'Videasy',
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      return mediaType === 'tv_show'
        ? `https://player.videasy.net/tv/${id.value}/${season}/${episode}?nextEpisode=true&autoplayNextEpisode=true`
        : `https://player.videasy.net/movie/${id.value}`;
    },
  },
  {
    id: '2embed',
    label: '2Embed',
    idKinds: ['tmdb', 'imdb'],
    types: ['tv_show', 'movie'],
    buildUrl(id, mediaType, season, episode) {
      return mediaType === 'tv_show'
        ? `https://www.2embed.stream/embed/tv/${id.value}/${season}/${episode}`
        : `https://www.2embed.stream/embed/movie/${id.value}`;
    },
  },
  {
    id: 'vidsrc-embed-ru',
    label: 'VidSrc Classic',
    subtitles: true,
    idKinds: ['tmdb', 'imdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode, subtitleLang) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vsembed.ru');
      url.searchParams.set(id.kind, id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); url.searchParams.set('autonext', '1'); }
      url.searchParams.set('autoplay', '1');
      // Documented: default subtitle language, ISO 639-1.
      if (subtitleLang) url.searchParams.set('ds_lang', subtitleLang);
      return url.toString();
    },
  },
  {
    id: 'vidsrc-rip',
    label: 'VidSrc RIP',
    idKinds: ['tmdb'],
    types: ['movie'],
    buildUrl(id) {
      return `https://vidsrc.rip/embed/movie/${id.value}`;
    },
  },
];

const AUTO_WATCH_SECONDS = 5 * 60;
// How long the player has to stay open on a title before it counts as
// "actually watching" for Continue Watching purposes — a bare click that's
// immediately closed (misclick, browsing) shouldn't leave a row behind.
const CONTINUE_WATCHING_DELAY_SECONDS = 20;

function buildUrl(providerId, externalId, mediaType, season, episode, subtitleLang = null) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId) || PROVIDERS[0];
  if (!provider) return null;
  if (!externalId) return null;
  try {
    return provider.buildUrl(externalId, mediaType, season, episode, subtitleLang);
  } catch {
    return null;
  }
}

// Servers that can play this title at all (media type + id kind).
function providerIdsFor(mediaType, externalId) {
  const type = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  const ids = PROVIDERS
    .filter((entry) => entry.types.includes(type) && (!externalId || entry.idKinds.includes(externalId.kind)))
    .map((entry) => entry.id);
  return ids.length ? ids : PROVIDERS.map((entry) => entry.id);
}
const EVENT_PROVIDERS = new Set(PROVIDERS.filter((entry) => entry.events).map((entry) => entry.id));
const SERVER_LABELS = Object.fromEntries(PROVIDERS.map((entry) => [entry.id, { label: entry.label, subtitles: Boolean(entry.subtitles) }]));
// How long a server has to stay open before it counts as "works" for this
// title (and the one-time audio check appears).
const SERVER_CONFIRM_SECONDS = 60;
// No playback time from an event-capable server after this long = it
// doesn't have this title; fail over automatically.
const FAILOVER_SECONDS = 25;

function normalizeStartAt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function bestServerFor(item, mediaType, prefs) {
  const memoryType = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  return rankServers(providerIdsFor(mediaType, getEmbeddedId(item)), {
    prefs,
    originalLanguage: item?.original_language || null,
    memory: getServerMemory(memoryType, item?.id),
  })[0]?.id || PROVIDERS[0].id;
}

export default function EmbedPlayer({ item, mediaType, onClose, initialSeason, initialEpisode }) {
  const { isMobile, isLandscape } = useDeviceType();
  const { showMini, closeMini } = useMiniPlayer();
  const [prefs, setPrefs] = useState(() => getPlaybackPrefs());
  const [provider, setProvider] = useState(() => bestServerFor(item, mediaType, getPlaybackPrefs()));
  const memoryType = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  const [originalLanguage, setOriginalLanguage] = useState(item?.original_language || null);
  const [reportSummary, setReportSummary] = useState([]);
  const [serverMemory, setServerMemory] = useState(() => getServerMemory(memoryType, item?.id));
  // Once the viewer picks a server themselves, or one has played long
  // enough to count as working, late-arriving community reports must not
  // yank them onto a different server mid-episode.
  const serverLockedRef = useRef(false);
  const manualPickRef = useRef(false);
  const playbackSeenRef = useRef(false);
  const triedRef = useRef(new Set());
  const [failoverNotice, setFailoverNotice] = useState(null);
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
  const [epPopoverOpen, setEpPopoverOpen] = useState(false);
  const modalRef = useRef(null);
  const epSelectorRef = useRef(null);
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
    serverLockedRef.current = false;
    manualPickRef.current = false;
    setProvider(bestServerFor(item, mediaType, getPlaybackPrefs()));
    setServerMemory(getServerMemory(mediaType === 'tv_show' ? 'tv_show' : 'movie', item?.id));
    setOriginalLanguage(item?.original_language || null);
    setReportSummary([]);
    setSeason(normalizeStartAt(initialSeason));
    setEpisode(normalizeStartAt(initialEpisode));
    setSeasonEpisodeCounts({});
    setRealSeasonCount(null);
    setWatched(new Set());
    setMetadataWarning('');
    setEpPopoverOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.title, mediaType, initialSeason, initialEpisode]);

  // ── Smart server choice (see utils/streamPreferences.js) ──────────────
  const availableIds = useMemo(() => providerIdsFor(mediaType, externalId), [mediaType, externalId]);
  const rankedServers = useMemo(
    () => rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory: serverMemory }),
    [availableIds, prefs, originalLanguage, reportSummary, serverMemory]
  );

  // Original language: from the catalog row, else TMDB.
  useEffect(() => {
    if (item?.original_language) return undefined;
    const tmdbLookupId = externalId?.kind === 'tmdb' ? externalId.value : null;
    if (!tmdbLookupId) return undefined;
    let cancelled = false;
    fetchTmdbLanguageInfo(mediaType, tmdbLookupId).then((info) => {
      if (!cancelled && info?.originalLanguage) setOriginalLanguage(info.originalLanguage);
    });
    return () => { cancelled = true; };
  }, [item?.original_language, externalId, mediaType]);

  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    fetchReportSummary(memoryType, item.id).then((rows) => { if (!cancelled) setReportSummary(rows); });
    return () => { cancelled = true; };
  }, [item?.id, memoryType]);

  // Follow the ranking until the viewer commits to a server.
  useEffect(() => {
    if (serverLockedRef.current) return;
    const best = rankedServers[0]?.id;
    if (best && best !== provider) setProvider(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedServers]);

  // Confirming a server works for this title. Servers that post
  // PLAYER_EVENT messages (VidLink, Videasy) are confirmed by real playback
  // (time actually advancing); for the rest, staying open for
  // SERVER_CONFIRM_SECONDS is the best available signal.
  const confirmedRef = useRef('');
  const confirmServer = useCallback(() => {
    const key = `${provider}|${item?.id}`;
    if (!item?.id || confirmedRef.current === key) return;
    confirmedRef.current = key;
    serverLockedRef.current = true;
    submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: true })
      .then(() => setServerMemory(getServerMemory(memoryType, item.id)))
      .catch(() => {});
  }, [provider, item?.id, memoryType]);

  useEffect(() => {
    if (!item?.id || !externalId || EVENT_PROVIDERS.has(provider)) return undefined;
    const timer = setTimeout(confirmServer, SERVER_CONFIRM_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [provider, item?.id, externalId, confirmServer]);

  useEffect(() => {
    if (!EVENT_PROVIDERS.has(provider)) return undefined;
    function onMessage(event) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (data?.type === 'PLAYER_EVENT') {
        const playback = data.data || {};
        if (Number(playback.currentTime) > 0) playbackSeenRef.current = true;
        if (Number(playback.currentTime) > 3 || (playback.event === 'timeupdate' && Number(playback.currentTime) > 0)) {
          confirmServer();
        }
        return;
      }
      // vidsrc.ru / vidsrc.su: { type: 'MEDIA_DATA', data: { progress: { watched, duration } } }
      if (data?.type === 'MEDIA_DATA') {
        const media = typeof data.data === 'string' ? (() => { try { return JSON.parse(data.data); } catch { return null; } })() : data.data;
        const watchedSeconds = Number(media?.progress?.watched);
        if (watchedSeconds > 0) playbackSeenRef.current = true;
        if (watchedSeconds > 3) confirmServer();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [provider, confirmServer]);

  // Automatic failover. Servers can load fine and still not have a given
  // episode (their catalogs differ), which looks identical from outside —
  // except that the event-capable ones never report playback time moving.
  // If a server we picked automatically shows no playback within
  // FAILOVER_SECONDS, mark it dead for this title and move to the next
  // ranked server. A server the viewer chose by hand is never skipped.
  useEffect(() => {
    triedRef.current = new Set();
    setFailoverNotice(null);
  }, [item?.id, season, episode]);

  useEffect(() => {
    playbackSeenRef.current = false;
    if (!item?.id || !externalId || manualPickRef.current || !EVENT_PROVIDERS.has(provider)) return undefined;
    const timer = setTimeout(() => {
      if (playbackSeenRef.current) return;
      triedRef.current.add(provider);
      submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: false }).catch(() => {});
      const memory = getServerMemory(memoryType, item.id);
      const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
      const next = ranking.find((server) => !triedRef.current.has(server.id) && server.id !== provider);
      if (!next) return;
      setServerMemory(memory);
      setFailoverNotice({ from: provider, to: next.id });
      setProvider(next.id);
    }, FAILOVER_SECONDS * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, season, episode, externalId, item?.id]);

  // Optional, from the panel: "the audio on this server is X".
  async function reportServerAudio(language) {
    if (!item?.id || !language) return;
    await submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: true, audioLang: language }).catch(() => {});
    const memory = getServerMemory(memoryType, item.id);
    setServerMemory(memory);
    const want = wantedAudio(prefs, originalLanguage);
    if (want && language !== want) {
      const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
      serverLockedRef.current = false;
      setProvider(nextServerAfter(provider, ranking, language));
    }
  }

  function nextServerAfter(currentId, ranking, avoidAudio = null) {
    const candidates = ranking.filter((server) => server.id !== currentId);
    return (candidates.find((server) => !avoidAudio || server.audio !== avoidAudio) || candidates[0])?.id || currentId;
  }

  function selectServer(id) {
    serverLockedRef.current = true;
    manualPickRef.current = true;
    setFailoverNotice(null);
    setProvider(id);
  }

  const failoverBar = failoverNotice && (
    <div className="st-failover" role="status">
      <span>
        {SERVER_LABELS[failoverNotice.from]?.label || failoverNotice.from} couldn&apos;t play this {isTV ? 'episode' : 'title'}, so we switched to {SERVER_LABELS[failoverNotice.to]?.label || failoverNotice.to}.
      </span>
      <button type="button" onClick={() => selectServer(failoverNotice.from)}>Try {SERVER_LABELS[failoverNotice.from]?.label || 'it'} anyway</button>
      <button type="button" className="st-failover-dismiss" onClick={() => setFailoverNotice(null)} aria-label="Dismiss">
        <X size={14} weight="bold" />
      </button>
    </div>
  );

  function changePrefs(patch) {
    const next = savePlaybackPrefs(patch);
    setPrefs(next);
    if (patch.audio) {
      // New audio language: let the ranking pick again, unless the current
      // server is already known to have it.
      const ranking = rankServers(availableIds, { prefs: next, originalLanguage, summary: reportSummary, memory: serverMemory });
      const current = ranking.find((server) => server.id === provider);
      const want = wantedAudio(next, originalLanguage);
      if (!(current?.audio && current.audio === want)) {
        serverLockedRef.current = false;
        if (ranking[0]?.id) setProvider(ranking[0].id);
      }
    }
  }

  async function reportBroken() {
    if (item?.id) await submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: false }).catch(() => {});
    const memory = getServerMemory(memoryType, item?.id);
    setServerMemory(memory);
    const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
    serverLockedRef.current = true;
    setProvider(nextServerAfter(provider, ranking));
  }

  const playbackOptionProps = {
    prefs,
    onPrefsChange: changePrefs,
    originalLanguage,
    servers: rankedServers,
    currentServer: provider,
    serverLabels: SERVER_LABELS,
    onSelectServer: selectServer,
    onReportBroken: reportBroken,
    onReportAudio: reportServerAudio,
  };
  const subtitleLang = prefs.subtitles && prefs.subtitles !== 'off' ? prefs.subtitles : null;

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

  const kbEpPopoverOpen = useRef(epPopoverOpen);
  useEffect(() => { kbEpPopoverOpen.current = epPopoverOpen; }, [epPopoverOpen]);

  // Close the season/episode popover on outside click, without letting that
  // click also register on whatever it landed on (e.g. re-toggling the
  // trigger button).
  useEffect(() => {
    if (!epPopoverOpen) return undefined;
    function onPointerDown(e) {
      if (epSelectorRef.current && !epSelectorRef.current.contains(e.target)) {
        setEpPopoverOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [epPopoverOpen]);

  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (kbEpPopoverOpen.current) { setEpPopoverOpen(false); return; }
        onClose?.();
        return;
      }
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

  // Recording/updating Continue Watching — independent of whether this title
  // is in the library (adding to the library stays a separate, explicit
  // action). Delayed by CONTINUE_WATCHING_DELAY_SECONDS so a title only lands
  // there once the player has actually stayed open, not on every click that
  // resolves a stream URL — a misclick or quick "let me check this out" close
  // shouldn't create (or bump) a Continue Watching entry.
  useEffect(() => {
    if (!item?.id || !buildUrl(provider, externalId, mediaType, season, episode, subtitleLang)) return undefined;

    const timer = setTimeout(() => {
      const progress = isTV ? { currentSeason: season, currentEpisode: episode } : {};
      upsertSupabaseContinueWatching({ mediaType, mediaId: item.id, ...progress }).catch(() => {});
      // Keeps the watchlist row's own progress columns in sync too, so a
      // title that's in BOTH the library and Continue Watching shows the
      // same up-to-date episode on both surfaces. No-ops if it's not in the
      // library — see updateWatchlistProgress's own doc comment.
      if (isTV) {
        updateWatchlistProgress({ mediaType, mediaId: item.id, ...progress }).catch(() => {});
      }
    }, CONTINUE_WATCHING_DELAY_SECONDS * 1000);

    return () => clearTimeout(timer);
  }, [item?.id, mediaType, isTV, season, episode, provider, externalId, subtitleLang]);

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

  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode, subtitleLang);
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
            <button className="mp-btn" onClick={handleMinimize} type="button" title="Minimize" aria-label="Minimize player"><CaretDown size={16} weight="bold" /></button>
            <button className="mp-btn" onClick={toggleFullscreen} type="button" title="Go landscape">
              ⤢
            </button>
            <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close"><X size={16} weight="bold" /></button>
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
            <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close"><X size={16} weight="bold" /></button>
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
                <span className="mp-row-label">Server</span>
                <div className="mp-chips">
                  {rankedServers.map((server) => (
                    <button
                      key={server.id}
                      className={`mp-chip ${provider === server.id ? 'active' : ''}`}
                      onClick={() => selectServer(server.id)}
                      type="button"
                    >{SERVER_LABELS[server.id]?.label || server.id}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {failoverBar}

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

          {/* Audio, subtitles and server — same panel as desktop, inline. */}
          <PlaybackOptionsPanel {...playbackOptionProps} />
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
            <div>
              <strong>{item.title}</strong>
              {isTV
                ? <span className="player-year">S{season} · E{episode}</span>
                : item.year && <span className="player-year">{item.year}</span>}
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
                  {watched.has(currentEpisodeKey) ? <><Check size={14} weight="bold" /> Watched</> : <><Plus size={14} weight="bold" /> Mark as watched</>}
                </button>
              )}
            </div>
          </div>
          <div className="player-header-btns">
            <button className="player-close" onClick={handleMinimize} title="Minimize" aria-label="Minimize player" type="button">
              <CaretDown size={18} weight="bold" />
            </button>
            <button className="player-close" onClick={onClose} title="Close" aria-label="Close player" type="button">
              <X size={18} weight="bold" />
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
                  aria-label="Exit fullscreen"
                  type="button"
                >
                  <ArrowsIn size={18} weight="bold" />
                </button>
                <button className="player-close" onClick={onClose} title="Close" aria-label="Close player" type="button">
                  <X size={18} weight="bold" />
                </button>
              </div>
            )}

            <div className="player-controls-top-row">
              <PlaybackOptions {...playbackOptionProps} />

              {isTV && (
                <div className="player-ep-selector" ref={epSelectorRef}>
                  <button
                    type="button"
                    className="player-ep-trigger"
                    onClick={() => setEpPopoverOpen((open) => !open)}
                    aria-haspopup="true"
                    aria-expanded={epPopoverOpen}
                  >
                    <span>S{season} · E{episode}</span>
                    <span className={`player-ep-trigger-caret${epPopoverOpen ? ' open' : ''}`}>⌄</span>
                  </button>

                  {epPopoverOpen && (
                    <div className="player-ep-popover" role="dialog" aria-label="Season and episode selector">
                      <div className="player-ep-section">
                        <span className="player-ep-section-label">Season</span>
                        <div className="player-ep-season-row">
                          {Array.from({ length: totalSeasons }, (_, index) => index + 1).map((value) => {
                            const watchedCount = Array.from(watched).filter(
                              (key) => key.startsWith(`${value}:`),
                            ).length;
                            const totalEpisodes = seasonEpisodeCounts[value];
                            const isDone = totalEpisodes && watchedCount === totalEpisodes;

                            return (
                              <button
                                key={value}
                                type="button"
                                className={`player-ep-season-chip${season === value ? ' active' : ''}${isDone ? ' done' : watchedCount > 0 ? ' partial' : ''}`}
                                onClick={() => { setSeason(value); setEpisode(1); }}
                              >
                                {value}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="player-ep-section">
                        <span className="player-ep-section-label">
                          Episode{episodeCount !== undefined ? ` · ${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''}` : ''}
                        </span>
                        <div className="player-ep-grid">
                          {episodeCount === undefined ? (
                            <span className="player-ep-loading">Loading episodes…</span>
                          ) : (
                            Array.from({ length: episodeCount }, (_, index) => index + 1).map((value) => {
                              const isWatchedEp = watched.has(`${season}:${value}`);
                              const isCurrent = episode === value;
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  className={`player-ep-chip${isCurrent ? ' active' : ''}${isWatchedEp && !isCurrent ? ' watched' : ''}`}
                                  onClick={() => { setEpisode(value); setEpPopoverOpen(false); }}
                                >
                                  {isWatchedEp ? '✓ ' : ''}{value}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {failoverBar}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsIn, ArrowsOut, CaretDown, Check, DeviceRotate, LockSimple, LockSimpleOpen, Play, Plus, X } from '@phosphor-icons/react';
import { api } from '../api';
import {
  fetchEpisodeProgress,
  markEpisodeWatched,
  unmarkEpisodeWatched,
  upsertSupabaseContinueWatching,
  updateWatchlistProgress,
  fetchSupabaseResumePoint,
} from '../utils/supabaseData';
import useDeviceType from '../hooks/useDeviceType';
import { getSettings } from '../utils/profileSettings';
import { isTvMode } from '../utils/tvMode';
import { readPlayback } from '../utils/playbackMessages';
import { useMiniPlayer } from '../contexts/MiniPlayerContext';
import { getEmbeddedId } from '../utils/embedPlayability';
import { fetchTmdbLanguageInfo, languageName } from '../utils/tmdb';
import { reachabilityMap } from '../utils/hostReachability';
import { useSeasonEpisodes } from '../hooks/useTitleDetails';
import { formatClock, getResumePosition, mergeRemotePosition, positionKey, savePosition } from '../utils/playbackPositions';
import {
  fetchReportSummary,
  fetchProviderHealth,
  rememberServer,
  getPlaybackPrefs,
  getServerMemory,
  rankServers,
  savePlaybackPrefs,
  submitStreamReport,
  wantedAudio,
} from '../utils/streamPreferences';
import PlaybackOptions, { MobilePlaybackPickers } from './PlaybackOptions';
import { haptic } from '../utils/haptics';

// Embed servers, best first. VidRift and Vidy lead: in testing they played
// every title tried, including a new 2026 K-drama episode that vidsrc.ru
// and 2Embed didn't have (identical on their own sites, so it's catalog
// coverage, not our embed), and both report playback time for failover.
// VidRift, Vidy and CineSrc were found via the sites they power
// (7movies.ac, movy.sx, shuttletv.su) and are documented embed APIs. Verified 2026-10-07 by loading each in a real
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
    // https://vidrift.net/docs — TMDB ids only; posts vidrift:progress
    // (currentTime) every 5s while playing. Played every title tested,
    // including new K-drama episodes other servers lacked.
    id: 'vidrift',
    label: 'VidRift',
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      const path = mediaType === 'tv_show' ? `/embed/tv/${id.value}/${season}/${episode}` : `/embed/movie/${id.value}`;
      const url = new URL(path, 'https://embed.vidrift.net');
      url.searchParams.set('brand', 'binge.');
      url.searchParams.set('brandColor', 'f4f6f8');
      return url.toString();
    },
  },
  {
    // https://www.vidy.st (#docs) — posts PLAYER_EVENT play/timeupdate.
    id: 'vidy',
    label: 'Vidy',
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidy.st');
      url.searchParams.set('color', 'F4F6F8');
      url.searchParams.set('autoplay', 'true');
      if (startAt > 0) url.searchParams.set('progress', String(startAt));
      if (isTV) {
        url.searchParams.set('nextEpisode', 'true');
        // Auto-next is ours (Up Next card), not the player's.
      }
      return url.toString();
    },
  },
  {
    id: 'vidlink',
    label: 'VidLink',
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt } = {}) {
      const isTV = mediaType === 'tv_show';
      const base = isTV
        ? `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=true&nextbutton=true`
        : `https://vidlink.pro/movie/${id.value}?autoplay=true`;
      // Documented startAt (seconds).
      return startAt > 0 ? `${base}&startAt=${startAt}` : base;
    },
  },
  {
    // https://cinesrc.st/docs — posts cinesrc:timeupdate { currentTime }.
    // subtitlelang (a language name) is undocumented but is what
    // shuttletv.su sends; harmless if ignored.
    id: 'cinesrc',
    label: 'CineSrc',
    events: true,
    subtitles: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, lowBandwidth } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/embed/tv/${id.value}` : `/embed/movie/${id.value}`, 'https://cinesrc.st');
      if (isTV) { url.searchParams.set('s', season); url.searchParams.set('e', episode); }
      url.searchParams.set('autoplay', 'true');
      if (startAt > 0) {
        url.searchParams.set('t', String(startAt));
        url.searchParams.set('continueprompt', 'false');
      }
      if (lowBandwidth) url.searchParams.set('quality', '720');
      url.searchParams.set('color', '#f4f6f8');
      url.searchParams.set('prioritize', 'true');
      url.searchParams.set('autonext', 'false');
      if (subtitleLang) {
        url.searchParams.set('subtitles', 'auto');
        url.searchParams.set('subtitlelang', languageName(subtitleLang));
      }
      return url.toString();
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
      if (isTV) url.searchParams.set('autonextepisode', 'false');
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
        ? `https://player.videasy.net/tv/${id.value}/${season}/${episode}?nextEpisode=true`
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
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
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

function buildUrl(providerId, externalId, mediaType, season, episode, subtitleLang = null, options = {}) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId) || PROVIDERS[0];
  if (!provider) return null;
  if (!externalId) return null;
  try {
    return provider.buildUrl(externalId, mediaType, season, episode, subtitleLang, options);
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
// Host each server's player lives on, for the network reachability probe.
const PROVIDER_HOSTS = Object.fromEntries(PROVIDERS.map((entry) => {
  try {
    return [entry.id, new URL(entry.buildUrl({ kind: 'tmdb', value: '1' }, 'movie', 1, 1, null, {})).hostname];
  } catch {
    return [entry.id, ''];
  }
}));
const EVENT_PROVIDERS = new Set(PROVIDERS.filter((entry) => entry.events).map((entry) => entry.id));
const SERVER_LABELS = Object.fromEntries(PROVIDERS.map((entry) => [entry.id, { label: entry.label, subtitles: Boolean(entry.subtitles) }]));
// How long a server has to stay open before it counts as "works" for this
// title (and the one-time audio check appears).
const SERVER_CONFIRM_SECONDS = 60;
// No playback time from an event-capable server after this long = it
// doesn't have this title; fail over automatically.
const FAILOVER_SECONDS = 25;
// Servers that report pause/play as well as time, so "time stopped moving"
// can be told apart from "viewer paused" — buffering detection only runs
// for these.
const PAUSE_AWARE = new Set(['vidrift', 'vidy', 'cinesrc', 'vidlink', 'videasy']);
// Servers that can start at a given second (URL param or message), so a
// mid-play switch keeps the viewer's place.
const RESUMABLE = new Set(['vidrift', 'vidy', 'cinesrc', 'vidlink']);
const UP_NEXT_SECONDS = 30;   // show the Up Next card in the last 30s
const UP_NEXT_COUNTDOWN = 10; // seconds before the next episode starts
const STALL_SECONDS = 12;      // no progress while playing -> buffering
const STALL_SWITCH_SECONDS = 30; // still stuck -> switch servers automatically

function prefersLowBandwidth() {
  if (getSettings().dataSaver) return true;
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
  return Boolean(connection && (connection.saveData || (connection.downlink && connection.downlink < 3)));
}

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

export default function EmbedPlayer({ item, mediaType, onClose, initialSeason, initialEpisode, initialPosition }) {
  const { isMobile, isLandscape } = useDeviceType();
  const { showMini, closeMini } = useMiniPlayer();
  const [prefs, setPrefs] = useState(() => getPlaybackPrefs());
  const [provider, setProvider] = useState(() => bestServerFor(item, mediaType, getPlaybackPrefs()));
  const memoryType = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  const [originalLanguage, setOriginalLanguage] = useState(item?.original_language || null);
  const [reportSummary, setReportSummary] = useState([]);
  const [providerHealth, setProviderHealth] = useState({});
  const [serverMemory, setServerMemory] = useState(() => getServerMemory(memoryType, item?.id));
  // Once the viewer picks a server themselves, or one has played long
  // enough to count as working, late-arriving community reports must not
  // yank them onto a different server mid-episode.
  const serverLockedRef = useRef(false);
  const manualPickRef = useRef(false);
  const playbackSeenRef = useRef(false);
  const triedRef = useRef(new Set());
  const [failoverNotice, setFailoverNotice] = useState(null);
  const [stall, setStall] = useState(null);
  const playbackRef = useRef({ time: 0, duration: 0, playing: false, lastAdvanceAt: Date.now(), lastSavedAt: 0 });
  // Start position per load (provider + episode), frozen when the load
  // begins so saving progress every few seconds never changes the iframe
  // URL (which would reload the player).
  const pendingStartRef = useRef(Number(initialPosition) > 0 ? Math.floor(Number(initialPosition)) : null);
  const [resumeNonce, setResumeNonce] = useState(0);
  const lastRemoteSaveRef = useRef(0);
  const frozenStartRef = useRef({ key: '', value: null });
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
  // Servers this network blocks (school/work firewalls) are dropped from
  // the ranking instead of being tried and failing.
  const [blockedIds, setBlockedIds] = useState(() => new Set());
  useEffect(() => {
    let cancelled = false;
    reachabilityMap(Object.values(PROVIDER_HOSTS)).then((reach) => {
      if (cancelled) return;
      setBlockedIds(new Set(Object.entries(PROVIDER_HOSTS).filter(([, host]) => reach[host] === false).map(([id]) => id)));
    });
    return () => { cancelled = true; };
  }, []);
  const availableIds = useMemo(() => {
    const ids = providerIdsFor(mediaType, externalId);
    const reachable = ids.filter((id) => !blockedIds.has(id));
    return reachable.length ? reachable : ids;
  }, [mediaType, externalId, blockedIds]);
  const rankedServers = useMemo(
    () => rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory: serverMemory, health: providerHealth }),
    [availableIds, prefs, originalLanguage, reportSummary, serverMemory, providerHealth]
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
    fetchProviderHealth().then((health) => { if (!cancelled) setProviderHealth(health); });
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
    playbackRef.current = { time: 0, duration: 0, playing: false, ended: false, lastAdvanceAt: Date.now(), lastSavedAt: 0 };
    function onMessage(event) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const reading = readPlayback(event.data);
      if (!reading) return;
      const now = Date.now();
      const state = playbackRef.current;

      if (reading.state === 'pause' || reading.state === 'ended') state.playing = false;
      state.ended = reading.state === 'ended' ? true : (reading.state === 'play' ? false : state.ended);
      if (reading.state === 'play') { state.playing = true; state.lastAdvanceAt = now; }
      if (reading.duration > 0) state.duration = reading.duration;

      if (Number.isFinite(reading.time) && reading.time > 0) {
        if (Math.abs(reading.time - state.time) > 0.25) {
          state.lastAdvanceAt = now;
          if (reading.state !== 'pause') state.playing = true;
          setStall(null);
        }
        state.time = reading.time;
        playbackSeenRef.current = true;
        if (reading.time > 3) confirmServer();
        if (now - state.lastSavedAt > 10000 && item?.id) {
          state.lastSavedAt = now;
          savePosition(positionKey(mediaType, item.id, season, episode), reading.time, state.duration);
        }
        // Synced copy (other devices) every 30s once there's something to
        // resume. Upserting Continue Watching also keeps it fresh.
        if (now - lastRemoteSaveRef.current > 30000 && item?.id && reading.time > 30) {
          lastRemoteSaveRef.current = now;
          syncPosition(reading.time, state.duration);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      const state = playbackRef.current;
      if (item?.id && state.time > 0) {
        savePosition(positionKey(mediaType, item.id, season, episode), state.time, state.duration);
        if (state.time > 30) syncPosition(state.time, state.duration);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, confirmServer, season, episode]);

  // ── Up Next / binge mode ─────────────────────────────────────────
  // Near the end of an episode (last UP_NEXT_SECONDS, or on 'ended'), show
  // the next episode with a 10s countdown. Players' own auto-next is turned
  // off in their URLs so this stays the one source of truth; the server
  // you're on carries over to the next episode.
  const currentSeasonEpisodes = isTV ? seasonEpisodeCounts[season] : null;
  const nextEpisode = useMemo(() => {
    if (!isTV) return null;
    if (currentSeasonEpisodes && episode < currentSeasonEpisodes) return { season, episode: episode + 1 };
    if (season < totalSeasons) return { season: season + 1, episode: 1 };
    return null;
  }, [isTV, currentSeasonEpisodes, episode, season, totalSeasons]);
  const nextSeasonEpisodes = useSeasonEpisodes(isTV && nextEpisode ? tmdbId : null, nextEpisode?.season);
  const nextInfo = nextEpisode && nextSeasonEpisodes?.find((ep) => ep.number === nextEpisode.episode);
  const [upNext, setUpNext] = useState(null); // { secondsLeft }
  const upNextDismissedRef = useRef('');

  useEffect(() => {
    setUpNext(null);
  }, [season, episode, item?.id]);

  useEffect(() => {
    if (!isTV || !nextEpisode) return undefined;
    const timer = setInterval(() => {
      const state = playbackRef.current;
      const key = `${season}:${episode}`;
      if (upNextDismissedRef.current === key) return;
      const nearEnd = state.duration > 0 && state.time > 0 && state.duration - state.time <= UP_NEXT_SECONDS;
      // With autoplay off in Settings the card waits for a tap (no countdown).
      if ((nearEnd || state.ended) && !upNext) setUpNext({ secondsLeft: getSettings().autoNext ? UP_NEXT_COUNTDOWN : null });
    }, 1000);
    return () => clearInterval(timer);
  }, [isTV, nextEpisode, season, episode, upNext]);

  useEffect(() => {
    if (!upNext || upNext.secondsLeft == null) return undefined;
    if (upNext.secondsLeft <= 0) { playNextEpisode(); return undefined; }
    const timer = setTimeout(() => setUpNext((current) => (current ? { secondsLeft: current.secondsLeft - 1 } : current)), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNext]);

  function playNextEpisode() {
    if (!nextEpisode) return;
    haptic();
    if (item?.id && !watched.has(`${season}:${episode}`)) {
      markEpisodeWatched({ mediaId: item.id, season, episode })
        .then(() => setWatched((previous) => new Set([...previous, `${season}:${episode}`])))
        .catch(() => {});
    }
    setUpNext(null);
    upNextDismissedRef.current = '';
    setSeason(nextEpisode.season);
    setEpisode(nextEpisode.episode);
  }

  function dismissUpNext() {
    upNextDismissedRef.current = `${season}:${episode}`;
    setUpNext(null);
  }

  const upNextCard = upNext && nextEpisode && (
    <div className="st-upnext" role="dialog" aria-label="Up next">
      {nextInfo?.still && <img src={nextInfo.still} alt="" className="st-upnext-still" />}
      <div className="st-upnext-body">
        <span className="st-upnext-kicker">Up next · S{nextEpisode.season} E{nextEpisode.episode}</span>
        <strong>{nextInfo?.title || `Episode ${nextEpisode.episode}`}</strong>
        <div className="st-upnext-actions">
          <button type="button" className="st-btn st-btn--primary" onClick={playNextEpisode}>
            <Play size={16} weight="fill" /> {upNext.secondsLeft == null ? 'Play next episode' : `Play now${upNext.secondsLeft > 0 ? ` (${upNext.secondsLeft})` : ''}`}
          </button>
          <button type="button" className="st-btn st-btn--ghost" onClick={dismissUpNext}>Cancel</button>
        </div>
      </div>
      {upNext.secondsLeft != null && <span className="st-upnext-bar" style={{ animationDuration: `${UP_NEXT_COUNTDOWN}s` }} aria-hidden="true" />}
    </div>
  );

  function syncPosition(seconds, duration) {
    upsertSupabaseContinueWatching({
      mediaType,
      mediaId: item.id,
      ...(isTV ? { currentSeason: season, currentEpisode: episode } : {}),
      positionSeconds: seconds,
      durationSeconds: duration,
    }).catch(() => {});
  }

  // Position from another device: if the synced copy is newer than this
  // device's and the player has barely started, jump there.
  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    fetchSupabaseResumePoint({ mediaType, mediaId: item.id }).then((remote) => {
      if (cancelled || !remote || !(remote.position > 30)) return;
      if (isTV && (Number(remote.season) !== Number(season) || Number(remote.episode) !== Number(episode))) return;
      const key = positionKey(mediaType, item.id, season, episode);
      const adopted = mergeRemotePosition(key, remote.position, remote.duration, remote.updatedAt);
      if (!adopted || playbackRef.current.time > 10) return;
      const target = getResumePosition(key);
      if (!target || Math.abs(target - (frozenStartRef.current.value || 0)) < 30) return;
      if (provider === 'vidrift' && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'vidrift:resume', currentTime: target }, 'https://embed.vidrift.net');
      } else if (RESUMABLE.has(provider)) {
        pendingStartRef.current = target;
        setResumeNonce((n) => n + 1);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, season, episode]);

  // Buffering: a server that's supposed to be playing but whose time has
  // stopped moving. Offer a same-timestamp switch after STALL_SECONDS and
  // make it automatically after STALL_SWITCH_SECONDS (never for a server
  // the viewer picked by hand).
  useEffect(() => {
    if (!PAUSE_AWARE.has(provider)) return undefined;
    const timer = setInterval(() => {
      const state = playbackRef.current;
      if (!state.playing || !(state.time > 0)) return;
      const stuckFor = (Date.now() - state.lastAdvanceAt) / 1000;
      if (stuckFor < STALL_SECONDS) return;
      const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory: getServerMemory(memoryType, item?.id) });
      const next = ranking.find((server) => server.id !== provider && RESUMABLE.has(server.id))
        || ranking.find((server) => server.id !== provider);
      if (!next) return;
      setStall({ provider, next: next.id, at: state.time });
      if (stuckFor >= STALL_SWITCH_SECONDS && !manualPickRef.current) {
        rememberServer(memoryType, item?.id, { [`slow:${provider}`]: Date.now() });
        setServerMemory(getServerMemory(memoryType, item?.id));
        switchServer(next.id, { at: state.time, reason: 'buffering' });
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, availableIds, prefs, originalLanguage, reportSummary]);

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

  // Change server, carrying the current position across when possible.
  function switchServer(id, { at = null, reason = null, manual = false } = {}) {
    const position = at ?? (playbackRef.current.time > 5 ? playbackRef.current.time : null);
    if (position) pendingStartRef.current = Math.floor(position);
    if (manual) {
      serverLockedRef.current = true;
      manualPickRef.current = true;
    }
    setStall(null);
    setFailoverNotice(reason ? { from: provider, to: id, reason, at: position } : null);
    setProvider(id);
  }

  function selectServer(id) {
    switchServer(id, { manual: true });
  }

  const stallBar = stall && !failoverNotice && (
    <div className="st-failover st-failover--stall" role="status">
      <span className="st-stall-dot" aria-hidden="true" />
      <span>Buffering on {SERVER_LABELS[stall.provider]?.label || stall.provider}…</span>
      <button type="button" onClick={() => switchServer(stall.next, { at: stall.at, reason: 'buffering' })}>
        Switch to {SERVER_LABELS[stall.next]?.label || stall.next}{RESUMABLE.has(stall.next) && stall.at ? ` at ${formatClock(stall.at)}` : ''}
      </button>
    </div>
  );

  const failoverBar = stallBar || (failoverNotice && (
    <div className="st-failover" role="status">
      <span>
        {failoverNotice.reason === 'buffering'
          ? `${SERVER_LABELS[failoverNotice.from]?.label || failoverNotice.from} kept buffering, so we switched to ${SERVER_LABELS[failoverNotice.to]?.label || failoverNotice.to}${failoverNotice.at ? ` at ${formatClock(failoverNotice.at)}` : ''}.`
          : `${SERVER_LABELS[failoverNotice.from]?.label || failoverNotice.from} couldn't play this ${isTV ? 'episode' : 'title'}, so we switched to ${SERVER_LABELS[failoverNotice.to]?.label || failoverNotice.to}.`}
      </span>
      <button type="button" onClick={() => selectServer(failoverNotice.from)}>Try {SERVER_LABELS[failoverNotice.from]?.label || 'it'} anyway</button>
      <button type="button" className="st-failover-dismiss" onClick={() => setFailoverNotice(null)} aria-label="Dismiss">
        <X size={14} weight="bold" />
      </button>
    </div>
  ));

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
    blockedCount: blockedIds.size,
    health: providerHealth,
  };
  const subtitleLang = prefs.subtitles && prefs.subtitles !== 'off' ? prefs.subtitles : null;

  const [rotationLocked, setRotationLocked] = useState(false);
  const [rotateHint, setRotateHint] = useState(false);
  const canLockRotation = typeof window !== 'undefined' && Boolean(window.screen?.orientation?.lock) && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  useEffect(() => {
    if (!rotateHint) return undefined;
    const timer = setTimeout(() => setRotateHint(false), 3500);
    return () => clearTimeout(timer);
  }, [rotateHint]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement) setRotationLocked(false);
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
      // On a TV the arrows move between the player's controls instead.
      if (!isTV || isTvMode()) return;
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

  // Orientation: Android can go fullscreen + lock to landscape (the lock
  // only works while fullscreen). iPhones allow neither for a web page, so
  // there the player follows the phone's own rotation and we just say so.
  async function enterLandscape() {
    const element = modalRef.current;
    try {
      if (!document.fullscreenElement) await element?.requestFullscreen?.({ navigationUI: 'hide' });
      await window.screen.orientation?.lock?.('landscape');
      setRotationLocked(true);
    } catch {
      if (!document.fullscreenElement) setRotateHint(true);
    }
  }

  async function toggleRotationLock() {
    haptic();
    try {
      if (rotationLocked) {
        window.screen.orientation?.unlock?.();
        setRotationLocked(false);
      } else {
        await window.screen.orientation?.lock?.(window.screen.orientation.type);
        setRotationLocked(true);
      }
    } catch { /* not supported */ }
  }

  function toggleFullscreen() {
    if (isMobile) {
      if (document.fullscreenElement) {
        window.screen.orientation?.unlock?.();
        setRotationLocked(false);
        document.exitFullscreen().catch(() => {});
      } else {
        enterLandscape();
      }
      return;
    }
    if (!document.fullscreenElement) {
      // Fullscreen the frame wrapper (iframe + our overlay), not the raw
      // iframe — requestFullscreen() only renders the target element's own
      // subtree, so fullscreening the iframe directly would make our
      // sibling overlay/toggle button impossible to show at all.
      const element = frameWrapRef.current || modalRef.current;
      element?.requestFullscreen()
        // Tablets: a 16:9 video wants landscape.
        .then(() => window.screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {
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

  const loadKey = `${provider}|${item?.id}|${season}|${episode}|${resumeNonce}`;
  if (frozenStartRef.current.key !== loadKey) {
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    frozenStartRef.current = {
      key: loadKey,
      value: pending ?? (item?.id ? getResumePosition(positionKey(mediaType, item.id, season, episode)) : null),
    };
  }
  const startAt = frozenStartRef.current.value;
  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode, subtitleLang, { startAt, lowBandwidth: prefersLowBandwidth() });

  // TV remote: hand the remote to the video once it loads, so OK plays and
  // pauses; Back steps out to the player's controls (KeyboardShortcuts).
  useEffect(() => {
    if (!isTvMode() || !embedUrl) return undefined;
    const timer = setTimeout(() => iframeRef.current?.focus(), 1500);
    return () => clearTimeout(timer);
  }, [embedUrl]);


  // VidRift takes its start position (and quality hint) as messages.
  function handleFrameLoad() {
    if (provider !== 'vidrift') return;
    const frame = iframeRef.current;
    setTimeout(() => {
      if (!frame?.contentWindow) return;
      if (startAt > 0) frame.contentWindow.postMessage({ type: 'vidrift:resume', currentTime: startAt }, 'https://embed.vidrift.net');
      if (prefersLowBandwidth()) frame.contentWindow.postMessage({ type: 'vidrift:quality-preference', label: '720p' }, 'https://embed.vidrift.net');
    }, 1500);
  }
  const episodeCount = isTV ? (seasonEpisodeCounts[season] ?? undefined) : undefined;
  const watchedInSeason = Array.from(watched).filter((key) => key.startsWith(`${season}:`)).length;

  // Hand off to the persistent global mini-player, then close this (full)
  // view the same way the close button would — the mini widget carries on
  // with its own copy of the embed, independent of this component now.
  function handleMinimize() {
    // Hand over the *current* second (not the one this load started at), and
    // save it, so the corner player and a later Expand both pick up here.
    const state = playbackRef.current;
    const key = item?.id ? positionKey(mediaType, item.id, season, episode) : null;
    if (key && state.time > 0) savePosition(key, state.time, state.duration);
    const at = state.time > 0 ? Math.floor(state.time) : startAt;
    const miniUrl = RESUMABLE.has(provider) && provider !== 'vidrift'
      ? buildUrl(provider, externalId, mediaType, season, episode, subtitleLang, { startAt: at, lowBandwidth: prefersLowBandwidth() })
      : embedUrl;
    const base = mediaType === 'tv_show' ? `/tv-show/${item.id}?play=1&season=${season}&episode=${episode}` : `/movie/${item.id}?play=1`;
    showMini({
      embedUrl: miniUrl,
      title: item.title,
      subtitle: isTV ? `S${season} E${episode}` : (item.year || ''),
      poster: item.poster_url || item.cover_url || item.image_url || null,
      href: base,
      positionKey: key,
      vidriftResume: provider === 'vidrift' && at > 0 ? at : null,
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
      <div className={`mp-shell${isLandscape ? ' mp-shell--ls' : ''}`} data-embed-player>
        {/* Header — hidden in landscape via CSS */}
        <div className="mp-header">
          <div className="mp-title">
            <span className="mp-title-text">{item.title}</span>
            {isTV && <span className="mp-title-ep">S{season} E{episode}</span>}
          </div>
          <div className="mp-header-btns">
            <button className="mp-btn" onClick={handleMinimize} type="button" title="Minimize" aria-label="Minimize player"><CaretDown size={16} weight="bold" /></button>
            <button className="mp-btn" onClick={toggleFullscreen} type="button" title="Full screen, landscape" aria-label="Full screen in landscape">
              <ArrowsOut size={16} weight="bold" />
            </button>
            <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close"><X size={16} weight="bold" /></button>
          </div>
        </div>

        {/* Video — expands to fill shell in landscape */}
        <div className="mp-video-wrap" ref={modalRef}>
          {embedUrl ? (
            <iframe
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}-${resumeNonce}`}
              ref={iframeRef}
              src={embedUrl}
              className="mp-iframe"
              allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; web-share *"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              title={`Watch ${item.title}`}
              onLoad={handleFrameLoad}
            />
          ) : (
            <div className="mp-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream…' : 'Stream unavailable.'}</p>
            </div>
          )}
          {upNextCard}
          {rotateHint && (
            <div className="mp-rotate-hint" role="status">
              <DeviceRotate size={22} weight="bold" aria-hidden="true" /> Turn your phone sideways for a bigger picture
            </div>
          )}
          {/* Landscape overlay — top-right corner buttons, hidden in portrait via CSS */}
          <div className="mp-ls-overlay">
            {canLockRotation && (
              <button
                className={`mp-btn${rotationLocked ? ' active' : ''}`}
                onClick={toggleRotationLock}
                type="button"
                title={rotationLocked ? 'Unlock rotation' : 'Lock rotation'}
                aria-label={rotationLocked ? 'Unlock rotation' : 'Lock rotation'}
                aria-pressed={rotationLocked}
              >
                {rotationLocked ? <LockSimple size={16} weight="bold" /> : <LockSimpleOpen size={16} weight="bold" />}
              </button>
            )}
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

          {/* Server, audio and subtitles — bottom sheets at thumb height. */}
          <MobilePlaybackPickers {...playbackOptionProps} />
        </div>
      </div>
    );
  }

  // ── Desktop player ───────────────────────────────────────────
  return (
    <div className="player-overlay" onClick={onClose} data-embed-player>
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
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}-${resumeNonce}`}
              ref={iframeRef}
              src={embedUrl}
              className="player-frame"
              allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; web-share *"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              title={`Watch ${item.title}`}
              onLoad={handleFrameLoad}
            />
          ) : (
            <div className="player-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream...' : 'Stream unavailable right now.'}</p>
            </div>
          )}

          {upNextCard}
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

// The embed servers the player can use (best first), how to build each
// one's URL, and the timings the player's failover / Up Next logic runs on.
// Keep PROBES in server/routes/cron.js in sync with PROVIDERS.
import { getSettings } from './profileSettings';
import { getEmbeddedId } from './embedPlayability';
import { languageName } from './tmdb';
import { getServerMemory, rankServers } from './streamPreferences';

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
export const PROVIDERS = [
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
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidy.st');
      url.searchParams.set('color', 'F4F6F8');
      url.searchParams.set('autoplay', noAutoplay ? 'false' : 'true');
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
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const autoplay = noAutoplay ? 'false' : 'true';
      const base = isTV
        ? `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=${autoplay}&nextbutton=true`
        : `https://vidlink.pro/movie/${id.value}?autoplay=${autoplay}`;
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
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, lowBandwidth, noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/embed/tv/${id.value}` : `/embed/movie/${id.value}`, 'https://cinesrc.st');
      if (isTV) { url.searchParams.set('s', season); url.searchParams.set('e', episode); }
      url.searchParams.set('autoplay', noAutoplay ? 'false' : 'true');
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
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidsrc.ru');
      url.searchParams.set('autoplay', noAutoplay ? 'false' : 'true');
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
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? '/embed/tv' : '/embed/movie', 'https://vsembed.ru');
      url.searchParams.set(id.kind, id.value);
      if (isTV) { url.searchParams.set('season', season); url.searchParams.set('episode', episode); }
      url.searchParams.set('autoplay', noAutoplay ? '0' : '1');
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

export const AUTO_WATCH_SECONDS = 5 * 60;

// How long the player has to stay open on a title before it counts as
// "actually watching" for Continue Watching purposes — a bare click that's
// immediately closed (misclick, browsing) shouldn't leave a row behind.
export const CONTINUE_WATCHING_DELAY_SECONDS = 20;

export function buildUrl(providerId, externalId, mediaType, season, episode, subtitleLang = null, options = {}) {
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
export function providerIdsFor(mediaType, externalId) {
  const type = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  const ids = PROVIDERS
    .filter((entry) => entry.types.includes(type) && (!externalId || entry.idKinds.includes(externalId.kind)))
    .map((entry) => entry.id);
  return ids.length ? ids : PROVIDERS.map((entry) => entry.id);
}

// Host each server's player lives on, for the network reachability probe.
export const PROVIDER_HOSTS = Object.fromEntries(PROVIDERS.map((entry) => {
  try {
    return [entry.id, new URL(entry.buildUrl({ kind: 'tmdb', value: '1' }, 'movie', 1, 1, null, {})).hostname];
  } catch {
    return [entry.id, ''];
  }
}));

export const EVENT_PROVIDERS = new Set(PROVIDERS.filter((entry) => entry.events).map((entry) => entry.id));

export const SERVER_LABELS = Object.fromEntries(PROVIDERS.map((entry) => [entry.id, { label: entry.label, subtitles: Boolean(entry.subtitles) }]));

// How long a server has to stay open before it counts as "works" for this
// title (and the one-time audio check appears).
export const SERVER_CONFIRM_SECONDS = 60;

// No playback time from an event-capable server after this long = it
// doesn't have this title; fail over automatically.
export const FAILOVER_SECONDS = 25;

// Servers that report pause/play as well as time, so "time stopped moving"
// can be told apart from "viewer paused" — buffering detection only runs
// for these.
export const PAUSE_AWARE = new Set(['vidrift', 'vidy', 'cinesrc', 'vidlink', 'videasy']);

// Servers that can start at a given second (URL param or message), so a
// mid-play switch keeps the viewer's place.
export const RESUMABLE = new Set(['vidrift', 'vidy', 'cinesrc', 'vidlink']);

export const UP_NEXT_SECONDS = 30;   // show the Up Next card in the last 30s
export const UP_NEXT_COUNTDOWN = 10; // seconds before the next episode starts
export const STALL_SECONDS = 12;      // no progress while playing -> buffering
export const STALL_SWITCH_SECONDS = 30; // still stuck -> switch servers automatically

export function prefersLowBandwidth() {
  if (getSettings().dataSaver) return true;
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
  return Boolean(connection && (connection.saveData || (connection.downlink && connection.downlink < 3)));
}

export function normalizeStartAt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function bestServerFor(item, mediaType, prefs) {
  const memoryType = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  return rankServers(providerIdsFor(mediaType, getEmbeddedId(item)), {
    prefs,
    originalLanguage: item?.original_language || null,
    memory: getServerMemory(memoryType, item?.id),
  })[0]?.id || PROVIDERS[0].id;
}

// The player's side of the embed servers: building a URL with the viewer's
// options, which servers fit a title, and the timings the failover / Up Next
// logic runs on. The servers themselves (ids, flags, URL builders) are in
// embedServers.js, which the server's uptime probe reads too.
import { getSettings } from './profileSettings';
import { getEmbeddedId } from './embedPlayability';
import { languageName } from './tmdb';
import { getServerMemory, rankServers } from './streamPreferences';
import { EMBED_SERVERS } from './embedServers';

export const PROVIDERS = EMBED_SERVERS;

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
    // CineSrc wants the subtitle language by name ("Spanish"), not its code.
    const subtitleLangName = subtitleLang ? languageName(subtitleLang) : '';
    return provider.buildUrl(externalId, mediaType, season, episode, subtitleLang, { ...options, subtitleLangName });
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
export const PAUSE_AWARE = new Set(['vidrift', 'vidy', 'cinesrc', 'vidlink', 'videasy', 'vixsrc', 'vidspark']);

// Servers that can start at a given second (URL param or message), so a
// mid-play switch keeps the viewer's place.
export const RESUMABLE = new Set(['vidrift', 'vidy', 'cinesrc', 'vidlink', 'vixsrc', 'vidspark']);

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

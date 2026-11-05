// Search extras layered on the catalog search: recent searches, people
// (actor / director → their titles in the catalog), live games, and the
// Top result → Movies → Series → Books → Live games grouping.
import { getActiveProfileId } from './activeProfile';
import { normalizeTmdbResult, tmdbGet, tmdbImage } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
import { workCredits } from './people';
import { fetchSportsStreams } from './sportsProviders';

// ── Recent searches (per profile, this device) ─────────────────────────

const RECENT_KEY = 'binge:recent-searches:';
const RECENT_MAX = 8;

function recentKey() {
  return `${RECENT_KEY}${getActiveProfileId() || 'default'}`;
}

export function getRecentSearches() {
  try { return JSON.parse(window.localStorage.getItem(recentKey()) || '[]'); } catch { return []; }
}

function writeRecent(list) {
  try { window.localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* private mode */ }
}

export function addRecentSearch(query) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return;
  writeRecent([clean, ...getRecentSearches().filter((entry) => entry.toLowerCase() !== clean.toLowerCase())]);
}

export function removeRecentSearch(query) {
  writeRecent(getRecentSearches().filter((entry) => entry !== query));
}

export function clearRecentSearches() {
  writeRecent([]);
}

// ── Grouping ───────────────────────────────────────────────────────────

const tag = (list, mediaType) => (list || []).map((item) => ({ ...item, media_type: mediaType }));

// { top, movies, series, books } with the single best video/book match
// pulled out as the top result.
export function groupResults(results) {
  const movies = tag(results?.movies, 'movie');
  const series = tag(results?.tv, 'tv_show');
  const books = tag(results?.books, 'book');
  const top = [...movies, ...series, ...books]
    .sort((a, b) => (Number(b.relevance) || 0) - (Number(a.relevance) || 0))[0] || null;
  const notTop = (item) => !top || item.media_type !== top.media_type || item.id !== top.id;
  return {
    top,
    movies: movies.filter(notTop),
    series: series.filter(notTop),
    books: books.filter(notTop),
  };
}

// ── People ─────────────────────────────────────────────────────────────

function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// A query only counts as a person search when it looks like their name
// ("tom hanks", "nolan"), not when a famous person merely matches loosely.
export function matchesPersonName(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (q.length < 3 || !n) return false;
  if (n === q) return true;
  const nameParts = n.split(' ');
  return q.split(' ').every((part) => nameParts.some((namePart) => namePart.startsWith(part))) && q.length >= 4;
}

// { person: { id, name, photo, department }, items } or null.
export async function searchPerson(query) {
  const data = await tmdbGet('/search/person', { query, include_adult: 'false' });
  const person = (data?.results || [])
    .filter((entry) => !entry.adult && (entry.known_for_department === 'Acting' || entry.known_for_department === 'Directing'))
    .find((entry) => matchesPersonName(query, entry.name) && entry.popularity >= 3);
  if (!person) return null;

  const credits = await tmdbGet(`/person/${person.id}/combined_credits`);
  const directing = person.known_for_department === 'Directing';
  // The same rule as their page (people.js): real, scripted roles, most
  // widely known first.
  const work = workCredits(credits);
  const results = (directing ? work.directing : work.acting)
    .slice(0, 30)
    .map((credit) => normalizeTmdbResult(credit));
  const [movies, shows] = await Promise.all([
    resolveTmdbItems(results.filter((r) => r.mediaType === 'movie'), 'movie'),
    resolveTmdbItems(results.filter((r) => r.mediaType === 'tv_show'), 'tv_show'),
  ]);
  const items = [...movies, ...shows].sort((a, b) => (b._tmdb?.voteCount || 0) - (a._tmdb?.voteCount || 0));
  return {
    person: {
      id: person.id,
      name: person.name,
      photo: tmdbImage(person.profile_path, 'w185'),
      department: directing ? 'Director' : 'Actor',
    },
    items,
  };
}

// ── Live games ─────────────────────────────────────────────────────────

let sportsCache = null; // { at, promise }

function cachedStreams() {
  if (!sportsCache || Date.now() - sportsCache.at > 60_000) {
    sportsCache = { at: Date.now(), promise: fetchSportsStreams().catch(() => []) };
  }
  return sportsCache.promise;
}

// Games (live or upcoming in the next 24h) whose teams/league match.
export async function searchGames(query) {
  const words = normalize(query).split(' ').filter((word) => word.length >= 2);
  if (!words.length) return [];
  const streams = await cachedStreams();
  const now = Date.now();
  return streams
    .filter((stream) => {
      const ends = stream.endsAt ? stream.endsAt * 1000 : (stream.startsAt || 0) * 1000 + 4 * 3600 * 1000;
      const soon = (stream.startsAt || 0) * 1000 < now + 24 * 3600 * 1000;
      return (stream.alwaysLive || (ends > now && soon));
    })
    .filter((stream) => {
      const haystack = normalize(`${stream.name} ${stream.league || ''} ${stream.category || ''}`);
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, 8);
}

export function isGameLive(stream, now = Date.now()) {
  return Boolean(stream.alwaysLive) || (stream.startsAt || 0) * 1000 <= now;
}

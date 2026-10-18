// Thin browser-side TMDB client for the browse rows and recommendations.
//
// The catalog's own popularity/vote columns are a one-off import snapshot
// (and null for a lot of big titles — Squid Game has none), so "Trending",
// "Popular K-Dramas" and "Because you watched X" come from TMDB's live
// lists instead and are then matched back to catalog rows by TMDB id (see
// catalogLookup.js). The key is the same public one supabaseApi.js already
// uses from the browser (REACT_APP_TMDB_API_KEY in vercel.json).
//
// Every call degrades to `null` rather than throwing, so a missing key or a
// TMDB outage just means callers fall back to the Supabase-only rows.

const TMDB_API_KEY = (process.env.REACT_APP_TMDB_API_KEY || '').trim();
const BASE_URL = 'https://api.themoviedb.org/3';
const CACHE_TTL_MS = 30 * 60 * 1000;
const STORAGE_PREFIX = 'binge:tmdb:';

const memoryCache = new Map();
const inflight = new Map();

export const isTmdbConfigured = Boolean(TMDB_API_KEY);

function readStored(key) {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeStored(key, data) {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Storage full or blocked — the in-memory cache still covers this tab.
  }
}

export async function tmdbGet(path, params = {}) {
  if (!TMDB_API_KEY) return null;

  const search = new URLSearchParams({ api_key: TMDB_API_KEY, language: 'en-US', ...params });
  // Key the cache without the api key so it never lands in storage.
  const cacheParams = new URLSearchParams(params);
  cacheParams.sort();
  const cacheKey = `${path}?${cacheParams.toString()}`;

  const memo = memoryCache.get(cacheKey);
  if (memo && Date.now() - memo.ts < CACHE_TTL_MS) return memo.data;

  const stored = readStored(cacheKey);
  if (stored) {
    memoryCache.set(cacheKey, { ts: Date.now(), data: stored });
    return stored;
  }

  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const request = (async () => {
    try {
      const response = await fetch(`${BASE_URL}${path}?${search.toString()}`);
      if (!response.ok) return null;
      const data = await response.json();
      memoryCache.set(cacheKey, { ts: Date.now(), data });
      writeStored(cacheKey, data);
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, request);
  return request;
}

// App media type <-> TMDB path segment.
export function tmdbKind(mediaType) {
  return mediaType === 'tv_show' ? 'tv' : 'movie';
}

// A catalog row's TMDB id, from its `tmdb:movie:123` / `tmdb:tv:123` source key.
export function tmdbIdFromItem(item) {
  const key = typeof item?.source_key === 'string' ? item.source_key : '';
  const match = /^tmdb:(movie|tv):(\d+)$/i.exec(key);
  if (match) return Number(match[2]);
  const direct = Number(item?.tmdb_id ?? item?.tmdbId);
  return Number.isFinite(direct) && direct > 0 ? direct : null;
}

export function sourceKeyFor(mediaType, tmdbId) {
  return `tmdb:${tmdbKind(mediaType)}:${tmdbId}`;
}

// TMDB genre ids -> the names our catalog's `genre` column uses. Movie and
// TV share most ids; TV has its own combined ones (10759, 10765, ...).
export const TMDB_GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};

const GENRE_IDS_BY_NAME = Object.entries(TMDB_GENRES).reduce((acc, [id, name]) => {
  acc[name.toLowerCase()] = Number(id);
  return acc;
}, {});

export function tmdbGenreId(name) {
  return GENRE_IDS_BY_NAME[String(name || '').trim().toLowerCase()] || null;
}

export function genreNamesFromIds(ids = []) {
  return ids.map((id) => TMDB_GENRES[id]).filter(Boolean);
}

export const LANGUAGE_NAMES = {
  en: 'English', ko: 'Korean', ja: 'Japanese', zh: 'Chinese', cn: 'Cantonese',
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', ru: 'Russian',
  tr: 'Turkish', th: 'Thai', ar: 'Arabic', nl: 'Dutch', sv: 'Swedish',
  da: 'Danish', no: 'Norwegian', pl: 'Polish', id: 'Indonesian', tl: 'Filipino',
  vi: 'Vietnamese', he: 'Hebrew', fa: 'Persian', uk: 'Ukrainian', fi: 'Finnish',
};

export function languageName(code) {
  if (!code) return '';
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

// Normalized shape for a TMDB list result, before catalog matching.
export function normalizeTmdbResult(result, mediaType) {
  const kind = mediaType || (result.media_type === 'tv' ? 'tv_show' : 'movie');
  return {
    tmdbId: result.id,
    mediaType: kind,
    title: result.title || result.name || '',
    releaseDate: result.release_date || result.first_air_date || null,
    originalLanguage: result.original_language || null,
    genreIds: result.genre_ids || (result.genres || []).map((g) => g.id),
    popularity: Number(result.popularity) || 0,
    voteAverage: Number(result.vote_average) || 0,
    voteCount: Number(result.vote_count) || 0,
    backdropPath: result.backdrop_path || null,
    posterPath: result.poster_path || null,
    overview: result.overview || '',
    adult: Boolean(result.adult),
  };
}

export function tmdbImage(path, size = 'w500') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export async function fetchTmdbList(path, mediaType, params = {}) {
  const data = await tmdbGet(path, params);
  if (!data?.results) return null;
  return data.results
    .filter((result) => !result.adult)
    .map((result) => normalizeTmdbResult(result, mediaType));
}

export function fetchTrending(mediaType, window = 'week') {
  return fetchTmdbList(`/trending/${tmdbKind(mediaType)}/${window}`, mediaType);
}

export function fetchDiscover(mediaType, params = {}) {
  return fetchTmdbList(`/discover/${tmdbKind(mediaType)}`, mediaType, {
    include_adult: 'false',
    sort_by: 'popularity.desc',
    ...params,
  });
}

export function fetchTmdbRecommendations(mediaType, tmdbId) {
  return fetchTmdbList(`/${tmdbKind(mediaType)}/${tmdbId}/recommendations`, mediaType);
}

export function fetchTmdbSimilar(mediaType, tmdbId) {
  return fetchTmdbList(`/${tmdbKind(mediaType)}/${tmdbId}/similar`, mediaType);
}

export async function searchTmdbMulti(query) {
  const data = await tmdbGet('/search/multi', { query, include_adult: 'false' });
  if (!data?.results) return null;
  return data.results
    .filter((result) => (result.media_type === 'movie' || result.media_type === 'tv') && !result.adult)
    .map((result) => normalizeTmdbResult(result));
}

// Spoken languages + original language for the player's audio panel.
export async function fetchTmdbLanguageInfo(mediaType, tmdbId) {
  if (!tmdbId) return null;
  const data = await tmdbGet(`/${tmdbKind(mediaType)}/${tmdbId}`);
  if (!data) return null;
  return {
    originalLanguage: data.original_language || null,
    spokenLanguages: (data.spoken_languages || []).map((lang) => lang.iso_639_1).filter(Boolean),
  };
}

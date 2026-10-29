// Trakt popular/trending lists, used to rank catalog rows the way Trakt's
// Discover page does, and the popular-titles list built from them.

const neonDb = require('../neonDb');

const TRAKT_API_URL = 'https://api.trakt.tv';

const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || process.env.REACT_APP_TRAKT_CLIENT_ID;

const TRAKT_CACHE_TTL_MS = 60 * 60 * 1000;

const traktCache = new Map();

function normalizeTitleKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getTmdbIdFromSourceKey(sourceKey) {
  const match = String(sourceKey || '').match(/^tmdb:(?:movie|tv):(\d+)$/);
  return match ? match[1] : null;
}

function getTraktMediaEntry(item, mediaType) {
  if (!item) return null;
  if (item[mediaType]) return item[mediaType];
  if (mediaType === 'show' && item.show) return item.show;
  if (mediaType === 'movie' && item.movie) return item.movie;
  if (item.ids || item.title) return item;
  return null;
}

function addTraktRank(rankMap, media, rank, weight) {
  if (!media) return;

  const score = Math.max(1, weight - rank);
  const ids = media.ids || {};
  const keys = [
    ids.tmdb ? `tmdb:${ids.tmdb}` : null,
    ids.imdb ? `imdb:${String(ids.imdb).toLowerCase()}` : null,
    media.title ? `title:${normalizeTitleKey(media.title)}` : null,
    media.title || media.year ? `title:${normalizeTitleKey(media.title)}:${media.year || ''}` : null,
  ].filter(Boolean);

  for (const key of keys) {
    rankMap.set(key, Math.max(rankMap.get(key) || 0, score));
  }
}

async function fetchTrakt(endpoint, params = {}) {
  if (!TRAKT_CLIENT_ID) return null;

  const url = new URL(`${TRAKT_API_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Trakt ${endpoint} failed with ${response.status}`);
  }

  return response.json();
}

async function getTraktRelevanceMap(type) {
  const mediaType = type === 'tv' ? 'show' : 'movie';
  const cacheKey = `relevance:${type}`;
  const cached = traktCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const rankMap = new Map();
  if (!TRAKT_CLIENT_ID) {
    traktCache.set(cacheKey, { value: rankMap, expiresAt: Date.now() + TRAKT_CACHE_TTL_MS });
    return rankMap;
  }

  // Mirrors Trakt Discover's popular/trending media pages:
  // https://app.trakt.tv/discover/popular?mode=media
  // https://app.trakt.tv/discover/trending?mode=media
  const endpoints = type === 'tv'
    ? [
        { path: '/shows/trending', weight: 10000 },
        { path: '/shows/popular', weight: 7000 },
      ]
    : [
        { path: '/movies/trending', weight: 10000 },
        { path: '/movies/popular', weight: 7000 },
      ];

  await Promise.all(endpoints.map(async ({ path: endpoint, weight }) => {
    try {
      const data = await fetchTrakt(endpoint, { extended: 'full', limit: 100 });
      (Array.isArray(data) ? data : []).forEach((item, index) => {
        addTraktRank(rankMap, getTraktMediaEntry(item, mediaType), index, weight);
      });
    } catch (error) {
      console.warn(error.message);
    }
  }));

  traktCache.set(cacheKey, { value: rankMap, expiresAt: Date.now() + TRAKT_CACHE_TTL_MS });
  return rankMap;
}

function scoreRowWithTrakt(row, relevanceMap) {
  if (!row || !relevanceMap?.size) return 0;

  const tmdbId = getTmdbIdFromSourceKey(row.source_key);
  const externalId = String(row.external_id || '').trim();
  const keys = [
    tmdbId ? `tmdb:${tmdbId}` : null,
    externalId.startsWith('tmdb:') ? `tmdb:${externalId.replace(/^tmdb:/, '')}` : null,
    /^tt\d+$/i.test(externalId) ? `imdb:${externalId.toLowerCase()}` : null,
    `title:${normalizeTitleKey(row.title)}`,
    `title:${normalizeTitleKey(row.title)}:${row.year || ''}`,
  ].filter(Boolean);

  return keys.reduce((best, key) => Math.max(best, relevanceMap.get(key) || 0), 0);
}

function sortRowsByTraktRelevance(items, relevanceMap) {
  if (!relevanceMap?.size) {
    return sortMediaItems(items, 'year-desc');
  }

  return [...items].sort((left, right) => {
    const leftScore = scoreRowWithTrakt(left, relevanceMap);
    const rightScore = scoreRowWithTrakt(right, relevanceMap);
    if (leftScore !== rightScore) return rightScore - leftScore;

    const leftYear = Number(left.year);
    const rightYear = Number(right.year);
    if (Number.isFinite(leftYear) && Number.isFinite(rightYear) && leftYear !== rightYear) {
      return rightYear - leftYear;
    }

    return String(left.title || '').localeCompare(String(right.title || ''));
  });
}

function sortMediaItems(items, sort) {
  const sortedItems = [...items];

  sortedItems.sort((left, right) => {
    if (sort === 'year-desc') {
      if (left.year == null && right.year == null) return left.title.localeCompare(right.title);
      if (left.year == null) return 1;
      if (right.year == null) return -1;
      return right.year - left.year || left.title.localeCompare(right.title);
    }

    if (sort === 'year-asc') {
      if (left.year == null && right.year == null) return left.title.localeCompare(right.title);
      if (left.year == null) return 1;
      if (right.year == null) return -1;
      return left.year - right.year || left.title.localeCompare(right.title);
    }

    if (sort === 'title-desc') {
      return right.title.localeCompare(left.title);
    }

    return left.title.localeCompare(right.title);
  });

  return sortedItems;
}

// ─── Popular titles cache (Trakt relevance) ───────────────────────────────────

const popularTitlesCache = new Map(); // key → { titles, expiresAt }

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

async function fetchPopularTitlesFromTrakt(mediaType) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const cacheKey = `popular-titles:${type}`;
  const cached = popularTitlesCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.titles;

  const relevanceMap = await getTraktRelevanceMap(type);
  if (!relevanceMap.size) return null;

  const table = type === 'tv' ? 'tv_shows' : 'movies';
  const keys = [...relevanceMap.keys()]
    .filter((key) => /^tmdb:\d+$/.test(key))
    .map((key) => `tmdb:${type === 'tv' ? 'tv' : 'movie'}:${key.slice(5)}`);
  if (!keys.length) return null;
  const { rows } = await neonDb.query(
    `SELECT * FROM ${table}
     WHERE source_key = ANY($1) AND poster_url IS NOT NULL AND TRIM(poster_url) <> ''`,
    [keys]
  );

  const titles = sortRowsByTraktRelevance(rows, relevanceMap)
    .slice(0, 80)
    .map((row) => row.title)
    .filter(Boolean);

  popularTitlesCache.set(cacheKey, { titles, expiresAt: Date.now() + CACHE_TTL_MS });
  return titles;
}

module.exports = { fetchPopularTitlesFromTrakt };

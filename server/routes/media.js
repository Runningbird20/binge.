const express = require('express');
const neonDb = require('../neonDb');
const { requireAuth } = require('../middleware/auth');
const { serviceClient } = require('../middleware/supabaseAdmin');
const { episodes } = require('./supabaseUserData');
const { buildBookGenreFacets, matchesBookGenreFacet } = require('../bookGenres');
const { calculateMovieRelevance } = require('../utils/movieRelevance');

// Ratings are user data in Supabase; the title itself comes from Neon.
// Same scale as the old SQL: average of (sum of categories / max) * 10.
async function ratingStats(table, columns, max, mediaId) {
  const sb = serviceClient();
  if (!sb) return { rows: [{ avg_rating: null, rating_count: 0 }] };
  const { data, error } = await sb.from(table).select(columns.join(',')).eq('media_id', mediaId);
  if (error || !data?.length) return { rows: [{ avg_rating: null, rating_count: 0 }] };
  const scores = data.map((row) => columns.reduce((sum, c) => sum + Number(row[c] || 0), 0) / max * 10);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
  return { rows: [{ avg_rating: avg, rating_count: data.length }] };
}

const router = express.Router();

// Episode progress is user data in Supabase.
router.use((req, res, next) => (
  req.path.startsWith('/episode-progress') ? requireAuth(req, res, () => episodes(req, res, next)) : next()
));

let cachedMovieTotalCount = null;
let cachedMovieTotalTime = 0;
let cachedTvTotalCount = null;
let cachedTvTotalTime = 0;
let cachedCuratedMovies = null;
let cachedCuratedMoviesTime = 0;
let cachedCuratedTv = null;
let cachedCuratedTvTime = 0;
let cachedCuratedBooks = null;
let cachedCuratedBooksTime = 0;
const CURATED_CACHE_TTL = 15 * 60 * 1000;

const TRAKT_API_URL = 'https://api.trakt.tv';
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || process.env.REACT_APP_TRAKT_CLIENT_ID;
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const TRAKT_CACHE_TTL_MS = 60 * 60 * 1000;
const traktCache = new Map();
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.REACT_APP_TMDB_API_KEY;
const OMDB_CACHE_DAYS = 30;
const OMDB_ENRICH_LIMIT = 80;

function normalizePage(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizePageSize(value, fallback = 24, max = 60) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function buildMediaGenreFacets(rows = []) {
  return Array.from(
    new Set(
      rows
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

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

function parsePercentRating(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Math.round(Number(match[1])) : null;
}

function parseNumericRating(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function isOmdbCacheStale(movie) {
  if (!movie.ratings_enriched_at) return true;

  const enrichedAt = new Date(movie.ratings_enriched_at).getTime();
  if (!Number.isFinite(enrichedAt)) return true;

  return Date.now() - enrichedAt > OMDB_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

async function fetchTmdbImdbId(tmdbId) {
  if (!TMDB_API_KEY || !tmdbId) return null;

  try {
    const url = new URL(`https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}/external_ids`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const data = await response.json();
    return /^tt\d+$/i.test(data?.imdb_id || '') ? data.imdb_id : null;
  } catch {
    return null;
  }
}

async function fetchOmdbRatings(imdbId) {
  if (!OMDB_API_KEY || !/^tt\d+$/i.test(imdbId || '')) return null;

  try {
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('i', imdbId);
    url.searchParams.set('apikey', OMDB_API_KEY);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.Response === 'False') return null;

    const ratings = Array.isArray(data?.Ratings) ? data.Ratings : [];
    const rt = ratings.find((rating) => rating.Source === 'Rotten Tomatoes')?.Value;
    const imdb = ratings.find((rating) => rating.Source === 'Internet Movie Database')?.Value || data?.imdbRating;
    const metacritic = ratings.find((rating) => rating.Source === 'Metacritic')?.Value || data?.Metascore;

    return {
      rotten_tomatoes_score: parsePercentRating(rt),
      imdb_rating: parseNumericRating(imdb),
      metacritic_score: parseNumericRating(metacritic),
      ratings_enriched_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function enrichMovieForRelevance(movie) {
  if (!movie?.id || !isOmdbCacheStale(movie)) return movie;

  let imdbId = movie.imdb_id;
  if (!imdbId) {
    imdbId = await fetchTmdbImdbId(getTmdbIdFromSourceKey(movie.source_key));
  }

  if (!imdbId) {
    const enrichedAt = new Date().toISOString();
    await neonDb.query('UPDATE movies SET ratings_enriched_at = $1 WHERE id = $2', [enrichedAt, movie.id]);
    return { ...movie, ratings_enriched_at: enrichedAt };
  }

  const ratings = await fetchOmdbRatings(imdbId);
  const payload = ratings || {
    rotten_tomatoes_score: null,
    imdb_rating: null,
    metacritic_score: null,
    ratings_enriched_at: new Date().toISOString(),
  };

  await neonDb.query(
    `UPDATE movies
     SET imdb_id = $1, rotten_tomatoes_score = $2, imdb_rating = $3, metacritic_score = $4, ratings_enriched_at = $5
     WHERE id = $6`,
    [imdbId, payload.rotten_tomatoes_score, payload.imdb_rating, payload.metacritic_score, payload.ratings_enriched_at, movie.id]
  );

  return { ...movie, imdb_id: imdbId, ...payload };
}

async function enrichMoviesForRelevance(movies) {
  const enriched = [];
  let attempts = 0;

  for (const movie of movies) {
    if (attempts < OMDB_ENRICH_LIMIT && isOmdbCacheStale(movie)) {
      attempts += 1;
      enriched.push(await enrichMovieForRelevance(movie));
    } else {
      enriched.push(movie);
    }
  }

  return enriched;
}

async function sortRowsByMovieRelevance(items) {
  const preSorted = [...items].sort((left, right) => {
    const leftPopularity = Number(left.popularity) || 0;
    const rightPopularity = Number(right.popularity) || 0;
    if (leftPopularity !== rightPopularity) return rightPopularity - leftPopularity;
    return (Number(right.year) || 0) - (Number(left.year) || 0);
  });

  const enriched = await enrichMoviesForRelevance(preSorted);
  return enriched.sort((left, right) => {
    const diff = calculateMovieRelevance(right) - calculateMovieRelevance(left);
    if (diff !== 0) return diff;
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

function normalizeEmbedId(kind, value) {
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

function normalizeLookupTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripTrailingYearLabel(value, explicitYear) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const year = Number(explicitYear);
  const withKnownYear = Number.isFinite(year)
    ? raw
        .replace(new RegExp(`\\s*\\((?:${year})\\)\\s*$`), '')
        .replace(new RegExp(`\\s*-\\s*${year}\\s*$`), '')
        .trim()
    : raw;

  return withKnownYear
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
    .replace(/\s*-\s*(?:19|20)\d{2}\s*$/, '')
    .trim();
}

function buildLookupTitleVariants(title, year) {
  const variants = [];

  function addVariant(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (!variants.includes(normalized)) {
      variants.push(normalized);
    }
  }

  addVariant(title);
  addVariant(stripTrailingYearLabel(title, year));

  return variants;
}

function scoreImdbSuggestion(result, expected) {
  const resultTitle = normalizeLookupTitle(result?.l);
  const expectedTitle = normalizeLookupTitle(expected?.title);
  const resultTitleNoYear = normalizeLookupTitle(stripTrailingYearLabel(result?.l));
  const expectedTitleNoYear = normalizeLookupTitle(stripTrailingYearLabel(expected?.title, expected?.year));
  const resultYear = Number(result?.y);
  const expectedYear = Number(expected?.year);
  const qid = String(result?.qid || '').toLowerCase();
  const q = String(result?.q || '').toLowerCase();
  const isTvResult = qid.includes('tv') || q.includes('tv');
  const isMovieResult =
    qid === 'movie' ||
    qid === 'feature' ||
    q.includes('feature') ||
    q.includes('movie');
  const wantsTv = expected?.type === 'tv_show';
  const wantsMovie = !wantsTv;

  let score = 0;

  if (resultTitle && expectedTitle) {
    if (resultTitle === expectedTitle) {
      score += 120;
    } else if (resultTitle.includes(expectedTitle) || expectedTitle.includes(resultTitle)) {
      score += 70;
    }
  }

  if (resultTitleNoYear && expectedTitleNoYear) {
    if (resultTitleNoYear === expectedTitleNoYear) {
      score += 80;
    } else if (
      resultTitleNoYear.includes(expectedTitleNoYear) ||
      expectedTitleNoYear.includes(resultTitleNoYear)
    ) {
      score += 40;
    }
  }

  if (Number.isFinite(expectedYear) && Number.isFinite(resultYear)) {
    const diff = Math.abs(expectedYear - resultYear);
    if (diff === 0) score += 35;
    else if (diff === 1) score += 20;
    else if (diff === 2) score += 10;
    else score -= Math.min(diff * 4, 20);
  }

  if (wantsTv && isTvResult) score += 30;
  if (wantsMovie && isMovieResult) score += 30;
  if (wantsTv && isMovieResult) score -= 20;
  if (wantsMovie && isTvResult) score -= 20;

  if (qid === 'videoGame' || qid === 'podcastSeries') score -= 80;
  if (qid === 'video') score -= 15;

  if (Number.isFinite(Number(result?.rank))) {
    score += Math.max(20 - Math.floor(Number(result.rank) / 500), 0);
  }

  return score;
}

async function lookupImdbId(title, year, type) {
  let best = null;
  let bestScore = -Infinity;
  const titleVariants = buildLookupTitleVariants(title, year);

  for (const lookupTitle of titleVariants) {
    const firstChar = lookupTitle[0]?.toLowerCase();
    const bucket = /^[a-z0-9]$/.test(firstChar) ? firstChar : '_';
    const url = `https://v2.sg.media-imdb.com/suggestion/${bucket}/${encodeURIComponent(lookupTitle)}.json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; binge-app/1.0)' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    const candidates = Array.isArray(data?.d) ? data.d : [];

    for (const candidate of candidates) {
      const imdbId = normalizeEmbedId('imdb', candidate?.id);
      if (!imdbId) continue;

      const score = scoreImdbSuggestion(candidate, { title: lookupTitle, year, type });
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  if (!best || bestScore < 60) return null;

  return {
    kind: 'imdb',
    value: best.id.toLowerCase(),
    title: best.l || null,
    year: best.y ?? null,
  };
}

// --- Movies ---
router.get('/movies', async (req, res) => {
  const { search, genre, year, sort } = req.query;
  const page     = normalizePage(req.query.page, 1);
  const pageSize = normalizePageSize(req.query.page_size, 48, 100);
  const offset   = (page - 1) * pageSize;

  try {
    const whereConditions = ['source_key IS NOT NULL'];
    const queryParams = [];
    let pIdx = 1;

    if (search && search.trim()) {
      whereConditions.push(`(title ILIKE $${pIdx} OR director ILIKE $${pIdx} OR overview ILIKE $${pIdx})`);
      queryParams.push(`%${search.trim()}%`);
      pIdx++;
    }

    if (genre && genre.trim()) {
      whereConditions.push(`genre ILIKE $${pIdx}`);
      queryParams.push(`%${genre.trim()}%`);
      pIdx++;
    }

    if (year) {
      whereConditions.push(`year = $${pIdx}`);
      queryParams.push(Number(year));
      pIdx++;
    }

    const isUpcoming = req.query.upcoming === '1' || req.query.upcoming === 'true';
    if (!isUpcoming && sort === 'relevance') {
      whereConditions.push(`(year IS NULL OR year <= ${new Date().getFullYear()})`);
    }

    if (req.query.kids_safe === '1' || req.query.kids_safe === 'true') {
      whereConditions.push(`age_rating IN ('G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG')`);
    }

    const whereClause = whereConditions.join(' AND ');

    let orderBy = 'title ASC';
    if (sort === 'year-desc') {
      orderBy = 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year DESC, title ASC';
    } else if (sort === 'year-asc') {
      orderBy = 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year ASC, title ASC';
    } else if (sort === 'title-desc') {
      orderBy = 'title DESC';
    } else if (sort === 'popularity' || sort === 'popularity-desc' || sort === 'relevance') {
      orderBy = 'CASE WHEN popularity IS NULL THEN 1 ELSE 0 END, popularity DESC, title ASC';
    } else if (sort === 'rating' || sort === 'rating-desc') {
      orderBy = 'CASE WHEN vote_average IS NULL THEN 1 ELSE 0 END, vote_average DESC, popularity DESC';
    }

    const isUnfiltered = queryParams.length === 0;
    let totalPromise;
    if (isUnfiltered && cachedMovieTotalCount != null && Date.now() - cachedMovieTotalTime < 3600000) {
      totalPromise = Promise.resolve({ rows: [{ total: cachedMovieTotalCount }] });
    } else {
      totalPromise = neonDb.query(`SELECT COUNT(*) as total FROM movies WHERE ${whereClause}`, queryParams)
        .then((res) => {
          if (isUnfiltered) {
            cachedMovieTotalCount = Number(res.rows[0]?.total || 0);
            cachedMovieTotalTime = Date.now();
          }
          return res;
        });
    }

    const itemsQuery = `
      SELECT *
      FROM movies
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    const [countRes, itemsRes, genresRes] = await Promise.all([
      totalPromise,
      neonDb.query(itemsQuery, [...queryParams, pageSize, offset]),
      neonDb.query('SELECT genre FROM movie_genres ORDER BY genre ASC').catch(() => ({ rows: [] })),
    ]);

    const total = Number(countRes.rows[0]?.total || 0);
    const items = itemsRes.rows.map((row) => ({
      ...row,
      id: Number(row.id),
    }));

    const genres = genresRes.rows.map((r) => r.genre).filter(Boolean);

    return res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      facets: { genres },
    });
  } catch (err) {
    console.error('Neon /movies query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/movies/genres', async (_req, res) => {
  try {
    const result = await neonDb.query('SELECT genre FROM movie_genres ORDER BY genre ASC');
    if (result.rows.length > 0) {
      return res.json({ genres: result.rows.map((r) => r.genre).filter(Boolean) });
    }
  } catch (err) {
    console.error('Neon movie genres error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-tmdb-ids', async (req, res) => {
  const { type, ids } = req.query;
  const isShow = type === 'tv' || type === 'tv_show';
  const table = isShow ? 'tv_shows' : 'movies';
  const prefix = isShow ? 'tmdb:tv:' : 'tmdb:movie:';

  const rawIds = String(ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!rawIds.length) {
    return res.json({ items: [] });
  }

  const keys = rawIds.map((id) => `${prefix}${id}`);

  try {
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const query = `
      SELECT *
      FROM ${table}
      WHERE source_key IN (${placeholders})
    `;
    const result = await neonDb.query(query, keys);
    const items = result.rows.map((r) => ({ ...r, id: Number(r.id) }));
    return res.json({ items });
  } catch (err) {
    console.error('Neon by-tmdb-ids error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

router.get('/popular-titles', requireAuth, async (req, res) => {
  const { type } = req.query;
  if (type !== 'movie' && type !== 'tv') {
    return res.status(400).json({ error: 'type must be movie or tv' });
  }

  try {
    const titles = await fetchPopularTitlesFromTrakt(type);
    res.json({ titles: titles || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getCuratedMovieRowsNeon() {
  const now = Date.now();
  if (cachedCuratedMovies && now - cachedCuratedMoviesTime < CURATED_CACHE_TTL) {
    return cachedCuratedMovies;
  }

  const CURRENT_YEAR = new Date().getFullYear();
  const baseFilter = `poster_url IS NOT NULL AND source_key IS NOT NULL AND (year IS NULL OR year <= ${CURRENT_YEAR})`;

  const rowDefs = [
    { id: 'featured', title: 'Featured Picks', seeAll: '/movies?sort=relevance', query: `SELECT * FROM movies WHERE ${baseFilter} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'upcoming', title: 'Upcoming Releases', seeAll: '/movies?sort=year-desc&upcoming=1', query: `SELECT * FROM movies WHERE poster_url IS NOT NULL AND source_key IS NOT NULL AND year > ${CURRENT_YEAR} ORDER BY year ASC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'trending', title: 'Trending Now', seeAll: '/movies?sort=year-desc', query: `SELECT * FROM movies WHERE ${baseFilter} AND year >= ${CURRENT_YEAR - 1} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'top_rated', title: 'Top Rated', seeAll: '/movies?sort=rating-desc', query: `SELECT * FROM movies WHERE ${baseFilter} AND vote_average >= 7.5 ORDER BY vote_average DESC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'action', title: 'Action & Adventure', seeAll: '/movies?genre=Action', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Action%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'comedy', title: 'Comedy', seeAll: '/movies?genre=Comedy', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Comedy%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'horror', title: 'Horror', seeAll: '/movies?genre=Horror', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Horror%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'scifi', title: 'Sci-Fi', seeAll: '/movies?genre=Science+Fiction', query: `SELECT * FROM movies WHERE ${baseFilter} AND (genre ILIKE '%Sci-Fi%' OR genre ILIKE '%Science Fiction%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'drama', title: 'Drama', seeAll: '/movies?genre=Drama', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Drama%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'thriller', title: 'Thriller & Mystery', seeAll: '/movies?genre=Thriller', query: `SELECT * FROM movies WHERE ${baseFilter} AND (genre ILIKE '%Thriller%' OR genre ILIKE '%Mystery%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'family', title: 'Family & Animation', seeAll: '/movies?genre=Family', query: `SELECT * FROM movies WHERE ${baseFilter} AND (genre ILIKE '%Family%' OR genre ILIKE '%Animation%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'romance', title: 'Romance', seeAll: '/movies?genre=Romance', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Romance%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
  ];

  const results = await Promise.all(
    rowDefs.map(async (def) => {
      try {
        const res = await neonDb.query(def.query);
        return {
          id: def.id,
          title: def.title,
          seeAll: def.seeAll,
          items: res.rows.map((r) => ({ ...r, id: Number(r.id) })),
        };
      } catch (err) {
        return { id: def.id, title: def.title, seeAll: def.seeAll, items: [] };
      }
    })
  );

  const filtered = results.filter((r) => r.items.length > 0);
  if (filtered.length > 0) {
    cachedCuratedMovies = filtered;
    cachedCuratedMoviesTime = now;
  }
  return filtered;
}

async function getCuratedTvRowsNeon() {
  const now = Date.now();
  if (cachedCuratedTv && now - cachedCuratedTvTime < CURATED_CACHE_TTL) {
    return cachedCuratedTv;
  }

  const CURRENT_YEAR = new Date().getFullYear();
  const baseFilter = `poster_url IS NOT NULL AND source_key IS NOT NULL AND (year IS NULL OR year <= ${CURRENT_YEAR})`;

  const rowDefs = [
    { id: 'featured', title: 'Featured Series', seeAll: '/tv-shows?sort=relevance', query: `SELECT * FROM tv_shows WHERE ${baseFilter} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'upcoming', title: 'Coming Soon', seeAll: '/tv-shows?sort=year-desc&upcoming=1', query: `SELECT * FROM tv_shows WHERE poster_url IS NOT NULL AND source_key IS NOT NULL AND year > ${CURRENT_YEAR} ORDER BY year ASC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'trending', title: 'Trending Now', seeAll: '/tv-shows?sort=year-desc', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND year >= ${CURRENT_YEAR - 1} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'top_rated', title: 'Top Rated', seeAll: '/tv-shows', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND vote_average >= 7.5 ORDER BY vote_average DESC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'drama', title: 'Drama', seeAll: '/tv-shows?genre=Drama', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND genre ILIKE '%Drama%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'comedy', title: 'Comedy & Sitcoms', seeAll: '/tv-shows?genre=Comedy', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND genre ILIKE '%Comedy%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'crime', title: 'Crime & Mystery', seeAll: '/tv-shows?genre=Crime', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND (genre ILIKE '%Crime%' OR genre ILIKE '%Mystery%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'scifi', title: 'Sci-Fi & Fantasy', seeAll: '/tv-shows?genre=Sci-Fi', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND (genre ILIKE '%Sci-Fi%' OR genre ILIKE '%Science Fiction%' OR genre ILIKE '%Fantasy%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'anime', title: 'Anime', seeAll: '/tv-shows?genre=Anime', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND (genre ILIKE '%Anime%' OR genre ILIKE '%Animation%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'action', title: 'Action & Adventure', seeAll: '/tv-shows?genre=Action', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND genre ILIKE '%Action%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
  ];

  const results = await Promise.all(
    rowDefs.map(async (def) => {
      try {
        const res = await neonDb.query(def.query);
        return {
          id: def.id,
          title: def.title,
          seeAll: def.seeAll,
          items: res.rows.map((r) => ({ ...r, id: Number(r.id) })),
        };
      } catch (err) {
        return { id: def.id, title: def.title, seeAll: def.seeAll, items: [] };
      }
    })
  );

  const filtered = results.filter((r) => r.items.length > 0);
  if (filtered.length > 0) {
    cachedCuratedTv = filtered;
    cachedCuratedTvTime = now;
  }
  return filtered;
}

async function getCuratedBookRowsNeon() {
  const now = Date.now();
  if (cachedCuratedBooks && now - cachedCuratedBooksTime < CURATED_CACHE_TTL) {
    return cachedCuratedBooks;
  }

  const baseFilter = 'cover_url IS NOT NULL AND source_key IS NOT NULL';

  const rowDefs = [
    { id: 'fiction', title: 'Popular Fiction', seeAll: '/books?genre=Fiction', query: `SELECT * FROM books WHERE ${baseFilter} AND (genre ILIKE '%Fiction%' OR genre = 'General Fiction') ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'scifi', title: 'Science Fiction', seeAll: '/books?genre=Science+Fiction', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%Science Fiction%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'fantasy', title: 'Fantasy', seeAll: '/books?genre=Fantasy', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%Fantasy%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'mystery', title: 'Mystery & Thriller', seeAll: '/books?genre=Mystery', query: `SELECT * FROM books WHERE ${baseFilter} AND (genre ILIKE '%Mystery%' OR genre ILIKE '%Thriller%' OR genre ILIKE '%Crime%') ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'romance', title: 'Romance', seeAll: '/books?genre=Romance', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%Romance%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'history', title: 'History', seeAll: '/books?genre=History', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%History%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'classics', title: 'Classic Literature', seeAll: '/books?genre=Classic', query: `SELECT * FROM books WHERE ${baseFilter} AND (genre ILIKE '%Classic%' OR (year < 1960 AND year > 1800)) ORDER BY year DESC NULLS LAST LIMIT 30` },
  ];

  const results = await Promise.all(
    rowDefs.map(async (def) => {
      try {
        const res = await neonDb.query(def.query);
        return {
          id: def.id,
          title: def.title,
          seeAll: def.seeAll,
          items: res.rows.map((r) => ({ ...r, id: Number(r.id) })),
        };
      } catch (err) {
        return { id: def.id, title: def.title, seeAll: def.seeAll, items: [] };
      }
    })
  );

  const filtered = results.filter((r) => r.items.length > 0);
  if (filtered.length > 0) {
    cachedCuratedBooks = filtered;
    cachedCuratedBooksTime = now;
  }
  return filtered;
}

router.get(['/movies/curated', '/movie-rows'], async (req, res) => {
  try {
    const rows = await getCuratedMovieRowsNeon();
    return res.json({ rows });
  } catch (err) {
    console.error('Neon movie curated error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get(['/tv-shows/curated', '/tv-show-rows'], async (req, res) => {
  try {
    const rows = await getCuratedTvRowsNeon();
    return res.json({ rows });
  } catch (err) {
    console.error('Neon tv curated error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get(['/books/curated', '/book-rows'], async (req, res) => {
  try {
    const rows = await getCuratedBookRowsNeon();
    return res.json({ rows });
  } catch (err) {
    console.error('Neon book curated error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/movies/:id', async (req, res) => {
  try {
    const movieRes = await neonDb.query(
      'SELECT * FROM movies WHERE id = $1 AND source_key IS NOT NULL',
      [req.params.id]
    );
    if (movieRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const movie = { ...movieRes.rows[0], id: Number(movieRes.rows[0].id) };
    const statsRes = await ratingStats('movie_ratings', ['acting', 'writing', 'originality', 'pacing', 'cinematography'], 25, req.params.id);

    const stats = statsRes.rows[0] || { avg_rating: null, rating_count: 0 };
    return res.json({
      ...movie,
      avg_rating: stats.avg_rating != null ? Number(stats.avg_rating) : null,
      rating_count: Number(stats.rating_count || 0),
    });
  } catch (err) {
    console.error('Neon /movies/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- TV Shows ---
router.get('/tv-shows', async (req, res) => {
  const { search, genre, sort } = req.query;
  const page     = normalizePage(req.query.page, 1);
  const pageSize = normalizePageSize(req.query.page_size, 48, 100);
  const offset   = (page - 1) * pageSize;

  try {
    const whereConditions = ['source_key IS NOT NULL'];
    const queryParams = [];
    let pIdx = 1;

    if (search && search.trim()) {
      whereConditions.push(`(title ILIKE $${pIdx} OR creator ILIKE $${pIdx} OR overview ILIKE $${pIdx})`);
      queryParams.push(`%${search.trim()}%`);
      pIdx++;
    }

    if (genre && genre.trim()) {
      whereConditions.push(`genre ILIKE $${pIdx}`);
      queryParams.push(`%${genre.trim()}%`);
      pIdx++;
    }

    if (req.query.year) {
      whereConditions.push(`year = $${pIdx}`);
      queryParams.push(Number(req.query.year));
      pIdx++;
    }

    const isUpcoming = req.query.upcoming === '1' || req.query.upcoming === 'true';
    if (!isUpcoming && sort === 'relevance') {
      whereConditions.push(`(year IS NULL OR year <= ${new Date().getFullYear()})`);
    }

    if (req.query.kids_safe === '1' || req.query.kids_safe === 'true') {
      whereConditions.push(`age_rating IN ('G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG')`);
    }

    const whereClause = whereConditions.join(' AND ');

    let orderBy = 'title ASC';
    if (sort === 'year-desc') {
      orderBy = 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year DESC, title ASC';
    } else if (sort === 'year-asc') {
      orderBy = 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year ASC, title ASC';
    } else if (sort === 'title-desc') {
      orderBy = 'title DESC';
    } else if (sort === 'popularity' || sort === 'popularity-desc' || sort === 'relevance') {
      orderBy = 'CASE WHEN popularity IS NULL THEN 1 ELSE 0 END, popularity DESC, title ASC';
    } else if (sort === 'rating' || sort === 'rating-desc') {
      orderBy = 'CASE WHEN vote_average IS NULL THEN 1 ELSE 0 END, vote_average DESC, popularity DESC';
    }

    const isUnfiltered = queryParams.length === 0;
    let totalPromise;
    if (isUnfiltered && cachedTvTotalCount != null && Date.now() - cachedTvTotalTime < 3600000) {
      totalPromise = Promise.resolve({ rows: [{ total: cachedTvTotalCount }] });
    } else {
      totalPromise = neonDb.query(`SELECT COUNT(*) as total FROM tv_shows WHERE ${whereClause}`, queryParams)
        .then((res) => {
          if (isUnfiltered) {
            cachedTvTotalCount = Number(res.rows[0]?.total || 0);
            cachedTvTotalTime = Date.now();
          }
          return res;
        });
    }

    const itemsQuery = `
      SELECT *
      FROM tv_shows
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    const [countRes, itemsRes, genresRes] = await Promise.all([
      totalPromise,
      neonDb.query(itemsQuery, [...queryParams, pageSize, offset]),
      neonDb.query('SELECT genre FROM tv_show_genres ORDER BY genre ASC').catch(() => ({ rows: [] })),
    ]);

    const total = Number(countRes.rows[0]?.total || 0);
    const items = itemsRes.rows.map((row) => ({
      ...row,
      id: Number(row.id),
    }));

    const genres = genresRes.rows.map((r) => r.genre).filter(Boolean);

    return res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      facets: { genres },
    });
  } catch (err) {
    console.error('Neon /tv-shows query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tv-shows/genres', async (_req, res) => {
  try {
    const result = await neonDb.query('SELECT genre FROM tv_show_genres ORDER BY genre ASC');
    if (result.rows.length > 0) {
      return res.json({ genres: result.rows.map((r) => r.genre).filter(Boolean) });
    }
  } catch (err) {
    console.error('Neon tv genres error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tv-shows/:id', async (req, res) => {
  try {
    const showRes = await neonDb.query(
      'SELECT * FROM tv_shows WHERE id = $1 AND source_key IS NOT NULL',
      [req.params.id]
    );
    if (showRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const show = { ...showRes.rows[0], id: Number(showRes.rows[0].id) };
    const statsRes = await ratingStats('tv_show_ratings', ['premise', 'originality', 'acting', 'cinematography', 'writing', 'pacing', 'resonance'], 38, req.params.id);

    const stats = statsRes.rows[0] || { avg_rating: null, rating_count: 0 };
    return res.json({
      ...show,
      avg_rating: stats.avg_rating != null ? Number(stats.avg_rating) : null,
      rating_count: Number(stats.rating_count || 0),
    });
  } catch (err) {
    console.error('Neon /tv-shows/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Books ---
router.get('/books', async (req, res) => {
  const { search, genre, min_year: minYear, sort } = req.query;
  const page = normalizePage(req.query.page, 1);
  const pageSize = normalizePageSize(req.query.page_size, 24);
  const offset = (page - 1) * pageSize;

  try {
    const whereConditions = ['source_key IS NOT NULL'];
    const queryParams = [];
    let pIdx = 1;

    if (search && search.trim()) {
      whereConditions.push(`(title ILIKE $${pIdx} OR author ILIKE $${pIdx})`);
      queryParams.push(`%${search.trim()}%`);
      pIdx++;
    }

    if (genre && genre.trim()) {
      whereConditions.push(`genre ILIKE $${pIdx}`);
      queryParams.push(`%${genre.trim()}%`);
      pIdx++;
    }

    if (minYear) {
      whereConditions.push(`(year IS NULL OR year >= $${pIdx})`);
      queryParams.push(Number(minYear));
      pIdx++;
    }

    const whereClause = whereConditions.join(' AND ');

    let orderBy = 'title ASC';
    if (sort === 'year-desc') {
      orderBy = 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year DESC, title ASC';
    } else if (sort === 'year-asc') {
      orderBy = 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year ASC, title ASC';
    }

    const [countRes, itemsRes, facetsRes, genresRes] = await Promise.all([
      neonDb.query(`SELECT COUNT(*) as total FROM books WHERE ${whereClause}`, queryParams),
      neonDb.query(`SELECT * FROM books WHERE ${whereClause} ORDER BY ${orderBy} LIMIT $${pIdx} OFFSET $${pIdx + 1}`, [...queryParams, pageSize, offset]),
      neonDb.query('SELECT MIN(year) AS min_year, MAX(year) AS max_year FROM books WHERE year IS NOT NULL').catch(() => ({ rows: [{}] })),
      neonDb.query('SELECT genre FROM book_genres ORDER BY genre ASC').catch(() => ({ rows: [] })),
    ]);

    const total = Number(countRes.rows[0]?.total || 0);
    const items = itemsRes.rows.map((row) => ({ ...row, id: Number(row.id) }));
    const facets = facetsRes.rows[0] || {};
    const genres = genresRes.rows.map((r) => r.genre).filter(Boolean);

    return res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      facets: {
        genres,
        minYear: facets.min_year ?? null,
        maxYear: facets.max_year ?? null,
      },
    });
  } catch (err) {
    console.error('Neon /books query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/books/genres', async (_req, res) => {
  try {
    const result = await neonDb.query('SELECT genre FROM book_genres ORDER BY genre ASC');
    if (result.rows.length > 0) {
      return res.json({ genres: result.rows.map((r) => r.genre).filter(Boolean) });
    }
  } catch (err) {
    console.error('Neon book genres error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/books/:id', async (req, res) => {
  try {
    const bookRes = await neonDb.query(
      'SELECT * FROM books WHERE id = $1 AND source_key IS NOT NULL',
      [req.params.id]
    );
    if (bookRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const book = { ...bookRes.rows[0], id: Number(bookRes.rows[0].id) };
    const statsRes = await ratingStats('book_ratings', ['prose', 'plot', 'characters', 'originality', 'pacing', 'resonance'], 32, req.params.id);

    const stats = statsRes.rows[0] || { avg_rating: null, rating_count: 0 };
    return res.json({
      ...book,
      avg_rating: stats.avg_rating != null ? Number(stats.avg_rating) : null,
      rating_count: Number(stats.rating_count || 0),
    });
  } catch (err) {
    console.error('Neon /books/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── TMDB ID lookup for embed player ─────────────────────────────────────────
router.get('/embed-id', async (req, res) => {
  const { title, year, type, imdb, tmdb } = req.query;

  const directId =
    normalizeEmbedId('imdb', imdb) ||
    normalizeEmbedId('tmdb', tmdb);

  if (directId) {
    return res.json(directId);
  }

  if (!title) {
    return res.status(400).json({ error: 'title required' });
  }

  try {
    const imdbMatch = await lookupImdbId(title, year, type);
    if (imdbMatch) {
      return res.json(imdbMatch);
    }
  } catch (error) {
    console.warn('IMDb lookup failed:', error.message);
  }

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (TMDB_KEY) {
    try {
      const mediaType = type === 'tv_show' ? 'tv' : 'movie';
      const params = new URLSearchParams({
        api_key: TMDB_KEY,
        query: title,
        ...(year ? { first_air_date_year: year, year } : {}),
      });
      const url = `https://api.themoviedb.org/3/search/${mediaType}?${params}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        const result = data.results?.[0];
        if (result?.id != null) {
          return res.json({
            kind: 'tmdb',
            value: String(result.id),
            title: result.title || result.name || null,
          });
        }
      }
    } catch (error) {
      console.warn('TMDB lookup failed:', error.message);
    }
  }

  return res.json({ kind: null, value: null });
});

router.get('/tmdb-id', async (req, res) => {
  const { title, year, type } = req.query;
  if (!title) return res.status(400).json({ error: 'title required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.json({ id: null });

  const mediaType = type === 'tv_show' ? 'tv' : 'movie';

  async function searchTmdb(query, extraParams = {}) {
    const params = new URLSearchParams({ api_key: TMDB_KEY, query, ...extraParams });
    const url = `https://api.themoviedb.org/3/search/${mediaType}?${params}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data.results?.[0] || null;
  }

  try {
    // Strategy 1: exact title + year
    let result = year ? await searchTmdb(title, { year, first_air_date_year: year }) : null;

    // Strategy 2: title without year
    if (!result) result = await searchTmdb(title);

    // Strategy 3: strip common subtitle separators (e.g. "Title: Subtitle" -> "Title")
    if (!result && title.includes(':')) {
      result = await searchTmdb(title.split(':')[0].trim());
    }

    // Strategy 4: strip parenthetical year from title e.g. "Show (2021)"
    if (!result && /\s*\(\d{4}\)\s*$/.test(title)) {
      result = await searchTmdb(title.replace(/\s*\(\d{4}\)\s*$/, '').trim());
    }

    // Strategy 5: try removing "Season X" or "Part X" suffixes
    if (!result && /\s+(season|part)\s+\d+/i.test(title)) {
      result = await searchTmdb(title.replace(/\s+(season|part)\s+\d+.*/i, '').trim());
    }

    // Strategy 6: for anime — try with "!" removed or common alt punctuation
    if (!result && /[!?]/.test(title)) {
      result = await searchTmdb(title.replace(/[!?]/g, '').trim());
    }

    if (!result) return res.json({ id: null });
    return res.json({ id: result.id, title: result.title || result.name });
  } catch (err) {
    return res.json({ id: null });
  }
});

// ─── TMDB show details (real season count) ───────────────────────────────────
router.get('/tmdb-show', async (req, res) => {
  const { tmdbId } = req.query;
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not set' });

  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(502).json({ error: 'TMDB error' });
    const data = await r.json();
    res.json({
      numberOfSeasons: data.number_of_seasons || null,
      numberOfEpisodes: data.number_of_episodes || null,
      status: data.status || null,
      name: data.name || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TMDB season episode count ────────────────────────────────────────────────
// In-memory cache for TMDB season data (avoids hammering API on repeat views)
const tmdbSeasonCache = new Map();
const TMDB_CACHE_TTL = 60 * 60 * 1000; // 1 hour

router.get('/tmdb-season', async (req, res) => {
  const { tmdbId, season } = req.query;
  if (!tmdbId || !season) return res.status(400).json({ error: 'tmdbId and season required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not set' });

  const cacheKey = `${tmdbId}:${season}`;
  const cached = tmdbSeasonCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TMDB_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: 'TMDB error' });
    const data = await r.json();
    const result = {
      season: data.season_number,
      episodeCount: data.episodes?.length || 0,
      episodes: (data.episodes || []).map(e => ({
        number: e.episode_number,
        name: e.name,
        airDate: e.air_date,
      })),
    };
    tmdbSeasonCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

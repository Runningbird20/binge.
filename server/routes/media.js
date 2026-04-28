const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildBookGenreFacets, matchesBookGenreFacet } = require('../bookGenres');

const router = express.Router();

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
router.get('/movies', (req, res) => {
  if (typeof db.syncImportedMovies === 'function') {
    db.syncImportedMovies();
  }

  const { search, genre, year, sort } = req.query;
  const page     = normalizePage(req.query.page, 1);
  const pageSize = normalizePageSize(req.query.page_size, 48, 100);
  const offset   = (page - 1) * pageSize;
  const params   = [];

  // Dedup subquery — prefer TMDB over Plex for same title+year
  let innerWhere = 'WHERE source_key IS NOT NULL';
  if (search) { innerWhere += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { innerWhere += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  if (year)   { innerWhere += ' AND year = ?';       params.push(Number(year)); }

  // Determine ORDER BY for SQL (sort in DB, not in memory)
  const orderBy = sort === 'year-desc' ? 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year DESC, title ASC'
                : sort === 'year-asc'  ? 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year ASC, title ASC'
                : sort === 'title-desc'? 'title DESC'
                : 'title ASC';

  const dedupeBase = `
    SELECT m.*
    FROM movies m
    INNER JOIN (
      SELECT
        MIN(CASE WHEN source_key LIKE 'tmdb:%' THEN id END) AS tmdb_id,
        MIN(id) AS any_id
      FROM movies
      ${innerWhere}
      GROUP BY LOWER(TRIM(title)), COALESCE(year, 0)
    ) dedup ON m.id = COALESCE(dedup.tmdb_id, dedup.any_id)
    ${innerWhere}
  `;

  const countParams = [...params, ...params]; // params used twice (inner + outer WHERE)
  const total = db.prepare(`SELECT COUNT(*) as n FROM (${dedupeBase})`).get(...countParams)?.n || 0;
  const items = db.prepare(`${dedupeBase} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...countParams, pageSize, offset);

  const genres = buildMediaGenreFacets(
    db.prepare(`
      SELECT DISTINCT genre FROM movies
      WHERE source_key IS NOT NULL AND genre IS NOT NULL AND TRIM(genre) <> ''
    `).all().map((row) => row.genre)
  );

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    facets: { genres },
  });
});

// ─── Curated rows endpoint ────────────────────────────────────────────────────
// Returns multiple named buckets in one call for the Netflix-style homepage layout

function getTopDeduped(table, where, orderBy, limit, extraParams = []) {
  // Returns deduplicated rows (prefer tmdb) matching a WHERE clause
  const alias = table === 'movies' ? 'm' : 't';
  const idCol  = table === 'movies' ? 'tmdb_id' : 'tmdb_id';
  const q = `
    SELECT ${alias}.*
    FROM ${table} ${alias}
    INNER JOIN (
      SELECT
        MIN(CASE WHEN source_key LIKE 'tmdb:%' THEN id END) AS tmdb_id,
        MIN(id) AS any_id
      FROM ${table}
      WHERE source_key IS NOT NULL
      GROUP BY LOWER(TRIM(title))${table === 'movies' ? ', COALESCE(year, 0)' : ''}
    ) dedup ON ${alias}.id = COALESCE(dedup.tmdb_id, dedup.any_id)
    WHERE ${alias}.source_key IS NOT NULL ${where ? 'AND ' + where : ''}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  try {
    return db.prepare(q).all(...extraParams, limit);
  } catch (e) {
    console.error('curated query error:', e.message, q);
    return [];
  }
}

// Movie row definitions
function buildMovieRows() {
  const CURRENT_YEAR = new Date().getFullYear();
  const NO_FUTURE = `AND year <= ${CURRENT_YEAR} AND poster_url IS NOT NULL`;
  const rows = [
    {
      id: 'upcoming',
      title: 'Upcoming Releases',
      seeAll: '/movies?sort=year-desc&upcoming=1',
      items: getTopDeduped('movies', `year > ${CURRENT_YEAR} AND poster_url IS NOT NULL`, `year ASC, RANDOM()`, 48),
    },
    {
      id: 'trending',
      title: 'Trending Now',
      seeAll: '/movies?sort=year-desc',
      items: getTopDeduped('movies', `year >= ${CURRENT_YEAR - 1} ${NO_FUTURE.replace('AND poster_url IS NOT NULL','')} AND poster_url IS NOT NULL`, 'RANDOM()', 48),
    },
    {
      id: 'new_releases',
      title: 'New Releases',
      seeAll: '/movies?sort=year-desc',
      items: getTopDeduped('movies', `year = ${CURRENT_YEAR} AND poster_url IS NOT NULL`, 'RANDOM()', 48),
    },
    {
      id: 'top_rated',
      title: 'Top Rated',
      seeAll: '/movies?sort=year-desc',
      items: getTopDeduped('movies', `year IS NOT NULL ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'action',
      title: 'Action & Adventure',
      seeAll: '/movies?genre=Action',
      items: getTopDeduped('movies', `genre LIKE '%Action%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'superhero',
      title: 'Superhero',
      seeAll: '/movies?category=superhero',
      items: getTopDeduped('movies', `(title LIKE '%Marvel%' OR title LIKE '%Spider%' OR title LIKE '%Batman%' OR title LIKE '%Superman%' OR title LIKE '%Avengers%' OR title LIKE '%Iron Man%' OR title LIKE '%Thor%' OR title LIKE '%Captain America%' OR title LIKE '%Black Panther%' OR title LIKE '%Doctor Strange%' OR title LIKE '%Guardians%' OR title LIKE '%X-Men%' OR title LIKE '%Deadpool%' OR title LIKE '%Wonder Woman%' OR title LIKE '%Aquaman%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'comedy',
      title: 'Comedy',
      seeAll: '/movies?genre=Comedy',
      items: getTopDeduped('movies', `genre LIKE '%Comedy%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'horror',
      title: 'Horror',
      seeAll: '/movies?genre=Horror',
      items: getTopDeduped('movies', `genre LIKE '%Horror%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'scifi',
      title: 'Sci-Fi',
      seeAll: '/movies?genre=Science+Fiction',
      items: getTopDeduped('movies', `(genre LIKE '%Sci-Fi%' OR genre LIKE '%Science Fiction%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'drama',
      title: 'Drama',
      seeAll: '/movies?genre=Drama',
      items: getTopDeduped('movies', `genre LIKE '%Drama%' AND genre NOT LIKE '%Horror%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'thriller',
      title: 'Thriller & Mystery',
      seeAll: '/movies?genre=Thriller',
      items: getTopDeduped('movies', `(genre LIKE '%Thriller%' OR genre LIKE '%Mystery%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'romance',
      title: 'Romance',
      seeAll: '/movies?genre=Romance',
      items: getTopDeduped('movies', `genre LIKE '%Romance%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'family',
      title: 'Family & Animation',
      seeAll: '/movies?genre=Family',
      items: getTopDeduped('movies', `(genre LIKE '%Family%' OR genre LIKE '%Animation%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'fantasy',
      title: 'Fantasy & Adventure',
      seeAll: '/movies?genre=Fantasy',
      items: getTopDeduped('movies', `(genre LIKE '%Fantasy%' OR genre LIKE '%Adventure%') AND genre NOT LIKE '%Horror%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'documentary',
      title: 'Documentary',
      seeAll: '/movies?genre=Documentary',
      items: getTopDeduped('movies', `genre LIKE '%Documentary%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'international',
      title: 'International',
      seeAll: '/movies?genre=International',
      items: getTopDeduped('movies', `poster_url IS NOT NULL AND year <= ${CURRENT_YEAR} AND year >= 2000 AND director IS NOT NULL`, 'RANDOM()', 48),
    },
    {
      id: 'holiday',
      title: 'Holiday & Christmas',
      seeAll: '/movies?category=holiday',
      items: getTopDeduped('movies', `(title LIKE '%Christmas%' OR title LIKE '%Holiday%' OR title LIKE '%Santa%' OR title LIKE '%Noel%' OR synopsis LIKE '%Christmas%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'war',
      title: 'War & History',
      seeAll: '/movies?genre=War',
      items: getTopDeduped('movies', `(genre LIKE '%War%' OR genre LIKE '%History%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'classics',
      title: 'Timeless Classics',
      seeAll: '/movies?sort=year-asc',
      items: getTopDeduped('movies', `year < 1990 AND year > 1920 AND poster_url IS NOT NULL`, 'RANDOM()', 48),
    },
    {
      id: 'crime',
      title: 'Crime',
      seeAll: '/movies?genre=Crime',
      items: getTopDeduped('movies', `genre LIKE '%Crime%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'music',
      title: 'Music & Concert',
      seeAll: '/movies?genre=Music',
      items: getTopDeduped('movies', `genre LIKE '%Music%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'western',
      title: 'Western',
      seeAll: '/movies?genre=Western',
      items: getTopDeduped('movies', `genre LIKE '%Western%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
  ];
  return rows.filter(r => r.items.length > 0);
}

function buildTvRows() {
  const CURRENT_YEAR = new Date().getFullYear();
  const NO_FUTURE = `AND year <= ${CURRENT_YEAR} AND poster_url IS NOT NULL`;
  const rows = [
    {
      id: 'upcoming',
      title: 'Coming Soon',
      seeAll: '/tv-shows?sort=year-desc&upcoming=1',
      items: getTopDeduped('tv_shows', `year > ${CURRENT_YEAR} AND poster_url IS NOT NULL`, 'year ASC, RANDOM()', 48),
    },
    {
      id: 'trending',
      title: 'Trending Now',
      seeAll: '/tv-shows?sort=year-desc',
      items: getTopDeduped('tv_shows', `year >= ${CURRENT_YEAR - 1} ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'top_rated',
      title: 'Top Rated',
      seeAll: '/tv-shows',
      items: getTopDeduped('tv_shows', `year IS NOT NULL ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'drama',
      title: 'Drama',
      seeAll: '/tv-shows?genre=Drama',
      items: getTopDeduped('tv_shows', `genre LIKE '%Drama%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'comedy',
      title: 'Comedy & Sitcoms',
      seeAll: '/tv-shows?genre=Comedy',
      items: getTopDeduped('tv_shows', `genre LIKE '%Comedy%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'crime',
      title: 'Crime & Mystery',
      seeAll: '/tv-shows?genre=Crime',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Crime%' OR genre LIKE '%Mystery%' OR genre LIKE '%Thriller%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'scifi',
      title: 'Sci-Fi & Fantasy',
      seeAll: '/tv-shows?genre=Sci-Fi',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Sci-Fi%' OR genre LIKE '%Science Fiction%' OR genre LIKE '%Fantasy%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'superhero',
      title: 'Superhero Shows',
      seeAll: '/tv-shows?category=superhero',
      items: getTopDeduped('tv_shows', `(title LIKE '%Marvel%' OR title LIKE '%Arrow%' OR title LIKE '%Flash%' OR title LIKE '%Supergirl%' OR title LIKE '%Daredevil%' OR title LIKE '%Loki%' OR title LIKE '%WandaVision%' OR title LIKE '%Hawkeye%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'anime',
      title: 'Anime',
      seeAll: '/tv-shows?genre=Anime',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Anime%' OR genre LIKE '%Animation%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'action',
      title: 'Action & Adventure',
      seeAll: '/tv-shows?genre=Action',
      items: getTopDeduped('tv_shows', `genre LIKE '%Action%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'reality',
      title: 'Reality & Competition',
      seeAll: '/tv-shows?genre=Reality',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Reality%' OR genre LIKE '%Game Show%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'horror',
      title: 'Horror & Supernatural',
      seeAll: '/tv-shows?genre=Horror',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Horror%' OR genre LIKE '%Supernatural%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'documentary',
      title: 'Documentary',
      seeAll: '/tv-shows?genre=Documentary',
      items: getTopDeduped('tv_shows', `genre LIKE '%Documentary%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'kids',
      title: 'Kids & Family',
      seeAll: '/tv-shows?genre=Kids',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Kids%' OR genre LIKE '%Family%' OR genre LIKE '%Children%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'binge',
      title: 'Binge-Worthy (4+ Seasons)',
      seeAll: '/tv-shows?min_seasons=4',
      items: getTopDeduped('tv_shows', `seasons >= 4 ${NO_FUTURE}`, 'seasons DESC, RANDOM()', 48),
    },
    {
      id: 'kdrama',
      title: 'K-Drama & Asian',
      seeAll: '/tv-shows?category=kdrama',
      items: getTopDeduped('tv_shows', `(genre LIKE '%Korean%' OR synopsis LIKE '%Korea%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'classics',
      title: 'Classic TV',
      seeAll: '/tv-shows?sort=year-asc',
      items: getTopDeduped('tv_shows', `year < 2000 AND year > 1950 AND poster_url IS NOT NULL`, 'RANDOM()', 48),
    },
    {
      id: 'medical',
      title: 'Medical Drama',
      seeAll: '/tv-shows?category=medical',
      items: getTopDeduped('tv_shows', `(title LIKE '%House%' OR title LIKE '%Grey%' OR title LIKE '%ER%' OR title LIKE '%Scrubs%' OR title LIKE '%Medical%' OR synopsis LIKE '%hospital%' OR synopsis LIKE '%doctor%') ${NO_FUTURE}`, 'RANDOM()', 48),
    },
    {
      id: 'talk',
      title: 'Talk & Late Night',
      seeAll: '/tv-shows?genre=Talk',
      items: getTopDeduped('tv_shows', `genre LIKE '%Talk%' ${NO_FUTURE}`, 'RANDOM()', 48),
    },
  ];
  return rows.filter(r => r.items.length > 0);
}

function buildBookRows() {
  const rows = [
    {
      id: 'fiction',
      title: 'Popular Fiction',
      seeAll: '/books?genre=Fiction',
      items: getBooksDeduped("AND (genre LIKE '%Fiction%' OR genre = 'General Fiction')"),
    },
    {
      id: 'scifi',
      title: 'Science Fiction',
      seeAll: '/books?genre=Science+Fiction',
      items: getBooksDeduped("AND genre LIKE '%Science Fiction%'"),
    },
    {
      id: 'fantasy',
      title: 'Fantasy',
      seeAll: '/books?genre=Fantasy',
      items: getBooksDeduped("AND genre LIKE '%Fantasy%'"),
    },
    {
      id: 'mystery',
      title: 'Mystery & Thriller',
      seeAll: '/books?genre=Mystery',
      items: getBooksDeduped("AND (genre LIKE '%Mystery%' OR genre LIKE '%Thriller%' OR genre LIKE '%Crime%')"),
    },
    {
      id: 'romance',
      title: 'Romance',
      seeAll: '/books?genre=Romance',
      items: getBooksDeduped("AND genre LIKE '%Romance%'"),
    },
    {
      id: 'biography',
      title: 'Biography & Memoir',
      seeAll: '/books?genre=Biography',
      items: getBooksDeduped("AND (genre LIKE '%Biography%' OR genre LIKE '%Memoir%')"),
    },
    {
      id: 'history',
      title: 'History',
      seeAll: '/books?genre=History',
      items: getBooksDeduped("AND genre LIKE '%History%'"),
    },
    {
      id: 'horror',
      title: 'Horror',
      seeAll: '/books?genre=Horror',
      items: getBooksDeduped("AND genre LIKE '%Horror%'"),
    },
    {
      id: 'selfhelp',
      title: 'Self Help & Psychology',
      seeAll: '/books?genre=Self+Help',
      items: getBooksDeduped("AND (genre LIKE '%Self Help%' OR genre LIKE '%Psychology%' OR genre LIKE '%Philosophy%')"),
    },
    {
      id: 'classics',
      title: 'Classic Literature',
      seeAll: '/books?genre=Classic',
      items: getBooksDeduped("AND (genre LIKE '%Classic%' OR (year < 1960 AND year > 1800))"),
    },
    {
      id: 'adventure',
      title: 'Adventure',
      seeAll: '/books?genre=Adventure',
      items: getBooksDeduped("AND genre LIKE '%Adventure%'"),
    },
    {
      id: 'truecrime',
      title: 'True Crime',
      seeAll: '/books?genre=True+Crime',
      items: getBooksDeduped("AND genre LIKE '%True Crime%'"),
    },
  ];
  return rows.filter(r => r.items.length > 0);
}

// ─── Groq-powered popular titles cache ────────────────────────────────────────

const GROQ_API_KEY  = process.env.GROQ_API_KEY;
const GROQ_MODEL    = 'llama-3.3-70b-versatile';
const GROQ_API_URL  = 'https://api.groq.com/openai/v1/chat/completions';

const popularTitlesCache = new Map(); // key → { titles, expiresAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

async function fetchPopularTitlesFromGroq(mediaType) {
  const cached = popularTitlesCache.get(mediaType);
  if (cached && Date.now() < cached.expiresAt) return cached.titles;

  if (!GROQ_API_KEY) return null;

  const isTV = mediaType === 'tv';
  const prompt = isTV
    ? `List 80 of the most widely watched and recognized TV shows of all time, spanning different genres and decades. Include prestige dramas, popular comedies, iconic sci-fi, crime shows, and animated hits. Return ONLY a valid JSON array of title strings, no explanation, no numbering, no markdown. Example: ["Breaking Bad","Game of Thrones"]`
    : `List 80 of the most widely watched and recognized movies of all time, spanning different genres and decades. Include blockbusters, acclaimed dramas, beloved comedies, iconic action films, and animated classics. Return ONLY a valid JSON array of title strings, no explanation, no numbering, no markdown. Example: ["The Dark Knight","Inception"]`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';

    // Extract JSON array from the response
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return null;

    const titles = JSON.parse(match[0]);
    if (!Array.isArray(titles) || titles.length === 0) return null;

    popularTitlesCache.set(mediaType, { titles, expiresAt: Date.now() + CACHE_TTL_MS });
    return titles;
  } catch {
    return null;
  }
}

router.get('/popular-titles', requireAuth, async (req, res) => {
  const { type } = req.query;
  if (type !== 'movie' && type !== 'tv') {
    return res.status(400).json({ error: 'type must be movie or tv' });
  }

  try {
    const titles = await fetchPopularTitlesFromGroq(type);
    res.json({ titles: titles || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/movies/curated', requireAuth, (req, res) => {
  try {
    const rows = buildMovieRows();
    res.json({ rows });
  } catch (err) {
    console.error('Movie curated error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tv-shows/curated', requireAuth, (req, res) => {
  try {
    const rows = buildTvRows();
    res.json({ rows });
  } catch (err) {
    console.error('TV curated error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/books/curated', requireAuth, (req, res) => {
  try {
    const rows = buildBookRows();
    res.json({ rows });
  } catch (err) {
    console.error('Books curated error:', err);
    res.status(500).json({ error: err.message });
  }
});


router.get('/movies/:id', (req, res) => {
  if (typeof db.syncImportedMovies === 'function') {
    db.syncImportedMovies();
  }

  const movie = db
    .prepare('SELECT * FROM movies WHERE id = ? AND source_key IS NOT NULL')
    .get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    `SELECT ROUND(AVG(CAST(acting+writing+originality+pacing+cinematography AS REAL)/25*10), 1) AS avg_rating,
            COUNT(*) AS rating_count
     FROM movie_ratings WHERE media_id = ?`
  ).get(req.params.id);
  res.json({ ...movie, ...stats });
});

// --- TV Shows ---
router.get('/tv-shows', (req, res) => {
  if (typeof db.syncImportedTvShows === 'function') {
    db.syncImportedTvShows();
  }

  const { search, genre, sort } = req.query;
  const page     = normalizePage(req.query.page, 1);
  const pageSize = normalizePageSize(req.query.page_size, 48, 100);
  const offset   = (page - 1) * pageSize;
  const params   = [];

  let innerWhere = 'WHERE source_key IS NOT NULL';
  if (search) { innerWhere += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { innerWhere += ' AND genre LIKE ?';  params.push(`%${genre}%`); }

  const orderBy = sort === 'year-desc' ? 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year DESC, title ASC'
                : sort === 'year-asc'  ? 'CASE WHEN year IS NULL THEN 1 ELSE 0 END, year ASC, title ASC'
                : sort === 'title-desc'? 'title DESC'
                : 'title ASC';

  const dedupeBase = `
    SELECT t.*
    FROM tv_shows t
    INNER JOIN (
      SELECT
        MIN(CASE WHEN source_key LIKE 'tmdb:%' THEN id END) AS tmdb_id,
        MIN(id) AS any_id
      FROM tv_shows
      ${innerWhere}
      GROUP BY LOWER(TRIM(title))
    ) dedup ON t.id = COALESCE(dedup.tmdb_id, dedup.any_id)
    ${innerWhere}
  `;

  const countParams = [...params, ...params];
  const total = db.prepare(`SELECT COUNT(*) as n FROM (${dedupeBase})`).get(...countParams)?.n || 0;
  const items = db.prepare(`${dedupeBase} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...countParams, pageSize, offset);
  const genres = buildMediaGenreFacets(
    db.prepare(`
      SELECT DISTINCT genre
      FROM tv_shows
      WHERE source_key IS NOT NULL
        AND genre IS NOT NULL
        AND TRIM(genre) <> ''
    `).all().map((row) => row.genre)
  );

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    facets: { genres },
  });
});

router.get('/tv-shows/:id', (req, res) => {
  if (typeof db.syncImportedTvShows === 'function') {
    db.syncImportedTvShows();
  }

  const show = db
    .prepare('SELECT * FROM tv_shows WHERE id = ? AND source_key IS NOT NULL')
    .get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    `SELECT ROUND(AVG(CAST(premise+originality+acting+cinematography+writing+pacing+resonance AS REAL)/38*10), 1) AS avg_rating,
            COUNT(*) AS rating_count
     FROM tv_show_ratings WHERE media_id = ?`
  ).get(req.params.id);
  res.json({ ...show, ...stats });
});

// --- Books ---
router.get('/books', (req, res) => {
  if (typeof db.syncImportedBooks === 'function') {
    db.syncImportedBooks();
  }

  const { search, genre, min_year: minYear, sort } = req.query;
  const page = normalizePage(req.query.page, 1);
  const pageSize = normalizePageSize(req.query.page_size, 24);
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE source_key IS NOT NULL';
  const params = [];
  if (search) {
    whereClause += ' AND (title LIKE ? OR author LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (minYear) {
    whereClause += ' AND (year IS NULL OR year >= ?)';
    params.push(Number(minYear));
  }

  const itemsQuery = `SELECT * FROM books ${whereClause}`;
  const facetsQuery = `
    SELECT
      MIN(year) AS min_year,
      MAX(year) AS max_year
    FROM books
    WHERE year IS NOT NULL
  `;
  const genresQuery = `
    SELECT DISTINCT genre
    FROM books
    WHERE genre IS NOT NULL AND TRIM(genre) <> ''
    ORDER BY genre ASC
  `;

  const allItems = db.prepare(itemsQuery).all(...params);
  const filteredItems = genre
    ? allItems.filter((book) => matchesBookGenreFacet(book.genre, genre))
    : allItems;
  const sortedItems = filteredItems.sort((left, right) => {
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

    return left.title.localeCompare(right.title);
  });
  const total = sortedItems.length;
  const items = sortedItems.slice(offset, offset + pageSize);
  const facets = db.prepare(facetsQuery).get();
  const genres = buildBookGenreFacets(db.prepare(genresQuery).all().map((row) => row.genre));

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: {
      genres,
      minYear: facets?.min_year ?? null,
      maxYear: facets?.max_year ?? null,
    },
  });
});

router.get('/books/:id', (req, res) => {
  if (typeof db.syncImportedBooks === 'function') {
    db.syncImportedBooks();
  }

  const book = db
    .prepare('SELECT * FROM books WHERE id = ? AND source_key IS NOT NULL')
    .get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    `SELECT ROUND(AVG(CAST(prose+plot+characters+originality+pacing+resonance AS REAL)/32*10), 1) AS avg_rating,
            COUNT(*) AS rating_count
     FROM book_ratings WHERE media_id = ?`
  ).get(req.params.id);
  res.json({ ...book, ...stats });
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

// ─── Episode progress tracking ────────────────────────────────────────────────
// Mark episode as watched
router.post('/episode-progress', requireAuth, (req, res) => {
  const { media_id, season, episode } = req.body;
  if (!media_id || !season || !episode) {
    return res.status(400).json({ error: 'media_id, season, episode required' });
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS episode_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        media_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, media_id, season, episode)
      )
    `);
    db.prepare(`
      INSERT OR REPLACE INTO episode_progress (user_id, media_id, season, episode, watched_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(req.user.id, Number(media_id), Number(season), Number(episode));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all watched episodes for a show
router.get('/episode-progress/:mediaId', requireAuth, (req, res) => {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS episode_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        media_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, media_id, season, episode)
      )
    `);
    const rows = db.prepare(`
      SELECT season, episode, watched_at FROM episode_progress
      WHERE user_id = ? AND media_id = ?
      ORDER BY watched_at DESC
    `).all(req.user.id, Number(req.params.mediaId));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unmark episode as watched
router.delete('/episode-progress', requireAuth, (req, res) => {
  const { media_id, season, episode } = req.body;
  try {
    db.prepare(`
      DELETE FROM episode_progress WHERE user_id = ? AND media_id = ? AND season = ? AND episode = ?
    `).run(req.user.id, Number(media_id), Number(season), Number(episode));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

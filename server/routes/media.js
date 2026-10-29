const express = require('express');
const neonDb = require('../neonDb');
const { requireAuth } = require('../middleware/auth');
const { serviceClient } = require('../middleware/supabaseAdmin');
const { episodes } = require('./supabaseUserData');
const { fetchPopularTitlesFromTrakt } = require('../utils/traktRelevance');
const { normalizeEmbedId, lookupImdbId } = require('../utils/imdbLookup');
const { getCuratedMovieRowsNeon, getCuratedTvRowsNeon, getCuratedBookRowsNeon } = require('../utils/curatedRows');

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

function normalizePage(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizePageSize(value, fallback = 24, max = 60) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
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

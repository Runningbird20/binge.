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
  const params = [];

  // Deduplicate by title+year — prefer TMDB over Plex for same title
  // Uses MIN(id) on TMDB records when available, otherwise Plex
  let whereClause = 'WHERE source_key IS NOT NULL';
  if (search) { whereClause += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { whereClause += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  if (year)   { whereClause += ' AND year = ?';       params.push(Number(year)); }

  const dedupeQuery = `
    SELECT m.*
    FROM movies m
    INNER JOIN (
      SELECT
        LOWER(TRIM(title)) AS norm_title,
        COALESCE(year, 0) AS norm_year,
        -- Prefer TMDB source keys, fall back to min id
        MIN(CASE WHEN source_key LIKE 'tmdb:%' THEN id END) AS tmdb_id,
        MIN(id) AS any_id
      FROM movies
      WHERE source_key IS NOT NULL
      GROUP BY LOWER(TRIM(title)), COALESCE(year, 0)
    ) dedup ON m.id = COALESCE(dedup.tmdb_id, dedup.any_id)
    ${whereClause}
  `;
  const items = sortMediaItems(db.prepare(dedupeQuery).all(...params), sort);
  const genres = buildMediaGenreFacets(
    db.prepare(`
      SELECT DISTINCT genre
      FROM movies
      WHERE source_key IS NOT NULL
        AND genre IS NOT NULL
        AND TRIM(genre) <> ''
    `).all().map((row) => row.genre)
  );

  res.json({
    items,
    facets: {
      genres,
    },
  });
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
  const params = [];

  let whereClause = 'WHERE source_key IS NOT NULL';
  if (search) { whereClause += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { whereClause += ' AND genre LIKE ?';  params.push(`%${genre}%`); }

  const dedupeQuery = `
    SELECT t.*
    FROM tv_shows t
    INNER JOIN (
      SELECT
        LOWER(TRIM(title)) AS norm_title,
        MIN(CASE WHEN source_key LIKE 'tmdb:%' THEN id END) AS tmdb_id,
        MIN(id) AS any_id
      FROM tv_shows
      WHERE source_key IS NOT NULL
      GROUP BY LOWER(TRIM(title))
    ) dedup ON t.id = COALESCE(dedup.tmdb_id, dedup.any_id)
    ${whereClause}
  `;
  const items = sortMediaItems(db.prepare(dedupeQuery).all(...params), sort);
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
    facets: {
      genres,
    },
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
router.get('/tmdb-season', async (req, res) => {
  const { tmdbId, season } = req.query;
  if (!tmdbId || !season) return res.status(400).json({ error: 'tmdbId and season required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not set' });

  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(502).json({ error: 'TMDB error' });
    const data = await r.json();
    res.json({
      season: data.season_number,
      episodeCount: data.episodes?.length || 0,
      episodes: (data.episodes || []).map(e => ({
        number: e.episode_number,
        name: e.name,
        airDate: e.air_date,
      })),
    });
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

// ─── Book download proxy ──────────────────────────────────────────────────────
// Streams the file from Internet Archive directly to the user — no redirect
router.get('/book-download', async (req, res) => {
  const { identifier, format } = req.query;

  if (!identifier) return res.status(400).json({ error: 'identifier required' });

  // Only allow safe formats
  const allowedFormats = ['pdf', 'epub', 'txt'];
  const fmt = allowedFormats.includes(format) ? format : 'pdf';

  // Internet Archive direct download URL
  // They store files as: /download/{identifier}/{identifier}.{ext}
  const url = `https://archive.org/download/${identifier}/${identifier}.${fmt}`;

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; binge-app/1.0)' },
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      // Try alternate filename pattern (some books use different names)
      const altUrl = `https://archive.org/download/${identifier}`;
      const listRes = await fetch(`https://archive.org/metadata/${identifier}/files`, {
        signal: AbortSignal.timeout(8000),
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        const files = listData.result || [];
        // Find a downloadable file in preferred format order
        const preferred = ['pdf', 'epub', 'txt'];
        let match = null;
        for (const ext of preferred) {
          match = files.find(f => f.name?.toLowerCase().endsWith(`.${ext}`) && f.source !== 'derivative');
          if (match) break;
        }
        if (!match) {
          match = files.find(f =>
            ['.pdf', '.epub', '.txt'].some(ext => f.name?.toLowerCase().endsWith(ext))
          );
        }

        if (match) {
          const fileUrl = `https://archive.org/download/${identifier}/${match.name}`;
          const fileRes = await fetch(fileUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; binge-app/1.0)' },
            signal: AbortSignal.timeout(30000),
          });

          if (fileRes.ok) {
            const ext = match.name.split('.').pop().toLowerCase();
            const contentTypes = {
              pdf:  'application/pdf',
              epub: 'application/epub+zip',
              txt:  'text/plain',
            };
            res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${match.name}"`);
            if (fileRes.headers.get('content-length')) {
              res.setHeader('Content-Length', fileRes.headers.get('content-length'));
            }
            fileRes.body.pipeTo(new WritableStream({
              write(chunk) { res.write(chunk); },
              close() { res.end(); },
              abort(err) { res.destroy(err); },
            }));
            return;
          }
        }
      }

      return res.status(404).json({ error: 'No downloadable file found for this book.' });
    }

    // Stream the file directly to the client
    const ext = fmt;
    const contentTypes = {
      pdf:  'application/pdf',
      epub: 'application/epub+zip',
      txt:  'text/plain',
    };
    const safeFilename = identifier.replace(/[^a-z0-9\-_]/gi, '_');
    res.setHeader('Content-Type', contentTypes[ext]);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.${ext}"`);
    if (upstream.headers.get('content-length')) {
      res.setHeader('Content-Length', upstream.headers.get('content-length'));
    }

    upstream.body.pipeTo(new WritableStream({
      write(chunk) { res.write(chunk); },
      close() { res.end(); },
      abort(err) { res.destroy(err); },
    }));

  } catch (err) {
    console.error('Book download error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed: ' + err.message });
    }
  }
});

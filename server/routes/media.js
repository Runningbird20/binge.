const express = require('express');
const db = require('../db');
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

// --- Movies ---
router.get('/movies', (req, res) => {
  if (typeof db.syncImportedMovies === 'function') {
    db.syncImportedMovies();
  }

  const { search, genre, year, sort } = req.query;
  let query = 'SELECT * FROM movies WHERE source_key IS NOT NULL';
  const params = [];
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  if (year)   { query += ' AND year = ?';       params.push(Number(year)); }
  const items = sortMediaItems(db.prepare(query).all(...params), sort);
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
  let query = 'SELECT * FROM tv_shows WHERE source_key IS NOT NULL';
  const params = [];
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  const items = sortMediaItems(db.prepare(query).all(...params), sort);
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

module.exports = router;

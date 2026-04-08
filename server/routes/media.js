const express = require('express');
const db = require('../db');

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

function getBookSortClause(sort) {
  if (sort === 'year-desc') {
    return 'year IS NULL ASC, year DESC, title ASC';
  }

  if (sort === 'year-asc') {
    return 'year IS NULL ASC, year ASC, title ASC';
  }

  return 'title ASC';
}

// --- Movies ---
router.get('/movies', (req, res) => {
  if (typeof db.syncImportedMovies === 'function') {
    db.syncImportedMovies();
  }

  const { search, genre, year } = req.query;
  let query = 'SELECT * FROM movies WHERE 1=1';
  const params = [];
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  if (year)   { query += ' AND year = ?';       params.push(Number(year)); }
  query += ' ORDER BY title ASC';
  res.json(db.prepare(query).all(...params));
});

router.get('/movies/:id', (req, res) => {
  if (typeof db.syncImportedMovies === 'function') {
    db.syncImportedMovies();
  }

  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE media_type = ? AND media_id = ?'
  ).get('movie', req.params.id);
  res.json({ ...movie, ...stats });
});

// --- TV Shows ---
router.get('/tv-shows', (req, res) => {
  if (typeof db.syncImportedTvShows === 'function') {
    db.syncImportedTvShows();
  }

  const { search, genre } = req.query;
  let query = 'SELECT * FROM tv_shows WHERE 1=1';
  const params = [];
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  query += ' ORDER BY title ASC';
  res.json(db.prepare(query).all(...params));
});

router.get('/tv-shows/:id', (req, res) => {
  if (typeof db.syncImportedTvShows === 'function') {
    db.syncImportedTvShows();
  }

  const show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE media_type = ? AND media_id = ?'
  ).get('tv_show', req.params.id);
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

  let whereClause = 'WHERE 1=1';
  const params = [];
  if (search) {
    whereClause += ' AND (title LIKE ? OR author LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (genre) {
    whereClause += ' AND genre = ?';
    params.push(genre);
  }
  if (minYear) {
    whereClause += ' AND (year IS NULL OR year >= ?)';
    params.push(Number(minYear));
  }

  const itemsQuery = `
    SELECT *
    FROM books
    ${whereClause}
    ORDER BY ${getBookSortClause(sort)}
    LIMIT ? OFFSET ?
  `;
  const totalQuery = `SELECT COUNT(*) AS total FROM books ${whereClause}`;
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

  const total = db.prepare(totalQuery).get(...params).total;
  const items = db.prepare(itemsQuery).all(...params, pageSize, offset);
  const facets = db.prepare(facetsQuery).get();
  const genres = db.prepare(genresQuery).all().map((row) => row.genre);

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

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE media_type = ? AND media_id = ?'
  ).get('book', req.params.id);
  res.json({ ...book, ...stats });
});

module.exports = router;

const express = require('express');
const router  = express.Router();
const db      = require('../db');
let _sbCreateClient = null;
function getCreateClient() {
  if (!_sbCreateClient) {
    try { _sbCreateClient = require('@supabase/supabase-js').createClient; }
    catch (e) { throw new Error('supabase-js not installed. Run: npm install'); }
  }
  return _sbCreateClient;
}

function getSb() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return getCreateClient()(url, key);
}

// Strip punctuation and lowercase — used for the SQLite column-normalised search.
// REPLACE(REPLACE(REPLACE(LOWER(col), '''', ''), '-', ''), '.', '') covers
// apostrophes, hyphens, and dots so "jojos" matches "JoJo's".
function normalizedCol(col) {
  return `REPLACE(REPLACE(REPLACE(LOWER(${col}), '''', ''), '-', ''), '.', '')`;
}

function buildSqlitePattern(raw) {
  // Strip all non-alphanumeric except spaces, lowercase
  return `%${raw.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '%')}%`;
}

// GET /search?q=query&types=movies,tv,books,people
router.get('/', async (req, res) => {
  const { q = '', types = 'movies,tv,books,people' } = req.query;
  if (!q.trim() || q.length < 2) return res.json({ movies: [], tv: [], books: [], people: [] });

  const typeArr    = types.split(',');
  const results    = { movies: [], tv: [], books: [], people: [] };
  const exactPat   = `%${q.trim()}%`;           // original (case-insensitive via SQLite)
  const fuzzyPat   = buildSqlitePattern(q);     // punctuation-stripped
  const limit      = 8;

  try {
    // SQLite: movies, tv, books
    // Two conditions per field: exact LIKE and normalised LIKE (strips apostrophes etc.)
    const mediaWhere = (titleCol, secondCol) =>
      `(${titleCol} LIKE ? OR ${normalizedCol(titleCol)} LIKE ?` +
      ` OR ${secondCol} LIKE ? OR ${normalizedCol(secondCol)} LIKE ?)`;

    if (typeArr.includes('movies')) {
      results.movies = db.prepare(
        `SELECT id, title, year, genre, poster_url, source_key FROM movies
         WHERE ${mediaWhere('title', 'genre')} AND source_key IS NOT NULL
         ORDER BY year DESC NULLS LAST LIMIT ?`
      ).all(exactPat, fuzzyPat, exactPat, fuzzyPat, limit);
    }
    if (typeArr.includes('tv')) {
      results.tv = db.prepare(
        `SELECT id, title, year, genre, poster_url, source_key FROM tv_shows
         WHERE ${mediaWhere('title', 'genre')} AND source_key IS NOT NULL
         ORDER BY year DESC NULLS LAST LIMIT ?`
      ).all(exactPat, fuzzyPat, exactPat, fuzzyPat, limit);
    }
    if (typeArr.includes('books')) {
      results.books = db.prepare(
        `SELECT id, title, author, year, genre, cover_url, source_key FROM books
         WHERE ${mediaWhere('title', 'author')} AND source_key IS NOT NULL
         ORDER BY year DESC NULLS LAST LIMIT ?`
      ).all(exactPat, fuzzyPat, exactPat, fuzzyPat, limit);
    }

    // Supabase: people
    const sb = getSb();
    if (sb) {
      if (typeArr.includes('people')) {
        const { data: people } = await sb.from('profiles').select('id, username, avatar_url, bio')
          .ilike('username', exactPat).limit(limit);
        results.people = people || [];
      }
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

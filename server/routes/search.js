const express = require('express');
const router  = express.Router();
const neonDb  = require('../neonDb');
let _sbCreateClient = null;
function getCreateClient() {
  if (!_sbCreateClient) {
    try { _sbCreateClient = require('../data-access/client').createHybridClient; }
    catch (e) { throw new Error('supabase-js not installed. Run: npm install'); }
  }
  return _sbCreateClient;
}

function getSb() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return getCreateClient()(url, key);
}

// GET /search?q=query&types=movies,tv,books,people
router.get('/', async (req, res) => {
  const { q = '', types = 'movies,tv,books,people' } = req.query;
  if (!q.trim() || q.length < 2) return res.json({ movies: [], tv: [], books: [], people: [] });

  const typeArr    = types.split(',');
  const results    = { movies: [], tv: [], books: [], people: [] };
  const exactPat   = `%${q.trim()}%`;
  const limit      = 8;

  try {
    const tasks = [];
    if (typeArr.includes('movies')) {
      tasks.push(
        neonDb.query(`
          SELECT id, title, year, genre, poster_url, source_key
          FROM movies
          WHERE source_key IS NOT NULL AND (title ILIKE $1 OR genre ILIKE $1)
          ORDER BY year DESC NULLS LAST LIMIT $2
        `, [exactPat, limit]).then((r) => {
          results.movies = r.rows.map((row) => ({ ...row, id: Number(row.id) }));
        })
      );
    }
    if (typeArr.includes('tv')) {
      tasks.push(
        neonDb.query(`
          SELECT id, title, year, genre, poster_url, source_key
          FROM tv_shows
          WHERE source_key IS NOT NULL AND (title ILIKE $1 OR genre ILIKE $1)
          ORDER BY year DESC NULLS LAST LIMIT $2
        `, [exactPat, limit]).then((r) => {
          results.tv = r.rows.map((row) => ({ ...row, id: Number(row.id) }));
        })
      );
    }
    if (typeArr.includes('books')) {
      tasks.push(
        neonDb.query(`
          SELECT id, title, author, year, genre, cover_url, source_key
          FROM books
          WHERE source_key IS NOT NULL AND (title ILIKE $1 OR author ILIKE $1)
          ORDER BY year DESC NULLS LAST LIMIT $2
        `, [exactPat, limit]).then((r) => {
          results.books = r.rows.map((row) => ({ ...row, id: Number(row.id) }));
        })
      );
    }
    // Profiles are account data, so people come from Supabase.
    const sb = typeArr.includes('people') ? getSb() : null;
    if (sb) {
      tasks.push(
        Promise.resolve(sb.from('profiles').select('id, username, avatar_url, bio')
          .ilike('username', exactPat).limit(limit))
          .then(({ data }) => { results.people = data || []; })
          .catch(() => { results.people = []; })
      );
    }
    await Promise.all(tasks);
    return res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

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

// GET /search?q=query&types=movies,tv,books,forums,people
router.get('/', async (req, res) => {
  const { q = '', types = 'movies,tv,books,forums,people' } = req.query;
  if (!q.trim() || q.length < 2) return res.json({ movies: [], tv: [], books: [], forums: [], posts: [], people: [] });

  const typeArr = types.split(',');
  const results = { movies: [], tv: [], books: [], forums: [], posts: [], people: [] };
  const query   = `%${q.trim()}%`;
  const limit   = 8;

  try {
    // SQLite: movies, tv, books
    if (typeArr.includes('movies')) {
      results.movies = db.prepare(
        `SELECT id, title, year, genre, poster_url, source_key FROM movies
         WHERE (title LIKE ? OR genre LIKE ?) AND source_key IS NOT NULL
         ORDER BY year DESC NULLS LAST LIMIT ?`
      ).all(query, query, limit);
    }
    if (typeArr.includes('tv')) {
      results.tv = db.prepare(
        `SELECT id, title, year, genre, poster_url, source_key FROM tv_shows
         WHERE (title LIKE ? OR genre LIKE ?) AND source_key IS NOT NULL
         ORDER BY year DESC NULLS LAST LIMIT ?`
      ).all(query, query, limit);
    }
    if (typeArr.includes('books')) {
      results.books = db.prepare(
        `SELECT id, title, author, year, genre, cover_url, source_key FROM books
         WHERE (title LIKE ? OR author LIKE ?) AND source_key IS NOT NULL
         ORDER BY year DESC NULLS LAST LIMIT ?`
      ).all(query, query, limit);
    }

    // Supabase: forums, posts, people
    const sb = getSb();
    if (sb) {
      if (typeArr.includes('forums')) {
        const { data: forums } = await sb.from('forums').select('id, name, slug, icon, description, member_count')
          .ilike('name', query).limit(limit);
        results.forums = forums || [];
      }
      if (typeArr.includes('forums')) {
        const { data: posts } = await sb.from('posts').select('id, title, flair, score, comment_count, created_at, forums(name, slug, icon)')
          .ilike('title', query).eq('is_removed', false).order('score', { ascending: false }).limit(limit);
        results.posts = posts || [];
      }
      if (typeArr.includes('people')) {
        const { data: people } = await sb.from('profiles').select('id, username, avatar_url, bio')
          .ilike('username', query).limit(limit);
        results.people = people || [];
      }
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

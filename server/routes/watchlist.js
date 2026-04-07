const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { media_type, status } = req.query;
  let query = 
    SELECT w.*,
      CASE w.media_type
        WHEN 'movie'   THEN (SELECT title FROM movies   WHERE id = w.media_id)
        WHEN 'tv_show' THEN (SELECT title FROM tv_shows WHERE id = w.media_id)
        WHEN 'book'    THEN (SELECT title FROM books    WHERE id = w.media_id)
      END AS title,
      CASE w.media_type
        WHEN 'movie'   THEN (SELECT poster_url FROM movies   WHERE id = w.media_id)
        WHEN 'tv_show' THEN (SELECT poster_url FROM tv_shows WHERE id = w.media_id)
        WHEN 'book'    THEN (SELECT cover_url  FROM books    WHERE id = w.media_id)
      END AS image_url,
      CASE w.media_type
        WHEN 'movie'   THEN (SELECT year FROM movies   WHERE id = w.media_id)
        WHEN 'tv_show' THEN (SELECT year FROM tv_shows WHERE id = w.media_id)
        WHEN 'book'    THEN (SELECT year FROM books    WHERE id = w.media_id)
      END AS year
    FROM watchlist w
    WHERE w.user_id = ?
  `;
  const params = [req.user.id];
  if (media_type) { query += ' AND w.media_type = ?'; params.push(media_type); }
  if (status)     { query += ' AND w.status = ?';     params.push(status); }
  query += ' ORDER BY w.added_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.post('/', (req, res) => {
  const { media_type, media_id, status = 'plan_to_watch' } = req.body;
  if (!media_type || !media_id) {
    return res.status(400).json({ error: 'media_type and media_id are required' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO watchlist (user_id, media_type, media_id, status) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, media_type, Number(media_id), status);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Already in watchlist' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', (req, res) => {
  const { status } = req.body;
  const item = db.prepare(
    'SELECT * FROM watchlist WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE watchlist SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const item = db.prepare(
    'SELECT * FROM watchlist WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM watchlist WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

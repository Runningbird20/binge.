const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { media_type, status } = req.query;
  let query = `
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

// Update progress — MUST be before /:id route or Express swallows it
router.patch('/progress', (req, res) => {
  const { media_type, media_id, current_season, current_episode, current_page, current_chapter, status, notes } = req.body;
  if (!media_type || !media_id) return res.status(400).json({ error: 'media_type and media_id required' });

  try {
    // Auto-add to watchlist if not already there
    db.prepare(`
      INSERT OR IGNORE INTO watchlist (user_id, media_type, media_id, status)
      VALUES (?, ?, ?, 'watching')
    `).run(req.user.id, media_type, Number(media_id));

    const fields = [];
    const params = [];

    if (current_season  !== undefined) { fields.push('current_season = ?');  params.push(Number(current_season)); }
    if (current_episode !== undefined) { fields.push('current_episode = ?'); params.push(Number(current_episode)); }
    if (current_page    !== undefined) { fields.push('current_page = ?');    params.push(Number(current_page)); }
    if (current_chapter !== undefined) { fields.push('current_chapter = ?'); params.push(String(current_chapter)); }
    if (status          !== undefined) { fields.push('status = ?');          params.push(String(status)); }
    if (notes           !== undefined) { fields.push('notes = ?');           params.push(String(notes)); }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    if (status === 'completed') fields.push('completed_at = CURRENT_TIMESTAMP');

    if (fields.length > 0) {
      params.push(req.user.id, media_type, Number(media_id));
      db.prepare(`
        UPDATE watchlist SET ${fields.join(', ')}
        WHERE user_id = ? AND media_type = ? AND media_id = ?
      `).run(...params);
    }

    const item = db.prepare('SELECT * FROM watchlist WHERE user_id = ? AND media_type = ? AND media_id = ?')
      .get(req.user.id, media_type, Number(media_id));
    res.json(item || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-add to watchlist (upsert — won't duplicate)
router.post('/auto-add', (req, res) => {
  const { media_type, media_id, status = 'watching' } = req.body;
  if (!media_type || !media_id) return res.status(400).json({ error: 'media_type and media_id required' });
  try {
    db.prepare(`
      INSERT OR IGNORE INTO watchlist (user_id, media_type, media_id, status)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, media_type, Number(media_id), status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

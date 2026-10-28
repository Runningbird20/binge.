const express = require('express');
const db = require('../db');
const neonDb = require('../neonDb');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use((req,res,next) => process.env.REACT_APP_AUTH_PROVIDER !== 'neon' ? require('./supabaseUserData').watchlist(req,res,next) : next());

router.get('/', async (req, res) => {
  const { media_type, status } = req.query;

  if (neonDb.isConfigured()) {
    try {
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
        WHERE w.user_id = $1
      `;
      const params = [req.user.id];
      let pIdx = 2;
      if (media_type) { query += ` AND w.media_type = $${pIdx++}`; params.push(media_type); }
      if (status)     { query += ` AND w.status = $${pIdx++}`;     params.push(status); }
      query += ' ORDER BY w.added_at DESC';
      const result = await neonDb.query(query, params);
      return res.json(result.rows);
    } catch (err) {
      console.warn('Neon watchlist GET error, falling back:', err.message);
    }
  }

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
  try {
    res.json(db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { media_type, media_id, status = 'plan_to_watch' } = req.body;
  if (!media_type || !media_id) {
    return res.status(400).json({ error: 'media_type and media_id are required' });
  }

  if (neonDb.isConfigured()) {
    try {
      const parsedId = Number(media_id) || 0;
      const existing = await neonDb.query(
        'SELECT id FROM watchlist WHERE user_id = $1 AND media_type = $2 AND media_id = $3',
        [req.user.id, media_type, parsedId]
      );
      if (existing.rows.length > 0) {
        await neonDb.query(
          'UPDATE watchlist SET status = $1, updated_at = NOW() WHERE id = $2',
          [status, existing.rows[0].id]
        );
        return res.status(200).json({ id: existing.rows[0].id });
      }

      const insertRes = await neonDb.query(
        'INSERT INTO watchlist (user_id, media_type, media_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [req.user.id, media_type, parsedId, status]
      );
      return res.status(201).json({ id: insertRes.rows[0]?.id });
    } catch (err) {
      if (err.message?.includes('duplicate key') || err.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Already in watchlist' });
      }
      console.warn('Neon watchlist POST error, falling back:', err.message);
    }
  }

  try {
    const result = db.prepare(
      'INSERT INTO watchlist (user_id, media_type, media_id, status) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, media_type, Number(media_id) || 0, status);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Already in watchlist' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update progress — MUST be before /:id route or Express swallows it
router.patch('/progress', async (req, res) => {
  const { media_type, media_id, current_season, current_episode, current_page, current_chapter, status, notes } = req.body;
  if (!media_type || !media_id) return res.status(400).json({ error: 'media_type and media_id required' });

  if (neonDb.isConfigured()) {
    try {
      const parsedId = Number(media_id) || 0;
      const existing = await neonDb.query(
        'SELECT id FROM watchlist WHERE user_id = $1 AND media_type = $2 AND media_id = $3',
        [req.user.id, media_type, parsedId]
      );

      if (existing.rows.length === 0) {
        await neonDb.query(
          "INSERT INTO watchlist (user_id, media_type, media_id, status) VALUES ($1, $2, $3, 'watching')",
          [req.user.id, media_type, parsedId]
        );
      }

      const fields = [];
      const params = [req.user.id, media_type, parsedId];
      let pIdx = 4;

      if (current_season  !== undefined) { fields.push(`current_season = $${pIdx++}`);  params.push(Number(current_season)); }
      if (current_episode !== undefined) { fields.push(`current_episode = $${pIdx++}`); params.push(Number(current_episode)); }
      if (current_page    !== undefined) { fields.push(`current_page = $${pIdx++}`);    params.push(Number(current_page)); }
      if (current_chapter !== undefined) { fields.push(`current_chapter = $${pIdx++}`); params.push(String(current_chapter)); }
      if (status          !== undefined) { fields.push(`status = $${pIdx++}`);          params.push(String(status)); }
      if (notes           !== undefined) { fields.push(`notes = $${pIdx++}`);           params.push(String(notes)); }

      fields.push('updated_at = NOW()');
      if (status === 'completed') fields.push('completed_at = NOW()');

      if (fields.length > 0) {
        await neonDb.query(
          `UPDATE watchlist SET ${fields.join(', ')} WHERE user_id = $1 AND media_type = $2 AND media_id = $3`,
          params
        );
      }

      const item = await neonDb.query(
        'SELECT * FROM watchlist WHERE user_id = $1 AND media_type = $2 AND media_id = $3',
        [req.user.id, media_type, parsedId]
      );
      return res.json(item.rows[0] || { success: true });
    } catch (err) {
      console.warn('Neon watchlist progress error, falling back:', err.message);
    }
  }

  try {
    // Auto-add to watchlist if not already there
    db.prepare(`
      INSERT OR IGNORE INTO watchlist (user_id, media_type, media_id, status)
      VALUES (?, ?, ?, 'watching')
    `).run(req.user.id, media_type, Number(media_id) || 0);

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
      params.push(req.user.id, media_type, Number(media_id) || 0);
      db.prepare(`
        UPDATE watchlist SET ${fields.join(', ')}
        WHERE user_id = ? AND media_type = ? AND media_id = ?
      `).run(...params);
    }

    const item = db.prepare('SELECT * FROM watchlist WHERE user_id = ? AND media_type = ? AND media_id = ?')
      .get(req.user.id, media_type, Number(media_id) || 0);
    res.json(item || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-add to watchlist (upsert — won't duplicate)
router.post('/auto-add', async (req, res) => {
  const { media_type, media_id, status = 'watching' } = req.body;
  if (!media_type || !media_id) return res.status(400).json({ error: 'media_type and media_id required' });

  if (neonDb.isConfigured()) {
    try {
      const parsedId = Number(media_id) || 0;
      const existing = await neonDb.query(
        'SELECT id FROM watchlist WHERE user_id = $1 AND media_type = $2 AND media_id = $3',
        [req.user.id, media_type, parsedId]
      );
      if (existing.rows.length === 0) {
        await neonDb.query(
          'INSERT INTO watchlist (user_id, media_type, media_id, status) VALUES ($1, $2, $3, $4)',
          [req.user.id, media_type, parsedId, status]
        );
      }
      return res.json({ success: true });
    } catch (err) {
      console.warn('Neon auto-add error, falling back:', err.message);
    }
  }

  try {
    db.prepare(`
      INSERT OR IGNORE INTO watchlist (user_id, media_type, media_id, status)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, media_type, Number(media_id) || 0, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const { status } = req.body;

  if (neonDb.isConfigured()) {
    try {
      const check = await neonDb.query('SELECT * FROM watchlist WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      await neonDb.query('UPDATE watchlist SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      console.warn('Neon watchlist PATCH error, falling back:', err.message);
    }
  }

  const item = db.prepare(
    'SELECT * FROM watchlist WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE watchlist SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  if (neonDb.isConfigured()) {
    try {
      const check = await neonDb.query('SELECT * FROM watchlist WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      await neonDb.query('DELETE FROM watchlist WHERE id = $1', [req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      console.warn('Neon watchlist DELETE error, falling back:', err.message);
    }
  }

  const item = db.prepare(
    'SELECT * FROM watchlist WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM watchlist WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

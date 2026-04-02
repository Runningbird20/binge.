const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/my', (req, res) => {
  const { media_type } = req.query;
  let query = 'SELECT * FROM ratings WHERE user_id = ?';
  const params = [req.user.id];
  if (media_type) { query += ' AND media_type = ?'; params.push(media_type); }
  query += ' ORDER BY created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/:media_type/:media_id', (req, res) => {
  const { media_type, media_id } = req.params;
  const rating = db.prepare(
    'SELECT * FROM ratings WHERE user_id = ? AND media_type = ? AND media_id = ?'
  ).get(req.user.id, media_type, Number(media_id));
  res.json(rating || null);
});

router.post('/', (req, res) => {
  const { media_type, media_id, rating, review } = req.body;
  if (!media_type || !media_id || !rating) {
    return res.status(400).json({ error: 'media_type, media_id, and rating are required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }
  try {
    db.prepare(`
      INSERT INTO ratings (user_id, media_type, media_id, rating, review)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, media_type, media_id)
      DO UPDATE SET rating = excluded.rating, review = excluded.review
    `).run(req.user.id, media_type, Number(media_id), Number(rating), review || null);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:media_type/:media_id', (req, res) => {
  db.prepare(
    'DELETE FROM ratings WHERE user_id = ? AND media_type = ? AND media_id = ?'
  ).run(req.user.id, req.params.media_type, Number(req.params.media_id));
  res.json({ success: true });
});

module.exports = router;

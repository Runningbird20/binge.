const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const SCHEMA = {
  movie: {
    table: 'movie_ratings',
    columns: ['acting', 'writing', 'originality', 'pacing', 'cinematography'],
    maxes: { acting: 5, writing: 5, originality: 5, pacing: 5, cinematography: 5 },
    totalMax: 25,
  },
  tv_show: {
    table: 'tv_show_ratings',
    columns: ['premise', 'originality', 'acting', 'cinematography', 'writing', 'pacing', 'resonance'],
    maxes: { premise: 5, originality: 5, acting: 6, cinematography: 5, writing: 6, pacing: 5, resonance: 6 },
    totalMax: 38,
  },
  book: {
    table: 'book_ratings',
    columns: ['prose', 'plot', 'characters', 'originality', 'pacing', 'resonance'],
    maxes: { prose: 5, plot: 5, characters: 6, originality: 5, pacing: 5, resonance: 6 },
    totalMax: 32,
  },
};

// GET /api/ratings/my
router.get('/my', (req, res) => {
  const { media_type } = req.query;
  const types = media_type ? [media_type] : ['movie', 'tv_show', 'book'];
  const results = [];

  const MEDIA_META = {
    movie:   { table: 'movies',   imageCol: 'poster_url' },
    tv_show: { table: 'tv_shows', imageCol: 'poster_url' },
    book:    { table: 'books',    imageCol: 'cover_url'  },
  };

  for (const type of types) {
    const schema = SCHEMA[type];
    if (!schema) continue;
    const meta = MEDIA_META[type];
    const rows = db.prepare(`
      SELECT r.*, '${type}' AS media_type,
             m.title, m.year, m.genre,
             m.${meta.imageCol} AS image_url
      FROM ${schema.table} r
      LEFT JOIN ${meta.table} m ON r.media_id = m.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);
    results.push(...rows);
  }

  res.json(results);
});

// GET /api/ratings/:media_type/:media_id
router.get('/:media_type/:media_id', (req, res) => {
  const { media_type, media_id } = req.params;
  const schema = SCHEMA[media_type];
  if (!schema) return res.status(400).json({ error: 'Invalid media_type' });

  const rating = db.prepare(
    `SELECT * FROM ${schema.table} WHERE user_id = ? AND media_id = ?`
  ).get(req.user.id, Number(media_id));

  res.json(rating || null);
});

// POST /api/ratings
router.post('/', (req, res) => {
  const { media_type, media_id, categories, review } = req.body;
  if (!media_type || !media_id || !categories) {
    return res.status(400).json({ error: 'media_type, media_id, and categories are required' });
  }

  const schema = SCHEMA[media_type];
  if (!schema) return res.status(400).json({ error: 'Invalid media_type' });

  for (const col of schema.columns) {
    const val = Number(categories[col]);
    if (!val || val < 1 || val > schema.maxes[col]) {
      return res.status(400).json({ error: `Invalid value for ${col}: must be 1–${schema.maxes[col]}` });
    }
  }

  try {
    const cols = schema.columns;
    const colList = cols.join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const updateSet = cols.map((c) => `${c} = excluded.${c}`).join(', ');
    const values = cols.map((c) => Number(categories[c]));

    db.prepare(`
      INSERT INTO ${schema.table} (user_id, media_id, ${colList}, review)
      VALUES (?, ?, ${placeholders}, ?)
      ON CONFLICT(user_id, media_id)
      DO UPDATE SET ${updateSet}, review = excluded.review
    `).run(req.user.id, Number(media_id), ...values, review || null);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/ratings/:media_type/:media_id
router.delete('/:media_type/:media_id', (req, res) => {
  const { media_type, media_id } = req.params;
  const schema = SCHEMA[media_type];
  if (!schema) return res.status(400).json({ error: 'Invalid media_type' });

  db.prepare(
    `DELETE FROM ${schema.table} WHERE user_id = ? AND media_id = ?`
  ).run(req.user.id, Number(media_id));
  res.json({ success: true });
});

module.exports = router;

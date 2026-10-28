const express = require('express');
const db = require('../db');
const neonDb = require('../neonDb');
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

const MEDIA_META = {
  movie:   { table: 'movies',   imageCol: 'poster_url' },
  tv_show: { table: 'tv_shows', imageCol: 'poster_url' },
  book:    { table: 'books',    imageCol: 'cover_url'  },
};

// GET /api/ratings/my
router.get('/my', async (req, res) => {
  const { media_type } = req.query;
  const types = media_type ? [media_type] : ['movie', 'tv_show', 'book'];
  const results = [];

  if (neonDb.isConfigured()) {
    try {
      for (const type of types) {
        const schema = SCHEMA[type];
        if (!schema) continue;
        const meta = MEDIA_META[type];
        const rows = await neonDb.query(`
          SELECT r.id, r.user_id, r.media_id, r.created_at, ${schema.columns.map((col) => `r.${col}`).join(', ')}, '${type}' AS media_type,
                 m.title, m.year, m.genre,
                 m.${meta.imageCol} AS image_url
          FROM ${schema.table} r
          LEFT JOIN ${meta.table} m ON r.media_id = m.id
          WHERE r.user_id = $1
          ORDER BY r.created_at DESC
        `, [req.user.id]);
        results.push(...rows.rows);
      }
      return res.json(results);
    } catch (err) {
      console.warn('Neon ratings /my error, falling back to SQLite:', err.message);
    }
  }

  for (const type of types) {
    const schema = SCHEMA[type];
    if (!schema) continue;
    const meta = MEDIA_META[type];
    try {
      const rows = db.prepare(`
        SELECT r.id, r.user_id, r.media_id, r.created_at, ${schema.columns.map((col) => `r.${col}`).join(', ')}, '${type}' AS media_type,
               m.title, m.year, m.genre,
               m.${meta.imageCol} AS image_url
        FROM ${schema.table} r
        LEFT JOIN ${meta.table} m ON r.media_id = m.id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
      `).all(req.user.id);
      results.push(...rows);
    } catch {
      // ignore table query errors in fallback
    }
  }

  res.json(results);
});

// GET /api/ratings/:media_type/:media_id
router.get('/:media_type/:media_id', async (req, res) => {
  const { media_type, media_id } = req.params;
  const schema = SCHEMA[media_type];
  if (!schema) return res.status(400).json({ error: 'Invalid media_type' });
  const parsedMediaId = Number(media_id) || 0;

  if (neonDb.isConfigured()) {
    try {
      const result = await neonDb.query(
        `SELECT id, user_id, media_id, created_at, ${schema.columns.join(', ')} FROM ${schema.table} WHERE user_id = $1 AND media_id = $2`,
        [req.user.id, parsedMediaId]
      );
      return res.json(result.rows[0] || null);
    } catch (err) {
      console.warn('Neon ratings GET single error, falling back:', err.message);
    }
  }

  try {
    const rating = db.prepare(
      `SELECT id, user_id, media_id, created_at, ${schema.columns.join(', ')} FROM ${schema.table} WHERE user_id = ? AND media_id = ?`
    ).get(req.user.id, parsedMediaId);
    res.json(rating || null);
  } catch {
    res.json(null);
  }
});

// POST /api/ratings
router.post('/', async (req, res) => {
  const { media_type, media_id, categories } = req.body;
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

  const parsedMediaId = Number(media_id) || 0;

  if (neonDb.isConfigured()) {
    try {
      const existing = await neonDb.query(
        `SELECT id FROM ${schema.table} WHERE user_id = $1 AND media_id = $2`,
        [req.user.id, parsedMediaId]
      );

      const cols = schema.columns;
      const values = cols.map((c) => Number(categories[c]));

      if (existing.rows.length > 0) {
        const updateSets = cols.map((col, idx) => `${col} = $${idx + 3}`);
        await neonDb.query(
          `UPDATE ${schema.table} SET ${updateSets.join(', ')} WHERE user_id = $1 AND media_id = $2`,
          [req.user.id, parsedMediaId, ...values]
        );
      } else {
        const colList = cols.join(', ');
        const placeholders = cols.map((_, idx) => `$${idx + 3}`).join(', ');
        await neonDb.query(
          `INSERT INTO ${schema.table} (user_id, media_id, ${colList})
           VALUES ($1, $2, ${placeholders})`,
          [req.user.id, parsedMediaId, ...values]
        );
      }
      return res.json({ success: true });
    } catch (err) {
      console.warn('Neon ratings POST error, falling back:', err.message);
    }
  }

  try {
    const cols = schema.columns;
    const colList = cols.join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const updateSet = cols.map((c) => `${c} = excluded.${c}`).join(', ');
    const values = cols.map((c) => Number(categories[c]));

    db.prepare(`
      INSERT INTO ${schema.table} (user_id, media_id, ${colList})
      VALUES (?, ?, ${placeholders})
      ON CONFLICT(user_id, media_id)
      DO UPDATE SET ${updateSet}
    `).run(req.user.id, parsedMediaId, ...values);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/ratings/:media_type/:media_id
router.delete('/:media_type/:media_id', async (req, res) => {
  const { media_type, media_id } = req.params;
  const schema = SCHEMA[media_type];
  if (!schema) return res.status(400).json({ error: 'Invalid media_type' });
  const parsedMediaId = Number(media_id) || 0;

  if (neonDb.isConfigured()) {
    try {
      await neonDb.query(
        `DELETE FROM ${schema.table} WHERE user_id = $1 AND media_id = $2`,
        [req.user.id, parsedMediaId]
      );
      return res.json({ success: true });
    } catch (err) {
      console.warn('Neon ratings DELETE error, falling back:', err.message);
    }
  }

  try {
    db.prepare(
      `DELETE FROM ${schema.table} WHERE user_id = ? AND media_id = ?`
    ).run(req.user.id, parsedMediaId);
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

module.exports = router;

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Submit a new media request
router.post('/', (req, res) => {
  try {
    const { title, media_type, year, reason } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!['movie', 'tv_show', 'book'].includes(media_type)) {
      return res.status(400).json({ error: 'media_type must be movie, tv_show, or book' });
    }

    // Ensure table exists (safety net for existing DBs)
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        media_type TEXT NOT NULL,
        year INTEGER,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check for duplicate pending request from this user
    const existing = db.prepare(`
      SELECT id FROM media_requests
      WHERE user_id = ? AND LOWER(title) = LOWER(?) AND media_type = ? AND status = 'pending'
    `).get(req.user.id, title.trim(), media_type);

    if (existing) {
      return res.status(409).json({ error: 'You already have a pending request for this title.' });
    }



    const result = db.prepare(`
      INSERT INTO media_requests (user_id, title, media_type, year, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, title.trim(), media_type, year ? Number(year) : null, reason?.trim() || null);

    const request = db.prepare('SELECT * FROM media_requests WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(request);
  } catch (err) {
    console.error('POST /requests error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Get current user's requests
router.get('/my', (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT * FROM media_requests WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user.id);
    res.json(requests);
  } catch (err) {
    console.error('GET /requests/my error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all requests (admin)
router.get('/admin', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT mr.*, u.username
      FROM media_requests mr
      JOIN users u ON mr.user_id = u.id
    `;
    const params = [];
    if (status) { query += ' WHERE mr.status = ?'; params.push(status); }
    query += ' ORDER BY mr.created_at DESC';
    res.json(db.prepare(query).all(...params));
  } catch (err) {
    console.error('GET /requests/admin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update request status (admin)
router.patch('/:id', (req, res) => {
  try {
    const { status, admin_note } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const existing = db.prepare('SELECT * FROM media_requests WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    db.prepare(`
      UPDATE media_requests SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, admin_note?.trim() || null, Number(req.params.id));

    res.json(db.prepare('SELECT * FROM media_requests WHERE id = ?').get(Number(req.params.id)));
  } catch (err) {
    console.error('PATCH /requests/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a request (owner only)
router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM media_requests WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    db.prepare('DELETE FROM media_requests WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /requests/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

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

// ── Ensure error_logs table exists ───────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER,
      error_type    TEXT NOT NULL DEFAULT 'unknown',
      error_message TEXT,
      context       TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
  `);
} catch { /* already exists */ }

// ── Supabase admin check ─────────────────────────────────────
async function requireAdmin(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Not signed in' }); return null; }
  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) { res.status(503).json({ error: 'Supabase not configured' }); return null; }
    const sb = getCreateClient()(url, key, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) { res.status(401).json({ error: 'Invalid session' }); return null; }
    // Check is_admin in profiles
    const sb2 = getCreateClient()(url, key); // service role for profile read
    const { data: profile } = await sb2.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) { res.status(403).json({ error: 'Admin access required' }); return null; }
    return user;
  } catch (err) { res.status(500).json({ error: err.message }); return null; }
}

// ── Helper: safe integer ──────────────────────────────────────
function safeInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

// ─────────────────────────────────────────────────────────────
// GET /admin/errors — error log
// ─────────────────────────────────────────────────────────────
router.get('/errors', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const limit = Math.min(200, Math.max(10, safeInt(req.query.limit, 50)));
  try {
    const rows  = db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?').all(limit);
    const total = db.prepare('SELECT COUNT(*) as c FROM error_logs').get().c;
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// POST /admin/errors — log an error (called internally)
// ─────────────────────────────────────────────────────────────
router.post('/errors', (req, res) => {
  const { user_id, error_type, error_message, context } = req.body;
  try {
    db.prepare('INSERT INTO error_logs (user_id, error_type, error_message, context) VALUES (?, ?, ?, ?)')
      .run(user_id || null, error_type || 'unknown', error_message || '', context || null);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// GET /admin/users — user list overview (Supabase)
// ─────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    const sb  = getCreateClient()(url, key);
    const { data, error } = await sb.from('profiles')
      .select('id, username, email, created_at, is_admin, is_public')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// PATCH /admin/users/:id/toggle-admin
// ─────────────────────────────────────────────────────────────
router.patch('/users/:id/toggle-admin', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    const sb  = getCreateClient()(url, key);
    const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', req.params.id).single();
    if (!profile) return res.status(404).json({ error: 'User not found' });
    const { data } = await sb.from('profiles').update({ is_admin: !profile.is_admin }).eq('id', req.params.id).select('id, username, is_admin').single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

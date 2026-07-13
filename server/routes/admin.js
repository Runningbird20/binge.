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

// ── Service-role client — required for auth.admin.* calls (create/delete
// users, read last sign-in). The anon/publishable key cannot do these; it
// intentionally lacks the privilege so a leaked browser key can't be used
// to delete accounts. ──────────────────────────────────────────
function requireServiceRoleClient(res) {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(503).json({
      error: 'Account creation and deletion require SUPABASE_SERVICE_ROLE_KEY to be set on the server (Supabase project settings → API → service_role key).',
    });
    return null;
  }
  return getCreateClient()(url, key);
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

    // Last sign-in lives on auth.users, not profiles — only readable via
    // the service-role admin API. Best-effort: if the service role isn't
    // configured, the list still renders, just without this column.
    let lastSignInById = {};
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { data: authList } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
        lastSignInById = Object.fromEntries(
          (authList?.users || []).map((u) => [u.id, u.last_sign_in_at || null])
        );
      } catch { /* best-effort */ }
    }

    res.json((data || []).map((row) => ({
      ...row,
      last_sign_in_at: lastSignInById[row.id] ?? null,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// POST /admin/users — create an account (service role required)
// ─────────────────────────────────────────────────────────────
router.post('/users', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const sb = requireServiceRoleClient(res); if (!sb) return;

  const email    = String(req.body?.email || '').trim().toLowerCase();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const bio      = String(req.body?.bio || '').trim();
  const makeAdmin = Boolean(req.body?.isAdmin);

  if (!email || !username) {
    return res.status(400).json({ error: 'Email and username are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // The on_auth_user_changed trigger creates the matching profiles row
    // from this metadata, so no separate insert is needed here.
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, bio, is_admin: makeAdmin },
    });
    if (error) throw error;

    res.json({
      id: data.user.id,
      email: data.user.email,
      username,
      bio,
      is_admin: makeAdmin,
      created_at: data.user.created_at,
      last_sign_in_at: null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to create the account.' });
  }
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

// ─────────────────────────────────────────────────────────────
// DELETE /admin/users/:id — permanently delete an account
// (service role required; cascades to profile/ratings/watchlist/etc.
// via `on delete cascade` foreign keys to auth.users)
// ─────────────────────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  if (req.params.id === admin.id) {
    return res.status(400).json({ error: "You can't delete your own account." });
  }
  const sb = requireServiceRoleClient(res); if (!sb) return;

  try {
    const { error } = await sb.auth.admin.deleteUser(req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to delete the account.' });
  }
});

module.exports = router;

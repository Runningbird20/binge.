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
    CREATE INDEX IF NOT EXISTS idx_chat_logs_created  ON chat_logs(created_at DESC);
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
// GET /admin/stats — overview metrics
// ─────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  try {
    const now = new Date();
    const d7  = new Date(now - 7  * 86400000).toISOString().slice(0,19);
    const d30 = new Date(now - 30 * 86400000).toISOString().slice(0,19);

    const totalQueries      = db.prepare('SELECT COUNT(*) as c FROM chat_logs').get().c;
    const queriesLast7Days  = db.prepare('SELECT COUNT(*) as c FROM chat_logs WHERE created_at >= ?').get(d7).c;
    const queriesLast30Days = db.prepare('SELECT COUNT(*) as c FROM chat_logs WHERE created_at >= ?').get(d30).c;

    // Count all registered users from Supabase profiles (not just chat users)
    let uniqueUsers = 0;
    try {
      const sbUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
      if (sbUrl && sbKey) {
        const sb2 = getCreateClient()(sbUrl, sbKey);
        const { data: profileRows } = await sb2.from('profiles').select('id').limit(5000);
        uniqueUsers = profileRows?.length ?? 0;
      }
    } catch { /* fall back to 0 */ }

    // Latency stats
    const latRow = db.prepare(`
      SELECT
        ROUND(AVG(latency_ms))  as avg_ms,
        MAX(latency_ms)         as max_ms
      FROM chat_logs WHERE latency_ms IS NOT NULL
    `).get();

    // P95 latency — sort and pick 95th percentile
    const allLatencies = db.prepare('SELECT latency_ms FROM chat_logs WHERE latency_ms IS NOT NULL ORDER BY latency_ms ASC').all().map(r => r.latency_ms);
    const p95Index = Math.floor(allLatencies.length * 0.95);
    const p95LatencyMs = allLatencies[p95Index] ?? null;

    // Errors
    const totalErrors    = db.prepare('SELECT COUNT(*) as c FROM error_logs').get().c;
    const errorsLast7Days = db.prepare('SELECT COUNT(*) as c FROM error_logs WHERE created_at >= ?').get(d7).c;

    // Intent breakdown
    const intentBreakdown = db.prepare(`
      SELECT intent, COUNT(*) as count FROM chat_logs
      WHERE created_at >= ? GROUP BY intent ORDER BY count DESC
    `).all(d30);

    // Queries per day (last 30 days)
    const queriesPerDay = db.prepare(`
      SELECT
        DATE(created_at) as day,
        COUNT(*) as count
      FROM chat_logs
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all(d30);

    // Avg latency per day
    const latencyPerDay = db.prepare(`
      SELECT
        DATE(created_at) as day,
        ROUND(AVG(latency_ms)) as avg_ms,
        MAX(latency_ms) as max_ms,
        COUNT(*) as count
      FROM chat_logs
      WHERE created_at >= ? AND latency_ms IS NOT NULL
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all(d30);

    // Success rate (queries without errors in error_logs on same minute)
    const slowQueries = db.prepare(`
      SELECT COUNT(*) as c FROM chat_logs WHERE latency_ms > 5000 AND created_at >= ?
    `).get(d30).c;

    // Top queries
    const topQueries = db.prepare(`
      SELECT query, COUNT(*) as count FROM chat_logs
      WHERE created_at >= ?
      GROUP BY LOWER(query) ORDER BY count DESC LIMIT 10
    `).all(d30);

    res.json({
      totalQueries, queriesLast7Days, queriesLast30Days, uniqueUsers,
      avgLatencyMs: latRow.avg_ms, maxLatencyMs: latRow.max_ms, p95LatencyMs,
      totalErrors, errorsLast7Days,
      intentBreakdown, queriesPerDay, latencyPerDay,
      slowQueries, topQueries,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// GET /admin/logs — paginated query log
// ─────────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const page   = Math.max(1, safeInt(req.query.page, 1));
  const limit  = Math.min(100, Math.max(5, safeInt(req.query.limit, 25)));
  const offset = (page - 1) * limit;
  const days   = safeInt(req.query.days, 30);
  const intent = req.query.intent || '';
  const since  = new Date(Date.now() - days * 86400000).toISOString().slice(0,19);

  try {
    let where = 'WHERE cl.created_at >= @since';
    const params = { since, limit, offset };
    if (intent) { where += ' AND cl.intent = @intent'; params.intent = intent; }

    const rows = db.prepare(`
      SELECT cl.id, u.username, cl.query, cl.intent,
             cl.response_length, cl.sources_count, cl.latency_ms, cl.created_at, cl.user_id
      FROM chat_logs cl
      LEFT JOIN users u ON cl.user_id = u.id
      ${where}
      ORDER BY cl.created_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    const total = db.prepare(`SELECT COUNT(*) as c FROM chat_logs cl ${where.replace('@limit','').replace('@offset','')}`).get({ since, ...(intent ? { intent } : {}) }).c;

    res.json({ rows, total, page, limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

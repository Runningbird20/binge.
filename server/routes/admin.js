const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/admin/stats — overview metrics
router.get('/stats', (req, res) => {
  try {
    const totalQueries = db.prepare('SELECT COUNT(*) as count FROM chat_logs').get();
    const last7Days = db.prepare(
      "SELECT COUNT(*) as count FROM chat_logs WHERE created_at >= datetime('now', '-7 days')"
    ).get();
    const last30Days = db.prepare(
      "SELECT COUNT(*) as count FROM chat_logs WHERE created_at >= datetime('now', '-30 days')"
    ).get();
    const latencyStats = db.prepare(
      'SELECT AVG(latency_ms) as avg, MAX(latency_ms) as max FROM chat_logs WHERE latency_ms IS NOT NULL'
    ).get();
    const intentBreakdown = db.prepare(
      "SELECT COALESCE(intent, 'unknown') as intent, COUNT(*) as count FROM chat_logs GROUP BY intent ORDER BY count DESC"
    ).all();
    const queriesPerDay = db.prepare(`
      SELECT strftime('%Y-%m-%d', created_at) as date, COUNT(*) as count
      FROM chat_logs
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY date
      ORDER BY date ASC
    `).all();
    const uniqueUsers = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM chat_logs'
    ).get();
    const totalErrors = db.prepare('SELECT COUNT(*) as count FROM chat_errors').get();
    const errorsLast7Days = db.prepare(
      "SELECT COUNT(*) as count FROM chat_errors WHERE created_at >= datetime('now', '-7 days')"
    ).get();

    // P95 latency — sorted in DB, sliced in JS
    const latencies = db.prepare(
      'SELECT latency_ms FROM chat_logs WHERE latency_ms IS NOT NULL ORDER BY latency_ms ASC'
    ).all().map(r => r.latency_ms);

    let p95LatencyMs = null;
    if (latencies.length > 0) {
      const idx = Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1);
      p95LatencyMs = latencies[idx];
    }

    res.json({
      totalQueries: totalQueries.count,
      queriesLast7Days: last7Days.count,
      queriesLast30Days: last30Days.count,
      avgLatencyMs: latencyStats.avg != null ? Math.round(latencyStats.avg) : null,
      maxLatencyMs: latencyStats.max,
      p95LatencyMs,
      uniqueUsers: uniqueUsers.count,
      totalErrors: totalErrors.count,
      errorsLast7Days: errorsLast7Days.count,
      intentBreakdown,
      queriesPerDay,
    });
  } catch (err) {
    console.error('GET /admin/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/logs — paginated chat logs
router.get('/logs', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const intent = req.query.intent?.trim() || null;
    const rawDays = parseInt(req.query.days, 10);
    const days = (!isNaN(rawDays) && rawDays > 0 && rawDays <= 365) ? rawDays : null;

    const where = [];
    const params = [];

    if (intent) {
      where.push('cl.intent = ?');
      params.push(intent);
    }
    if (days !== null) {
      where.push(`cl.created_at >= datetime('now', '-${days} days')`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(
      `SELECT COUNT(*) as count FROM chat_logs cl ${whereClause}`
    ).get(...params);

    const rows = db.prepare(`
      SELECT cl.id, cl.user_id, u.username, cl.query, cl.intent,
             cl.response_length, cl.sources_count, cl.latency_ms, cl.created_at
      FROM chat_logs cl
      LEFT JOIN users u ON cl.user_id = u.id
      ${whereClause}
      ORDER BY cl.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ rows, total: total.count, page, limit });
  } catch (err) {
    console.error('GET /admin/logs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/errors — recent chat error logs
router.get('/errors', (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const rows = db.prepare(
      'SELECT * FROM chat_errors ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
    const total = db.prepare('SELECT COUNT(*) as count FROM chat_errors').get();
    res.json({ rows, total: total.count });
  } catch (err) {
    console.error('GET /admin/errors error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

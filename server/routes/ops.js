const crypto = require('crypto');
const express = require('express');
const { serviceClient, userFromRequest, adminOnly } = require('../middleware/supabaseAdmin');
const cron = require('./cron');

const router = express.Router();

// ── Error intake (anyone; rate limited) ────────────────────────────────
// The app's own error log: browsers post crashes here, the server logs its
// own failures via logServerError. Admins read them in the panel.
const hits = new Map(); // ip -> [ms]
function limited(ip, max = 30) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

function fingerprint(message, stack) {
  const frame = String(stack || '').split('\n').find((line) => /at |@/.test(line)) || '';
  return crypto.createHash('sha1').update(`${String(message).slice(0, 200)}|${frame.trim().slice(0, 200)}`).digest('hex').slice(0, 16);
}

async function insertError(row) {
  const db = serviceClient();
  if (!db) return;
  await db.from('error_events').insert({ ...row, fingerprint: fingerprint(row.message, row.stack) });
}

router.post('/errors', async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'slow down' });
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'message required' });
  const user = await userFromRequest(req);
  await insertError({
    source: 'client',
    message,
    stack: String(req.body?.stack || '').slice(0, 4000) || null,
    url: String(req.body?.url || '').slice(0, 500) || null,
    release: String(req.body?.release || '').slice(0, 60) || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    user_id: user?.id || null,
  }).catch(() => {});
  res.status(204).end();
});

function logServerError(error, req) {
  insertError({
    source: 'server',
    message: String(error?.message || error).slice(0, 1000),
    stack: String(error?.stack || '').slice(0, 4000) || null,
    url: `${req.method} ${req.originalUrl}`.slice(0, 500),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
  }).catch(() => {});
}

// ── Admin actions ──────────────────────────────────────────────────────

router.post('/health-check', adminOnly(async (req, res, db) => {
  try {
    res.json(await cron.checkServers(db, { force: true }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}));

// Push a message to every device with notifications on.
router.post('/broadcast', adminOnly(async (req, res, db) => {
  const title = String(req.body?.title || '').trim().slice(0, 80);
  const body = String(req.body?.body || '').trim().slice(0, 200);
  const url = String(req.body?.url || '/home').trim().slice(0, 200);
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });
  if (!url.startsWith('/')) return res.status(400).json({ error: 'Link must be a path on binge., like /movies.' });
  if (!cron.setupPush()) return res.status(503).json({ error: 'Push isn’t configured (VAPID keys).' });
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  const result = await cron.pushTo(db, subs || [], JSON.stringify({ title, body, url, tag: `broadcast-${Date.now()}` }));
  res.json({ devices: (subs || []).length, ...result });
}));

module.exports = router;
module.exports.logServerError = logServerError;

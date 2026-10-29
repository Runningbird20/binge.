const express = require('express');
const router  = express.Router();

let _sbCreateClient = null;
function getCreateClient() {
  if (!_sbCreateClient) {
    try { _sbCreateClient = require('../data-access/client').createHybridClient; }
    catch (e) { throw new Error('supabase-js not installed. Run: npm install'); }
  }
  return _sbCreateClient;
}

// ── Admin check (Supabase) ─────────────────────────────────────────
async function requireAdmin(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Not signed in' }); return null; }

  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) { res.status(503).json({ error: 'Admin auth not configured' }); return null; }
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

// ── Service-role client — required for auth.admin.* calls (create/delete
// users, read last sign-in). The anon/publishable key cannot do these; it
// intentionally lacks the privilege so a leaked browser key can't be used
// to delete accounts. ──────────────────────────────────────────
function requireServiceRoleClient(res) {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    res.status(503).json({
      error: 'Account creation and deletion require SUPABASE_SERVICE_ROLE_KEY to be set on the server (Supabase project settings → API → service_role key).',
    });
    return null;
  }
  return getCreateClient()(url, key);
}

// ─────────────────────────────────────────────────────────────
// GET /admin/users — user list overview
// ─────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;

  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.json([]);
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
    if ((process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
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

// Account creation goes straight from the client to Supabase's public
// signUp() (see createSupabaseUserAsAdmin in src/utils/supabaseData.js) —
// no server route for it. Deletion still has to live here: only the
// service-role key can remove an auth.users row, and that key must never
// reach the browser.

// ─────────────────────────────────────────────────────────────
// PATCH /admin/users/:id/toggle-admin
// ─────────────────────────────────────────────────────────────
router.patch('/users/:id/toggle-admin', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;

  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
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

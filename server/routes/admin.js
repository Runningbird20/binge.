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

// ─────────────────────────────────────────────────────────────
// POST /admin/users { username, email, password, bio, isAdmin }
// Accounts are invite-only (routes/invites.js) and public sign-ups are off in
// Supabase, so an admin's "Create account" goes through the service role too.
// The email counts as confirmed: the admin is vouching for it.
// ─────────────────────────────────────────────────────────────
router.post('/users', async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const sb = requireServiceRoleClient(res); if (!sb) return;
  const username = String(req.body?.username || '').trim().slice(0, 40);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const bio = String(req.body?.bio || '').trim().slice(0, 280);
  if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Add a username and a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const { data: taken } = await sb.from('profiles').select('id').eq('username', username).limit(1);
    if (taken?.length) return res.status(409).json({ error: 'That username is taken.' });
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, bio } });
    if (error) {
      const exists = error.code === 'email_exists' || /already/i.test(error.message || '');
      return res.status(exists ? 409 : 400).json({ error: exists ? 'An account with this email already exists.' : error.message });
    }
    const isAdmin = Boolean(req.body?.isAdmin);
    if (isAdmin) await sb.from('profiles').update({ is_admin: true }).eq('id', data.user.id);
    res.json({
      id: data.user.id, username, email, bio, is_admin: isAdmin, is_public: true,
      created_at: data.user.created_at, last_sign_in_at: null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Deletion has to live here too: only the service-role key can remove an
// auth.users row, and that key must never reach the browser.

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

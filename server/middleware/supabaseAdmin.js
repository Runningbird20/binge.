// Shared Supabase helpers for server routes: a service-role client, the
// signed-in user from a request's Bearer token, and an admin gate (the
// profiles.is_admin flag — same rule as the admin users routes).
const { createClient } = require('@supabase/supabase-js');

let service = null;

function serviceClient() {
  if (service) return service;
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  service = createClient(url, key, { auth: { persistSession: false } });
  return service;
}

async function userFromRequest(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const db = serviceClient();
  if (!token || !db) return null;
  try {
    const { data: { user } } = await db.auth.getUser(token);
    return user || null;
  } catch {
    return null;
  }
}

// Express handler wrapper: 401/403 unless the caller is an admin.
function adminOnly(handler) {
  return async (req, res) => {
    const db = serviceClient();
    if (!db) return res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
    const user = await userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    req.adminUser = user;
    return handler(req, res, db);
  };
}

module.exports = { serviceClient, userFromRequest, adminOnly };

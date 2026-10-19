// Shared Supabase/Neon helpers for server routes: a service-role client, the
// signed-in user from a request's Bearer token, and an admin gate.
const neonAuth = require('../neonAuth');

let service = null;
let _sbCreateClient = null;

function getCreateClient() {
  if (!_sbCreateClient) {
    try {
      _sbCreateClient = require('@supabase/supabase-js').createClient;
    } catch {
      _sbCreateClient = null;
    }
  }
  return _sbCreateClient;
}

function serviceClient() {
  if (service) return service;
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const cc = getCreateClient();
  if (!cc) return null;
  service = cc(url, key, { auth: { persistSession: false } });
  return service;
}

async function userFromRequest(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  if (neonAuth.isConfigured()) {
    try {
      const neonUser = await neonAuth.validateNeonSessionToken(token);
      if (neonUser) return neonUser;
    } catch {}
  }

  const db = serviceClient();
  if (!db) return null;
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
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'Not signed in' });

    if (neonAuth.isConfigured()) {
      try {
        const neonUser = await neonAuth.validateNeonSessionToken(token);
        if (neonUser) {
          const isAdmin = neonUser.role === 'admin' || neonUser.isAdmin === true;
          if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
          req.adminUser = neonUser;
          return handler(req, res, null);
        }
      } catch {}
    }

    const db = serviceClient();
    if (!db) return res.status(503).json({ error: 'Admin auth service is not configured.' });
    const user = await userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    req.adminUser = user;
    return handler(req, res, db);
  };
}

module.exports = { serviceClient, userFromRequest, adminOnly };

const jwt = require('jsonwebtoken');

// Lazy-load supabase to avoid crashing if module isn't installed
let _createClient = null;
function getCreateClient() {
  if (!_createClient) {
    try { _createClient = require('@supabase/supabase-js').createClient; }
    catch { _createClient = null; }
  }
  return _createClient;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function readBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// Decode Supabase JWT without network verification (safe for read-only user ID extraction)
function decodeSupabaseToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (!payload?.sub) return null;
    return { id: payload.sub, supabaseId: payload.sub, email: payload.email || '', fromSupabase: true };
  } catch { return null; }
}

// Check if a token looks like a Supabase JWT (they're long and have 3 parts)
function isSupabaseToken(token) {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    // Supabase tokens have 'iss' containing 'supabase'
    return payload?.iss?.includes('supabase') || payload?.role === 'authenticated';
  } catch { return false; }
}

// Verify a Supabase token and get the user
async function verifySupabaseToken(token) {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const createClient = getCreateClient();
    if (!createClient) return null;
    const sb = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;
    // Return in same shape as legacy JWT payload
    return { id: user.id, supabaseId: user.id, email: user.email, fromSupabase: true };
  } catch { return null; }
}

// Async version of requireAuth that handles both JWT types
function requireAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Try legacy JWT first (fast, synchronous)
  if (!isSupabaseToken(token)) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // Supabase token — async verification
  verifySupabaseToken(token).then(user => {
    if (!user) return res.status(401).json({ error: 'Invalid Supabase token' });
    req.user = user;
    next();
  }).catch(() => res.status(401).json({ error: 'Auth error' }));
}

function optionalAuth(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) { req.user = null; return next(); }

  if (!isSupabaseToken(token)) {
    try { req.user = jwt.verify(token, JWT_SECRET); }
    catch { req.user = null; }
    return next();
  }

  // Supabase token — use fast local decode (no network call needed for optional auth)
  req.user = decodeSupabaseToken(token);
  next();
}

module.exports = { requireAuth, optionalAuth, JWT_SECRET };

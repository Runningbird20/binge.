const jwt = require('jsonwebtoken');

// Lazy-load supabase to avoid crashing if the package is unavailable.
let createClientCache = null;
function getCreateClient() {
  if (!createClientCache) {
    try {
      createClientCache = require('@supabase/supabase-js').createClient;
    } catch {
      createClientCache = null;
    }
  }

  return createClientCache;
}

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  // Primary auth is Supabase (tokens verified via auth.getUser). JWT_SECRET is
  // only used for the legacy SQLite auth path. Warn loudly but don't crash —
  // crashing would break all API routes in serverless environments like Vercel.
  console.warn('[auth] WARNING: JWT_SECRET env var is not set. Set it in your Vercel dashboard (or .env) to secure the legacy auth path.');
  return 'dev-secret-change-in-production';
})();

function readBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function decodeJwtSection(section) {
  if (!section) return null;

  try {
    const normalized = String(section)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${'='.repeat(padding)}`;
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function looksLikeJwt(token) {
  return String(token || '').split('.').length === 3;
}

function getJwtHeader(token) {
  return decodeJwtSection(String(token || '').split('.')[0]);
}

function getJwtPayload(token) {
  return decodeJwtSection(String(token || '').split('.')[1]);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return null;
  }

  return { url, key };
}

// Decode a Supabase JWT without verifying it. This is only used for optional auth.
function decodeSupabaseToken(token) {
  const payload = getJwtPayload(token);
  if (!payload?.sub) return null;

  return {
    id: payload.sub,
    supabaseId: payload.sub,
    email: payload.email || '',
    fromSupabase: true,
  };
}

function isSupabaseToken(token) {
  if (!looksLikeJwt(token)) return false;

  const header = getJwtHeader(token);
  const payload = getJwtPayload(token);
  const algorithm = String(header?.alg || '').toUpperCase();

  // Legacy app tokens are HS256 by default. Supabase access tokens commonly use ES256.
  if (algorithm && !algorithm.startsWith('HS')) {
    return true;
  }

  return (
    payload?.iss?.includes('supabase') ||
    payload?.aud === 'authenticated' ||
    ['authenticated', 'anon', 'service_role'].includes(payload?.role)
  );
}

async function verifySupabaseToken(token) {
  const supabaseConfig = getSupabaseConfig();
  const createClient = getCreateClient();

  if (!supabaseConfig || !createClient) {
    return null;
  }

  try {
    const sb = createClient(supabaseConfig.url, supabaseConfig.key, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;

    return {
      id: user.id,
      supabaseId: user.id,
      email: user.email || '',
      fromSupabase: true,
    };
  } catch {
    return null;
  }
}

async function isSupabaseAdmin(userId) {
  const supabaseConfig = getSupabaseConfig();
  const createClient = getCreateClient();

  if (!supabaseConfig || !createClient || !userId) {
    return false;
  }

  try {
    const sb = createClient(supabaseConfig.url, supabaseConfig.key, {
      auth: { persistSession: false },
    });

    const { data, error } = await sb
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return false;
    }

    return data.is_admin === true;
  } catch {
    return false;
  }
}

function verifySupabaseRequest(req, res, next, token) {
  verifySupabaseToken(token)
    .then((user) => {
      if (!user) {
        return res.status(401).json({ error: 'Invalid Supabase token' });
      }

      req.user = user;
      next();
    })
    .catch(() => res.status(401).json({ error: 'Auth error' }));
}

function verifySupabaseAdminRequest(req, res, next, token) {
  verifySupabaseToken(token)
    .then(async (user) => {
      if (!user) {
        return res.status(401).json({ error: 'Invalid Supabase token' });
      }

      const admin = await isSupabaseAdmin(user.id);
      if (!admin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = { ...user, is_admin: true, isAdmin: true };
      next();
    })
    .catch(() => res.status(401).json({ error: 'Auth error' }));
}

function requireAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  if (isSupabaseToken(token)) {
    return verifySupabaseRequest(req, res, next, token);
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    if (looksLikeJwt(token)) {
      return verifySupabaseRequest(req, res, next, token);
    }

    return res.status(401).json({ error: 'Invalid token' });
  }
}

function optionalAuth(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  if (isSupabaseToken(token)) {
    req.user = decodeSupabaseToken(token);
    return next();
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = looksLikeJwt(token) ? decodeSupabaseToken(token) : null;
  }

  next();
}

function requireAdmin(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (isSupabaseToken(token)) {
    return verifySupabaseAdminRequest(req, res, next, token);
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const normalizedRole = String(payload.userType || payload.user_type || payload.role || '').toLowerCase();
    const admin = payload.isAdmin === true || payload.is_admin === true || normalizedRole === 'admin';

    if (!admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.user = payload;
    next();
  } catch {
    if (looksLikeJwt(token)) {
      return verifySupabaseAdminRequest(req, res, next, token);
    }

    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { requireAuth, optionalAuth, requireAdmin, JWT_SECRET };

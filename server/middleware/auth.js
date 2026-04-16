const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function readBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }

  return auth.slice(7);
}

async function verifyToken(token) {
  // Try local JWT first (legacy)
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    // fall through to Supabase verification
  }

  // Try Supabase JWT secret verification (preferred — no network call)
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (supabaseJwtSecret) {
    try {
      const payload = jwt.verify(token, supabaseJwtSecret);
      return {
        id: payload.sub,
        email: payload.email,
        username: payload.user_metadata?.username || payload.email,
        user_type: payload.user_metadata?.user_type || null,
        _supabaseUserId: payload.sub,
      };
    } catch {
      // fall through
    }
  }

  // Fall back to Supabase API token verification
  try {
    const { supabase } = require('../utils/supabaseClient');
    if (!supabase) {
      console.warn('[auth] Supabase client not configured — cannot verify Supabase token');
      return null;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      console.warn('[auth] supabase.auth.getUser error:', error.message || error);
      return null;
    }
    if (!data?.user) return null;

    const u = data.user;
    return {
      id: u.id,
      email: u.email,
      username: u.user_metadata?.username || u.email,
      user_type: u.user_metadata?.user_type || null,
      _supabaseUser: u,
    };
  } catch (err) {
    console.warn('[auth] Supabase token verification threw:', err?.message || err);
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  verifyToken(token).then(payload => {
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = payload;
    next();
  }).catch(() => {
    res.status(401).json({ error: 'Invalid token' });
  });
}

function requireAdmin(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  verifyToken(token).then(async payload => {
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = payload;

    // Check admin role — may be in JWT payload or need Supabase profile lookup
    let userType = payload.user_type;
    const supabaseId = payload._supabaseUser?.id || payload._supabaseUserId;

    if (userType !== 'admin' && supabaseId) {
      try {
        const { supabase } = require('../utils/supabaseClient');
        if (supabase) {
          const { data } = await supabase
            .from('profiles')
            .select('user_type')
            .eq('id', supabaseId)
            .single();
          if (data?.user_type) userType = data.user_type;
        }
      } catch {
        // ignore — will fail the admin check below
      }
    }

    if (userType !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  }).catch(() => {
    res.status(401).json({ error: 'Invalid token' });
  });
}

function optionalAuth(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) {
    req.user = null;
    next();
    return;
  }

  verifyToken(token).then(payload => {
    req.user = payload || null;
    next();
  }).catch(() => {
    req.user = null;
    next();
  });
}

module.exports = { requireAuth, requireAdmin, optionalAuth, JWT_SECRET };

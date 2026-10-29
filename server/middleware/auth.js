// Supabase Auth is the only identity system: a request is signed in when its
// Bearer token is a Supabase access token that auth.getUser() accepts.

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

function readBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return null;
  }

  return { url, key };
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

async function requireAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const user = await verifySupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user;
  next();
}

module.exports = { requireAuth };

const crypto = require('crypto');
const neonDb = require('./neonDb');

let cachedJwksKeys = null;
let lastJwksFetch = 0;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getAuthBaseUrl() {
  return process.env.NEON_AUTH_BASE_URL || '';
}

function getJwksUrl() {
  return process.env.NEON_AUTH_JWKS_URL || '';
}

function isConfigured() {
  return Boolean(getAuthBaseUrl() && getJwksUrl());
}

async function fetchJwksKeys() {
  const now = Date.now();
  if (cachedJwksKeys && now - lastJwksFetch < JWKS_CACHE_TTL_MS) {
    return cachedJwksKeys;
  }

  const jwksUrl = getJwksUrl();
  if (!jwksUrl) return [];

  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS from Neon Auth: ${response.status}`);
  }

  const data = await response.json();
  cachedJwksKeys = data.keys || [];
  lastJwksFetch = now;
  return cachedJwksKeys;
}

function parseJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, payload, rawHeader: parts[0], rawPayload: parts[1], rawSig: parts[2] };
  } catch {
    return null;
  }
}

async function verifyNeonJwt(token) {
  const parsed = parseJwt(token);
  if (!parsed) return null;

  try {
    const keys = await fetchJwksKeys();
    const kid = parsed.header.kid;
    const keyMatch = keys.find((k) => !kid || k.kid === kid);
    if (!keyMatch || keyMatch.kty !== 'OKP' || keyMatch.crv !== 'Ed25519') {
      return null;
    }

    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: keyMatch.x,
      },
      format: 'jwk',
    });

    const data = Buffer.from(`${parsed.rawHeader}.${parsed.rawPayload}`, 'utf8');
    const signature = Buffer.from(parsed.rawSig, 'base64url');
    const isValid = crypto.verify(null, data, keyObject, signature);

    if (!isValid) return null;

    if (parsed.payload.exp && parsed.payload.exp * 1000 < Date.now()) {
      return null;
    }

    return parsed.payload;
  } catch (err) {
    console.error('[Neon Auth] JWT verification error:', err.message);
    return null;
  }
}

async function validateNeonSessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  // 1. First check if it's a JWT from Neon Auth
  if (token.split('.').length === 3) {
    const payload = await verifyNeonJwt(token);
    if (payload && payload.sub) {
      return {
        id: payload.sub,
        email: payload.email || '',
        name: payload.name || payload.username || '',
        role: payload.role || 'user',
        fromNeon: true,
      };
    }
  }

  // 2. Otherwise check session token directly in Neon Postgres neon_auth.session table
  if (neonDb.isConfigured()) {
    try {
      const res = await neonDb.query(
        `SELECT 
           s.id AS session_id, 
           s."expiresAt", 
           u.id AS user_id, 
           u.name, 
           u.email, 
           u.role
         FROM neon_auth.session s
         JOIN neon_auth.user u ON s."userId" = u.id
         WHERE s.token = $1 AND s."expiresAt" > NOW()`,
        [token]
      );

      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          id: row.user_id,
          email: row.email || '',
          name: row.name || '',
          role: row.role || 'user',
          sessionId: row.session_id,
          fromNeon: true,
        };
      }
    } catch (err) {
      console.warn('[Neon Auth] Database session lookup error:', err.message);
    }
  }

  // 3. Alternatively check against Neon Auth get-session endpoint
  const authBaseUrl = getAuthBaseUrl();
  if (authBaseUrl) {
    try {
      const response = await fetch(`${authBaseUrl}/get-session`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'http://localhost:3000',
        },
      });

      if (response.ok) {
        const body = await response.json();
        if (body?.user) {
          return {
            id: body.user.id,
            email: body.user.email || '',
            name: body.user.name || '',
            role: body.user.role || 'user',
            fromNeon: true,
          };
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return null;
}

async function neonSignUp({ email, password, name = '', origin = 'http://localhost:3000' }) {
  const authBaseUrl = getAuthBaseUrl();
  if (!authBaseUrl) {
    throw new Error('NEON_AUTH_BASE_URL is not configured.');
  }

  const response = await fetch(`${authBaseUrl}/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin || 'http://localhost:3000',
    },
    body: JSON.stringify({ email, password, name }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Sign-up failed with status ${response.status}`);
  }

  return data;
}

async function neonSignIn({ email, password, origin = 'http://localhost:3000' }) {
  const authBaseUrl = getAuthBaseUrl();
  if (!authBaseUrl) {
    throw new Error('NEON_AUTH_BASE_URL is not configured.');
  }

  const response = await fetch(`${authBaseUrl}/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin || 'http://localhost:3000',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Sign-in failed with status ${response.status}`);
  }

  return data;
}

async function healthCheck() {
  const authBaseUrl = getAuthBaseUrl();
  const jwksUrl = getJwksUrl();

  if (!authBaseUrl || !jwksUrl) {
    return {
      ok: false,
      configured: false,
      error: 'Neon Auth environment variables missing',
    };
  }

  try {
    const okRes = await fetch(`${authBaseUrl}/ok`);
    const jwksRes = await fetch(jwksUrl);

    const isOk = okRes.ok && jwksRes.ok;
    return {
      ok: isOk,
      configured: true,
      authBaseUrl,
      jwksUrl,
      status: okRes.status,
      jwksStatus: jwksRes.status,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err.message,
    };
  }
}

module.exports = {
  isConfigured,
  getAuthBaseUrl,
  getJwksUrl,
  verifyNeonJwt,
  validateNeonSessionToken,
  neonSignUp,
  neonSignIn,
  healthCheck,
};


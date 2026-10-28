/**
 * Neon Client Utilities
 * Connects the frontend to Neon Postgres, Neon Auth, and Neon Functions.
 */

const NEON_AUTH_BASE_URL =
  process.env.REACT_APP_NEON_AUTH_BASE_URL ||
  process.env.NEON_AUTH_BASE_URL ||
  '';

const NEON_FUNCTION_HELLO_BASE_URL =
  process.env.REACT_APP_NEON_FUNCTION_HELLO_BASE_URL ||
  process.env.NEON_FUNCTION_HELLO_BASE_URL ||
  '';

// Authentication can remain on Supabase while application data uses Neon.
export const isNeonAuthConfigured = Boolean(NEON_AUTH_BASE_URL)
  && process.env.REACT_APP_AUTH_PROVIDER !== 'supabase';
export const isNeonFunctionsConfigured = Boolean(NEON_FUNCTION_HELLO_BASE_URL);

export function getApiBaseUrl() {
  const configured =
    process.env.REACT_APP_API_URL ||
    process.env.REACT_APP_LEGACY_API_URL ||
    '';
  return configured.replace(/\/+$/, '');
}

export function getClientOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

/**
 * Safely parse JSON response body and gracefully handle HTML / doctype responses
 */
async function parseJsonSafely(res, fallbackMessage) {
  if (!res) {
    throw new Error(fallbackMessage || 'No response received.');
  }

  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    throw new Error(fallbackMessage || `Failed to read response: ${err.message}`);
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    if (/^<!doctype|^<html/i.test(text.trim())) {
      throw new Error(
        `Server returned HTML instead of JSON (${res.status}). Make sure the backend server is running and reachable.`
      );
    }
    throw new Error(fallbackMessage || `Invalid server response (${res.status}).`);
  }
}

/**
 * Fetch comprehensive health status of all Neon services from the server.
 */
export async function getNeonHealth() {
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/api/neon/health`);
    return await parseJsonSafely(res, 'Failed to fetch Neon health');
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Call the deployed Neon Function (either directly or via the server proxy).
 */
export async function callNeonHello() {
  // Try direct if URL configured, else proxy
  const targetUrl = NEON_FUNCTION_HELLO_BASE_URL
    ? `${NEON_FUNCTION_HELLO_BASE_URL.replace(/\/+$/, '')}/`
    : `${getApiBaseUrl()}/api/neon/functions/hello`;

  try {
    const res = await fetch(targetUrl);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.trim() };
    }
    return { ok: res.ok, status: res.status, ...data };
  } catch (err) {
    // If browser CORS or offline, fallback to server proxy
    const proxyUrl = `${getApiBaseUrl()}/api/neon/functions/hello`;
    if (targetUrl !== proxyUrl) {
      try {
        const proxyRes = await fetch(proxyUrl);
        return await parseJsonSafely(proxyRes, 'Functions proxy error');
      } catch (proxyErr) {
        return { ok: false, error: proxyErr.message };
      }
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Sign up a user with Neon Auth.
 */
export async function neonSignUp({ email, password, name = '' }) {
  // 1. Try direct call to Neon Auth if configured
  if (NEON_AUTH_BASE_URL) {
    try {
      const directRes = await fetch(`${NEON_AUTH_BASE_URL.replace(/\/+$/, '')}/sign-up/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: getClientOrigin(),
        },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await parseJsonSafely(directRes, 'Neon sign-up failed');
      if (directRes.ok && data.user) {
        if (data.token) {
          window.localStorage.setItem('neon_auth_token', data.token);
          window.localStorage.setItem('token', data.token);
        }
        return data;
      }
      if (!directRes.ok) {
        throw new Error(data.message || data.error || `Sign-up failed (${directRes.status})`);
      }
    } catch (err) {
      // If it's a known validation/auth error from Neon Auth, rethrow it directly
      if (err.message && !err.message.includes('fetch') && !err.message.includes('network') && !err.message.includes('HTML')) {
        throw err;
      }
      console.warn('[Neon Auth] Direct sign-up failed, trying server proxy:', err.message);
    }
  }

  // 2. Fall back to backend server proxy
  const apiBase = getApiBaseUrl();
  let res;
  try {
    res = await fetch(`${apiBase}/api/auth/neon/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: getClientOrigin(),
      },
      body: JSON.stringify({ email, password, name }),
    });
  } catch (err) {
    throw new Error(`Neon sign-up request failed: ${err.message}`);
  }

  const data = await parseJsonSafely(res, 'Neon sign-up returned no response.');
  if (!res.ok) {
    throw new Error(data.error || data.message || `Sign-up failed (${res.status})`);
  }

  if (data.token) {
    window.localStorage.setItem('neon_auth_token', data.token);
    window.localStorage.setItem('token', data.token);
  }

  return data;
}

/**
 * Sign in a user with Neon Auth.
 */
export async function neonSignIn({ email, password }) {
  // 1. Try direct call to Neon Auth if configured
  if (NEON_AUTH_BASE_URL) {
    try {
      const directRes = await fetch(`${NEON_AUTH_BASE_URL.replace(/\/+$/, '')}/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: getClientOrigin(),
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await parseJsonSafely(directRes, 'Neon sign-in failed');
      if (directRes.ok && data.user) {
        if (data.token) {
          window.localStorage.setItem('neon_auth_token', data.token);
          window.localStorage.setItem('token', data.token);
        }
        return data;
      }
      if (!directRes.ok) {
        throw new Error(data.message || data.error || `Sign-in failed (${directRes.status})`);
      }
    } catch (err) {
      if (err.message && !err.message.includes('fetch') && !err.message.includes('network') && !err.message.includes('HTML')) {
        throw err;
      }
      console.warn('[Neon Auth] Direct sign-in failed, trying server proxy:', err.message);
    }
  }

  // 2. Fall back to backend server proxy
  const apiBase = getApiBaseUrl();
  let res;
  try {
    res = await fetch(`${apiBase}/api/auth/neon/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: getClientOrigin(),
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    throw new Error(`Neon sign-in request failed: ${err.message}`);
  }

  const data = await parseJsonSafely(res, 'Neon sign-in returned no response.');
  if (!res.ok) {
    throw new Error(data.error || data.message || `Sign-in failed (${res.status})`);
  }

  if (data.token) {
    window.localStorage.setItem('neon_auth_token', data.token);
    window.localStorage.setItem('token', data.token);
  }

  return data;
}

/**
 * Restore user session from Neon Auth.
 */
export async function getNeonSession() {
  const token = window.localStorage.getItem('neon_auth_token') || window.localStorage.getItem('token');
  if (!token) return null;

  // Direct Neon Auth get-session check
  if (NEON_AUTH_BASE_URL) {
    try {
      const directRes = await fetch(`${NEON_AUTH_BASE_URL.replace(/\/+$/, '')}/get-session`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: getClientOrigin(),
        },
      });
      if (directRes.ok) {
        const text = await directRes.text();
        if (text) {
          try {
            const data = JSON.parse(text);
            if (data?.user) return data.user;
          } catch {}
        }
      }
    } catch {}
  }

  // Fallback to server proxy
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/api/auth/neon/session`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const data = await parseJsonSafely(res);
    return data?.user || null;
  } catch {
    return null;
  }
}

/**
 * Sign out user from Neon Auth.
 */
export function neonSignOut() {
  window.localStorage.removeItem('neon_auth_token');
  window.localStorage.removeItem('token');
  window.localStorage.removeItem('user');
}

/**
 * Test Neon Postgres database query.
 */
export async function testNeonPostgres() {
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/api/neon/postgres/test`);
    return await parseJsonSafely(res, 'Failed to test Neon Postgres');
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

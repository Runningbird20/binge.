function resolveBaseUrl() {
  if (process.env.NODE_ENV === 'test') return '/api';
  const configuredApiUrl = process.env.REACT_APP_API_URL?.trim();
  if (!configuredApiUrl) return '/api';
  const normalizedApiUrl = configuredApiUrl.replace(/\/+$/, '');
  if (normalizedApiUrl.endsWith('/api')) return normalizedApiUrl;
  return `${normalizedApiUrl}/api`;
}

const BASE = resolveBaseUrl();

// ── Token cache ───────────────────────────────────────────────
// Cache the token so we only call getSession() once per session,
// not on every single API request. This is the main cause of the
// white flash on load.
let _cachedToken = null;
let _tokenFetchPromise = null;

async function fetchSupabaseToken() {
  try {
    const { supabase } = await import('./utils/supabase');
    if (!supabase) return null;
    // Race against a 3-second timeout so a slow Supabase never blocks the UI
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise(resolve => setTimeout(() => resolve({ data: null }), 3000)),
    ]);
    return result?.data?.session?.access_token || null;
  } catch { return null; }
}

async function getAuthToken() {
  // 1. Legacy Express JWT (synchronous, instant)
  const legacyToken = localStorage.getItem('token');
  if (legacyToken) return legacyToken;

  // 2. Return cached token if we already fetched it
  if (_cachedToken) return _cachedToken;

  // 3. If a fetch is already in-flight, wait for it instead of starting another
  if (_tokenFetchPromise) return _tokenFetchPromise;

  // 4. Fetch once, cache the result
  _tokenFetchPromise = fetchSupabaseToken().then(token => {
    _cachedToken = token;
    _tokenFetchPromise = null;
    return token;
  });

  return _tokenFetchPromise;
}

// Call this when the user logs out so the cache is cleared
export function clearTokenCache() {
  _cachedToken = null;
  _tokenFetchPromise = null;
}

// Call this when the session changes (e.g. after login) to refresh the cache
export function setTokenCache(token) {
  _cachedToken = token || null;
  _tokenFetchPromise = null;
}

// ── Response helpers ──────────────────────────────────────────
async function parseResponseBody(res) {
  const text = await res.text();
  if (!text) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return JSON.parse(text);
  try { return JSON.parse(text); } catch { return text; }
}

function buildErrorMessage(res, data) {
  if (data && typeof data === 'object') {
    return data.error || data.message || `Request failed with status ${res.status}`;
  }
  if (typeof data === 'string') {
    const message = data.trim();
    if (!message) return `Request failed with status ${res.status}`;
    if (message.startsWith('Proxy error')) return `${message} Make sure the API server is running and reachable.`;
    if (message.startsWith('<!DOCTYPE') || message.startsWith('<html')) return `The API returned an HTML error page (status ${res.status}).`;
    return message;
  }
  return `Request failed with status ${res.status}`;
}

// ── Main request function ─────────────────────────────────────
async function request(method, path, body) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Unable to reach the API server (localhost:5001). Make sure the backend is running.');
  }

  const data = await parseResponseBody(res);
  if (!res.ok) throw new Error(buildErrorMessage(res, data));
  return data;
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path, body)  => request('DELETE', path, body),
};

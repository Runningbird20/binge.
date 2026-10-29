import { trackedFetch } from './utils/loadingProgress';
import { executeSupabaseRoute } from './utils/supabaseApi';
import { isSupabaseConfigured } from './utils/supabase';

function isLegacyBackendEnabled() {
  return String(process.env.REACT_APP_ENABLE_LEGACY_BACKEND || '')
    .trim()
    .toLowerCase() === 'true';
}

const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host || '');

// A localhost API URL (a copied .env) only works when the page is local too.
// Production was once built with http://localhost:5001, which sent every
// visitor's admin, Ask binge. and other /api calls to their own computer.
function configuredLegacyUrl() {
  const configured = process.env.REACT_APP_LEGACY_API_URL?.trim();
  if (!configured || typeof window === 'undefined') return configured;
  try {
    const target = new URL(configured, window.location.href);
    if (isLocalHost(target.hostname) && !isLocalHost(window.location.hostname)) return '';
  } catch {
    return '';
  }
  return configured;
}

function resolveLegacyBaseUrl() {
  const configuredApiUrl = configuredLegacyUrl();

  if (!configuredApiUrl) {
    return (!isSupabaseConfigured || isLegacyBackendEnabled()) ? '/api' : null;
  }

  const normalizedApiUrl = configuredApiUrl.replace(/\/+$/, '');
  if (normalizedApiUrl.endsWith('/api')) {
    return normalizedApiUrl;
  }

  return `${normalizedApiUrl}/api`;
}

const LEGACY_BASE = resolveLegacyBaseUrl();

let cachedToken = null;
let tokenFetchPromise = null;

async function fetchSupabaseToken() {
  try {
    const { isSupabaseConfigured, getSupabaseSession } = await import('./utils/supabase');
    if (!isSupabaseConfigured) {
      return null;
    }

    const result = await Promise.race([
      getSupabaseSession(),
      new Promise((resolve) => {
        window.setTimeout(() => resolve({ data: null }), 3000);
      }),
    ]);

    return result?.data?.session?.access_token || null;
  } catch {
    return null;
  }
}

// The API only accepts Supabase access tokens.
async function getAuthToken() {
  if (cachedToken) {
    return cachedToken;
  }

  if (!isSupabaseConfigured) {
    return null;
  }

  if (tokenFetchPromise) {
    return tokenFetchPromise;
  }

  tokenFetchPromise = fetchSupabaseToken().then((token) => {
    cachedToken = token;
    tokenFetchPromise = null;
    return token;
  });

  return tokenFetchPromise;
}

export function clearTokenCache() {
  cachedToken = null;
  tokenFetchPromise = null;
}

export function setTokenCache(token) {
  cachedToken = token || null;
  tokenFetchPromise = null;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildLegacyErrorMessage(response, data) {
  if (data && typeof data === 'object') {
    return data.error || data.message || `Request failed with status ${response.status}`;
  }

  if (typeof data === 'string') {
    const message = data.trim();
    if (!message) {
      return `Request failed with status ${response.status}`;
    }

    if (message.startsWith('Proxy error')) {
      return `${message} Make sure the API server is running and reachable.`;
    }

    if (/^<!doctype|^<html/i.test(message)) {
      return `The legacy API returned HTML instead of JSON (status ${response.status}).`;
    }

    return message;
  }

  return `Request failed with status ${response.status}`;
}

function isHtmlPayload(data) {
  return typeof data === 'string' && /^<!doctype|^<html/i.test(data.trim());
}

// POSTs that only read (safe to send twice).
const RETRYABLE_POSTS = ['/extras/ai/picks'];

async function requestLegacyApi(method, path, body) {
  if (!LEGACY_BASE) {
    throw new Error(
      'This deployment does not include the legacy backend. Set REACT_APP_LEGACY_API_URL to a separately hosted API or enable REACT_APP_ENABLE_LEGACY_BACKEND=true for a same-origin /api deployment.'
    );
  }

  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // A dropped connection (common in an installed app on mobile data, or just
  // after the phone wakes it) gets one retry for requests that are safe to
  // repeat; the message shown is for people, not developers.
  const send = () => trackedFetch(`${LEGACY_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let response;
  try {
    response = await send();
  } catch {
    if (method === 'GET' || RETRYABLE_POSTS.some((prefix) => path.startsWith(prefix))) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      try { response = await send(); } catch { /* reported below */ }
    }
    if (!response) {
      throw new Error(navigator.onLine === false
        ? 'You’re offline. Check your connection and try again.'
        : 'Couldn’t reach binge. just now. Check your connection and try again.');
    }
  }

  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(buildLegacyErrorMessage(response, data));
  }

  if (isHtmlPayload(data)) {
    throw new Error('The legacy API returned HTML instead of JSON.');
  }

  return data;
}

async function request(method, path, body) {
  const directResult = await executeSupabaseRoute(method, path, body);
  if (directResult !== null) {
    return directResult;
  }

  return requestLegacyApi(method, path, body);
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path, body) => request('DELETE', path, body),
};

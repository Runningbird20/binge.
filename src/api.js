import { executeSupabaseRoute } from './utils/supabaseApi';

function isLegacyBackendEnabled() {
  return String(process.env.REACT_APP_ENABLE_LEGACY_BACKEND || '')
    .trim()
    .toLowerCase() === 'true';
}

function resolveLegacyBaseUrl() {
  const configuredApiUrl = process.env.REACT_APP_LEGACY_API_URL?.trim();

  if (!configuredApiUrl) {
    return isLegacyBackendEnabled() ? '/api' : null;
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
    const { supabase } = await import('./utils/supabase');
    if (!supabase) {
      return null;
    }

    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise((resolve) => {
        window.setTimeout(() => resolve({ data: null }), 3000);
      }),
    ]);

    return result?.data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function getAuthToken() {
  const legacyToken = window.localStorage.getItem('token');
  if (legacyToken) {
    return legacyToken;
  }

  if (cachedToken) {
    return cachedToken;
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

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return JSON.parse(text);
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

  let response;
  try {
    response = await fetch(`${LEGACY_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      'Unable to reach the API. If you still need the legacy backend, set REACT_APP_LEGACY_API_URL and make sure that server is running.'
    );
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

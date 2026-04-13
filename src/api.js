function resolveBaseUrl() {
  if (process.env.NODE_ENV === 'test') {
    return '/api';
  }

  const configuredApiUrl = process.env.REACT_APP_API_URL?.trim();
  if (!configuredApiUrl) {
    return '/api';
  }

  const normalizedApiUrl = configuredApiUrl.replace(/\/+$/, '');
  if (normalizedApiUrl.endsWith('/api')) {
    return normalizedApiUrl;
  }

  return `${normalizedApiUrl}/api`;
}

const BASE = resolveBaseUrl();

async function getAuthToken() {
  // Try legacy Express JWT first
  const legacyToken = localStorage.getItem('token');
  if (legacyToken) return legacyToken;

  // Fall back to Supabase session token
  try {
    const { supabase } = await import('./utils/supabase');
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) return data.session.access_token;
    }
  } catch { /* ignore */ }
  return null;
}

function authHeaders() {
  // Sync version — only gets legacy token (for backwards compat)
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseResponseBody(res) {
  const text = await res.text();
  if (!text) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return JSON.parse(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildErrorMessage(res, data) {
  if (data && typeof data === 'object') {
    return data.error || data.message || `Request failed with status ${res.status}`;
  }

  if (typeof data === 'string') {
    const message = data.trim();
    if (!message) {
      return `Request failed with status ${res.status}`;
    }
    if (message.startsWith('Proxy error')) {
      return `${message} Make sure the API server is running and reachable.`;
    }
    if (message.startsWith('<!DOCTYPE') || message.startsWith('<html')) {
      return `The API returned an HTML error page (status ${res.status}).`;
    }
    return message;
  }

  return `Request failed with status ${res.status}`;
}

async function request(method, path, body) {
  let res;
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

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
  if (!res.ok) {
    throw new Error(buildErrorMessage(res, data));
  }
  return data;
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path, body)  => request('DELETE', path, body),
};

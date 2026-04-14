import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL)?.trim();
const supabaseKey = (
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY
)?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

async function getSupabaseFunctionHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
  };

  if (!supabase) {
    return headers;
  }

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
  } catch {}

  return headers;
}

function isJwtAuthError(response, data) {
  const message =
    typeof data === 'string'
      ? data
      : data && typeof data === 'object'
        ? [data.error, data.message, data.code].filter(Boolean).join(' ')
        : '';

  return response.status === 401 && /jwt|authorization|token/i.test(message);
}

async function retryFunctionWithRefresh(functionName, body) {
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session?.access_token) {
      return null;
    }
  } catch {
    return null;
  }

  const retryHeaders = await getSupabaseFunctionHeaders();
  return fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    headers: retryHeaders,
    body: JSON.stringify(body ?? {}),
  });
}

async function parseFunctionResponse(response) {
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

function buildFunctionErrorMessage(response, data) {
  if (data && typeof data === 'object') {
    return data.error || data.message || data.code || `Function request failed with status ${response.status}`;
  }

  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }

  return `Function request failed with status ${response.status}`;
}

export async function invokeSupabaseFunction(functionName, body) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY).');
  }

  const headers = await getSupabaseFunctionHeaders();
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  let data = await parseFunctionResponse(response);

  if (isJwtAuthError(response, data)) {
    const retryResponse = await retryFunctionWithRefresh(functionName, body);
    if (retryResponse) {
      data = await parseFunctionResponse(retryResponse);
      if (!retryResponse.ok) {
        throw new Error(buildFunctionErrorMessage(retryResponse, data));
      }
      return data;
    }
  }

  if (!response.ok) {
    throw new Error(buildFunctionErrorMessage(response, data));
  }

  return data;
}


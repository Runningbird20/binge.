import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_ENV_KEYS = [
  'REACT_APP_SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
];

const SUPABASE_ANON_KEY_ENV_KEYS = [
  'REACT_APP_SUPABASE_ANON_KEY',
  'REACT_APP_SUPABASE_PUBLISHABLE_KEY',
  'REACT_APP_SUPABASE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_KEY',
];

function readFirstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return {
        key,
        value: value.trim(),
      };
    }
  }

  return {
    key: null,
    value: '',
  };
}

const resolvedSupabaseUrl = readFirstEnv(SUPABASE_URL_ENV_KEYS);
const resolvedSupabaseAnonKey = readFirstEnv(SUPABASE_ANON_KEY_ENV_KEYS);

const supabaseUrl = resolvedSupabaseUrl.value;
const supabaseKey = resolvedSupabaseAnonKey.value;

export const supabaseEnv = {
  url: supabaseUrl,
  anonKey: supabaseKey,
  urlKey: resolvedSupabaseUrl.key,
  anonKeyKey: resolvedSupabaseAnonKey.key,
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// A second client with session persistence off, used for one-shot signUp()
// calls made on someone else's behalf (e.g. an admin creating an account).
// auth.signUp() logs in as the new user on whatever client it's called on —
// running it here instead of the main `supabase` client keeps the caller's
// own session untouched.
let sessionlessClient = null;
export function getSessionlessSupabaseClient() {
  if (!isSupabaseConfigured) {
    throw new Error(getSupabaseConfigErrorMessage());
  }

  if (!sessionlessClient) {
    sessionlessClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  return sessionlessClient;
}

export function getSupabaseConfigErrorMessage() {
  return [
    'Missing Supabase environment variables.',
    'Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY for this Create React App project.',
    'If you are reusing config from another stack, VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY and NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are also recognized when available.',
  ].join(' ');
}

export function requireSupabaseClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(getSupabaseConfigErrorMessage());
  }

  return supabase;
}

let sessionRequestPromise = null;
let userRequestPromise = null;
let refreshRequestPromise = null;
let authOperationQueue = Promise.resolve();

function runSerializedAuthOperation(operation) {
  const run = authOperationQueue.catch(() => {}).then(operation);
  authOperationQueue = run.catch(() => {});
  return run;
}

export async function getSupabaseSession() {
  const client = requireSupabaseClient();
  if (!sessionRequestPromise) {
    sessionRequestPromise = runSerializedAuthOperation(() => client.auth.getSession()).finally(() => {
      sessionRequestPromise = null;
    });
  }

  return sessionRequestPromise;
}

export async function getSupabaseUser() {
  const client = requireSupabaseClient();
  if (!userRequestPromise) {
    userRequestPromise = runSerializedAuthOperation(() => client.auth.getUser()).finally(() => {
      userRequestPromise = null;
    });
  }

  return userRequestPromise;
}

export async function refreshSupabaseSession() {
  const client = requireSupabaseClient();
  if (!refreshRequestPromise) {
    refreshRequestPromise = runSerializedAuthOperation(() => client.auth.refreshSession()).finally(() => {
      refreshRequestPromise = null;
    });
  }

  return refreshRequestPromise;
}

function looksLikeNetworkError(message) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|network issue/i.test(message);
}

function looksLikeInvalidSupabaseUrl(message) {
  return /invalid url|failed to construct 'url'|must be a valid url|supabase url/i.test(message);
}

function looksLikeInvalidSupabaseKey(message) {
  return /invalid api key|invalid jwt|jwt malformed|apikey|anon key|publishable key/i.test(message);
}

function looksLikeAuthSessionError(message) {
  return /auth session missing|auth session|invalid refresh token|refresh token|jwt expired|session missing|session expired|invalid claim/i.test(message);
}

function looksLikeMissingAuthorizationHeader(message) {
  return /missing authorization header|authorization header/i.test(message);
}

function looksLikeRlsError(message) {
  return /row-level security|permission denied|new row violates row-level security policy|violates row-level security/i.test(message);
}

function looksLikeMissingRelationError(code, message) {
  return code === '42P01' || /relation .* does not exist|table .* does not exist|schema cache/i.test(message);
}

export function toSupabaseError(error, fallbackMessage, options = {}) {
  if (!error) {
    return new Error(fallbackMessage);
  }

  const message = String(error.message || '').trim();
  const code = String(error.code || '').trim();
  const resourceName = options.resourceName || options.resource || 'resource';
  const edgeFunctionName = options.edgeFunctionName || options.functionName || '';

  if (!isSupabaseConfigured) {
    return new Error(getSupabaseConfigErrorMessage());
  }

  if (looksLikeInvalidSupabaseUrl(message)) {
    return new Error('The Supabase URL is invalid. Check REACT_APP_SUPABASE_URL.');
  }

  if (looksLikeInvalidSupabaseKey(message)) {
    return new Error('The Supabase anon key was rejected. Check REACT_APP_SUPABASE_ANON_KEY.');
  }

  if (looksLikeAuthSessionError(message)) {
    return new Error('Your Supabase auth session is missing or invalid. Please sign in again.');
  }

  if (edgeFunctionName && looksLikeMissingAuthorizationHeader(message)) {
    return new Error(
      `The Supabase Edge Function "${edgeFunctionName}" requires a bearer token. Disable JWT verification for that function or make sure the user has an active Supabase session.`
    );
  }

  if (looksLikeMissingRelationError(code, message)) {
    return new Error(`Supabase is missing the required "${resourceName}" table or view. Run the latest migration and verify the schema exists.`);
  }

  if (looksLikeRlsError(message) || code === '42501') {
    return new Error(`Supabase denied access to "${resourceName}". Check the table's RLS policies.`);
  }

  if (edgeFunctionName && /function|functions/i.test(message)) {
    return new Error(`The Supabase Edge Function "${edgeFunctionName}" failed. Check the function deployment and logs.`);
  }

  if (looksLikeNetworkError(message) || error.name === 'TypeError') {
    return new Error('Unable to reach Supabase. Check your Supabase URL, anon key, and network connection.');
  }

  return new Error(message || fallbackMessage);
}

async function getSupabaseFunctionHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
  };

  if (!supabase) {
    return headers;
  }

  try {
    const { data } = await getSupabaseSession();
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
    const { data, error } = await refreshSupabaseSession();
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
    throw new Error(getSupabaseConfigErrorMessage());
  }

  const headers = await getSupabaseFunctionHeaders();
  let response;

  try {
    response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${encodeURIComponent(functionName)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    });
  } catch (error) {
    throw toSupabaseError(error, `Unable to reach the Supabase Edge Function "${functionName}".`, {
      resourceName: 'edge function',
      edgeFunctionName: functionName,
    });
  }

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
    throw toSupabaseError(
      new Error(buildFunctionErrorMessage(response, data)),
      `The Supabase Edge Function "${functionName}" failed.`,
      {
        resourceName: 'edge function',
        edgeFunctionName: functionName,
      }
    );
  }

  return data;
}


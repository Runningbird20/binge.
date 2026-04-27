import { invokeSupabaseFunction, isSupabaseConfigured } from './supabase';

const DEV_LAB_STATUS_PATH = '/status';
const VALID_BACKEND_MODES = new Set(['auto', 'server', 'supabase']);

function callDevFunction(action, payload = {}) {
  return invokeSupabaseFunction('dev', {
    action,
    ...payload,
  });
}

function isLegacyBackendEnabled() {
  return String(process.env.REACT_APP_ENABLE_LEGACY_BACKEND || '').trim().toLowerCase() === 'true';
}

function resolveBackendMode() {
  const configuredMode = String(process.env.REACT_APP_DEVLAB_API_MODE || '').trim().toLowerCase();
  return VALID_BACKEND_MODES.has(configuredMode) ? configuredMode : 'auto';
}

function normalizeDevLabApiBase(url) {
  const normalized = String(url || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return '/api/dev-lab';
  }

  if (normalized.endsWith('/api/dev-lab')) {
    return normalized;
  }

  if (normalized.endsWith('/api')) {
    return `${normalized}/dev-lab`;
  }

  return `${normalized}/api/dev-lab`;
}

function resolveServerBaseUrl() {
  const configuredDevLabUrl = process.env.REACT_APP_DEVLAB_API_URL?.trim();
  if (configuredDevLabUrl) {
    return normalizeDevLabApiBase(configuredDevLabUrl);
  }

  const configuredLegacyApiUrl = process.env.REACT_APP_LEGACY_API_URL?.trim();
  if (configuredLegacyApiUrl) {
    return normalizeDevLabApiBase(configuredLegacyApiUrl);
  }

  return '/api/dev-lab';
}

const DEV_LAB_BACKEND_MODE = resolveBackendMode();
const DEV_LAB_SERVER_BASE = resolveServerBaseUrl();

let serverAvailabilityPromise = null;

function parseResponseBody(response) {
  return response.text().then((text) => {
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
  });
}

function isHtmlPayload(data) {
  return typeof data === 'string' && /^<!doctype|^<html/i.test(data.trim());
}

function buildServerErrorMessage(response, data) {
  if (data && typeof data === 'object') {
    return data.error || data.message || `Developer Lab request failed with status ${response.status}`;
  }

  if (typeof data === 'string') {
    const message = data.trim();
    if (!message) {
      return `Developer Lab request failed with status ${response.status}`;
    }

    if (/^<!doctype|^<html/i.test(message)) {
      return `The DB-backed Developer Lab returned HTML instead of JSON (status ${response.status}).`;
    }

    return message;
  }

  return `Developer Lab request failed with status ${response.status}`;
}

async function requestServer(method, path, body) {
  let response;

  try {
    response = await fetch(`${DEV_LAB_SERVER_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      'Unable to reach the DB-backed Developer Lab API. Make sure the /api server is running and DATABASE_URL or SUPABASE_DB_URL is configured.'
    );
  }

  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(buildServerErrorMessage(response, data));
  }

  if (isHtmlPayload(data)) {
    throw new Error('The DB-backed Developer Lab returned HTML instead of JSON.');
  }

  return data;
}

async function canUseServerBackend() {
  if (DEV_LAB_BACKEND_MODE === 'server') {
    return true;
  }

  if (DEV_LAB_BACKEND_MODE === 'supabase') {
    return false;
  }

  if (isLegacyBackendEnabled()) {
    if (!serverAvailabilityPromise) {
      serverAvailabilityPromise = requestServer('GET', DEV_LAB_STATUS_PATH)
        .then((payload) => payload?.ok === true)
        .catch(() => false);
    }

    return serverAvailabilityPromise;
  }

  if (!serverAvailabilityPromise) {
    serverAvailabilityPromise = requestServer('GET', DEV_LAB_STATUS_PATH)
      .then((payload) => payload?.ok === true)
      .catch(() => false);
  }

  return serverAvailabilityPromise;
}

async function requestDevLab({ method, path, body, action, payload = {} }) {
  const serverForced = DEV_LAB_BACKEND_MODE === 'server';

  if (await canUseServerBackend()) {
    try {
      return await requestServer(method, path, body);
    } catch (error) {
      if (serverForced || !isSupabaseConfigured) {
        throw error;
      }

      return callDevFunction(action, payload);
    }
  }

  if (isSupabaseConfigured) {
    return callDevFunction(action, payload);
  }

  throw new Error(
    'Developer Lab is unavailable. Expose /api/dev-lab with DATABASE_URL or SUPABASE_DB_URL, or configure the Supabase "dev" function.'
  );
}

export const devLabApi = {
  getDashboard: () =>
    requestDevLab({
      method: 'GET',
      path: '/dashboard',
      action: 'dashboard',
    }),
  listKnowledge: () =>
    requestDevLab({
      method: 'GET',
      path: '/knowledge',
      action: 'knowledge:list',
    }),
  saveManualDocument: (payload) =>
    requestDevLab({
      method: 'POST',
      path: '/ingest/manual',
      body: payload,
      action: 'knowledge:create-manual',
      payload,
    }),
  scrapeUrlDocument: (payload) =>
    requestDevLab({
      method: 'POST',
      path: '/ingest/url',
      body: payload,
      action: 'knowledge:scrape-url',
      payload,
    }),
  importCatalogFromApi: (payload) =>
    requestDevLab({
      method: 'POST',
      path: '/ingest/api',
      body: payload,
      action: 'catalog:import-api',
      payload,
    }),
  savePromptProfile: (intent, payload) =>
    requestDevLab({
      method: 'PUT',
      path: `/prompts/${encodeURIComponent(intent)}`,
      body: payload,
      action: 'prompts:save',
      payload: { intent, ...payload },
    }),
  previewPromptResponse: (payload) =>
    requestDevLab({
      method: 'POST',
      path: '/chat/preview',
      body: payload,
      action: 'preview',
      payload,
    }),
  listEvaluations: () =>
    requestDevLab({
      method: 'GET',
      path: '/evaluations',
      action: 'evaluations:list',
    }),
  createEvaluationCase: (payload) =>
    requestDevLab({
      method: 'POST',
      path: '/evaluations/cases',
      body: payload,
      action: 'evaluations:create-case',
      payload,
    }),
  runEvaluations: (payload) =>
    requestDevLab({
      method: 'POST',
      path: '/evaluations/run',
      body: payload,
      action: 'evaluations:run',
      payload,
    }),
  deleteKnowledgeDocument: (id) =>
    requestDevLab({
      method: 'DELETE',
      path: `/knowledge/${id}`,
      action: 'knowledge:delete',
      payload: { id },
    }),
  deleteEvaluationCase: (id) =>
    requestDevLab({
      method: 'DELETE',
      path: `/evaluations/cases/${id}`,
      action: 'evaluations:delete-case',
      payload: { id },
    }),
};

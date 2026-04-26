import { getSupabaseSession, invokeSupabaseFunction, isSupabaseConfigured } from './supabase';

const VALID_BACKEND_MODES = new Set(['auto', 'server', 'supabase']);
const CHATBOT_FUNCTION_NAME = String(process.env.REACT_APP_CHATBOT_FUNCTION_NAME || 'ai-chatbot').trim() || 'ai-chatbot';

function resolveBackendMode() {
  const configuredMode = String(process.env.REACT_APP_CHATBOT_API_MODE || '').trim().toLowerCase();
  return VALID_BACKEND_MODES.has(configuredMode) ? configuredMode : 'auto';
}

function normalizeChatApiBase(url) {
  const normalized = String(url || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return '/api/chat';
  }

  if (normalized.endsWith('/api/chat')) {
    return normalized;
  }

  if (normalized.endsWith('/api')) {
    return `${normalized}/chat`;
  }

  return `${normalized}/api/chat`;
}

function resolveServerBaseUrl() {
  const configuredChatUrl = process.env.REACT_APP_CHATBOT_API_URL?.trim();
  if (configuredChatUrl) {
    return normalizeChatApiBase(configuredChatUrl);
  }

  const configuredLegacyApiUrl = process.env.REACT_APP_LEGACY_API_URL?.trim();
  if (configuredLegacyApiUrl) {
    return normalizeChatApiBase(configuredLegacyApiUrl);
  }

  return '/api/chat';
}

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
    return data.error || data.message || `Chat request failed with status ${response.status}`;
  }

  if (typeof data === 'string') {
    const message = data.trim();
    if (!message) {
      return `Chat request failed with status ${response.status}`;
    }

    if (/^<!doctype|^<html/i.test(message)) {
      return `The chat API returned HTML instead of JSON (status ${response.status}).`;
    }

    return message;
  }

  return `Chat request failed with status ${response.status}`;
}

async function getServerAuthToken() {
  try {
    const legacyToken = window.localStorage.getItem('token');
    if (legacyToken) {
      return legacyToken;
    }
  } catch {}

  if (!isSupabaseConfigured) {
    return null;
  }

  try {
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

async function requestServer(method, path, body) {
  const token = await getServerAuthToken();
  let response;

  try {
    response = await fetch(`${resolveServerBaseUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      'Unable to reach the chat API. Make sure the /api server is deployed or set REACT_APP_CHATBOT_API_URL.'
    );
  }

  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(buildServerErrorMessage(response, data));
  }

  if (isHtmlPayload(data)) {
    throw new Error('The chat API returned HTML instead of JSON.');
  }

  return data;
}

async function requestSupabaseChat(message, conversationHistory = []) {
  const normalizedHistory = Array.isArray(conversationHistory)
    ? conversationHistory
        .map((entry) => ({
          role: String(entry?.role || '').trim(),
          content: String(entry?.content || '').trim(),
        }))
        .filter((entry) => entry.role && entry.content)
    : [];

  return invokeSupabaseFunction(CHATBOT_FUNCTION_NAME, {
    messages: [
      ...normalizedHistory,
      { role: 'user', content: String(message || '').trim() },
    ],
  });
}

async function requestSupabaseStatus() {
  return invokeSupabaseFunction(CHATBOT_FUNCTION_NAME, {
    messages: [{ role: 'system', content: 'Ping' }],
  });
}

async function requestServerStatus() {
  const payload = await requestServer('GET', '/status');
  if (payload?.ok !== true) {
    throw new Error('The chat API is reachable, but GROQ_API_KEY is not configured.');
  }
  return payload;
}

async function requestServerChat(message, conversationHistory = []) {
  return requestServer('POST', '', {
    message,
    conversationHistory,
  });
}

async function requestWithFallback(primaryRequest, fallbackRequest) {
  let primaryError;

  try {
    return await primaryRequest();
  } catch (error) {
    primaryError = error;
  }

  try {
    return await fallbackRequest();
  } catch {
    throw primaryError;
  }
}

export async function checkChatbotStatus() {
  const backendMode = resolveBackendMode();

  if (backendMode === 'server' || !isSupabaseConfigured) {
    return requestServerStatus();
  }

  if (backendMode === 'supabase') {
    return requestSupabaseStatus();
  }

  return requestWithFallback(requestSupabaseStatus, requestServerStatus);
}

export async function sendChatbotMessage({ message, conversationHistory = [] }) {
  const trimmedMessage = String(message || '').trim();
  if (!trimmedMessage) {
    throw new Error('Message is required.');
  }

  const backendMode = resolveBackendMode();
  if (backendMode === 'server' || !isSupabaseConfigured) {
    return requestServerChat(trimmedMessage, conversationHistory);
  }

  if (backendMode === 'supabase') {
    return requestSupabaseChat(trimmedMessage, conversationHistory);
  }

  return requestWithFallback(
    () => requestSupabaseChat(trimmedMessage, conversationHistory),
    () => requestServerChat(trimmedMessage, conversationHistory)
  );
}

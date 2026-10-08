// binge.'s own error log (no third-party tracker). Crashes caught by error
// boundaries, uncaught errors and unhandled promise rejections are sent to
// /api/ops/errors, which stores them in Supabase (error_events) for the
// admin panel's Errors tab. Noise from embedded players, extensions and
// flaky networks is dropped, and each distinct error is sent at most once a
// minute per tab.
import { api } from '../api';

const IGNORE = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection/i,
  /Load failed|Failed to fetch|NetworkError|network error/i,
  /AbortError|TimeoutError|The operation was aborted/i,
  /^Script error\.?$/i,
  /ChunkLoadError|Loading chunk \d+ failed/i, // stale tab after a deploy
];
const recent = new Map(); // fingerprint -> last sent ms
let installed = false;

function fingerprintOf(message, stack) {
  const firstFrame = String(stack || '').split('\n').find((line) => /at |@/.test(line)) || '';
  return `${String(message).slice(0, 160)}|${firstFrame.trim().slice(0, 160)}`;
}

export function reportError(error, context = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const message = String(error?.message || error || 'Unknown error').slice(0, 1000);
  if (IGNORE.some((pattern) => pattern.test(message))) return;
  const stack = String(error?.stack || context.componentStack || '').slice(0, 4000);
  const fingerprint = fingerprintOf(message, stack);
  if (Date.now() - (recent.get(fingerprint) || 0) < 60_000) return;
  recent.set(fingerprint, Date.now());
  api.post('/ops/errors', {
    message,
    stack: context.componentStack ? `${stack}\n\nComponent stack:${context.componentStack}`.slice(0, 4000) : stack,
    url: window.location.pathname + window.location.search,
    release: process.env.REACT_APP_VERSION || null,
  }).catch(() => { /* logging must never break the app */ });
}

export function initMonitoring() {
  if (installed || typeof window === 'undefined' || process.env.NODE_ENV !== 'production') return;
  installed = true;
  window.addEventListener('error', (event) => {
    // Errors from other origins (embeds) arrive as an opaque "Script error."
    if (!event.error && /^Script error/i.test(event.message || '')) return;
    reportError(event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason));
}

// Pop-up blocking for the embed servers' players. They're cross-origin
// iframes, so binge. can't see inside them or learn a pop-up's address.
// Instead the iframe is sandboxed without allow-popups / allow-top-navigation,
// so the browser itself refuses every pop-up, pop-under and redirect the
// player or an ad inside it tries (nested frames inherit the sandbox).
//
// Some players refuse to run sandboxed. They're loaded normally when:
//   - testing showed it (PROVIDERS[].sandbox === false in embedProviders.js), or
//   - this device learned it: a sandboxed load that never started playing,
//     then an unsandboxed load of the same server that did. Remembered for
//     14 days, then the sandbox is tried again (servers change).

import { EVENT_PROVIDERS, PROVIDERS } from './embedProviders';

// No allow-popups, allow-popups-to-escape-sandbox, allow-top-navigation*,
// allow-modals (alert/confirm traps) or allow-downloads. allow-same-origin
// keeps the player's own storage and CORS requests working; it can't lift
// the sandbox because the frame is cross-origin.
export const SANDBOX_FLAGS = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock allow-pointer-lock';

const KEY = 'binge:popupSandbox:refused';
export const RETRY_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

// How long a sandboxed load of an event server gets to report playback
// before it's reloaded unsandboxed (well inside FAILOVER_SECONDS, so a
// title the server doesn't have still fails over on time).
export const SANDBOX_CHECK_SECONDS = 12;

function readRefusals(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRefusals(storage, refusals) {
  try { storage?.setItem(KEY, JSON.stringify(refusals)); } catch { /* storage blocked */ }
}

const defaultStorage = () => (typeof window !== 'undefined' ? window.localStorage : null);

// Whether this server's player should load sandboxed. `known` is the
// server's tested setting (true / false / undefined = untested, try it).
export function shouldSandbox(providerId, known, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!providerId || known === false) return false;
  const refusedAt = Number(readRefusals(storage)[providerId]) || 0;
  return !(refusedAt && now - refusedAt < RETRY_AFTER_MS);
}

// Whether this server's player loads with its pop-ups blocked on this
// device: its tested setting (an untested server only if it reports
// playback, so a refusal can be noticed), unless this device learned that it
// refuses the sandbox. The player and the server lists both use this.
export function popupsBlocked(providerId, options) {
  const tested = PROVIDERS.find((entry) => entry.id === providerId)?.sandbox;
  return shouldSandbox(providerId, tested ?? (EVENT_PROVIDERS.has(providerId) ? undefined : false), options);
}

// This server wouldn't play sandboxed on this device.
export function rememberRefusal(providerId, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!providerId) return;
  writeRefusals(storage, { ...readRefusals(storage), [providerId]: now });
}

// It played sandboxed after all (e.g. after the 14 days): forget the refusal.
export function forgetRefusal(providerId, { storage = defaultStorage() } = {}) {
  const refusals = readRefusals(storage);
  if (!(providerId in refusals)) return;
  delete refusals[providerId];
  writeRefusals(storage, refusals);
}

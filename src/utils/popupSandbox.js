// Pop-up blocking for the embed servers' players. They're cross-origin
// iframes, so binge. can't see inside them or learn a pop-up's address.
// Instead the iframe is sandboxed without allow-popups / allow-top-navigation,
// so the browser itself refuses every pop-up, pop-under and redirect the
// player or an ad inside it tries (nested frames inherit the sandbox).
//
// Some players refuse to run sandboxed, so a server is sandboxed only when
// testing showed its video playing 5+ seconds in a sandboxed frame
// (PROVIDERS[].sandbox === true in embedProviders.js). An untested server
// loads normally: what it reports can't prove the sandbox works, because
// VidLink, VixSrc and VidSrc keep reporting playback time behind their
// "disable the sandbox" page. A tested server also loads normally where this
// device learned that it refuses (usePopupSandbox): a sandboxed load that
// didn't play, then an unsandboxed load of the same server that did.
// Remembered for 14 days, then the sandbox is tried again (servers change).

import { PROVIDERS } from './embedProviders';

// The sandbox itself is defined next to the servers (embedServers.js), so
// scripts/check-sandbox.js tests the same flags.
export { SANDBOX_FLAGS } from './embedServers';

const KEY = 'binge:popupSandbox:refused';
export const RETRY_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

// How long a sandboxed load of an event server gets to report playback
// before it's reloaded unsandboxed (well inside FAILOVER_SECONDS, so a
// title the server doesn't have still fails over on time).
export const SANDBOX_CHECK_SECONDS = 12;

// A load counts as playing once its video has played this long. A reported
// time alone proves nothing: it can be the resume position, or the first
// frame of a video that then froze (CineSrc did once in WebKit, sandboxed).
export const SANDBOX_PLAY_SECONDS = 5;

// Seconds of video this load has played, from the times the server reports
// (sampled once a second). Counting starts at the first new time, not at 0:
// that time may be a resume position, and `staleTime` (what the previous load
// of the same server last reported) is ignored. A jump back, or further ahead
// than the clock moved, is a seek and starts the count again.
export function createPlaybackMeter(staleTime = 0) {
  let first = null;
  let last = { time: staleTime, at: 0 };
  return function read(time, now) {
    if (time > 0 && time !== last.time) {
      const seeked = first && (time < last.time || time - last.time > (now - last.at) / 1000 + 3);
      if (!first || seeked) first = { time };
      last = { time, at: now };
    }
    return { started: Boolean(first), played: first ? last.time - first.time : 0 };
  };
}

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
// server's tested setting: only true sandboxes (false / undefined = refuses
// or untested).
export function shouldSandbox(providerId, known, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!providerId || known !== true) return false;
  const refusedAt = Number(readRefusals(storage)[providerId]) || 0;
  return !(refusedAt && now - refusedAt < RETRY_AFTER_MS);
}

// Whether this server's player loads with its pop-ups blocked on this
// device: tested to play sandboxed, unless this device learned that it
// refuses. The player and the server lists both use this.
export function popupsBlocked(providerId, options) {
  return shouldSandbox(providerId, PROVIDERS.find((entry) => entry.id === providerId)?.sandbox, options);
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

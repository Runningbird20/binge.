// Titles the active profile has watched — rated, marked Watched, or started
// (in Continue Watching, or any episode watched) — are never recommended:
// they're left out of the browse rows and spotlights on Home, Movies and TV,
// More Like This, and Surprise me. Search, person pages, franchises, the
// calendar and the profile's own rows (Continue Watching, My List, New
// Episodes, Sent to you) still list them.
//
// One shared copy of the profile's watched keys ("movie:12"), loaded once,
// reused for a minute, and refreshed whenever the profile's history changes
// (binge:historyChanged / binge:ratingSaved) or the profile switches. Rows
// keep the old copy while a new one loads, so nothing flickers.
import { useEffect, useSyncExternalStore } from 'react';
import { fetchWatchedTitleKeys } from './supabaseData';
import { getActiveProfileId, subscribeActiveProfile } from './activeProfile';

const FRESH_MS = 60 * 1000;
const NONE = new Set();
const listeners = new Set();
let state = { profile: null, keys: null };
let fetchedAt = 0;
let inflight = null;
let latest = 0; // only the newest request publishes

const profileKey = () => getActiveProfileId() || 'default';

export function titleKey(item) {
  return `${item?.media_type}:${Number(item?.media_id ?? item?.id)}`;
}

// The items not in `keys` (all of them when keys is empty or unknown).
export function withoutWatched(items, keys) {
  if (!Array.isArray(items) || !keys?.size) return items;
  return items.filter((item) => !keys.has(titleKey(item)));
}

function publish(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

// Resolves to the active profile's watched keys (an empty Set when signed
// out or offline). Shares one request; `force` skips the one-minute reuse.
export function loadWatchedKeys({ force = false } = {}) {
  const profile = profileKey();
  if (!force && state.profile === profile && state.keys && Date.now() - fetchedAt < FRESH_MS) {
    return Promise.resolve(state.keys);
  }
  if (!force && inflight?.profile === profile) return inflight.promise;
  latest += 1;
  const request = latest;
  const promise = Promise.resolve()
    .then(() => fetchWatchedTitleKeys())
    .catch(() => new Set())
    .then((keys) => {
      const known = keys instanceof Set ? keys : new Set();
      if (request === latest && profileKey() === profile) {
        fetchedAt = Date.now();
        publish({ profile, keys: known });
      }
      return known;
    })
    .finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { profile, promise };
  return promise;
}

export function resetWatchedKeys() {
  inflight = null;
  fetchedAt = 0;
  publish({ profile: null, keys: null });
}

// History changed: reload now if anything on screen is filtering.
function refresh() {
  fetchedAt = 0;
  if (listeners.size) loadWatchedKeys({ force: true });
}

if (typeof window !== 'undefined') {
  ['binge:historyChanged', 'binge:ratingSaved'].forEach((name) => window.addEventListener(name, refresh));
  // Another profile: rows re-render (as loading) and load its keys.
  subscribeActiveProfile(() => {
    inflight = null;
    publish({ ...state });
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

// The watched keys for the active profile, or null while they first load.
// With enabled=false it loads nothing and returns an empty Set.
export function useWatchedKeys(enabled = true) {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const profile = profileKey();
  useEffect(() => {
    if (enabled) loadWatchedKeys();
  }, [enabled, profile]);
  if (!enabled) return NONE;
  return current.profile === profile ? current.keys : null;
}

// What a page showed last time, kept on this device for a week, so Home and
// the Movies/Series rows paint at once on a new visit while fresh data loads
// (the TV apps' HomeSnapshot). Keys that hold a profile's own data include
// its id; signing out clears them all. Best effort: a full or blocked
// storage just means a normal load.
const PREFIX = 'binge:keep:';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_BYTES = 400_000;

function storage() {
  try { return window.localStorage; } catch { return null; }
}

export function readKept(key, { maxAgeMs = MAX_AGE_MS, now = Date.now() } = {}) {
  const store = storage();
  if (!key || !store) return undefined;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { at, value } = JSON.parse(raw);
    return now - at < maxAgeMs ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeKept(key, value, { now = Date.now() } = {}) {
  const store = storage();
  if (!key || !store || value === undefined) return;
  let text;
  try { text = JSON.stringify({ at: now, value }); } catch { return; }
  if (text.length > MAX_BYTES) return;
  try {
    store.setItem(PREFIX + key, text);
  } catch {
    // Full: drop the oldest kept entries and try once more.
    pruneKept(store, 0.5);
    try { store.setItem(PREFIX + key, text); } catch { /* give up quietly */ }
  }
}

function keptKeys(store) {
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

function pruneKept(store, share) {
  const entries = keptKeys(store).map((key) => {
    try { return [key, JSON.parse(store.getItem(key)).at || 0]; } catch { return [key, 0]; }
  }).sort((a, b) => a[1] - b[1]);
  entries.slice(0, Math.ceil(entries.length * share)).forEach(([key]) => store.removeItem(key));
}

export function clearKept() {
  const store = storage();
  if (store) keptKeys(store).forEach((key) => store.removeItem(key));
}

// Where the viewer stopped in each movie / episode (per profile, this
// device). Fed by the embed players' time messages; used to start the next
// load — or a mid-play server switch — at the same moment.
import { getActiveProfileId } from './activeProfile';

const KEY_PREFIX = 'binge:positions:';
const MAX_ENTRIES = 400;

function storageKey() {
  return `${KEY_PREFIX}${getActiveProfileId() || 'default'}`;
}

function readAll() {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey()) || '{}') || {};
  } catch {
    return {};
  }
}

function writeAll(store) {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(store));
  } catch {
    // Storage full or blocked — resume just won't persist on this device.
  }
}

export function positionKey(mediaType, mediaId, season, episode) {
  return mediaType === 'tv_show' ? `tv:${mediaId}:${season}:${episode}` : `movie:${mediaId}`;
}

// Seconds to resume at, or null when there's nothing worth resuming (barely
// started, or effectively finished).
export function getResumePosition(key) {
  const entry = readAll()[key];
  if (!entry || !(entry.t > 30)) return null;
  if (entry.d && entry.t > entry.d - 120) return null;
  return Math.floor(entry.t);
}

// Raw entry ({ t, d, at }) — used to compare against the synced copy.
export function getPositionEntry(key) {
  return readAll()[key] || null;
}

// Adopt a position from another device if it's newer than ours.
export function mergeRemotePosition(key, seconds, duration, updatedAt) {
  if (!(seconds > 0)) return false;
  const local = readAll()[key];
  if (local && (local.at || 0) >= (updatedAt || 0)) return false;
  const store = readAll();
  store[key] = { t: Math.floor(seconds), d: duration || local?.d || null, at: updatedAt || Date.now() };
  writeAll(store);
  return true;
}

export function savePosition(key, seconds, duration) {
  if (!(seconds > 0)) return;
  const store = readAll();
  store[key] = { t: Math.floor(seconds), d: duration > 0 ? Math.floor(duration) : store[key]?.d || null, at: Date.now() };
  const entries = Object.entries(store).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_ENTRIES);
  writeAll(Object.fromEntries(entries));
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

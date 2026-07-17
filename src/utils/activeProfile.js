// Tracks which account_profiles row is "active" right now — read internally
// by the watchlist/ratings/continue-watching/episode-progress functions in
// supabaseData.js so every one of their many existing call sites across the
// app keeps working unchanged, instead of threading a profileId parameter
// through all of them individually.
let activeProfileId = null;
const listeners = new Set();

const STORAGE_KEY = 'activeProfileId';

export function getActiveProfileId() {
  return activeProfileId;
}

export function setActiveProfileId(id) {
  activeProfileId = id || null;
  try {
    if (activeProfileId) {
      window.localStorage.setItem(STORAGE_KEY, activeProfileId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private browsing, etc.) — in-memory value still works.
  }
  listeners.forEach((fn) => fn(activeProfileId));
}

export function loadStoredActiveProfileId() {
  try {
    activeProfileId = window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    activeProfileId = null;
  }
  return activeProfileId;
}

export function clearActiveProfileId() {
  setActiveProfileId(null);
}

// Lets AuthContext (or anything else) react when the active profile changes,
// e.g. to re-fetch profile-scoped data after a switch.
export function subscribeActiveProfile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

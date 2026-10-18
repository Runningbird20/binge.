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

// Whether the active profile also owns rows with no profile_id (saved before
// profiles existed). True for the default profile and for an account's only
// profile — the same rule as the TV app. Remembered so the first queries
// after a reload (before the profile list arrives) agree with later ones.
const LEGACY_KEY = 'activeProfileOwnsLegacy';
let ownsLegacy = (() => {
  try { return window.localStorage.getItem(LEGACY_KEY) !== '0'; } catch { return true; }
})();

export function activeProfileOwnsLegacyRows() {
  return ownsLegacy;
}

export function setActiveProfileOwnsLegacyRows(value) {
  ownsLegacy = Boolean(value);
  try { window.localStorage.setItem(LEGACY_KEY, ownsLegacy ? '1' : '0'); } catch { /* storage unavailable */ }
}

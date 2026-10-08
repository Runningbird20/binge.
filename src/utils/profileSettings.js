// Per-profile switches (Settings page). Stored locally for instant reads and
// synced to account_profiles.settings so they follow the profile across
// devices; the profile row wins when it loads (it's written on every change).
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

const KEY = 'binge:profile-settings:';
export const SETTINGS_EVENT = 'binge:settings';

export const DEFAULT_SETTINGS = {
  autoNext: true,     // Up Next countdown plays the next episode by itself
  previews: true,     // muted trailers on hover and in the billboard
  dataSaver: false,   // ask servers for lower quality
  haptics: true,      // vibration feedback on supported phones
};

function storageKey() {
  return `${KEY}${getActiveProfileId() || 'default'}`;
}

export function getSettings() {
  try {
    const raw = window.localStorage.getItem(storageKey());
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeLocal(settings) {
  try { window.localStorage.setItem(storageKey(), JSON.stringify(settings)); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings })); } catch { /* old browsers */ }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeLocal(next);
  const profileId = getActiveProfileId();
  if (profileId && isSupabaseConfigured && supabase) {
    supabase.from('account_profiles').update({ settings: next }).eq('id', profileId).then(() => {}, () => {});
  }
  return next;
}

export function hydrateSettings(profile) {
  if (profile?.settings && typeof profile.settings === 'object' && Object.keys(profile.settings).length) {
    writeLocal({ ...DEFAULT_SETTINGS, ...profile.settings });
  }
}

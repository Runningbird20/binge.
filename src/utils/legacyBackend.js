export function isLegacyBackendEnabled() {
  return String(process.env.REACT_APP_ENABLE_LEGACY_BACKEND || '').toLowerCase() === 'true';
}

export function hasLegacyBackendSession() {
  if (typeof window === 'undefined' || !isLegacyBackendEnabled()) {
    return false;
  }

  try {
    return Boolean(window.localStorage.getItem('token'));
  } catch {
    return false;
  }
}

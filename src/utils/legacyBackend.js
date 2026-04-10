export function hasLegacyBackendSession() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return Boolean(window.localStorage.getItem('token'));
  } catch {
    return false;
  }
}

// Where the browser reaches this app's own API (/api/neon-data and the
// Express routes). Neon Postgres is only reached through that API.

const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host || '');

// A localhost API URL (from a copied .env) only makes sense when the page is
// also local; a deployed site uses its own origin's /api instead.
export function getApiBaseUrl() {
  const configured = (
    process.env.REACT_APP_API_URL ||
    process.env.REACT_APP_LEGACY_API_URL ||
    ''
  ).trim().replace(/\/+$/, '');
  if (!configured || typeof window === 'undefined') return configured;
  try {
    const target = new URL(configured, window.location.href);
    if (isLocalHost(target.hostname) && !isLocalHost(window.location.hostname)) return '';
  } catch {
    return '';
  }
  return configured;
}

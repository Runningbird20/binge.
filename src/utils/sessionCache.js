// In-memory, per-tab cache for page-level data (catalog browse results,
// ratings, watchlist, continue-watching, etc). It's a plain module-level
// Map, so it survives SPA route changes (unmount/remount of the page
// component) but is cleared on a full page reload — that's the right
// lifetime for this data: no point re-fetching the movies catalog every
// time you tab back to it from a detail page, but also no need to persist
// it to disk or worry about it going stale across browser sessions.
//
// Usage is stale-while-revalidate: callers hydrate from the cache
// immediately (skipping the loading spinner) if an entry exists, then
// always kick off a real fetch in the background to refresh it — see
// useSessionCachedFetch below for the common case.
const store = new Map();

export function getCached(key) {
  return store.has(key) ? store.get(key) : undefined;
}

export function setCached(key, value) {
  store.set(key, value);
  return value;
}

export function invalidateCached(key) {
  store.delete(key);
}

// Removes every cached entry whose key starts with `prefix` — for
// invalidating "all catalog views for this media type" after a mutation
// that could change facets (e.g. an import), without needing to know the
// exact filter/sort/search combination that produced each cached key.
export function invalidateCachedPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

// Shared key shape for the Movies/TVShows/Books catalog views, so the same
// browse state (filters + sort + kids-mode) reliably hits the same cache
// entry across a session regardless of which page built the key.
export function buildCatalogCacheKey(mediaType, { genreValues = [], searchTerm = '', sortMode = 'featured', kidsSafe = false } = {}) {
  return [
    'catalog',
    mediaType,
    [...genreValues].sort().join(','),
    searchTerm.trim().toLowerCase(),
    sortMode,
    kidsSafe ? 'kids' : 'all',
  ].join('::');
}

// Shared key shape for a user's own watchlist/ratings/continue-watching data
// (Home, Profile). Scoped by profileId as well as userId since switching the
// active profile changes what these queries return.
export function buildUserDataCacheKey(namespace, userId, profileId) {
  return ['user-data', namespace, userId || '', profileId || ''].join('::');
}

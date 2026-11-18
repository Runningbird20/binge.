// AniList GraphQL (https://docs.anilist.co) — free, no key, CORS-enabled,
// rate limited to ~90 requests/min per IP. The player uses it to find an
// anime's MyAnimeList id for AniSkip's intro and credits markers
// (utils/episodeMarkers.js).
const ENDPOINT = 'https://graphql.anilist.co';
const CACHE_MS = 30 * 60 * 1000;

const cache = new Map(); // body -> { at, promise }

export class AniListError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Requests are shared through the cache, so the network call itself is never
// tied to one caller's AbortSignal (React's dev double-mount would otherwise
// cancel the shared request for everyone). A caller that aborts just stops
// waiting.
export async function anilistQuery(query, variables = {}, signal) {
  const body = JSON.stringify({ query, variables });
  let hit = cache.get(body);
  if (!hit || Date.now() - hit.at >= CACHE_MS) {
    const promise = (async () => {
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        });
      } catch {
        throw new AniListError('Couldn’t reach AniList. Check your connection and try again.', 0);
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('Retry-After')) || 60;
        throw new AniListError(`AniList is busy — try again in about ${wait} seconds.`, 429);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.errors) {
        const message = json?.errors?.[0]?.message || `AniList error (${res.status})`;
        throw new AniListError(res.status === 404 ? 'That series wasn’t found.' : message, res.status);
      }
      return json.data;
    })();
    hit = { at: Date.now(), promise };
    cache.set(body, hit);
    promise.catch(() => { if (cache.get(body) === hit) cache.delete(body); }); // don't cache failures
  }
  if (!signal) return hit.promise;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    hit.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

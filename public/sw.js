const CACHE_NAME = 'binge-shell-v2';
const IMAGE_CACHE_NAME = 'binge-images-v1';
const IMAGE_CACHE_MAX_ENTRIES = 400;
const VALID_CACHE_NAMES = [CACHE_NAME, IMAGE_CACHE_NAME];
const SHELL_ASSETS = ['/', '/index.html', '/manifest.json'];
const BLOCKED_AD_HOST_PARTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'popads.net',
  'propellerads.com',
];
const BLOCKED_AD_PATH_PARTS = ['/ads/', '/adserver', '/advert', '/banner', '/popunder', '/popup'];

function isBlockedAdRequest(url) {
  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`.toLowerCase();
  return (
    BLOCKED_AD_HOST_PARTS.some((part) => host.includes(part)) ||
    BLOCKED_AD_PATH_PARTS.some((part) => path.includes(part))
  );
}

// Poster/cover art comes from third-party hosts (TMDB, Plex, Open Library,
// Supabase storage), so it can't be caught by the same-origin static-asset
// rule below — it needs its own origin-agnostic check.
function isImageRequest(request, url) {
  if (request.destination === 'image') return true;
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url.pathname);
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Cache.keys() preserves insertion order, so the front of the list is the
  // oldest entries — good enough as a size cap without tracking real LRU.
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !VALID_CACHE_NAMES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (isBlockedAdRequest(url)) {
    event.respondWith(new Response(null, { status: 204, statusText: 'Blocked by Binge ad blocker' }));
    return;
  }

  // Cache-first for poster/cover art, regardless of origin — this is the
  // bulk of what's slow to re-load on Movies/TV/Books/Home/Profile, and
  // previously fell through the origin check below and was never cached
  // by the app at all (only whatever the remote host's own HTTP caching
  // happened to provide, which several of these hosts don't set well).
  if (isImageRequest(event.request, url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cross-origin <img> requests (no explicit CORS mode) come back
          // opaque — status 0, ok:false — by design. That's still a valid,
          // cacheable response; we just can't inspect it.
          if (response.ok || response.type === 'opaque') {
            const responseCopy = response.clone();
            caches.open(IMAGE_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseCopy);
              trimCache(IMAGE_CACHE_NAME, IMAGE_CACHE_MAX_ENTRIES);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Never intercept Supabase, API, or other cross-origin requests
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML so the app always loads fresh
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, fonts — images are handled above)
  if (/\.(js|css|ico|woff2?|ttf)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        });
      })
    );
  }
});

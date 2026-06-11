// Add blocked ad domains to the BLOCKED_DOMAINS array below
// NOTE: This list must be kept in sync with the BLOCKED_DOMAINS array in
// src/components/PopupShield.jsx — they cannot share a module because this
// file is a plain Service Worker script.
const BLOCKED_DOMAINS = [
  'REPLACE_WITH_AD_DOMAIN_1',
  'REPLACE_WITH_AD_DOMAIN_2',
];

const CACHE_NAME = 'binge-shell-v1';
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

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d))) {
    event.respondWith(new Response('', { status: 200, statusText: 'Blocked by Binge PopupShield' }));
    return;
  }

  if (isBlockedAdRequest(url)) {
    event.respondWith(new Response(null, { status: 204, statusText: 'Blocked by Binge ad blocker' }));
    return;
  }

  // Never intercept Supabase, API, or cross-origin requests
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

  // Cache-first for static assets (JS, CSS, images, fonts)
  if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)(\?|$)/.test(url.pathname)) {
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

const CACHE_NAME = 'binge-shell-v2';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.json'];

// ── Ad-blocking (mirrors server/utils/adBlocklist.js) ─────────────────────────
// This catches ad requests that slip through server-side filtering and run inside
// the proxied embed page (JS-initiated fetches whose URLs are rewritten to /api/proxy).
const AD_DOMAINS = new Set([
  'doubleclick.net','googlesyndication.com','googleadservices.com',
  'googletagmanager.com','googletagservices.com','adservice.google.com',
  'adnxs.com','adnxs.net','rubiconproject.com','pubmatic.com',
  'openx.net','openx.com','casalemedia.com','indexww.com',
  'smartadserver.com','criteo.com','criteo.net','outbrain.com',
  'taboola.com','sharethrough.com','sovrn.com','lijit.com','33across.com',
  'popads.net','popad.co','popunder.ru','exoclick.com','exosrv.com',
  'juicyads.net','juicyads.com','trafficjunky.net','trafficjunky.com',
  'traffichouse.net','adsterra.com','adsterra.network',
  'propellerads.com','propellerclick.com','propeller-cdn.com',
  'hilltopads.net','hilltopads.com','adcash.com','mgid.com','mgid.eu',
  'clickadu.com','bidvertiser.com','revcontent.com','revenueads.net',
  'adespresso.com','zedo.com','adhaven.com','adspyglass.com',
  'oclaserver.com','oclasrv.com','onclickads.net','onclasrv.com',
  'adtng.com','adtng.net','go2speed.org','adf.ly','shrinkme.io',
  'ouo.io','bc.vc','sh.st','shorte.st',
  'quantserve.com','quantcount.com','lotame.com','bluekai.com',
  'krxd.net','demdex.net','scorecardresearch.com','adsrvr.org',
  'turn.com','mediaplex.com','imrworldwide.com','addthis.com',
  'addthisedge.com','sharethis.com','tiqcdn.com','akamaihd.net',
  'popupads.net','popcash.net','adcolony.com','inmobi.com','loopme.com',
  'aerserv.com','adfalcon.com','weborama.fr','weborama.com',
  'xapads.com','trafmag.com','googlr.net','gogle.co',
]);

function isAdHostname(h) {
  const clean = h.toLowerCase().replace(/^www\./, '');
  if (AD_DOMAINS.has(clean)) return true;
  const parts = clean.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (AD_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
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

  // Never intercept cross-origin requests
  if (url.origin !== self.location.origin) return;

  // For /api/proxy requests: block if the target URL belongs to an ad domain.
  // This catches ad network calls made from inside the proxied embed page whose
  // URLs have been rewritten by embedProxy.js to go through our resource proxy.
  if (url.pathname === '/api/proxy') {
    const target = url.searchParams.get('url');
    if (target) {
      try {
        if (isAdHostname(new URL(target).hostname)) {
          event.respondWith(new Response('', { status: 204 }));
          return;
        }
      } catch { /* malformed target — let it through to the server */ }
    }
  }

  // Skip remaining SW logic for all other API routes
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

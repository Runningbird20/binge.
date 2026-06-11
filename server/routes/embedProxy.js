const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const { URL } = require('url');

// Build the guard + base-href + SPA-route-fix injection for a proxied HTML page.
// Injected right after <head> (or prepended) so the base tag is parsed before any assets.
function buildHeadInjection(origin, originalPath, originalSearch) {
  const safeOrigin = origin.replace(/'/g, "\\'");
  const safePath   = (originalPath + originalSearch).replace(/'/g, "\\'");

  return `<script>(function(){
  // Set <base> so relative asset paths resolve against the original host.
  var b = document.createElement('base');
  b.href = '${safeOrigin}/';
  var h = document.head || document.getElementsByTagName('head')[0];
  if (h) h.insertBefore(b, h.firstChild);

  // Fix the URL so SPA routers see the original path, not the proxy path.
  try { history.replaceState(null, '', '${safePath}'); } catch(e) {}

  // Block window.open() — kills popup ads.
  var _open = window.open;
  window.open = function(url, name, features) {
    if (!url || url === 'about:blank') return _open.apply(this, arguments);
    return null;
  };

  // Block ALL navigation from inside the iframe so the proxied SPA can't
  // escape to our origin. location.assign/replace/reload are patched; we
  // also shadow location.href via the prototype to stop direct assignment.
  try {
    var noop = function(){};
    window.location.assign  = noop;
    window.location.replace = noop;
    window.location.reload  = noop;

    // Intercept href property assignment on the Location prototype.
    var locProto = Object.getPrototypeOf(window.location);
    var hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
    if (hrefDesc && hrefDesc.set) {
      Object.defineProperty(locProto, 'href', {
        get: hrefDesc.get,
        set: noop,
        configurable: true,
      });
    }
  } catch(e) {}
}());</script>`;
}

// Fetches an embed page, strips framing-denial headers, injects base-href + SPA fix.
router.get('/', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  let parsed;
  try {
    parsed = new URL(decodeURIComponent(url));
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https allowed' });
  }

  const origin = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
  const injection = buildHeadInjection(origin, parsed.pathname, parsed.search);

  const lib = parsed.protocol === 'https:' ? https : http;
  const proxyReq = lib.request(
    {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      timeout: 10000,
    },
    (upstream) => {
      const strip = new Set(['x-frame-options', 'content-security-policy', 'frame-options', 'content-length']);
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (!strip.has(k.toLowerCase())) res.set(k, v);
      }
      res.set('Access-Control-Allow-Origin', '*');

      const contentType = (upstream.headers['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html');

      if (!isHtml) {
        // Non-HTML (JS, CSS, images, etc.) — pipe straight through
        res.status(upstream.statusCode);
        upstream.pipe(res);
        return;
      }

      // Buffer HTML so we can inject the head script
      res.status(upstream.statusCode);
      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', chunk => { body += chunk; });
      upstream.on('end', () => {
        // Inject right after <head> so base href is set before any assets load.
        // Fall back to before </head>, then to prepend.
        if (body.includes('<head>')) {
          body = body.replace('<head>', '<head>' + injection);
        } else if (body.includes('</head>')) {
          body = body.replace('</head>', injection + '</head>');
        } else {
          body = injection + body;
        }
        res.send(body);
      });
    },
  );

  proxyReq.on('error',   () => { if (!res.headersSent) res.status(502).json({ error: 'Upstream error' }); });
  proxyReq.on('timeout', () => { proxyReq.destroy(); if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' }); });
  proxyReq.end();
});

module.exports = router;

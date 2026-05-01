const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const { URL } = require('url');

// Injected before </head> in every proxied HTML page.
// Blocks automatic popups and top-frame navigation attempts from embed pages.
const GUARD_SCRIPT = `<script>(function(){
  // Block window.open() — kills popup ads; player UI popups opened on direct user
  // tap are still blocked, but that's an acceptable trade-off vs. auto-popup ads.
  var _open = window.open;
  window.open = function(url, name, features) {
    if (!url || url === 'about:blank') return _open.apply(this, arguments);
    return null;
  };

  // Block automatic top-frame navigation (popunder redirects).
  // User-initiated anchor clicks are unaffected — only script-driven changes are caught.
  try {
    var _assign   = window.location.assign.bind(window.location);
    var _replace  = window.location.replace.bind(window.location);
    window.location.assign  = function(u){ if (window === window.top) _assign(u); };
    window.location.replace = function(u){ if (window === window.top) _replace(u); };
  } catch(e) {}
}());</script>`;

// Fetches an embed page, strips framing-denial headers, and injects popup guard.
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

      // Buffer HTML so we can inject the guard script
      res.status(upstream.statusCode);
      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', chunk => { body += chunk; });
      upstream.on('end', () => {
        // Inject guard just before </head>; fall back to prepending if no </head>
        if (body.includes('</head>')) {
          body = body.replace('</head>', GUARD_SCRIPT + '</head>');
        } else {
          body = GUARD_SCRIPT + body;
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

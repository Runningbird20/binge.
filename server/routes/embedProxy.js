const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Fetches an embed page and strips framing-denial headers so it can be iframed.
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
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      timeout: 10000,
    },
    (upstream) => {
      res.status(upstream.statusCode);
      const strip = new Set(['x-frame-options', 'content-security-policy', 'frame-options']);
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (!strip.has(k.toLowerCase())) res.set(k, v);
      }
      res.set('Access-Control-Allow-Origin', '*');
      upstream.pipe(res);
    },
  );

  proxyReq.on('error',   () => { if (!res.headersSent) res.status(502).json({ error: 'Upstream error' }); });
  proxyReq.on('timeout', () => { proxyReq.destroy(); if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' }); });
  proxyReq.end();
});

module.exports = router;

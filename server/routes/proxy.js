const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_REDIRECTS = 5;

function fetchUrl(urlStr, redirectsLeft, res) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https allowed' });
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const req = lib.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': `${parsed.protocol}//${parsed.host}`,
        'Referer': urlStr,
      },
      timeout: 15000,
    },
    (upstream) => {
      const { statusCode } = upstream;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        if (redirectsLeft <= 0) return res.status(502).json({ error: 'Too many redirects' });
        const loc = upstream.headers.location;
        if (!loc) return res.status(502).json({ error: 'Redirect missing Location' });
        upstream.resume();
        return fetchUrl(
          loc.startsWith('http') ? loc : new URL(loc, urlStr).href,
          redirectsLeft - 1,
          res,
        );
      }
      res.status(statusCode);
      for (const h of ['content-type', 'content-length', 'cache-control', 'last-modified', 'etag']) {
        if (upstream.headers[h]) res.set(h, upstream.headers[h]);
      }
      res.set('Access-Control-Allow-Origin', '*');
      upstream.pipe(res);
    },
  );

  req.on('error',   () => { if (!res.headersSent) res.status(502).json({ error: 'Upstream error' }); });
  req.on('timeout', () => { req.destroy(); if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' }); });
  req.end();
}

router.get('/', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });
  let decoded;
  try { decoded = decodeURIComponent(url); new URL(decoded); } catch { return res.status(400).json({ error: 'Invalid url' }); }
  fetchUrl(decoded, MAX_REDIRECTS, res);
});

module.exports = router;

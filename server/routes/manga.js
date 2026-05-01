const express = require('express');
const router  = express.Router();
const https   = require('https');

const API_HOST = 'comick-source-api.notaspider.dev';

function upstreamRequest({ method, path, body }, res) {
  const bodyStr = body ? JSON.stringify(body) : null;
  const opts = {
    hostname: API_HOST,
    port: 443,
    path,
    method: method || 'GET',
    headers: {
      'Accept':     'application/json',
      'User-Agent': 'BingeApp/1.0',
      ...(bodyStr ? {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      } : {}),
    },
  };

  const req = https.request(opts, upstream => {
    if (upstream.statusCode === 429) {
      return res.status(429).json({ error: 'Rate limited — try again shortly.' });
    }
    if (upstream.statusCode >= 400) {
      return res.status(upstream.statusCode).json({ error: `Upstream ${upstream.statusCode}` });
    }

    // Collect body then forward — avoids gzip/encoding pipe issues
    const chunks = [];
    upstream.on('data', c => chunks.push(c));
    upstream.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(parsed);
      } catch {
        res.status(502).json({ error: 'Invalid upstream JSON' });
      }
    });
    upstream.on('error', err => {
      if (!res.headersSent) res.status(502).json({ error: err.message });
    });
  });

  req.on('error',   err => { if (!res.headersSent) res.status(502).json({ error: err.message }); });
  req.on('timeout', ()  => { req.destroy(); if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' }); });
  req.setTimeout(25000);

  if (bodyStr) req.write(bodyStr);
  req.end();
}

// GET /api/manga/sources
router.get('/sources', (req, res) => {
  upstreamRequest({ method: 'GET', path: '/api/sources' }, res);
});

// POST /api/manga/search   body: { query, source }
router.post('/search', (req, res) => {
  const { query = '', source = 'all' } = req.body || {};
  if (!query.trim()) return res.json({ results: [] });
  upstreamRequest({ method: 'POST', path: '/api/search', body: { query: query.slice(0, 200), source } }, res);
});

// POST /api/manga/chapters   body: { url, source? }
router.post('/chapters', (req, res) => {
  const { url, source } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  upstreamRequest({ method: 'POST', path: '/api/chapters', body: { url, source } }, res);
});

module.exports = router;

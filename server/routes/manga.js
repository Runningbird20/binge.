const express = require('express');
const router  = express.Router();

const API = 'https://comick-source-api.notaspider.dev';

async function upstream(path, { method = 'GET', body } = {}) {
  const opts = {
    method,
    headers: { 'Accept': 'application/json', 'User-Agent': 'BingeApp/1.0' },
    signal: AbortSignal.timeout(22000),
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const err = new Error(`Upstream ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json(); // native fetch decompresses gzip/brotli automatically
}

router.get('/sources', async (req, res) => {
  try {
    const data = await upstream('/api/sources');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/search', async (req, res) => {
  const { query = '', source = 'mangakatana' } = req.body || {};
  if (!query.trim()) return res.json({ results: [] });
  try {
    const data = await upstream('/api/search', {
      method: 'POST',
      body: { query: query.slice(0, 200), source },
    });
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/chapters', async (req, res) => {
  const { url, source } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const data = await upstream('/api/chapters', {
      method: 'POST',
      body: { url, source },
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;

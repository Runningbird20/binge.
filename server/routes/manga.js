const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');

const MDEX_BASE = 'https://api.mangadex.org';

function mdexFetch(path, res) {
  const url = `${MDEX_BASE}${path}`;
  const mod = url.startsWith('https') ? https : http;

  const req = mod.get(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'BingeApp/1.0',
    },
    timeout: 12000,
  }, upstream => {
    if (upstream.statusCode === 429) {
      return res.status(429).json({ error: 'MangaDex rate limit — try again shortly.' });
    }
    if (upstream.statusCode >= 400) {
      return res.status(upstream.statusCode).json({ error: `MangaDex ${upstream.statusCode}` });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60');
    upstream.pipe(res);
  });

  req.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  });
  req.on('timeout', () => {
    req.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'MangaDex timeout' });
  });
}

// GET /api/manga/search?title=&format=&page=&pageSize=
router.get('/search', (req, res) => {
  const { title = '', format = 'all', page = '1', pageSize = '24' } = req.query;

  const langMap = {
    manga:   ['ja'],
    manhwa:  ['ko'],
    manhua:  ['zh', 'zh-hk'],
    comics:  ['en'],
  };

  const params = new URLSearchParams();
  params.set('limit', String(Math.min(Number(pageSize) || 24, 48)));
  params.set('offset', String((Math.max(Number(page) || 1, 1) - 1) * (Number(pageSize) || 24)));
  ['cover_art', 'author'].forEach(v => params.append('includes[]', v));
  ['safe', 'suggestive'].forEach(v => params.append('contentRating[]', v));
  params.set('order[followedCount]', 'desc');
  params.set('hasAvailableChapters', 'true');
  params.append('availableTranslatedLanguage[]', 'en');
  if (title.trim()) params.set('title', title.trim().slice(0, 200));
  const langs = langMap[format];
  if (langs) langs.forEach(l => params.append('originalLanguage[]', l));

  mdexFetch(`/manga?${params}`, res);
});

// GET /api/manga/chapters/:mangaId
router.get('/chapters/:mangaId', (req, res) => {
  const { mangaId } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(mangaId)) return res.status(400).json({ error: 'Invalid manga ID' });

  const params = new URLSearchParams();
  params.append('translatedLanguage[]', 'en');
  params.set('order[chapter]', 'asc');
  params.set('limit', '500');
  params.append('includes[]', 'scanlation_group');
  ['safe', 'suggestive'].forEach(v => params.append('contentRating[]', v));

  mdexFetch(`/manga/${mangaId}/feed?${params}`, res);
});

// GET /api/manga/pages/:chapterId
router.get('/pages/:chapterId', (req, res) => {
  const { chapterId } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(chapterId)) return res.status(400).json({ error: 'Invalid chapter ID' });

  mdexFetch(`/at-home/server/${chapterId}`, res);
});

module.exports = router;

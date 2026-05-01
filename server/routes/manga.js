const express = require('express');
const router  = express.Router();

const MDX    = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';

async function mdx(path, params = {}) {
  const url = new URL(`${MDX}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item));
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = new Error(`MangaDex ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function normalizeManga(m) {
  const attrs  = m.attributes || {};
  const title  = attrs.title?.en || Object.values(attrs.title || {})[0] || 'Unknown';
  const desc   = attrs.description?.en || Object.values(attrs.description || {})[0] || '';
  const cover  = (m.relationships || []).find(r => r.type === 'cover_art');
  const author = (m.relationships || []).find(r => r.type === 'author');
  return {
    id:            m.id,
    title,
    description:   desc.replace(/\[\w+\]/g, '').trim().slice(0, 600),
    cover:         cover?.attributes?.fileName
                     ? `${COVERS}/${m.id}/${cover.attributes.fileName}.512.jpg`
                     : null,
    status:        attrs.status,
    year:          attrs.year,
    author:        author?.attributes?.name || '',
    tags:          (attrs.tags || [])
                     .filter(t => t.attributes?.group === 'genre')
                     .map(t => t.attributes.name.en)
                     .slice(0, 5),
    latestChapter: attrs.lastChapter,
    contentRating: attrs.contentRating,
  };
}

function normalizeChapter(c) {
  const attrs = c.attributes || {};
  const group = (c.relationships || []).find(r => r.type === 'scanlation_group');
  return {
    id:        c.id,
    number:    attrs.chapter,
    title:     attrs.title,
    volume:    attrs.volume,
    pages:     attrs.pages,
    publishAt: attrs.publishAt,
    group:     group?.attributes?.name || '',
    lang:      attrs.translatedLanguage,
  };
}

const CONTENT = ['safe', 'suggestive', 'erotica'];

// Search
router.get('/search', async (req, res) => {
  const { q = '', limit = 24 } = req.query;
  if (!q.trim()) return res.json({ results: [] });
  try {
    const data = await mdx('/manga', {
      title: q,
      limit: Math.min(Number(limit), 40),
      'includes[]':          ['cover_art', 'author'],
      'contentRating[]':     CONTENT,
      'order[relevance]':    'desc',
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ results: (data.data || []).map(normalizeManga) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Popular
router.get('/popular', async (req, res) => {
  try {
    const data = await mdx('/manga', {
      limit: 24,
      'includes[]':                     ['cover_art', 'author'],
      'order[followedCount]':           'desc',
      'contentRating[]':                ['safe', 'suggestive'],
      'availableTranslatedLanguage[]':  ['en'],
    });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ results: (data.data || []).map(normalizeManga) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Chapter list
router.get('/:id/chapters', async (req, res) => {
  try {
    // MangaDex paginates at 500; fetch up to 500 chapters (enough for most series)
    const data = await mdx(`/manga/${req.params.id}/feed`, {
      'translatedLanguage[]': ['en'],
      'order[chapter]':       'asc',
      limit:                  500,
      'includes[]':           ['scanlation_group'],
      'contentRating[]':      CONTENT,
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ chapters: (data.data || []).map(normalizeChapter) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Chapter pages
router.get('/chapter/:id/pages', async (req, res) => {
  try {
    const data   = await mdx(`/at-home/server/${req.params.id}`);
    const { hash, data: files, dataSaver } = data.chapter || {};
    const base   = data.baseUrl;
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({
      pages:          (files     || []).map(f => `${base}/data/${hash}/${f}`),
      dataSaverPages: (dataSaver || []).map(f => `${base}/data-saver/${hash}/${f}`),
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;

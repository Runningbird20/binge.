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
  // MangaDex's main title is often romanized ("Na Honjaman Level-Up");
  // prefer an English alternate title ("Solo Leveling") when there is one.
  const englishAlt = (attrs.altTitles || []).find((alt) => alt.en)?.en;
  const original = attrs.title?.en || Object.values(attrs.title || {})[0] || 'Unknown';
  const isRomanized = attrs.originalLanguage && attrs.originalLanguage !== 'en' && !attrs.title?.en?.match(/[^\x00-\x7F]/)
    && englishAlt && englishAlt.toLowerCase() !== original.toLowerCase();
  const title  = isRomanized ? englishAlt : original;
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
    originalLanguage: attrs.originalLanguage,
    originalTitle: isRomanized ? original : null,
    // Cross-references for "Where to read" (AniList id, official English
    // publisher page) — MangaDex keeps both in attributes.links.
    anilistId: /^\d+$/.test(String(attrs.links?.al || '')) ? Number(attrs.links.al) : null,
    officialUrl: /^https:\/\//.test(String(attrs.links?.engtl || '')) ? attrs.links.engtl : null,
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
    // Officially licensed chapters live on the publisher's platform
    // (TappyToon, Webnovel, MANGA Plus…) and have no pages on MangaDex.
    externalUrl: attrs.externalUrl || null,
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
      'contentRating[]':     ['safe', 'suggestive'],
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

// Browse rows: original language, genre and sort, for the Manga & Comics
// landing page. Genre names map to MangaDex tag ids (fetched once, cached).
let tagCache = null;
async function tagIdsByName() {
  if (tagCache && Date.now() - tagCache.time < 24 * 60 * 60 * 1000) return tagCache.map;
  const data = await mdx('/manga/tag');
  const map = new Map((data.data || []).map((tag) => [String(tag.attributes?.name?.en || '').toLowerCase(), tag.id]));
  tagCache = { map, time: Date.now() };
  return map;
}

const BROWSE_ORDERS = {
  popular: { 'order[followedCount]': 'desc' },
  rating: { 'order[rating]': 'desc' },
  latest: { 'order[latestUploadedChapter]': 'desc' },
  new: { 'order[createdAt]': 'desc' },
};
const browseCache = new Map();

router.get('/browse', async (req, res) => {
  const { lang = '', tags = '', order = 'popular' } = req.query;
  const limit = Math.min(Number(req.query.limit) || 24, 40);
  const cacheKey = `${lang}|${tags}|${order}|${limit}`;
  const cached = browseCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 10 * 60 * 1000) return res.json({ results: cached.results });
  try {
    const params = {
      limit,
      'includes[]': ['cover_art', 'author'],
      'contentRating[]': ['safe', 'suggestive'],
      'availableTranslatedLanguage[]': ['en'],
      'hasAvailableChapters': 'true',
      ...(BROWSE_ORDERS[order] || BROWSE_ORDERS.popular),
    };
    if (/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) params['originalLanguage[]'] = [lang];
    const names = String(tags).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (names.length) {
      const ids = await tagIdsByName();
      const tagIds = names.map((name) => ids.get(name)).filter(Boolean);
      if (tagIds.length) params['includedTags[]'] = tagIds;
    }
    const data = await mdx('/manga', params);
    const results = (data.data || []).map(normalizeManga);
    browseCache.set(cacheKey, { results, time: Date.now() });
    if (browseCache.size > 200) browseCache.delete(browseCache.keys().next().value);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({ results });
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

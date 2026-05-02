// Dedicated Vercel serverless function for MangaDex proxy.
// Handles all /api/manga/* routes without going through the [..slug] Express chain.
const MDX    = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';
const CONTENT = ['safe', 'suggestive', 'erotica'];

async function mdxFetch(path, params = {}) {
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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Vercel sets req.query.path for [...path].js catch-all files
    const pathParam = req.query.path;
    const segments = Array.isArray(pathParam)
      ? pathParam
      : (pathParam ? String(pathParam).split('/').filter(Boolean) : []);

    // GET /api/manga/popular
    if (segments[0] === 'popular' && segments.length === 1) {
      const data = await mdxFetch('/manga', {
        limit:                            24,
        'includes[]':                     ['cover_art', 'author'],
        'order[followedCount]':           'desc',
        'contentRating[]':                ['safe', 'suggestive'],
        'availableTranslatedLanguage[]':  ['en'],
      });
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json({ results: (data.data || []).map(normalizeManga) });
    }

    // GET /api/manga/search?q=...
    if (segments[0] === 'search' && segments.length === 1) {
      const q = req.query.q || '';
      if (!q.trim()) return res.json({ results: [] });
      const data = await mdxFetch('/manga', {
        title:               q.trim(),
        limit:               Math.min(Number(req.query.limit || 24), 40),
        'includes[]':        ['cover_art', 'author'],
        'contentRating[]':   CONTENT,
        'order[relevance]':  'desc',
      });
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json({ results: (data.data || []).map(normalizeManga) });
    }

    // GET /api/manga/chapter/:id/pages
    if (segments[0] === 'chapter' && segments[2] === 'pages' && segments.length === 3) {
      const chapterId = segments[1];
      const data = await mdxFetch(`/at-home/server/${chapterId}`);
      const { hash, data: files, dataSaver } = data.chapter || {};
      const base = data.baseUrl;
      res.setHeader('Cache-Control', 'public, max-age=600');
      return res.json({
        pages:          (files     || []).map(f => `${base}/data/${hash}/${f}`),
        dataSaverPages: (dataSaver || []).map(f => `${base}/data-saver/${hash}/${f}`),
      });
    }

    // GET /api/manga/:id/chapters
    if (segments.length === 2 && segments[1] === 'chapters') {
      const mangaId = segments[0];
      const data = await mdxFetch(`/manga/${mangaId}/feed`, {
        'translatedLanguage[]': ['en'],
        'order[chapter]':       'asc',
        limit:                  500,
        'includes[]':           ['scanlation_group'],
        'contentRating[]':      CONTENT,
      });
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json({ chapters: (data.data || []).map(normalizeChapter) });
    }

    return res.status(404).json({ error: 'Manga route not found.' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};

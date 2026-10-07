const express = require('express');
const router  = express.Router();

async function gutendexGet(path, signal) {
  const res = await fetch(`https://gutendex.com${path}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'BingeApp/1.0' },
    signal: signal ?? AbortSignal.timeout(12000),
  });
  if (!res.ok) throw Object.assign(new Error(`Gutendex ${res.status}`), { status: res.status });
  return res.json();
}

// ── Gutenberg search (via Gutendex) ───────────────────────────
router.get('/gutenberg/search', async (req, res) => {
  const { q = '', page = '1' } = req.query;
  if (!q.trim()) return res.json({ count: 0, books: [] });
  try {
    const data = await gutendexGet(
      `/books/?search=${encodeURIComponent(q.trim())}&page=${page}&languages=en`
    );
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      count: data.count,
      next: !!data.next,
      books: (data.results || []).map(b => ({
        id:            b.id,
        title:         b.title,
        authors:       (b.authors || []).map(a => {
                         const parts = a.name.split(', ');
                         return parts.length === 2 ? `${parts[1]} ${parts[0]}` : a.name;
                       }).join(', '),
        cover:         b.formats?.['image/jpeg'] ?? null,
        downloadCount: b.download_count,
        hasHtml:       !!(b.formats?.['text/html']),
        subjects:      (b.subjects || []).slice(0, 3),
      })),
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── In-site reader for free public-domain editions ─────────────
// Gutenberg pages are fetched straight from gutenberg.org (the old route
// asked Gutendex for the file URL first — ~28s per request when measured).
// Standard Ebooks pages forbid framing (X-Frame-Options: sameorigin), so
// both are proxied and served from our origin, which also lets the client
// reader restyle them (font size, light/sepia/dark) and remember the
// scroll position. Scripts from the source pages are not allowed to run.
const READER_CACHE_TTL = 6 * 60 * 60 * 1000;
const readerCache = new Map();

const READER_STYLE = `<style id="binge-reader-base">
  html { -webkit-text-size-adjust: 100%; }
  body { font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif; max-width: 42rem; margin: 0 auto;
         padding: 2.5rem 1.5rem 6rem; line-height: 1.75; font-size: 1.15rem; color: #1d1d1f; background: #fbfaf7; }
  h1, h2, h3, h4 { line-height: 1.25; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; }
  a { color: inherit; }
  /* Gutenberg boilerplate header/footer */
  #pg-header, #pg-footer, section.pg-boilerplate { opacity: 0.55; font-size: 0.85em; }
</style>`;

async function fetchReaderPage(url) {
  const cached = readerCache.get(url);
  if (cached && Date.now() - cached.time < READER_CACHE_TTL) return cached.html;
  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'BingeApp/1.0 (+reader)', Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(12000),
  });
  if (!upstream.ok) throw Object.assign(new Error(`upstream ${upstream.status}`), { status: upstream.status });
  const raw = await upstream.text();
  const html = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head([^>]*)>/i, `<head$1><base href="${url}">`)
    .replace(/<\/head>/i, `${READER_STYLE}</head>`);
  readerCache.set(url, { html, time: Date.now() });
  if (readerCache.size > 200) readerCache.delete(readerCache.keys().next().value);
  return html;
}

function sendReaderPage(res, html) {
  // The app's helmet CSP is for the API; reader pages need the source
  // site's images and stylesheets, but never scripts.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; base-uri https:");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.removeHeader('X-Frame-Options');
  res.send(html);
}

router.get('/gutenberg/read/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).send('Invalid ID');
  try {
    let html;
    try {
      html = await fetchReaderPage(`https://www.gutenberg.org/cache/epub/${id}/pg${id}-images.html`);
    } catch {
      // Older/odd books: ask Gutendex for the real HTML file as a fallback.
      const info = await gutendexGet(`/books/${id}`);
      const htmlUrl = info.formats?.['text/html'];
      if (!htmlUrl) return res.status(404).send('<p>No HTML version available for this book.</p>');
      html = await fetchReaderPage(htmlUrl);
    }
    sendReaderPage(res, html);
  } catch (err) {
    res.status(502).send(`<p>Error loading book: ${err.message}</p>`);
  }
});

router.get('/standard/:author/:title', async (req, res) => {
  const { author, title } = req.params;
  if (!/^[a-z0-9-]+$/.test(author) || !/^[a-z0-9-]+$/.test(title)) return res.status(400).send('Invalid book');
  try {
    const html = await fetchReaderPage(`https://standardebooks.org/ebooks/${author}/${title}/text/single-page`);
    sendReaderPage(res, html);
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).send(`<p>Error loading book: ${err.message}</p>`);
  }
});

// ── Google Books preview lookup ───────────────────────────────
// Anonymous Google Books calls share a small global quota (429s in
// testing); with GOOGLE_BOOKS_API_KEY set they use the project's own quota.
// Returns { preview: { id, full } | null }, cached for a day.
const googleCache = new Map();
const GOOGLE_TTL = 24 * 60 * 60 * 1000;

function normalizeBookTitle(title) {
  return String(title || '').toLowerCase().split(/[:;(]/)[0].replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

router.get('/google/preview', async (req, res) => {
  const title = normalizeBookTitle(req.query.title);
  const author = String(req.query.author || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!title) return res.status(400).json({ error: 'title required' });
  const cacheKey = `${title}|${author}`;
  const cached = googleCache.get(cacheKey);
  if (cached && Date.now() - cached.time < GOOGLE_TTL) return res.json({ preview: cached.preview });

  const q = `intitle:${title}${author ? `+inauthor:${author}` : ''}`;
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_API_KEY)}` : '';
  try {
    const upstream = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books${key}`, { signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) return res.status(upstream.status === 429 ? 503 : 502).json({ error: `google ${upstream.status}` });
    const data = await upstream.json();
    const match = (data.items || []).find((volume) => normalizeBookTitle(volume.volumeInfo?.title) === title
      && volume.accessInfo?.embeddable
      && ['PARTIAL', 'ALL_PAGES'].includes(volume.accessInfo?.viewability));
    const preview = match ? { id: match.id, full: match.accessInfo.viewability === 'ALL_PAGES' } : null;
    googleCache.set(cacheKey, { preview, time: Date.now() });
    if (googleCache.size > 2000) googleCache.delete(googleCache.keys().next().value);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json({ preview });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Internet Archive search ───────────────────────────────────
router.get('/archive/search', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json([]);
  try {
    // IA requires literal [] in the URL — URLSearchParams encodes them as %5B%5D which IA rejects
    const qParam = encodeURIComponent(`(${q.trim()}) AND mediatype:texts AND language:eng`);
    const fl     = ['identifier', 'title', 'creator', 'year', 'subject'].map(f => `fl[]=${f}`).join('&');
    const iaUrl  = `https://archive.org/advancedsearch.php?q=${qParam}&rows=24&output=json&sort=downloads+desc&${fl}`;
    const raw = await fetch(iaUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'BingeApp/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!raw.ok) throw new Error(`Archive ${raw.status}`);
    const data = await raw.json();
    const docs = data.response?.docs || [];
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(docs.map(d => ({
      id:      d.identifier,
      title:   d.title || d.identifier,
      authors: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
      year:    d.year || '',
      cover:   `https://archive.org/services/img/${d.identifier}`,
      embedUrl: `https://archive.org/embed/${d.identifier}`,
    })));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;

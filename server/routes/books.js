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

// ── Gutenberg in-site reader (proxy HTML) ─────────────────────
router.get('/gutenberg/read/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).send('Invalid ID');
  try {
    const info = await gutendexGet(`/books/${id}`);
    const htmlUrl = info.formats?.['text/html'];
    if (!htmlUrl) return res.status(404).send('<p>No HTML version available for this book.</p>');

    const raw = await fetch(htmlUrl, {
      headers: { 'User-Agent': 'BingeApp/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!raw.ok) return res.status(502).send(`<p>Could not fetch book (${raw.status}).</p>`);

    const html = await raw.text();
    const injected = html
      .replace(/<head>/i, `<head><base href="${htmlUrl}">`)
      .replace(/<\/head>/i, `<style>
        body { font-family: Georgia, serif; max-width: 720px; margin: 2rem auto; padding: 0 1.5rem 4rem; line-height: 1.75; color: #1a1a1a; background: #fefefe; }
        h1,h2,h3,h4 { font-family: Georgia, serif; }
        pre { white-space: pre-wrap; }
        img { max-width: 100%; }
      </style></head>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(injected);
  } catch (err) {
    res.status(502).send(`<p>Error loading book: ${err.message}</p>`);
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

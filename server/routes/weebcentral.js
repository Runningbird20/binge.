claudeconst express  = require('express');
const router   = express.Router();
const cheerio  = require('cheerio');

const BASE = 'https://weebcentral.com';

const HDRS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE,
};

async function wc(url, extra = {}) {
  const res = await fetch(url, {
    headers: { ...HDRS, Accept: extra.json ? 'application/json' : 'text/html,*/*', ...extra.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Object.assign(new Error(`WeebCentral ${res.status}`), { status: res.status });
  return res;
}

function normalizeItem(m) {
  return {
    id:     m.id || m.slug || String(m.series_id || ''),
    title:  m.title || m.name || '',
    cover:  m.cover_image || m.image_url || m.thumbnail || m.cover || m.image || '',
    status: m.status || '',
    author: Array.isArray(m.author) ? m.author.join(', ')
          : Array.isArray(m.authors) ? m.authors.join(', ')
          : (m.author || m.authors || ''),
    tags:   Array.isArray(m.genres)  ? m.genres.slice(0, 5) : [],
    source: 'weebcentral',
  };
}

// ── Search ─────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json({ results: [] });
  try {
    const url = `${BASE}/search/data?term=${encodeURIComponent(q.trim())}&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=false&display_mode=Minimal+Display&limit=24&offset=0`;
    const raw  = await wc(url, { json: true });
    const data = await raw.json();
    const items = Array.isArray(data) ? data : (data.data || data.results || data.items || []);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ results: items.map(normalizeItem) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Popular ────────────────────────────────────────────────────
router.get('/popular', async (req, res) => {
  try {
    const url  = `${BASE}/search/data?sort=Most+Popular&order=Descending&official=Any&anime=Any&adult=false&display_mode=Minimal+Display&limit=24&offset=0`;
    const raw  = await wc(url, { json: true });
    const data = await raw.json();
    const items = Array.isArray(data) ? data : (data.data || data.results || data.items || []);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ results: items.map(normalizeItem) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Chapter list ───────────────────────────────────────────────
router.get('/:id/chapters', async (req, res) => {
  try {
    const raw  = await wc(`${BASE}/series/${encodeURIComponent(req.params.id)}/full-chapter-list`);
    const html = await raw.text();
    const $    = cheerio.load(html);
    const chapters = [];

    $('a[href*="/chapters/"]').each((_i, el) => {
      const href    = $(el).attr('href') || '';
      const idMatch = href.match(/\/chapters\/([^/?#]+)/);
      if (!idMatch) return;
      const chapterId = idMatch[1];
      if (chapters.some(c => c.id === chapterId)) return;

      const text     = $(el).text().replace(/\s+/g, ' ').trim();
      const numMatch = text.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i) || text.match(/^([\d.]+)\b/);
      const number   = numMatch ? numMatch[1] : null;
      const title    = text.replace(/Chapter\s*[\d.]+[-:]\s*/i, '').trim() || null;

      chapters.push({ id: chapterId, number, title: title === text ? null : title, externalUrl: null });
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ chapters: chapters.reverse() }); // site returns newest-first
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Chapter pages ──────────────────────────────────────────────
router.get('/chapter/:id/pages', async (req, res) => {
  try {
    const raw  = await wc(
      `${BASE}/chapters/${encodeURIComponent(req.params.id)}/images?is_prev=False&curr_page=1&reading_style=long_strip`,
      { json: true },
    );
    const data = await raw.json();
    // API returns a JSON array of URL strings, or possibly { images: [...] }
    const pages = (Array.isArray(data) ? data : (data.images || data.pages || []))
      .map(p => (typeof p === 'string' ? p : (p.url || p.src || p.image || '')))
      .filter(Boolean);

    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({ pages, dataSaverPages: [] });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;

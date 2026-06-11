const express = require('express');
const router  = express.Router();
const cheerio = require('cheerio');

const BASE = 'https://bato.to';

const HDRS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE,
};

async function bato(url, opts = {}) {
  const res = await fetch(url, {
    headers: { ...HDRS, Accept: 'text/html,application/xhtml+xml,*/*', ...opts.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Object.assign(new Error(`Bato.to ${res.status}`), { status: res.status });
  return res;
}

// Parse a series card in search / browse HTML
function parseCards($) {
  const seen = new Set();
  const results = [];

  // Try multiple selector patterns that Bato.to has used across versions
  const selectors = [
    'a[href*="/series/"]',
    '[class*="item"] a[href*="/series/"]',
    'article a[href*="/series/"]',
  ];

  for (const sel of selectors) {
    $(sel).each((_i, el) => {
      const href    = $(el).attr('href') || '';
      const idMatch = href.match(/\/series\/(\d+)/);
      if (!idMatch) return;
      const id = idMatch[1];
      if (seen.has(id)) return;
      seen.add(id);

      const img   = $(el).find('img').first();
      const cover = img.attr('src') || img.attr('data-src') || img.attr('data-original') || '';
      const title = (
        $(el).find('[class*="title"],[class*="name"]').first().text().trim() ||
        img.attr('alt') ||
        $(el).attr('title') ||
        ''
      ).replace(/\s+/g, ' ').trim();

      if (!title) return;
      results.push({ id, title, cover, status: '', author: '', tags: [], source: 'bato' });
    });
    if (results.length) break; // stop once a working selector found data
  }
  return results;
}

// ── Search ─────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json({ results: [] });
  try {
    const raw  = await bato(`${BASE}/search?word=${encodeURIComponent(q.trim())}&lang=en`);
    const html = await raw.text();
    const $    = cheerio.load(html);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ results: parseCards($).slice(0, 24) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Popular ────────────────────────────────────────────────────
router.get('/popular', async (req, res) => {
  try {
    const raw  = await bato(`${BASE}/browse?langs=en&sort=views_w`);
    const html = await raw.text();
    const $    = cheerio.load(html);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ results: parseCards($).slice(0, 24) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Chapter list ───────────────────────────────────────────────
router.get('/:id/chapters', async (req, res) => {
  try {
    const raw  = await bato(`${BASE}/series/${encodeURIComponent(req.params.id)}`);
    const html = await raw.text();
    const $    = cheerio.load(html);
    const seen = new Set();
    const chapters = [];

    $('a[href*="/chapter/"]').each((_i, el) => {
      const href    = $(el).attr('href') || '';
      const idMatch = href.match(/\/chapter\/(\d+)/);
      if (!idMatch) return;
      const chapterId = idMatch[1];
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const text     = $(el).text().replace(/\s+/g, ' ').trim();
      const numMatch = text.match(/(?:Ch(?:apter)?\.?\s*)([\d.]+)/i) || text.match(/^([\d.]+)\b/);
      chapters.push({
        id:          chapterId,
        number:      numMatch ? numMatch[1] : null,
        title:       null,
        externalUrl: null,
      });
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ chapters: chapters.reverse() }); // newest-first on page → ascending
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Chapter pages ──────────────────────────────────────────────
router.get('/chapter/:id/pages', async (req, res) => {
  try {
    const raw  = await bato(`${BASE}/chapter/${encodeURIComponent(req.params.id)}`);
    const html = await raw.text();
    let pages  = [];

    // Strategy 1: Astro/SSR JSON data — __NUXT_DATA__ or similar
    const jsonScriptMatch = html.match(/<script[^>]+(?:id=["']__NUXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonScriptMatch) {
      try {
        const flat = JSON.parse(jsonScriptMatch[1]);
        // Walk every string value; collect anything that looks like an image CDN URL
        const walk = (v) => {
          if (typeof v === 'string' && /https?:\/\/.+\.(jpe?g|png|webp)(\?.*)?$/i.test(v)) pages.push(v);
          else if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') Object.values(v).forEach(walk);
        };
        walk(flat);
        // Keep only CDN image URLs (exclude cover thumbnails by filtering for chapter-like paths)
        pages = pages.filter(u => /cdn\.|bato\.|hango\.|batotoo\.|btcenter\./.test(u));
      } catch {}
    }

    // Strategy 2: explicit JS variables
    if (!pages.length) {
      for (const pattern of [
        /(?:imgFileList|imageFiles|page_urls|batoWord)\s*=\s*(\[[^\]]+\])/,
        /["']pages["']\s*:\s*(\[[^\]]+\])/,
      ]) {
        const m = html.match(pattern);
        if (m) { try { pages = JSON.parse(m[1]).filter(p => typeof p === 'string'); break; } catch {} }
      }
    }

    // Strategy 3: scan all script tags for an array of image URLs
    if (!pages.length) {
      const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      let sm;
      while ((sm = scriptRe.exec(html)) !== null) {
        const arrM = sm[1].match(/(\["https?:\/\/[^\]]*\.(?:jpe?g|png|webp)[^\]]*"\])/i);
        if (arrM) { try { pages = JSON.parse(arrM[1]); break; } catch {} }
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({
      pages: pages.filter(p => typeof p === 'string' && /^https?:\/\//.test(p)),
      dataSaverPages: [],
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;

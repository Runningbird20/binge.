// Link previews for shared titles. The site renders in the browser, so a
// link pasted into iMessage, Discord, Slack or WhatsApp used to show the
// generic binge. card. vercel.json sends link-preview bots (by user agent)
// asking for /movie/:id, /tv-show/:id or /book/:id here; this answers with
// a small page whose og:/twitter: tags carry the title, its description and
// its TMDB backdrop (or the book cover). People never come here; a bot that
// follows the page's link back gets the normal site.
const express = require('express');

const router = express.Router();
const TABLES = { movie: 'movies', 'tv-show': 'tv_shows', book: 'books' };
const cache = new Map(); // `${type}:${id}` → { at, card }
const TTL_MS = 6 * 3600 * 1000;

function escape(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function trim(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function tmdbKey() {
  return process.env.TMDB_API_KEY || process.env.REACT_APP_TMDB_API_KEY;
}

// The catalog row, then TMDB's backdrop and overview (TMDB titles only).
async function loadCard(type, id) {
  const catalog = require('../catalogDb');
  const columns = type === 'book' ? 'id, title, author, year, genre, synopsis AS overview, cover_url AS image, source_key'
    : 'id, title, year, genre, overview, poster_url AS image, source_key';
  const { rows } = await catalog.query(`SELECT ${columns} FROM ${TABLES[type]} WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) return null;
  const card = {
    title: row.title,
    year: row.year,
    description: row.overview || '',
    image: row.image || null,
    kind: type === 'book' ? `Book${row.author ? ` by ${row.author}` : ''}` : type === 'movie' ? 'Movie' : 'Series',
  };
  const match = /^tmdb:(movie|tv):(\d+)$/.exec(row.source_key || '');
  if (match && tmdbKey()) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${match[1]}/${match[2]}?api_key=${tmdbKey()}&language=en-US`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (data.backdrop_path) card.image = `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`;
        if (!card.description && data.overview) card.description = data.overview;
      }
    } catch { /* the catalog's own art will do */ }
  }
  return card;
}

function page(card, url, site) {
  const title = card ? `${card.title}${card.year ? ` (${card.year})` : ''}` : 'binge.';
  const description = card ? trim(`${card.kind} on binge. ${card.description}`, 200)
    : 'Movies, series, books and live sports — with picks made for you, not for everyone.';
  const image = card?.image || `${site}/logo512.png`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escape(title)} · binge.</title>
<meta name="description" content="${escape(description)}">
<meta property="og:site_name" content="binge.">
<meta property="og:type" content="${card?.kind === 'Movie' ? 'video.movie' : card?.kind === 'Series' ? 'video.tv_show' : card ? 'book' : 'website'}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${escape(image)}">
<meta property="og:url" content="${escape(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${escape(image)}">
<link rel="canonical" href="${escape(url)}">
</head><body><a href="${escape(url)}">${escape(title)} on binge.</a></body></html>`;
}

router.get('/:type/:id', async (req, res) => {
  const { type } = req.params;
  const id = Number(req.params.id);
  const site = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'binge-26.vercel.app'}`;
  const url = `${site}/${type}/${req.params.id}`;
  if (!TABLES[type] || !Number.isSafeInteger(id) || id <= 0) return res.status(404).type('html').send(page(null, site, site));
  const key = `${type}:${id}`;
  let card = cache.get(key)?.at > Date.now() - TTL_MS ? cache.get(key).card : undefined;
  if (card === undefined) {
    card = await loadCard(type, id).catch(() => null);
    cache.set(key, { at: Date.now(), card });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
  }
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600').type('html').send(page(card, url, site));
});

module.exports = router;
module.exports.page = page;

const express = require('express');
const { Readable } = require('stream');
const { isAdRequest } = require('../utils/adBlocklist');

const router = express.Router();

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Content-type patterns that mean this is an HLS manifest (text, needs URL rewriting)
const M3U_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'application/mpegurl',
]);

// Vercel serverless hard response-body limit is 4.5 MB (Hobby) / 5 MB (Pro).
// Binary media segments can exceed this, so we redirect the browser directly to
// the upstream URL for those. Only M3U8 manifests (always small text) go through
// the proxy body — which is exactly what we need to rewrite the internal URLs.
const VERCEL = Boolean(process.env.VERCEL);
// Segments larger than this go via redirect to avoid the Vercel limit.
// Set to 0 to always proxy (useful for local dev where there is no limit).
const MAX_PROXY_BYTES = VERCEL ? 4 * 1024 * 1024 : 0;

function isM3u(contentType, url) {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  return M3U_TYPES.has(ct) || url.includes('.m3u8') || url.endsWith('.m3u');
}

function resolveSegmentUrl(line, playlistUrl) {
  try {
    if (/^https?:\/\//i.test(line)) return line;
    const base = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
    return new URL(line, base).href;
  } catch {
    return line;
  }
}

// Rewrite all segment/variant URLs in an M3U8 so they flow through this proxy.
// Uses a relative path so it works on any host (local, Vercel, custom domain)
// without needing to know the public origin — the browser fills that in.
function rewriteM3u8(text, playlistUrl) {
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = resolveSegmentUrl(trimmed, playlistUrl);
      return `/api/proxy?url=${encodeURIComponent(absolute)}`;
    })
    .join('\n');
}

// GET /api/proxy?url=<encoded>
router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed' });
  }

  // Block requests to known ad/tracker domains before we ever hit the network
  if (isAdRequest(parsed)) {
    res.set('Access-Control-Allow-Origin', '*');
    return res.status(204).end();
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StreamProxy/1.0)',
        'Accept': '*/*',
        'Origin': `${parsed.protocol}//${parsed.host}`,
        'Referer': `${parsed.protocol}//${parsed.host}/`,
      },
      redirect: 'follow',
      // Stay well under Vercel's 10 s serverless hard-kill limit
      signal: AbortSignal.timeout(VERCEL ? 8_000 : 14_000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    const contentType = upstream.headers.get('content-type') || '';

    // Always permit cross-origin access from the browser player
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    res.set('Cache-Control', 'no-cache, no-store');

    // ── M3U8 manifest ──────────────────────────────────────────────────────────
    // Always read the full text (manifests are tiny), rewrite URLs, return body.
    if (isM3u(contentType, url)) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, url);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // ── Binary segments (TS, fMP4, AAC, etc.) ─────────────────────────────────
    // On Vercel, large responses exceed the 4.5 MB serverless limit and are
    // silently dropped. For segments we know the Content-Length up front: if it
    // exceeds our safe threshold, redirect the browser straight to the upstream
    // URL and let the stream server serve the bytes directly.
    // On local dev (VERCEL=false, MAX_PROXY_BYTES=0) we always proxy.
    if (MAX_PROXY_BYTES > 0) {
      const cl = Number(upstream.headers.get('content-length') || 0);
      if (cl > MAX_PROXY_BYTES) {
        // The segment is too large to go through the serverless function body.
        // A 302 is fine here — the browser will follow it and the segment
        // server will serve the bytes. CORS on the segment server itself may
        // block this, but that is the fundamental Vercel serverless limitation.
        return res.redirect(302, url);
      }
    }

    res.set('Content-Type', contentType || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.set('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.set('Content-Range', cr);
    res.status(upstream.status);

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timed out' });
    }
    console.error('[proxy] error:', err.message);
    return res.status(502).json({ error: 'Could not fetch upstream resource' });
  }
});

// Preflight
router.options('/', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.sendStatus(204);
});

module.exports = router;

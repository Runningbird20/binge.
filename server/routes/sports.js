const express = require('express');
const router = express.Router();

const PPV_API = 'https://api.ppv.st/api/streams';
const CACHE_TTL = 60 * 1000;

let cache = null;
let cacheTime = 0;

function isTruthy(val) {
  return val === 1 || val === true || val === '1';
}

async function fetchStreams() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  const res = await fetch(PPV_API, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; sports-aggregator/1.0)',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    if (cache) return cache;
    throw new Error(`ppv.st ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !Array.isArray(data.streams)) {
    if (cache) return cache;
    throw new Error('Unexpected ppv.st response');
  }

  const now = Math.floor(Date.now() / 1000);
  const streams = [];

  for (const cat of data.streams) {
    const catAlwaysLive = isTruthy(cat.always_live);

    for (const s of cat.streams || []) {
      const alwaysLive = catAlwaysLive || isTruthy(s.always_live);
      const live       = alwaysLive || (s.starts_at <= now && s.ends_at >= now);
      const upcoming   = !alwaysLive && s.starts_at > now;
      const ended      = !alwaysLive && s.ends_at < now;

      if (ended && !isTruthy(s.allowpaststreams)) continue;

      // iframe field from ppv.st is a plain URL
      const iframeSrc = s.iframe || null;

      streams.push({
        id:         s.id,
        name:       s.name,
        tag:        s.tag   || null,
        poster:     s.poster || null,
        category:   s.category_name || cat.category,
        uriName:    s.uri_name,
        startsAt:   s.starts_at,
        endsAt:     s.ends_at,
        alwaysLive: alwaysLive,
        live,
        upcoming,
        replay:     ended && isTruthy(s.allowpaststreams),
        iframeSrc,
      });
    }
  }

  // live first, then upcoming (soonest first), then replays
  streams.sort((a, b) => {
    if (a.live !== b.live)     return a.live ? -1 : 1;
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.startsAt - b.startsAt;
  });

  cache = { streams, timestamp: data.timestamp };
  cacheTime = Date.now();
  return cache;
}

router.get('/streams', async (req, res) => {
  try {
    const result = await fetchStreams();
    res.json(result);
  } catch (err) {
    console.error('[sports]', err.message);
    res.status(502).json({ error: 'Sports streams unavailable', details: err.message });
  }
});

module.exports = router;

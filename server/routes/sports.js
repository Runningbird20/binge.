const express = require('express');

const router = express.Router();

const PPV_API = 'https://api.ppv.to/api/streams';
const CACHE_TTL = 60 * 1000; // 60 seconds per API docs

let cache = null;
let cacheTime = 0;

// The iframe field from ppv.to is either a plain URL or a full <iframe ...> HTML string
function extractIframeSrc(iframe) {
  if (!iframe) return null;
  // Plain URL (most common case)
  if (iframe.startsWith('http://') || iframe.startsWith('https://') || iframe.startsWith('//')) {
    return iframe;
  }
  // HTML string — extract src="..."
  const m = iframe.match(/src=["']([^"']+)["']/);
  return m ? m[1] : null;
}

async function fetchStreams() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  try {
    const res = await fetch(PPV_API, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; binge-app)',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`ppv.to API ${res.status}`);

    const data = await res.json();
    if (!data.success || !Array.isArray(data.streams)) {
      throw new Error('Unexpected ppv.to response');
    }

    const now = Math.floor(Date.now() / 1000);

    // Flatten category objects into a single array with enriched fields
    const streams = [];
    for (const cat of data.streams) {
      for (const s of cat.streams || []) {
        const isAlwaysLive = s.always_live === 1 || cat.always_live === 1;
        const isLiveNow    = isAlwaysLive || (s.starts_at <= now && s.ends_at >= now);
        const isUpcoming   = !isAlwaysLive && s.starts_at > now;
        const isEnded      = !isAlwaysLive && s.ends_at < now;

        // Skip ended streams that don't allow past-stream replay
        if (isEnded && !s.allowpaststreams) continue;

        streams.push({
          id:              s.id,
          name:            s.name,
          tag:             s.tag || null,
          poster:          s.poster || null,
          category:        s.category_name || cat.category,
          categoryId:      cat.id,
          uriName:         s.uri_name,
          startsAt:        s.starts_at,
          endsAt:          s.ends_at,
          alwaysLive:      isAlwaysLive,
          isLive:          isLiveNow,
          isUpcoming:      isUpcoming,
          isReplay:        isEnded && !!s.allowpaststreams,
          // Extract src from iframe HTML so the client can embed it directly
          iframeSrc:       extractIframeSrc(s.iframe),
        });
      }
    }

    // Sort: live first, then upcoming by start time, then replays
    streams.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      if (a.isUpcoming && b.isUpcoming) return a.startsAt - b.startsAt;
      return 0;
    });

    const result = { streams, timestamp: data.timestamp };
    cache = result;
    cacheTime = Date.now();
    return result;
  } catch (err) {
    console.error('ppv.to fetch failed:', err.message);
    // Return cached data if available even if stale
    if (cache) return cache;
    throw err;
  }
}

router.get('/streams', async (req, res) => {
  try {
    const data = await fetchStreams();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Sports streams unavailable', message: err.message });
  }
});

module.exports = router;

// Standalone Vercel serverless function — bypasses Express entirely.
// Fetches ppv.to streams API, flattens and sorts, returns JSON.
const PPV_API = 'https://api.ppv.to/api/streams';
const CACHE_TTL = 60_000;

let cache = null;
let cacheTime = 0;

function truthy(v) { return v === 1 || v === true || v === '1'; }

async function getStreams() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  const res = await fetch(PPV_API, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; binge-sports/1.0)',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    if (cache) return cache;
    throw new Error(`ppv.to ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !Array.isArray(data.streams)) {
    if (cache) return cache;
    throw new Error('Bad ppv.to response');
  }

  const now = Math.floor(Date.now() / 1000);
  const streams = [];

  for (const cat of data.streams) {
    const catLive = truthy(cat.always_live);
    for (const s of cat.streams || []) {
      const alwaysLive = catLive || truthy(s.always_live);
      const live     = alwaysLive || (s.starts_at <= now && s.ends_at >= now);
      const upcoming = !alwaysLive && s.starts_at > now;
      const ended    = !alwaysLive && s.ends_at < now;
      if (ended && !truthy(s.allowpaststreams)) continue;

      streams.push({
        id:         s.id,
        name:       s.name,
        tag:        s.tag        || null,
        poster:     s.poster     || null,
        category:   s.category_name || cat.category,
        uriName:    s.uri_name,
        startsAt:   s.starts_at,
        endsAt:     s.ends_at,
        alwaysLive,
        live,
        upcoming,
        replay:     ended && truthy(s.allowpaststreams),
        iframeSrc:  s.iframe || null,
      });
    }
  }

  streams.sort((a, b) => {
    if (a.live !== b.live)         return a.live ? -1 : 1;
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.startsAt - b.startsAt;
  });

  cache = { streams, timestamp: data.timestamp };
  cacheTime = Date.now();
  return cache;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const result = await getStreams();
    res.status(200).json(result);
  } catch (err) {
    console.error('[sports/streams]', err.message);
    res.status(502).json({ error: 'Sports streams unavailable', details: err.message });
  }
};

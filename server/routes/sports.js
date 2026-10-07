const express = require('express');
const router = express.Router();

// Server-side proxy + cache for the three sports providers. Returns the
// normalized but UNMERGED list ({ raw }); src/utils/sportsProviders.js's
// mergeNormalized() turns it into one entry per game.

const CACHE_TTL = 60 * 1000;
let cache = null;
let cacheTime = 0;

const RESOLVE_CACHE_TTL = 30 * 1000;
const resolveCache = new Map();

const DURATION_SEC = {
  Basketball: 3 * 3600,
  Soccer: 2.25 * 3600,
  'American Football': 3.5 * 3600,
  Baseball: 3.5 * 3600,
  Hockey: 3 * 3600,
  'Combat Sports': 5 * 3600,
  Tennis: 3 * 3600,
  Golf: 5 * 3600,
  Racing: 3 * 3600,
  Rugby: 2 * 3600,
  Cricket: 8 * 3600,
  'Australian Football': 2.5 * 3600,
  Billiards: 3 * 3600,
  Darts: 3 * 3600,
};
const DEFAULT_DURATION_SEC = 3 * 3600;

const STREAMED_CATEGORY_MAP = {
  basketball: 'Basketball',
  football: 'Soccer',
  'american-football': 'American Football',
  hockey: 'Hockey',
  baseball: 'Baseball',
  'motor-sports': 'Racing',
  fight: 'Combat Sports',
  tennis: 'Tennis',
  rugby: 'Rugby',
  golf: 'Golf',
  billiards: 'Billiards',
  afl: 'Australian Football',
  darts: 'Darts',
  cricket: 'Cricket',
  other: 'Other',
};

const STREAMFREE_CATEGORY_MAP = {
  soccer: 'Soccer',
  basketball: 'Basketball',
  hockey: 'Hockey',
  combat: 'Combat Sports',
  baseball: 'Baseball',
  football: 'American Football',
  racing: 'Racing',
  tennis: 'Tennis',
  cricket: 'Cricket',
};

function isTruthy(val) {
  return val === 1 || val === true || val === '1';
}

// Normalizers mirror src/utils/sportsProviders.js's fetch*Normalized
// (Node can't import from src/). Only fetching + normalizing happens here;
// the fuzzy one-entry-per-game merge runs client-side on this raw list, so
// that matching logic exists in exactly one place.
async function fetchPpvNormalized() {
  const res = await fetch('https://api.ppv.st/api/streams', {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; sports-aggregator/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ppv.st ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error('ppv.st error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const cat of data.streams || []) {
    const catAlwaysLive = isTruthy(cat.always_live);
    for (const s of cat.streams || []) {
      const alwaysLive = catAlwaysLive || isTruthy(s.always_live);
      const ended = !alwaysLive && s.ends_at < now;
      if (ended && !isTruthy(s.allowpaststreams)) continue;
      if (!s.iframe) continue;
      const rawCategory = s.category_name || cat.category || 'Other';
      // PPV.st's "24/7 Streams" bucket is non-sports (cartoon reruns etc.).
      if (rawCategory === '24/7 Streams') continue;
      out.push({
        name: s.name,
        category: rawCategory,
        poster: s.poster || null,
        tag: s.tag || null,
        colors: Array.isArray(s.colors) ? s.colors : null,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        alwaysLive,
        replay: ended && isTruthy(s.allowpaststreams),
        provider: { id: 'ppv', embedUrl: s.iframe, label: s.source_tag ? `PPV · ${s.source_tag}` : 'PPV' },
      });
    }
  }
  return out;
}

async function fetchStreamedNormalized() {
  const res = await fetch('https://streamed.pk/api/matches/all', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`streamed.pk ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('streamed.pk error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const m of data) {
    if (!Array.isArray(m.sources) || m.sources.length === 0) continue;
    const category = STREAMED_CATEGORY_MAP[m.category] || 'Other';
    const startsAt = Math.floor((m.date || 0) / 1000);
    const endsAt = startsAt + (DURATION_SEC[category] || DEFAULT_DURATION_SEC);
    if (startsAt && now > endsAt) continue;
    const homeTeam = m.teams && m.teams.home;
    const awayTeam = m.teams && m.teams.away;
    const home = homeTeam ? homeTeam.name : null;
    const away = awayTeam ? awayTeam.name : null;
    const badge = (team) => (team && team.badge ? `https://streamed.pk/api/images/badge/${team.badge}.webp` : null);
    for (const src of m.sources) {
      out.push({
        name: m.title,
        category,
        poster: m.poster ? `https://streamed.pk${m.poster}` : null,
        tag: null,
        teams: home && away ? { home, away } : null,
        logos: home && away ? { home: badge(homeTeam), away: badge(awayTeam) } : null,
        startsAt,
        endsAt,
        alwaysLive: !startsAt,
        replay: false,
        provider: { id: 'streamed', source: src.source, matchId: src.id, label: `Streamed · ${src.source}` },
      });
    }
  }
  return out;
}

async function fetchStreamfreeNormalized() {
  const res = await fetch('https://streamfree.top/api/v1/streams', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`streamfree ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.streams)) throw new Error('streamfree error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const s of data.streams) {
    const category = STREAMFREE_CATEGORY_MAP[s.category] || 'Other';
    const startsAt = s.match_timestamp || 0;
    const duration = DURATION_SEC[category] || DEFAULT_DURATION_SEC;
    const endsAt = startsAt ? startsAt + duration : now + duration;
    if (startsAt && now > endsAt) continue;
    if (!s.embed_url) continue;
    const home = s.team1 ? s.team1.name : null;
    const away = s.team2 ? s.team2.name : null;
    out.push({
      name: s.name,
      category,
      poster: s.thumbnail_url || null,
      tag: s.league || null,
      teams: home && away ? { home, away } : null,
      logos: home && away ? { home: (s.team1 && s.team1.logo) || null, away: (s.team2 && s.team2.logo) || null } : null,
      startsAt,
      endsAt,
      alwaysLive: !startsAt,
      replay: false,
      provider: { id: 'streamfree', embedUrl: s.embed_url, label: 'StreamFree' },
    });
  }
  return out;
}

async function fetchRawStreams() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  const [ppv, streamed, streamfree] = await Promise.allSettled([
    fetchPpvNormalized(),
    fetchStreamedNormalized(),
    fetchStreamfreeNormalized(),
  ]);

  const lists = [];
  if (ppv.status === 'fulfilled') lists.push(...ppv.value);
  else console.error('[sports] ppv.st', ppv.reason && ppv.reason.message);
  if (streamed.status === 'fulfilled') lists.push(...streamed.value);
  else console.error('[sports] streamed.pk', streamed.reason && streamed.reason.message);
  if (streamfree.status === 'fulfilled') lists.push(...streamfree.value);
  else console.error('[sports] streamfree', streamfree.reason && streamfree.reason.message);

  if (lists.length === 0) {
    if (cache) return cache;
    throw new Error('All sports providers unavailable');
  }

  const result = { raw: lists };
  cache = result;
  cacheTime = Date.now();
  return result;
}

router.get('/streams', async (req, res) => {
  try {
    const result = await fetchRawStreams();
    res.json(result);
  } catch (err) {
    console.error('[sports]', err.message);
    res.status(502).json({ error: 'Sports streams unavailable', details: err.message });
  }
});

router.get('/resolve/streamed/:source/:matchId', async (req, res) => {
  const { source, matchId } = req.params;
  const cacheKey = `${source}/${matchId}`;
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.time < RESOLVE_CACHE_TTL) {
    return res.json({ embedUrl: cached.embedUrl });
  }

  try {
    const upstream = await fetch(
      `https://streamed.pk/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(matchId)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!upstream.ok) throw new Error(`streamed.pk ${upstream.status}`);
    const list = await upstream.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error('no streams for source');
    const best = list.find((s) => s.hd) || list[0];
    const embedUrl = best.embedUrl || null;
    resolveCache.set(cacheKey, { embedUrl, time: Date.now() });
    res.json({ embedUrl });
  } catch (err) {
    console.error('[sports] resolve streamed', err.message);
    res.status(502).json({ error: 'Could not resolve stream', details: err.message });
  }
});

module.exports = router;

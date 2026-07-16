const express = require('express');
const router = express.Router();

// Server-side mirror of src/utils/sportsProviders.js's fetch+normalize+merge
// logic. Kept as a separate copy (Node vs. CRA/webpack can't share a source
// file across this repo's client/server boundary) rather than a shared
// module — matches the existing precedent of this route already duplicating
// the PPV.st parsing that also lives client-side as a fallback path.

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

function slugifyTeam(name) {
  if (!name) return '';
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1] || cleaned;
}

function splitTeamsFromTitle(title) {
  if (!title) return null;
  const parts = title.split(/\s+(?:vs\.?|v\.?|@)\s+/i);
  if (parts.length !== 2) return null;
  return { home: parts[0].trim(), away: parts[1].trim() };
}

function dayBucket(startsAtSec) {
  if (!startsAtSec) return 'unknown';
  return new Date(startsAtSec * 1000).toISOString().slice(0, 10);
}

function buildMatchKey({ category, home, away, title, startsAtSec }) {
  let teamA = home;
  let teamB = away;
  if (!teamA && !teamB) {
    const split = splitTeamsFromTitle(title);
    if (split) { teamA = split.home; teamB = split.away; }
  }
  const bucket = dayBucket(startsAtSec);
  if (teamA && teamB) {
    const pair = [slugifyTeam(teamA), slugifyTeam(teamB)].sort().join('_');
    return `${category}|${pair}|${bucket}`;
  }
  const titleSlug = String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-');
  return `${category}|title:${titleSlug}|${bucket}`;
}

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
      const live     = alwaysLive || (s.starts_at <= now && s.ends_at >= now);
      const upcoming = !alwaysLive && s.starts_at > now;
      const ended    = !alwaysLive && s.ends_at < now;
      if (ended && !isTruthy(s.allowpaststreams)) continue;
      if (!s.iframe) continue;
      const category = s.category_name || cat.category || 'Other';
      // PPV.st bundles a non-sports "24/7 Streams" category (cartoon reruns,
      // a live cow cam, etc.) alongside real events — filter the whole
      // category out rather than naming individual shows, since it's a
      // fixed bucket the source itself uses to mean "not a sport".
      if (category === '24/7 Streams') continue;
      out.push({
        matchKey: buildMatchKey({ category, title: s.name, startsAtSec: s.starts_at }),
        name: s.name,
        category,
        poster: s.poster || null,
        tag: s.tag || null,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        alwaysLive,
        live,
        upcoming,
        replay: ended && isTruthy(s.allowpaststreams),
        provider: { id: 'ppv', embedUrl: s.iframe },
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
    const duration = DURATION_SEC[category] || DEFAULT_DURATION_SEC;
    const endsAt = startsAt + duration;
    if (startsAt && now > endsAt) continue;
    const home = m.teams && m.teams.home ? m.teams.home.name : null;
    const away = m.teams && m.teams.away ? m.teams.away.name : null;
    const poster = m.poster ? `https://streamed.pk${m.poster}` : null;
    const matchKey = buildMatchKey({ category, home, away, title: m.title, startsAtSec: startsAt });
    for (const src of m.sources) {
      out.push({
        matchKey,
        name: m.title,
        category,
        poster,
        tag: null,
        startsAt,
        endsAt,
        alwaysLive: false,
        live: now >= startsAt,
        upcoming: now < startsAt,
        replay: false,
        provider: { id: 'streamed', source: src.source, matchId: src.id, label: `Streamed.pk (${src.source})` },
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
    out.push({
      matchKey: buildMatchKey({
        category,
        home: s.team1 ? s.team1.name : null,
        away: s.team2 ? s.team2.name : null,
        title: s.name,
        startsAtSec: startsAt,
      }),
      name: s.name,
      category,
      poster: s.thumbnail_url || null,
      tag: s.league || null,
      startsAt,
      endsAt,
      alwaysLive: !startsAt,
      live: !startsAt || now >= startsAt,
      upcoming: !!startsAt && now < startsAt,
      replay: false,
      provider: { id: 'streamfree', embedUrl: s.embed_url },
    });
  }
  return out;
}

function mergeNormalized(lists) {
  const byKey = new Map();
  for (const item of lists) {
    const existing = byKey.get(item.matchKey);
    if (!existing) {
      byKey.set(item.matchKey, {
        id: item.matchKey,
        name: item.name,
        category: item.category,
        poster: item.poster,
        tag: item.tag,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        alwaysLive: item.alwaysLive,
        live: item.live,
        upcoming: item.upcoming,
        replay: item.replay,
        providers: [item.provider],
        _timingFromPpv: item.provider.id === 'ppv',
      });
    } else {
      existing.providers.push(item.provider);
      if (!existing.poster && item.poster) existing.poster = item.poster;
      if (item.provider.id === 'ppv' && !existing._timingFromPpv) {
        existing.startsAt = item.startsAt;
        existing.endsAt = item.endsAt;
        existing.alwaysLive = item.alwaysLive;
        existing.live = item.live;
        existing.upcoming = item.upcoming;
        existing.replay = item.replay;
        existing._timingFromPpv = true;
      }
    }
  }
  const merged = Array.from(byKey.values()).map(({ _timingFromPpv, ...rest }) => rest);
  merged.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.startsAt - b.startsAt;
  });
  return merged;
}

async function fetchMergedStreams() {
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

  const result = { streams: mergeNormalized(lists) };
  cache = result;
  cacheTime = Date.now();
  return result;
}

router.get('/streams', async (req, res) => {
  try {
    const result = await fetchMergedStreams();
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

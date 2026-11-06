// The three sports feeds (PPV.st, Streamed.pk, StreamFree), fetched and normalized
// into one shape: one entry per listing, each with a single provider as its server.
// One copy, used by the browser (utils/sportsProviders.js, which merges the
// listings into one entry per game) and by the server's fallback proxy
// (server/routes/sports.js, which returns them unmerged). An ES module, so the
// server loads it with require() (Node 24).
//
// Each fetch takes { timeoutMs, headers }: the server waits less (it has a
// function time limit) and sends a User-Agent, which a page can't set.

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
  football: 'Soccer', // streamed.pk uses "football" for soccer
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
  football: 'American Football', // streamfree uses "football" for NFL/CFB
  racing: 'Racing',
  tennis: 'Tennis',
  cricket: 'Cricket',
};

function truthy(v) { return v === 1 || v === true || v === '1'; }

export async function fetchPpvNormalized({ timeoutMs = 10000, headers = {} } = {}) {
  const res = await fetch('https://api.ppv.st/api/streams', {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ppv.st ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error('ppv.st error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const cat of data.streams || []) {
    const catAlwaysLive = truthy(cat.always_live);
    for (const s of cat.streams || []) {
      const alwaysLive = catAlwaysLive || truthy(s.always_live);
      const ended = !alwaysLive && s.ends_at < now;
      if (ended && !truthy(s.allowpaststreams)) continue;
      if (!s.iframe) continue;
      const rawCategory = s.category_name || cat.category || 'Other';
      // PPV.st's "24/7 Streams" bucket is non-sports (cartoon reruns etc.).
      if (rawCategory === '24/7 Streams') continue;
      // The main embed plus any mirrors ("substreams", each with its own tag).
      const embeds = [{ iframe: s.iframe, tag: s.source_tag }, ...(Array.isArray(s.substreams) ? s.substreams : [])
        .filter((sub) => sub && sub.iframe && sub.iframe !== s.iframe)
        .map((sub) => ({ iframe: sub.iframe, tag: sub.source_tag }))];
      for (const embed of embeds) {
        out.push({
          name: s.name,
          category: rawCategory,
          poster: s.poster || null,
          tag: s.tag || null,
          colors: Array.isArray(s.colors) ? s.colors : null,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          alwaysLive,
          replay: ended && truthy(s.allowpaststreams),
          provider: { id: 'ppv', embedUrl: embed.iframe, label: embed.tag ? `PPV · ${embed.tag}` : 'PPV' },
        });
      }
    }
  }
  return out;
}

export async function fetchStreamedNormalized({ timeoutMs = 10000, headers = {} } = {}) {
  const res = await fetch('https://streamed.pk/api/matches/all', {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
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
    if (startsAt && now > endsAt) continue; // stale — streamed.pk has no replays
    const home = m.teams?.home?.name || null;
    const away = m.teams?.away?.name || null;
    const badge = (team) => (team?.badge ? `https://streamed.pk/api/images/badge/${team.badge}.webp` : null);
    for (const src of m.sources) {
      out.push({
        name: m.title,
        category,
        poster: m.poster ? `https://streamed.pk${m.poster}` : null,
        tag: null,
        teams: home && away ? { home, away } : null,
        logos: home && away ? { home: badge(m.teams.home), away: badge(m.teams.away) } : null,
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

// "…/football/redzone1080p" → "StreamFree 1080p"; numbered when unclear.
function streamfreeLabel(url, index, count) {
  const quality = /(2160|1080|720|480)p/.exec(url);
  if (quality) return `StreamFree ${quality[1] === '2160' ? '4K' : `${quality[1]}p`}`;
  return count > 1 ? `StreamFree ${index + 1}` : 'StreamFree';
}

export async function fetchStreamfreeNormalized({ timeoutMs = 10000, headers = {} } = {}) {
  const res = await fetch('https://streamfree.top/api/v1/streams', {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
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
    // Embeds appear in "sources" near game time: { quality, url, live } objects
    // (plain URL strings until 2026-11; the older API had embed_url).
    const sources = (Array.isArray(s.sources) ? s.sources : []).map((source) => (typeof source === 'string' ? source : source?.url));
    const embeds = [...new Set([...sources, s.embed_url].filter((url) => typeof url === 'string' && url.startsWith('http')))];
    if (embeds.length === 0) continue;
    // Channels (RedZone, Sky Sports F1, Willow) keep a timestamp from weeks
    // ago; anything with embeds that "started" over 2 days back is one.
    const channel = Boolean(startsAt) && now - startsAt > 2 * 86400;
    if (startsAt && now > endsAt && !channel) continue;
    const home = s.team1?.name || null;
    const away = s.team2?.name || null;
    for (const [index, embedUrl] of embeds.entries()) {
      out.push({
        name: s.name,
        category,
        poster: s.thumbnail_url || null,
        tag: s.league || null,
        teams: home && away ? { home, away } : null,
        logos: home && away ? { home: s.team1?.logo || null, away: s.team2?.logo || null } : null,
        startsAt: channel ? 0 : startsAt,
        endsAt: channel ? now + duration : endsAt,
        alwaysLive: !startsAt || channel,
        replay: false,
        provider: { id: 'streamfree', embedUrl, label: streamfreeLabel(embedUrl, index, embeds.length) },
      });
    }
  }
  return out;
}

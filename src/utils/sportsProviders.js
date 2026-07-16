// Multi-provider sports stream aggregation. Combines 3 independent, free
// live-sports APIs (PPV.st, Streamed.pk, StreamFree) into one unified feed
// and opportunistically groups entries that are almost certainly the same
// real-world event (same two teams + same day + same sport) so the player
// can silently fail over to another provider's feed if one goes down,
// instead of forcing the user to hunt for an alternate stream themselves.
//
// The three source APIs disagree on team-name formatting ("LA Clippers" vs.
// "Los Angeles Clippers") and on what "football" means (soccer vs. American
// football), so matching/labelling below is heuristic, not exact — a merge
// miss just means the same game shows up as separate entries per provider,
// which is harmless. Matching two different games together would be worse,
// so buildMatchKey requires category + day + a team-nickname pair before
// ever merging two entries.

const PROVIDER_LABELS = {
  ppv: 'PPV.st',
  streamed: 'Streamed.pk',
  streamfree: 'StreamFree',
};

// Rough event length per sport, used only to estimate an end time for the
// two providers (Streamed.pk, StreamFree) that don't give one — PPV.st's
// own starts_at/ends_at stay authoritative once a match is merged with it.
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

function slugifyTeam(name) {
  if (!name) return '';
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  // The last token is almost always the team's nickname ("Clippers",
  // "Wizards") — providers disagree on whether they include the city
  // ("Los Angeles Clippers" vs. "LA Clippers"), but the nickname is stable.
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

// Order-independent key so "A vs B" and "B vs A" (providers disagree on
// home/away order) still merge into one entry.
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
  // No parseable team pair (e.g. a golf tournament or fight-night card name)
  // — fall back to the whole title, which won't merge across providers but
  // still displays correctly as its own single-provider entry.
  const titleSlug = String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-');
  return `${category}|title:${titleSlug}|${bucket}`;
}

async function fetchPpvNormalized() {
  const res = await fetch('https://api.ppv.st/api/streams', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
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
      const live     = alwaysLive || (s.starts_at <= now && s.ends_at >= now);
      const upcoming = !alwaysLive && s.starts_at > now;
      const ended    = !alwaysLive && s.ends_at < now;
      if (ended && !truthy(s.allowpaststreams)) continue;
      if (!s.iframe) continue;
      const category = s.category_name || cat.category || 'Other';
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
        replay: ended && truthy(s.allowpaststreams),
        provider: { id: 'ppv', embedUrl: s.iframe },
      });
    }
  }
  return out;
}

async function fetchStreamedNormalized() {
  const res = await fetch('https://streamed.pk/api/matches/all', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
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
    if (startsAt && now > endsAt) continue; // stale — streamed.pk has no replay assets
    const home = m.teams?.home?.name || null;
    const away = m.teams?.away?.name || null;
    const poster = m.poster ? `https://streamed.pk${m.poster}` : null;
    const matchKey = buildMatchKey({ category, home, away, title: m.title, startsAtSec: startsAt });
    // Each match can itself have multiple independent backend sources
    // (admin/delta/echo/...) — surface all of them as separate provider
    // entries so failover has real alternates even within just this API.
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
    signal: AbortSignal.timeout(10000),
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
      matchKey: buildMatchKey({ category, home: s.team1?.name, away: s.team2?.name, title: s.name, startsAtSec: startsAt }),
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
        // PPV.st has real end times / replay detection — prefer it as the
        // timing "source of truth" once present, over the estimated
        // durations used for the other two providers.
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

// Fetches + merges all 3 providers directly from the browser (all three
// send Access-Control-Allow-Origin: *). Used both as the client-side
// fallback when the server proxy is unavailable, and reused verbatim by
// fetchSportsStreams below.
export async function fetchAllSportsStreams() {
  const [ppv, streamed, streamfree] = await Promise.allSettled([
    fetchPpvNormalized(),
    fetchStreamedNormalized(),
    fetchStreamfreeNormalized(),
  ]);

  const lists = [];
  if (ppv.status === 'fulfilled') lists.push(...ppv.value);
  if (streamed.status === 'fulfilled') lists.push(...streamed.value);
  if (streamfree.status === 'fulfilled') lists.push(...streamfree.value);

  if (lists.length === 0) {
    const firstError = [ppv, streamed, streamfree].find((r) => r.status === 'rejected');
    throw new Error(firstError?.reason?.message || 'All sports providers unavailable');
  }
  return mergeNormalized(lists);
}

export async function fetchSportsStreams() {
  // Server proxy first (one shared cache instead of every visitor hitting
  // three separate free APIs, and a server IP is less likely to trip
  // streamed.pk's ddos-guard challenge than a random browser) — direct
  // multi-provider fetch as a fallback if the proxy route is unavailable.
  try {
    const res = await fetch('/api/sports/streams', { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (!data.error && Array.isArray(data.streams) && data.streams.length > 0) {
        return data.streams;
      }
    }
  } catch { /* fall through */ }
  return fetchAllSportsStreams();
}

// Resolves one provider entry from a merged stream's `providers` array into
// an actual embeddable iframe URL. PPV.st and StreamFree already give a
// direct embed URL up front; Streamed.pk requires a second lookup per
// (source, matchId) pair, done lazily here so we're not making hundreds of
// extra requests for matches the user never opens.
export async function resolveProviderEmbedUrl(provider) {
  if (!provider) return null;
  if (provider.embedUrl) return provider.embedUrl;
  if (provider.id === 'streamed' && provider.source && provider.matchId) {
    try {
      const res = await fetch(
        `/api/sports/resolve/streamed/${encodeURIComponent(provider.source)}/${encodeURIComponent(provider.matchId)}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.embedUrl) return data.embedUrl;
      }
    } catch { /* fall through */ }

    try {
      const res = await fetch(
        `https://streamed.pk/api/stream/${encodeURIComponent(provider.source)}/${encodeURIComponent(provider.matchId)}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;
      const list = await res.json();
      if (!Array.isArray(list) || list.length === 0) return null;
      const best = list.find((s) => s.hd) || list[0];
      return best.embedUrl || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function providerLabel(provider) {
  if (!provider) return '';
  return provider.label || PROVIDER_LABELS[provider.id] || provider.id;
}

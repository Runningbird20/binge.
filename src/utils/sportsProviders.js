// Multi-provider sports stream aggregation. Combines 3 independent, free
// live-sports APIs (PPV.st, Streamed.pk, StreamFree) into one feed with
// exactly ONE entry per real-world game; every provider feed for that game
// becomes a selectable "server" on it.
//
// The providers disagree on almost everything, so matching is fuzzy:
//   - separators: "Ravens at Falcons" / "Ravens vs Falcons" / "Ravens - Falcons"
//   - team names: "LA Clippers" / "Los Angeles Clippers", "Man United" /
//     "Manchester United"
//   - categories: PPV's "Football" is soccer, StreamFree's "football" is NFL
//   - start times: providers round differently; ±3h counts as the same game
// Two entries merge only when the category matches, both teams match
// (either order) and the start times are within the window — a missed merge
// shows a duplicate, a false merge would play the wrong game, so the rule
// leans strict.
//
// The server route (/api/sports/streams) fetches + normalizes the same
// three providers and returns the unmerged list; merging only happens here.

import { fetchDisabledServers } from './streamPreferences';

const PROVIDER_NAMES = {
  ppv: 'PPV',
  streamed: 'Streamed',
  streamfree: 'StreamFree',
};

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
const MERGE_WINDOW_SEC = 3 * 3600;

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

// PPV.st's own category names -> the canonical ones above.
const CANONICAL_CATEGORY = {
  football: 'Soccer',
  soccer: 'Soccer',
  'ice hockey': 'Hockey',
  hockey: 'Hockey',
  motorsports: 'Racing',
  'motor sports': 'Racing',
  wrestling: 'Combat Sports',
  boxing: 'Combat Sports',
  mma: 'Combat Sports',
  fight: 'Combat Sports',
};

export function canonicalCategory(category) {
  const key = String(category || '').trim().toLowerCase();
  return CANONICAL_CATEGORY[key] || category || 'Other';
}

function truthy(v) { return v === 1 || v === true || v === '1'; }

// ── Team parsing / matching ────────────────────────────────────────────

const SEPARATOR = /\s+(?:vs\.?|v\.?|versus|@|at|-|–|—)\s+/i;

export function splitTeamsFromTitle(title) {
  if (!title) return null;
  // Drop a trailing " - League" / ": Week 6" style suffix only when it
  // leaves a clean "A vs B" behind.
  const parts = String(title).split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [home, away] = parts.map((part) => part.trim());
  if (!home || !away) return null;
  return { home, away };
}

// Words that appear in many different teams' names and so can't identify
// one on their own ("United", "City", "State", "FC"...).
const GENERIC_TOKENS = new Set([
  'fc', 'cf', 'sc', 'afc', 'ac', 'as', 'cd', 'sv', 'fk', 'sk', 'if', 'bk', 'ss', 'us', 'club', 'the', 'de', 'del', 'la', 'le',
  'united', 'city', 'state', 'st', 'saint', 'real', 'sporting', 'athletic', 'atletico', 'university', 'team',
  'new', 'los', 'san', 'north', 'south', 'east', 'west', 'central', 'women', 'w', 'u21', 'u23', 'ii',
]);

function teamTokens(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !GENERIC_TOKENS.has(token));
}

function tokensMatch(a, b) {
  if (a === b) return true;
  // Abbreviation vs full word: "man" ~ "manchester", "utd" isn't handled
  // but is rare in these feeds.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short) && long.length - short.length >= 2;
}

// Generic words that still tell two clubs from the same city apart
// (Manchester City vs Manchester United, Michigan vs Michigan State).
const QUALIFIERS = new Set(['united', 'city', 'state', 'athletic', 'sporting', 'real', 'county', 'rovers', 'wanderers', 'albion', 'women']);

function qualifiers(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => QUALIFIERS.has(token));
}

export function teamsMatch(nameA, nameB) {
  const qa = qualifiers(nameA);
  const qb = qualifiers(nameB);
  if (qa.length && qb.length && !qa.some((token) => qb.includes(token))) return false;

  const a = teamTokens(nameA);
  const b = teamTokens(nameB);
  if (!a.length || !b.length) {
    return String(nameA || '').trim().toLowerCase() === String(nameB || '').trim().toLowerCase();
  }
  // Nickname (last token) agreement is the strongest signal; otherwise any
  // distinctive shared token.
  if (tokensMatch(a[a.length - 1], b[b.length - 1])) return true;
  return a.some((tokenA) => tokenA.length >= 4 && b.some((tokenB) => tokensMatch(tokenA, tokenB)));
}

function titleSlug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameEvent(a, b) {
  if (a.category !== b.category) return false;

  const timesKnown = a.startsAt && b.startsAt && !a.alwaysLive && !b.alwaysLive;
  if (timesKnown && Math.abs(a.startsAt - b.startsAt) > MERGE_WINDOW_SEC) return false;
  if (!timesKnown && a.alwaysLive !== b.alwaysLive && a.startsAt && b.startsAt) return false;

  if (a.teams && b.teams) {
    return (teamsMatch(a.teams.home, b.teams.home) && teamsMatch(a.teams.away, b.teams.away))
      || (teamsMatch(a.teams.home, b.teams.away) && teamsMatch(a.teams.away, b.teams.home));
  }
  // Channels / tournaments / fight cards: identical normalized title.
  return titleSlug(a.name) === titleSlug(b.name);
}

// ── League inference (for ESPN-style league rows) ──────────────────────

const NFL_NICKNAMES = new Set(['cardinals', 'falcons', 'ravens', 'bills', 'panthers', 'bears', 'bengals', 'browns', 'cowboys', 'broncos', 'lions', 'packers', 'texans', 'colts', 'jaguars', 'chiefs', 'raiders', 'chargers', 'rams', 'dolphins', 'vikings', 'patriots', 'saints', 'giants', 'jets', 'eagles', 'steelers', '49ers', 'seahawks', 'buccaneers', 'titans', 'commanders']);
const NBA_NICKNAMES = new Set(['hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'mavericks', 'nuggets', 'pistons', 'warriors', 'rockets', 'pacers', 'clippers', 'lakers', 'grizzlies', 'heat', 'bucks', 'timberwolves', 'pelicans', 'knicks', 'thunder', 'magic', '76ers', 'suns', 'blazers', 'kings', 'spurs', 'raptors', 'jazz', 'wizards']);
const NHL_NICKNAMES = new Set(['ducks', 'bruins', 'sabres', 'flames', 'hurricanes', 'blackhawks', 'avalanche', 'blue jackets', 'stars', 'red wings', 'oilers', 'panthers', 'kings', 'wild', 'canadiens', 'predators', 'devils', 'islanders', 'rangers', 'senators', 'flyers', 'penguins', 'sharks', 'kraken', 'blues', 'lightning', 'maple leafs', 'canucks', 'golden knights', 'capitals', 'jets', 'mammoth']);

function nickname(name) {
  const tokens = String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const two = tokens.slice(-2).join(' ');
  return { one: tokens[tokens.length - 1] || '', two };
}

function inferLeague(item) {
  if (item.tag && !/24\/7/i.test(item.tag)) return item.tag;
  if (item.alwaysLive) return '24/7 Channels';
  const teams = item.teams;
  if (teams) {
    const [a, b] = [nickname(teams.home), nickname(teams.away)];
    const inSet = (set) => (set.has(a.one) || set.has(a.two)) && (set.has(b.one) || set.has(b.two));
    if (item.category === 'American Football') return inSet(NFL_NICKNAMES) ? 'NFL' : 'College Football';
    if (item.category === 'Basketball' && inSet(NBA_NICKNAMES)) return 'NBA';
    if (item.category === 'Hockey' && inSet(NHL_NICKNAMES)) return 'NHL';
    if (item.category === 'Baseball') return 'MLB';
  }
  return item.category;
}

// ── Provider fetch + normalize ─────────────────────────────────────────

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
      const ended = !alwaysLive && s.ends_at < now;
      if (ended && !truthy(s.allowpaststreams)) continue;
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
        replay: ended && truthy(s.allowpaststreams),
        provider: { id: 'ppv', embedUrl: s.iframe, label: s.source_tag ? `PPV · ${s.source_tag}` : 'PPV' },
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
    const home = s.team1?.name || null;
    const away = s.team2?.name || null;
    out.push({
      name: s.name,
      category,
      poster: s.thumbnail_url || null,
      tag: s.league || null,
      teams: home && away ? { home, away } : null,
      logos: home && away ? { home: s.team1?.logo || null, away: s.team2?.logo || null } : null,
      startsAt,
      endsAt,
      alwaysLive: !startsAt,
      replay: false,
      provider: { id: 'streamfree', embedUrl: s.embed_url, label: 'StreamFree' },
    });
  }
  return out;
}

// ── Merge ──────────────────────────────────────────────────────────────

// "NFL vs RedZone" is a channel, not a matchup.
const NOT_A_TEAM = /^(nfl|nba|nhl|mlb|mls|wnba|ncaa\w*|redzone|red zone|tbd|tba)$/i;

// Only team sports have "A vs B" titles; racing/golf/fight-card titles use
// " - " for "Event - Session" and must not be read as two teams.
const TEAM_SPORTS = new Set(['Soccer', 'Basketball', 'American Football', 'Hockey', 'Baseball', 'Rugby', 'Cricket', 'Australian Football', 'Volleyball']);

function prepare(item) {
  const category = canonicalCategory(item.category);
  let teams = TEAM_SPORTS.has(category) ? (item.teams || splitTeamsFromTitle(item.name)) : null;
  if (teams && (NOT_A_TEAM.test(teams.home.trim()) || NOT_A_TEAM.test(teams.away.trim()))) teams = null;
  return { ...item, category, teams };
}

// Listings that aren't watchable events at all.
function isJunkListing(item) {
  return /\bschedule\b/i.test(item.name || '');
}

function cleanName(entry, fallbackName) {
  if (entry.teams) return `${entry.teams.home} vs ${entry.teams.away}`;
  return fallbackName || '';
}

function eventId(entry) {
  const base = entry.teams
    ? [entry.teams.home, entry.teams.away].map((name) => teamTokens(name).join('-')).sort().join('_')
    : titleSlug(entry.name).replace(/\s+/g, '-');
  const day = entry.startsAt && !entry.alwaysLive ? new Date(entry.startsAt * 1000).toISOString().slice(0, 10) : 'live';
  return `${entry.category}|${base}|${day}`.toLowerCase();
}

export function mergeNormalized(rawItems) {
  const clusters = [];
  const byCategory = new Map();

  for (const raw of rawItems) {
    if (isJunkListing(raw)) continue;
    const item = prepare(raw);
    const bucket = byCategory.get(item.category) || [];
    const cluster = bucket.find((candidate) => candidate.members.some((member) => sameEvent(member, item)));

    if (cluster) {
      cluster.members.push(item);
      // De-dupe identical servers (same provider + same source/url).
      const providerKey = `${item.provider.id}|${item.provider.source || ''}|${item.provider.embedUrl || item.provider.matchId || ''}`;
      if (!cluster.providerKeys.has(providerKey)) {
        cluster.providerKeys.add(providerKey);
        cluster.providers.push(item.provider);
      }
    } else {
      const created = {
        members: [item],
        providers: [item.provider],
        providerKeys: new Set([`${item.provider.id}|${item.provider.source || ''}|${item.provider.embedUrl || item.provider.matchId || ''}`]),
      };
      bucket.push(created);
      byCategory.set(item.category, bucket);
      clusters.push(created);
    }
  }

  const now = Math.floor(Date.now() / 1000);

  const merged = clusters.map(({ members, providers }) => {
    // PPV has real start/end times + replay detection; prefer it for timing.
    const timing = members.find((member) => member.provider.id === 'ppv') || members[0];
    const withTeams = members.find((member) => member.teams) || members[0];
    const withLogos = members.find((member) => member.logos?.home && member.logos?.away);
    const tagged = members.find((member) => member.tag && !/24\/7/i.test(member.tag));
    const entry = {
      category: timing.category,
      teams: withTeams.teams || null,
      name: '',
      poster: (members.find((member) => member.provider.id === 'ppv' && member.poster) || members.find((member) => member.poster))?.poster || null,
      logos: withLogos?.logos || null,
      colors: members.find((member) => member.colors)?.colors || null,
      tag: tagged?.tag || null,
      startsAt: timing.startsAt,
      endsAt: timing.endsAt,
      alwaysLive: members.every((member) => member.alwaysLive),
      replay: timing.replay,
      // PPV first (most reliable in practice), then StreamFree, then
      // Streamed's sub-sources.
      providers: [...providers].sort((a, b) => ['ppv', 'streamfree', 'streamed'].indexOf(a.id) - ['ppv', 'streamfree', 'streamed'].indexOf(b.id)),
    };
    entry.name = cleanName(entry, (members.find((member) => member.provider.id === 'ppv') || members[0]).name);
    entry.league = inferLeague(entry);
    entry.id = eventId(entry);
    entry.live = entry.alwaysLive || (entry.startsAt <= now && entry.endsAt >= now);
    entry.upcoming = !entry.alwaysLive && entry.startsAt > now;
    return entry;
  });

  // Same id can still collide (e.g. two legs of a doubleheader on one day).
  const seenIds = new Map();
  merged.forEach((entry) => {
    const count = seenIds.get(entry.id) || 0;
    seenIds.set(entry.id, count + 1);
    if (count) entry.id = `${entry.id}#${count}`;
  });

  merged.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.startsAt - b.startsAt;
  });
  return merged;
}

// ── Admin switches ─────────────────────────────────────────────────────
// Sports feeds share server_config with the movie servers, under a
// "sports:" prefix: sports:ppv, sports:streamfree, sports:streamed (all of
// Streamed) and sports:streamed:<source> (one Streamed source, e.g. alpha).

export const SPORTS_PROVIDER_IDS = Object.keys(PROVIDER_NAMES);

export function sportsSwitchKeys(provider) {
  if (!provider?.id) return [];
  const keys = [`sports:${provider.id}`];
  if (provider.id === 'streamed' && provider.source) keys.push(`sports:streamed:${provider.source}`);
  return keys;
}

export function withoutDisabledFeeds(rawItems, disabled) {
  if (!disabled || disabled.size === 0) return rawItems;
  return rawItems.filter((item) => !sportsSwitchKeys(item.provider).some((key) => disabled.has(key)));
}

// How many feeds each provider (and each Streamed source) has right now,
// for the admin panel.
export function countFeedsBySwitch(rawItems) {
  const counts = {};
  for (const item of rawItems) {
    for (const key of sportsSwitchKeys(item.provider)) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// ── Public API ─────────────────────────────────────────────────────────

export async function fetchRawSportsStreams() {
  const results = await Promise.allSettled([
    fetchPpvNormalized(),
    fetchStreamedNormalized(),
    fetchStreamfreeNormalized(),
  ]);
  const lists = results.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value);
  if (lists.length === 0) {
    const firstError = results.find((result) => result.status === 'rejected');
    throw new Error(firstError?.reason?.message || 'All sports providers unavailable');
  }
  return lists;
}

export async function fetchAllSportsStreams() {
  return mergeNormalized(await fetchRawSportsStreams());
}

// Unmerged feeds: server proxy first (one shared cache, and a server IP is
// less likely to trip streamed.pk's ddos-guard), direct browser fetch as a
// fallback.
export async function fetchSportsFeeds() {
  try {
    const res = await fetch('/api/sports/streams', { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (!data.error && Array.isArray(data.raw) && data.raw.length > 0) return data.raw;
    }
  } catch { /* fall through */ }
  return fetchRawSportsStreams();
}

// Feeds an admin switched off are left out before merging, so a game only
// shows if some enabled feed still carries it.
export async function fetchSportsStreams() {
  const [raw, disabled] = await Promise.all([fetchSportsFeeds(), fetchDisabledServers()]);
  return mergeNormalized(withoutDisabledFeeds(raw, disabled));
}

// Resolves one server entry into an embeddable iframe URL. PPV and
// StreamFree give one up front; Streamed.pk needs a lookup per source.
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

// "Server 2 · Streamed · admin" style label for the server dropdown.
export function providerLabel(provider) {
  if (!provider) return '';
  return provider.label || PROVIDER_NAMES[provider.id] || provider.id;
}

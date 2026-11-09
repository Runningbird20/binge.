// Multi-provider sports stream aggregation. Combines independent, free
// live-sports feeds (PPV.st, StreamFree, TimStreams, and college games on TV
// channels; see sportsFeeds.js) into one feed with
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
// Fetching + normalizing each feed is in sportsFeeds.js, shared with the server
// route (/api/sports/streams), which returns the unmerged list; merging only happens here.

import { fetchDisabledServers } from './streamPreferences';
import { fetchPpvNormalized, fetchStreamfreeNormalized, fetchTimstreamsNormalized, fetchTvChannelGamesNormalized } from './sportsFeeds';

const PROVIDER_NAMES = {
  ppv: 'PPV',
  streamfree: 'StreamFree',
  timstreams: 'TimStreams',
};

// The feeds, in the fixed order they're merged in (a game takes its name and
// id from its first listing, so the order must never depend on arrival), with
// the admin switch that turns each off. Both TimStreams feeds share one switch.
const FEEDS = [
  { fetch: fetchPpvNormalized, key: 'sports:ppv' },
  { fetch: fetchStreamfreeNormalized, key: 'sports:streamfree' },
  { fetch: fetchTimstreamsNormalized, key: 'sports:timstreams' },
  { fetch: fetchTvChannelGamesNormalized, key: 'sports:timstreams' },
];

const MERGE_WINDOW_SEC = 3 * 3600;

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
  // One name is the other's short form: "BYU" ⊂ "BYU Cougars", "Iowa State" ⊂
  // "Iowa State Cyclones" (short school names fail the length rule below).
  const within = (x, y) => x.every((tokenX) => y.some((tokenY) => tokensMatch(tokenX, tokenY)));
  const sameQualifiers = qa.length === qb.length && qa.every((token) => qb.includes(token));
  if (sameQualifiers && (within(a, b) || within(b, a))) return true;
  return a.some((tokenA) => tokenA.length >= 4 && b.some((tokenB) => tokensMatch(tokenA, tokenB)));
}

function titleSlug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Women's events: a women's game never merges with the men's game between
// the same two schools (college doubleheaders are often hours apart on one
// day), and gets its own id.
function isWomens(item) {
  return /\bwomen|\bncaaw\b|\(w\)/i.test(`${item.tag || ''} ${item.name || ''}`);
}

function sameEvent(a, b) {
  if (a.category !== b.category) return false;
  if (isWomens(a) !== isWomens(b)) return false;

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

// Feeds name the same league differently (StreamFree "NCAAF", PPV "College
// Football"); one name per league keeps it to one row.
const LEAGUE_ALIASES = {
  ncaaf: 'College Football', 'ncaa football': 'College Football', 'college football': 'College Football',
  ncaab: 'College Basketball', 'ncaa basketball': 'College Basketball', 'college basketball': 'College Basketball',
  ncaaw: "Women's College Basketball", 'ncaa women\'s basketball': "Women's College Basketball", 'women\'s college basketball': "Women's College Basketball",
  epl: 'Premier League', 'english premier league': 'Premier League', 'premier league': 'Premier League',
  'la liga': 'LaLiga', laliga: 'LaLiga',
  ucl: 'Champions League', 'uefa champions league': 'Champions League', 'champions league': 'Champions League',
  f1: 'Formula 1', 'formula one': 'Formula 1', 'formula 1': 'Formula 1',
  wwe: 'Wrestling', aew: 'Wrestling', wrestling: 'Wrestling',
  ufc: 'UFC', mma: 'MMA',
};

export function canonicalLeague(name) {
  if (!name) return name;
  return LEAGUE_ALIASES[String(name).trim().toLowerCase()] || name;
}

function inferLeague(item) {
  if (item.tag && !/24\/7/i.test(item.tag)) return canonicalLeague(item.tag);
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
  return `${entry.category}${isWomens(entry) ? '-w' : ''}|${base}|${day}`.toLowerCase();
}

// Server order within a game; any other feed id goes last.
const SERVER_ORDER = ['ppv', 'streamfree', 'timstreams'];
function feedRank(id) {
  const index = SERVER_ORDER.indexOf(id);
  return index === -1 ? SERVER_ORDER.length : index;
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
    const withColors = members.find((member) => member.colors?.length >= 2);
    const tagged = members.find((member) => member.tag && !/24\/7/i.test(member.tag));
    const entry = {
      category: timing.category,
      teams: withTeams.teams || null,
      name: '',
      poster: (members.find((member) => member.provider.id === 'ppv' && member.poster) || members.find((member) => member.poster))?.poster || null,
      logos: withLogos?.logos || null,
      colors: withColors?.colors || null,
      // A college conference game's conference (its card shows that mark).
      conference: members.find((member) => member.conference)?.conference || null,
      tag: tagged?.tag || null,
      startsAt: timing.startsAt,
      endsAt: timing.endsAt,
      alwaysLive: members.every((member) => member.alwaysLive),
      replay: timing.replay,
      // PPV first (most reliable in practice), then StreamFree, then TimStreams.
      providers: [...providers].sort((a, b) => feedRank(a.id) - feedRank(b.id)),
    };
    entry.name = cleanName(entry, (members.find((member) => member.provider.id === 'ppv') || members[0]).name);
    // Logos follow the name's order ("A vs B" → A's logo first), even when
    // they came from a feed that lists the teams the other way round.
    const named = splitTeamsFromTitle(entry.name);
    if (entry.logos && withLogos?.teams && named
      && teamsMatch(named.home, withLogos.teams.away) && !teamsMatch(named.home, withLogos.teams.home)) {
      entry.logos = { home: entry.logos.away, away: entry.logos.home };
    }
    // Colors too: each team's color sits behind its own logo.
    if (entry.colors && withColors?.teams && named
      && teamsMatch(named.home, withColors.teams.away) && !teamsMatch(named.home, withColors.teams.home)) {
      entry.colors = [entry.colors[1], entry.colors[0]];
    }
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
// "sports:" prefix: sports:ppv, sports:streamfree and sports:timstreams (its
// events and the TV-channel college games). sports:streamed and
// sports:streamed:<source> are from Streamed, closed since November 2026.

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
  const results = await Promise.allSettled(FEEDS.map((feed) => feed.fetch()));
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

// Unmerged feeds: straight from the browser first (the feeds refuse
// Vercel's servers, so the proxy has answered 502 since 2026-10-08 and only
// added a wasted round trip), the server proxy as a fallback.
async function fetchProxyFeeds() {
  const res = await fetch('/api/sports/streams', { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`sports proxy ${res.status}`);
  const data = await res.json();
  if (data.error || !Array.isArray(data.raw) || data.raw.length === 0) throw new Error('sports proxy empty');
  return data.raw;
}

export async function fetchSportsFeeds() {
  try {
    return await fetchRawSportsStreams();
  } catch {
    return fetchProxyFeeds();
  }
}

// Feeds an admin switched off are left out before merging, so a game only
// shows if some enabled feed still carries it.
export async function fetchSportsStreams() {
  const [raw, disabled] = await Promise.all([fetchSportsFeeds(), fetchDisabledServers()]);
  return mergeNormalized(withoutDisabledFeeds(raw, disabled));
}

// Same result, delivered as each feed arrives: onUpdate(merged) runs after
// every feed, so the page shows games without waiting for the slowest one
// (StreamFree takes ~0.7s, the others ~0.3s). Resolves with the final list.
export async function loadSportsStreams(onUpdate) {
  const disabledPromise = fetchDisabledServers().catch(() => new Set());
  // Kept in feed order (FEEDS) whatever order they arrive in: the merge takes
  // a game's name and id from its first listing, so an arrival-order merge gave
  // the same game a different id from one refresh to the next (and the player
  // lost the game it was showing).
  const byFeed = FEEDS.map(() => null);
  const ordered = () => byFeed.filter(Boolean);
  let settled = 0;
  let lastError = null;
  // A feed switched off as a whole in Admin › Servers isn't even requested
  // (a provider that's down, like Streamed redirecting its API away in Oct
  // 2026, otherwise errors on every page that loads sports). Waits at most
  // 1.5s for the switches.
  const switches = await Promise.race([disabledPromise, new Promise((resolve) => setTimeout(() => resolve(new Set()), 1500))]);
  const feeds = FEEDS.map((feed) => (switches.has(feed.key) ? async () => [] : feed.fetch));
  await Promise.all(feeds.map((fetchFeed, index) => fetchFeed()
    .then(async (items) => {
      byFeed[index] = items;
      const disabled = await disabledPromise;
      settled += 1;
      // Show games once two feeds are in; the last one arrives with the
      // final update below.
      if (settled >= 2 && settled < feeds.length) onUpdate?.(mergeNormalized(withoutDisabledFeeds(ordered().flat(), disabled)));
    })
    .catch((error) => { settled += 1; lastError = error; })));
  if (ordered().length === 0) {
    const raw = await fetchProxyFeeds().catch(() => { throw lastError || new Error('All sports providers unavailable'); });
    const merged = mergeNormalized(withoutDisabledFeeds(raw, await disabledPromise));
    onUpdate?.(merged);
    return merged;
  }
  const merged = mergeNormalized(withoutDisabledFeeds(ordered().flat(), await disabledPromise));
  onUpdate?.(merged);
  return merged;
}

// The same real game in two schedule refreshes, even if its id changed
// (a feed renamed a team): same category, both teams match, within 3h.
export function sameGame(a, b) {
  if (!a || !b || a.category !== b.category || Boolean(a.alwaysLive) !== Boolean(b.alwaysLive)) return false;
  if (a.startsAt && b.startsAt && Math.abs(a.startsAt - b.startsAt) > 3 * 3600) return false;
  const ta = a.teams || splitTeamsFromTitle(a.name);
  const tb = b.teams || splitTeamsFromTitle(b.name);
  if (ta && tb) {
    return (teamsMatch(ta.home, tb.home) && teamsMatch(ta.away, tb.away)) || (teamsMatch(ta.home, tb.away) && teamsMatch(ta.away, tb.home));
  }
  return titleSlug(a.name) === titleSlug(b.name);
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
// ── Streamed: every stream of every source ─────────────────────────────
// A Streamed source usually has several streams (numbered feeds, HD and SD,
// different commentary). Feed lists only say which sources a game has, so
// the player expands them when a game opens.

const MAX_STREAMS_PER_SOURCE = 4;

async function fetchStreamedStreams(source, matchId) {
  const path = `${encodeURIComponent(source)}/${encodeURIComponent(matchId)}`;
  try {
    const res = await fetch(`/api/sports/resolve/streamed/${path}?all=1`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.streams) && data.streams.length) return data.streams;
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch(`https://streamed.pk/api/stream/${path}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list.filter((s) => typeof s.embedUrl === 'string') : null;
  } catch {
    return null;
  }
}

export function streamedStreamLabel(source, stream, count) {
  const language = stream.language && !/^main$/i.test(stream.language) ? ` · ${stream.language}` : '';
  const number = count > 1 ? ` ${stream.streamNo || ''}`.trimEnd() : '';
  return `Streamed · ${source}${number}${stream.hd ? ' HD' : ''}${language}`;
}

// Replaces each Streamed source with its streams (HD first, capped per
// source). A source that can't be looked up stays as it was and is resolved
// on demand, so expanding never loses a server.
// Expansions are cached briefly, so warming a game on hover makes the click
// that follows start at once.
const EXPAND_TTL_MS = 90_000;
const expandCache = new Map(); // key -> { at, promise }

export function expandStreamProviders(providers) {
  const key = providers.map((provider) => `${provider.id}|${provider.source || ''}|${provider.matchId || provider.embedUrl || ''}`).join(',');
  const hit = expandCache.get(key);
  if (hit && Date.now() - hit.at < EXPAND_TTL_MS) return hit.promise;
  const promise = expandStreamProvidersNow(providers);
  expandCache.set(key, { at: Date.now(), promise });
  promise.catch(() => expandCache.delete(key));
  return promise;
}

async function expandStreamProvidersNow(providers) {
  const expanded = await Promise.all(providers.map(async (provider) => {
    if (provider.id !== 'streamed' || provider.embedUrl || !provider.source || !provider.matchId) return [provider];
    const streams = await fetchStreamedStreams(provider.source, provider.matchId);
    if (!streams || streams.length === 0) return [provider];
    const sorted = [...streams].sort((a, b) => Number(Boolean(b.hd)) - Number(Boolean(a.hd)) || (a.streamNo || 0) - (b.streamNo || 0));
    return sorted.slice(0, MAX_STREAMS_PER_SOURCE).map((stream) => ({
      ...provider,
      embedUrl: stream.embedUrl,
      label: streamedStreamLabel(provider.source, stream, streams.length),
    }));
  }));
  const seen = new Set();
  return expanded.flat().filter((provider) => {
    const key = provider.embedUrl || `${provider.source}|${provider.matchId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function providerLabel(provider) {
  if (!provider) return '';
  return provider.label || PROVIDER_NAMES[provider.id] || provider.id;
}

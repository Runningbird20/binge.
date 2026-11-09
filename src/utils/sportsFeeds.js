// The sports feeds (PPV.st, StreamFree, TimStreams, and college games on TV
// channels), fetched and normalized into one shape: one entry per listing, each
// with a single provider as its server. Streamed.pk closed in November 2026 (its
// site now says so and lists PPV.st, StreamFree and TimStreams as alternatives).
// One copy, used by the browser (utils/sportsProviders.js, which merges the
// listings into one entry per game) and by the server's fallback proxy
// (server/routes/sports.js, which returns them unmerged). A plain .js ES module,
// never .mjs: Vercel's build compiles .js ES modules to CommonJS for the API
// function, and the server requires it inside the route, not at startup.
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

// ── TimStreams (tim-streams.com) ──────────────────────────────────────
// A public JSON API (CORS *): /api/live-upcoming lists events with their embeds,
// /api/channels 220 live TV channels. Times come without an offset and are US
// Eastern (checked against ESPN: "2026-11-09T19:00" was 00:00 UTC). Embeds
// played in an iframe on another site (2026-11-09) after one click, no pop-ups.

const TIM_API = 'https://tim-streams.com/api';

const TIM_GENRES = {
  1: 'Soccer', 2: 'Racing', 3: 'Combat Sports', 6: 'Combat Sports', 7: 'Basketball', 8: 'American Football',
  9: 'Baseball', 10: 'Tennis', 11: 'Hockey', 12: 'Darts', 13: 'Cricket', 15: 'Rugby', 16: 'Rugby',
};

// TimStreams' league names → ours (others pass through canonicalLeague).
const TIM_LEAGUES = {
  'National Basketball Association': 'NBA',
  'National Football League': 'NFL',
  'NCAA Football': 'College Football',
  'National Hockey League': 'NHL',
  'Major League Baseball': 'MLB',
  'Major League Soccer': 'MLS',
  'UEFA Champions League': 'Champions League',
  'La Liga': 'LaLiga',
  'Ligue One': 'Ligue 1',
};

// "2026-11-09T19:00" in US Eastern time → unix seconds.
export function easternToUnix(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return 0;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(asUtc));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const shownAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((2 * asUtc - shownAsUtc) / 1000);
}

async function fetchTimJson(path, { timeoutMs, headers }) {
  const res = await fetch(`${TIM_API}${path}`, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`tim-streams ${res.status}`);
  return res.json();
}

// Free streams only: VIP ones need a TimStreams login.
function timProviders(streams, label) {
  const free = (Array.isArray(streams) ? streams : []).filter((stream) => stream?.url && !stream.vip);
  return free.map((stream, index) => ({
    id: 'timstreams',
    embedUrl: stream.url,
    label: label(stream, index, free.length),
  }));
}

export async function fetchTimstreamsNormalized({ timeoutMs = 10000, headers = {} } = {}) {
  const data = await fetchTimJson('/live-upcoming', { timeoutMs, headers });
  if (!Array.isArray(data?.events)) throw new Error('tim-streams error');
  const leagueNames = new Map();
  for (const genre of data.genres || []) {
    for (const sub of genre.sub_categories || []) leagueNames.set(`${genre.id}:${sub.id}`, sub.name);
  }
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const event of data.events) {
    const category = TIM_GENRES[event.genre] || 'Other';
    const startsAt = easternToUnix(event.time);
    const endsAt = startsAt ? startsAt + (DURATION_SEC[category] || DEFAULT_DURATION_SEC) : 0;
    if (startsAt && now > endsAt) continue;
    // "Away @ Home"
    const [away, home] = String(event.name || '').split(/\s+@\s+/);
    const league = leagueNames.get(`${event.genre}:${event.sub_genre}`);
    const providers = timProviders(event.streams, (stream) => `TimStreams · ${stream.name || 'Live'}`);
    for (const provider of providers) {
      out.push({
        name: event.name,
        category,
        poster: event.logo ? new URL(event.logo, 'https://tim-streams.com').toString() : null,
        tag: league ? (TIM_LEAGUES[league] || league) : null,
        teams: home && away ? { home: home.trim(), away: away.trim() } : null,
        startsAt,
        endsAt,
        alwaysLive: !startsAt,
        replay: false,
        provider,
      });
    }
  }
  return out;
}

// ── College games on TV channels ──────────────────────────────────────
// Most college games are on no feed's schedule, but many air on a TV network
// TimStreams carries live. ESPN's scoreboard (every Division I game, with its
// national network) is joined with the channel list: each game on a carried
// network becomes a listing whose server is that channel's live stream.
// Streaming-only services (ESPN+, SECN+, ACCNX, B1G+, Peacock, FloSports) have
// no channel, so those games stay uncovered.

// How far ahead each is listed. Football is weekly and listed a week ahead,
// as PPV lists Saturday's games from Monday: ESPN's scoreboard without a date
// is the current week (Tuesday to Saturday), one request. Basketball is daily
// and ~150 games a day, so today's and tomorrow's (Eastern days), as far as 30
// hours ahead. ESPN returns nothing for a date range with a division filter.
const COLLEGE_SCHEDULES = [
  { league: 'College Football', category: 'American Football', path: 'football/college-football', groups: 80, byWeek: true, aheadHours: 7 * 24 },
  { league: 'College Basketball', category: 'Basketball', path: 'basketball/mens-college-basketball', groups: 50, aheadHours: 30 },
  { league: "Women's College Basketball", category: 'Basketball', path: 'basketball/womens-college-basketball', groups: 50, aheadHours: 30 },
];

// ESPN's network names → TimStreams channel names.
const CHANNEL_FOR_NETWORK = {
  ESPN: 'ESPN', ESPN2: 'ESPN2', ESPNU: 'ESPNU', ESPNEWS: 'ESPNEWS',
  'SEC Network': 'SEC Network', 'ACC Network': 'ACC Network', BTN: 'Big Ten Network',
  CBSSN: 'CBS Sports Network', FS1: 'Fox Sports 1', FS2: 'Fox Sports 2',
  truTV: 'TruTV', TNT: 'TNT', TBS: 'TBS', 'USA Net': 'USA Network', CW: 'CW',
  ABC: 'ABC', CBS: 'CBS', Fox: 'Fox', FOX: 'Fox', NBC: 'NBC',
};

// Over-the-air networks split the country on busy Saturdays (several games in
// one window, each in its own region), and TimStreams carries one feed of
// each. Their games are only listed when nothing else of ours is on that
// network within 3 hours.
const REGIONAL_NETWORKS = new Set(['ABC', 'CBS', 'Fox', 'NBC', 'CW']);

// ESPN's scoreboard "dates" are US Eastern calendar days.
function easternDay(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(unixSeconds * 1000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

async function fetchEspnJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  return res.json();
}

// In a browser, through our own /api/sports/espn when ESPN refuses the page
// (its bot filter), as liveScores.js does. The server asks ESPN directly.
async function fetchCollegeGames({ path, groups }, day, timeoutMs) {
  const query = `${day ? `dates=${day}&` : ''}groups=${groups}&limit=500`;
  const direct = fetchEspnJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?${query}`, timeoutMs);
  const board = typeof window === 'undefined'
    ? await direct
    : await direct.catch(() => fetchEspnJson(`/api/sports/espn?path=${path}/scoreboard&${query}`, timeoutMs));
  return board.events || [];
}

// ESPN's team color ("232d4b") as "#232d4b".
function teamColor(team) {
  return /^[0-9a-f]{6}$/i.test(team?.color || '') ? `#${team.color}` : null;
}

export async function fetchTvChannelGamesNormalized({ timeoutMs = 10000, headers = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const days = [...new Set([easternDay(now), easternDay(now + 86400)])];
  const [channelData, ...boards] = await Promise.all([
    fetchTimJson('/channels', { timeoutMs, headers }),
    ...COLLEGE_SCHEDULES.flatMap((schedule) => (schedule.byWeek ? [null] : days).map((day) => fetchCollegeGames(schedule, day, timeoutMs)
      .then((events) => ({ schedule, events }))
      .catch(() => ({ schedule, events: [] })))),
  ]);
  const channels = new Map((channelData?.channels || []).map((channel) => [channel.name, channel]));
  if (channels.size === 0) throw new Error('tim-streams channels empty');

  const games = [];
  const seen = new Set();
  for (const { schedule, events } of boards) {
    for (const event of events) {
      const competition = event.competitions?.[0];
      if (!competition || seen.has(event.id) || event.status?.type?.state === 'post') continue;
      seen.add(event.id);
      const startsAt = Math.floor(Date.parse(event.date) / 1000);
      if (!startsAt || startsAt > now + schedule.aheadHours * 3600) continue;
      const networks = (competition.broadcasts || [])
        .filter((broadcast) => broadcast.market === 'national')
        .flatMap((broadcast) => broadcast.names || [])
        .map((network) => CHANNEL_FOR_NETWORK[network])
        .filter((name) => name && channels.has(name));
      if (networks.length === 0) continue;
      const team = (side) => competition.competitors?.find((competitor) => competitor.homeAway === side)?.team;
      const home = team('home');
      const away = team('away');
      if (!home || !away) continue;
      const conference = competition.conferenceCompetition && competition.groups?.isConference ? competition.groups.name || null : null;
      games.push({ schedule, startsAt, home, away, conference, networks: [...new Set(networks)] });
    }
  }

  const sharesRegionalWindow = (game, network) => games.some((other) => other !== game
    && other.networks.includes(network) && Math.abs(other.startsAt - game.startsAt) < 3 * 3600);

  const out = [];
  for (const game of games) {
    const { schedule, startsAt, home, away, conference } = game;
    for (const network of game.networks) {
      if (REGIONAL_NETWORKS.has(network) && sharesRegionalWindow(game, network)) continue;
      const providers = timProviders(channels.get(network).streams, (stream, index, count) => `${network}${count > 1 ? ` ${index + 1}` : ''} · TimStreams`);
      const homeName = home.location || home.shortDisplayName || home.displayName;
      const awayName = away.location || away.shortDisplayName || away.displayName;
      for (const provider of providers) {
        out.push({
          name: `${awayName} at ${homeName}`,
          category: schedule.category,
          poster: null,
          tag: schedule.league,
          teams: { home: homeName, away: awayName },
          logos: { home: home.logo || null, away: away.logo || null },
          colors: teamColor(home) && teamColor(away) ? [teamColor(home), teamColor(away)] : null,
          conference,
          startsAt,
          endsAt: startsAt + (DURATION_SEC[schedule.category] || DEFAULT_DURATION_SEC),
          alwaysLive: false,
          replay: false,
          provider,
        });
      }
    }
  }
  return out;
}

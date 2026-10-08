// Live score, box score and play-by-play for a game, from ESPN's public
// site API (no key; CORS-enabled). A stream is matched to an ESPN event by
// league + both team names, so the panel still has value when the stream
// lags or drops.
import { teamsMatch, splitTeamsFromTitle } from './sportsProviders';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const LEAGUE_PATHS = {
  NFL: ['football/nfl'],
  'College Football': ['football/college-football'],
  NBA: ['basketball/nba'],
  WNBA: ['basketball/wnba'],
  NHL: ['hockey/nhl'],
  MLB: ['baseball/mlb'],
  MLS: ['soccer/usa.1'],
  'Premier League': ['soccer/eng.1'],
  LaLiga: ['soccer/esp.1'],
  'Champions League': ['soccer/uefa.champions'],
  'Serie A': ['soccer/ita.1'],
  Bundesliga: ['soccer/ger.1'],
  'Ligue 1': ['soccer/fra.1'],
  'Liga MX': ['soccer/mex.1'],
};

const CATEGORY_PATHS = {
  'American Football': ['football/nfl', 'football/college-football'],
  Basketball: ['basketball/nba', 'basketball/wnba', 'basketball/mens-college-basketball'],
  Hockey: ['hockey/nhl'],
  Baseball: ['baseball/mlb'],
  Soccer: ['soccer/eng.1', 'soccer/esp.1', 'soccer/usa.1', 'soccer/uefa.champions', 'soccer/ita.1', 'soccer/ger.1', 'soccer/fra.1', 'soccer/mex.1'],
};

export function espnPathsFor(stream) {
  return LEAGUE_PATHS[stream.league] || CATEGORY_PATHS[stream.category] || [];
}

const cache = new Map(); // url -> { at, promise }

// Through our own /api when ESPN refuses the browser (bot filters, CORS).
function proxyUrl(url) {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  params.set('path', parsed.pathname.replace('/apis/site/v2/sports/', ''));
  return `/api/sports/espn?${params}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function getJson(url, ttl) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = fetchJson(url)
    .catch(() => fetchJson(proxyUrl(url)))
    .catch(() => null);
  cache.set(url, { at: Date.now(), promise });
  return promise;
}

// ESPN's scoreboard "dates" are US Eastern calendar days.
function easternDay(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(unixSeconds * 1000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

function eventMatches(event, teams) {
  const competitors = event.competitions?.[0]?.competitors || [];
  const names = competitors.map((c) => c.team?.displayName || c.team?.name || '');
  if (names.length !== 2) return false;
  return (teamsMatch(teams.home, names[0]) && teamsMatch(teams.away, names[1]))
    || (teamsMatch(teams.home, names[1]) && teamsMatch(teams.away, names[0]));
}

// { path, eventId } or null.
export async function findEspnEvent(stream) {
  const teams = stream.teams || splitTeamsFromTitle(stream.name);
  if (!teams || stream.alwaysLive) return null;
  const day = stream.startsAt ? easternDay(stream.startsAt) : null;
  for (const path of espnPathsFor(stream)) {
    const url = `${BASE}/${path}/scoreboard${day ? `?dates=${day}` : ''}${path.includes('college') ? `${day ? '&' : '?'}groups=80&limit=300` : ''}`;
    const board = await getJson(url, 60_000);
    const event = (board?.events || []).find((candidate) => eventMatches(candidate, teams));
    if (event) return { path, eventId: event.id };
  }
  return null;
}

function teamStats(boxTeam) {
  // Most sports give { label, displayValue }; baseball nests per-category
  // arrays instead, which we skip (line score covers it).
  return (boxTeam?.statistics || [])
    .filter((stat) => stat && typeof stat.displayValue === 'string')
    .map((stat) => ({ key: stat.name || stat.label, label: stat.label || stat.name, value: stat.displayValue }));
}

// Normalized summary for the panel.
export async function fetchGameSummary({ path, eventId }, { fresh = false } = {}) {
  const data = await getJson(`${BASE}/${path}/summary?event=${eventId}`, fresh ? 15_000 : 60_000);
  if (!data) return null;
  const competition = data.header?.competitions?.[0] || {};
  const status = competition.status?.type || {};
  const competitors = [...(competition.competitors || [])].sort((a) => (a.homeAway === 'away' ? -1 : 1));
  const teams = competitors.map((c) => ({
    id: c.team?.id,
    name: c.team?.displayName,
    short: c.team?.abbreviation || c.team?.shortDisplayName,
    // Prefer the variant made for dark backgrounds (the panel is dark).
    logo: (c.team?.logos || []).find((logo) => (logo.rel || []).includes('dark'))?.href || c.team?.logos?.[0]?.href || c.team?.logo || null,
    score: c.score ?? '',
    homeAway: c.homeAway,
    lines: (c.linescores || []).map((line) => line.displayValue ?? line.value ?? ''),
    record: c.record?.[0]?.summary || '',
  }));

  const box = data.boxscore?.teams || [];
  const statsByTeam = teams.map((team) => teamStats(box.find((entry) => entry.team?.id === team.id)));
  const statRows = (statsByTeam[0] || [])
    .map((stat) => ({ label: stat.label, away: stat.value, home: (statsByTeam[1] || []).find((other) => other.key === stat.key)?.value ?? '' }))
    .slice(0, 8);

  const leaders = (data.leaders || []).map((group) => ({
    team: group.team?.abbreviation,
    items: (group.leaders || []).slice(0, 3).map((category) => ({
      category: category.displayName,
      name: category.leaders?.[0]?.athlete?.shortName || category.leaders?.[0]?.athlete?.displayName,
      value: category.leaders?.[0]?.displayValue,
    })).filter((entry) => entry.name),
  })).filter((group) => group.items.length);

  const plays = (data.plays || [])
    .filter((play) => play.text)
    .slice(-25)
    .reverse()
    .map((play) => ({
      id: play.id,
      text: play.text,
      clock: play.clock?.displayValue || '',
      period: play.period?.displayValue || (play.period?.number ? `P${play.period.number}` : ''),
      scoring: Boolean(play.scoringPlay),
      score: play.scoringPlay && play.awayScore != null ? `${play.awayScore}–${play.homeScore}` : '',
    }));

  return {
    state: status.state || 'pre', // pre | in | post
    detail: status.shortDetail || status.detail || '',
    teams,
    periods: Math.max(0, ...teams.map((team) => team.lines.length)),
    statRows,
    leaders,
    plays,
  };
}

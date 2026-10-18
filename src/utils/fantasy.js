// ESPN Fantasy rosters for the live score panel. The game being watched picks
// the fantasy game (NFL → football, MLB → baseball, …), so a football and a
// baseball league each show up only during their own sport.
//
// League ids and the private-league cookies (espn_s2 + SWID) stay on this
// device, per profile: they act like an ESPN password, so they're never
// written to Supabase. /api/sports/fantasy forwards them to ESPN per request.
import { getActiveProfileId } from './activeProfile';

export const FANTASY_EVENT = 'binge:fantasy-changed';

const PATH_TO_GAME = {
  'football/nfl': 'ffl',
  'baseball/mlb': 'flb',
  'basketball/nba': 'fba',
  'hockey/nhl': 'fhl',
};

export const GAME_LABELS = {
  ffl: 'Football',
  flb: 'Baseball',
  fba: 'Basketball',
  fhl: 'Hockey',
};

// ESPN lineup slot ids per game, in the order ESPN lists a lineup.
const SLOTS = {
  ffl: { order: [0, 2, 4, 6, 23, 16, 17, 20, 21], names: { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'Bench', 21: 'IR' }, bench: [20, 21] },
  flb: { order: [0, 1, 2, 3, 4, 6, 7, 19, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], names: { 0: 'C', 1: '1B', 2: '2B', 3: '3B', 4: 'SS', 5: 'OF', 6: '2B/SS', 7: '1B/3B', 8: 'LF', 9: 'CF', 10: 'RF', 11: 'DH', 12: 'UTIL', 13: 'P', 14: 'SP', 15: 'RP', 16: 'Bench', 17: 'IL', 19: 'IF' }, bench: [16, 17] },
  fba: { order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], names: { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'Bench', 13: 'IR' }, bench: [12, 13] },
  fhl: { order: [0, 1, 2, 3, 4, 5, 6, 7, 8], names: { 0: 'C', 1: 'LW', 2: 'RW', 3: 'F', 4: 'D', 5: 'G', 6: 'UTIL', 7: 'Bench', 8: 'IR' }, bench: [7, 8] },
};

export function fantasyGameFor(espnPath) {
  return PATH_TO_GAME[espnPath] || null;
}

function storageKey() {
  return `binge.fantasy.v1:${getActiveProfileId() || 'default'}`;
}

function readAll() {
  try { return JSON.parse(window.localStorage.getItem(storageKey()) || '{}') || {}; } catch { return {}; }
}

function writeAll(all) {
  try { window.localStorage.setItem(storageKey(), JSON.stringify(all)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(FANTASY_EVENT));
}

// { leagueId, teamId, s2, swid } or null.
export function getFantasyLeague(game) {
  return readAll()[game] || null;
}

export function saveFantasyLeague(game, league) {
  writeAll({ ...readAll(), [game]: { ...getFantasyLeague(game), ...league } });
}

export function removeFantasyLeague(game) {
  const all = readAll();
  delete all[game];
  writeAll(all);
}

// Pulls a league id out of a pasted ESPN URL ("…?leagueId=123&teamId=4")
// or takes a bare number.
export function parseLeagueInput(text) {
  const value = String(text || '').trim();
  if (/^[0-9]{1,12}$/.test(value)) return { leagueId: value };
  try {
    const url = new URL(value);
    const leagueId = url.searchParams.get('leagueId');
    const teamId = url.searchParams.get('teamId');
    if (leagueId && /^[0-9]{1,12}$/.test(leagueId)) return { leagueId, teamId: teamId && /^[0-9]+$/.test(teamId) ? Number(teamId) : undefined };
  } catch { /* not a URL */ }
  return null;
}

const cache = new Map(); // key -> { at, promise }

export async function fetchFantasyLeague(game, league, { fresh = false } = {}) {
  const key = `${game}:${league.leagueId}:${league.swid || ''}:${(league.s2 || '').slice(-12)}`;
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < 20_000) return hit.promise;
  const headers = {};
  if (league.s2 && league.swid) {
    headers['x-espn-s2'] = league.s2;
    headers['x-espn-swid'] = league.swid;
  }
  const promise = fetch(`/api/sports/fantasy/${game}/${league.leagueId}`, { headers, signal: AbortSignal.timeout(15000) })
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'ESPN Fantasy isn’t answering right now.');
      return body;
    });
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

// The viewer's team: the saved choice, else the one ESPN says the SWID owns.
export function pickMyTeam(data, league) {
  const teams = data?.teams || [];
  return teams.find((team) => String(team.id) === String(league?.teamId)) || teams.find((team) => team.mine) || null;
}

export function slotName(game, slotId) {
  return SLOTS[game]?.names[slotId] || '';
}

export function isBenchSlot(game, slotId) {
  return Boolean(SLOTS[game]?.bench.includes(slotId));
}

export function sortRoster(game, roster) {
  const order = SLOTS[game]?.order || [];
  const rank = (slotId) => {
    const at = order.indexOf(slotId);
    return at === -1 ? order.length : at;
  };
  return [...roster].sort((a, b) => rank(a.slotId) - rank(b.slotId));
}

// Players whose pro team is on the field in this game. ESPN Fantasy's
// proTeamId is the same id the ESPN scores API uses; the abbreviation is a
// fallback for the few teams where they differ.
export function playingInGame(player, gameTeams) {
  return gameTeams.some((team) => String(team.id) === String(player.proTeamId)
    || (team.short && player.proTeam && team.short.toUpperCase() === player.proTeam.toUpperCase()));
}

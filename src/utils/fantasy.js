// ESPN Fantasy rosters for the live score panel. The game being watched picks
// the fantasy game (NFL → football, MLB → baseball, …), so a football and a
// baseball league each show up only during their own sport.
//
// Signed in, everything follows the account, per profile: leagues live in
// fantasy_leagues, and the private-league cookies (espn_s2 + SWID, which act
// like an ESPN password) are sent once to /api/sports/fantasy/credentials,
// which encrypts them server-side; the browser never reads them back.
// Signed out, both stay on this device and go to ESPN through the proxy as
// headers; the first signed-in visit moves them to the account.
import { getActiveProfileId } from './activeProfile';
import { getSupabaseSession, isSupabaseConfigured, supabase } from './supabase';

export const FANTASY_EVENT = 'binge:fantasy-changed';

const PATH_TO_GAME = {
  'football/nfl': 'ffl',
  'baseball/mlb': 'flb',
  'basketball/nba': 'fba',
  'hockey/nhl': 'fhl',
};

// The ESPN scores path for each fantasy game (which games are "on now").
export const GAME_PATHS = Object.fromEntries(Object.entries(PATH_TO_GAME).map(([path, game]) => [game, path]));

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

// Signed out, everything stays on this device:
// { teams: [{ key, game, leagueId, teamId }], login?: { s2, swid } }.
// (v1 kept one league per sport, with the login inside each; read once.)
function storageKey(version = 2) {
  return `binge.fantasy.v${version}:${getActiveProfileId() || 'default'}`;
}

function readLocal() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey()) || 'null');
    if (saved && Array.isArray(saved.teams)) return saved;
    const old = JSON.parse(window.localStorage.getItem(storageKey(1)) || '{}') || {};
    const teams = Object.entries(old).filter(([, l]) => l?.leagueId)
      .map(([game, l]) => ({ key: `${game}:${l.leagueId}:${l.teamId ?? ''}`, game, leagueId: String(l.leagueId), teamId: l.teamId }));
    const withLogin = Object.values(old).find((l) => l?.s2 && l?.swid);
    return { teams, login: withLogin ? { s2: withLogin.s2, swid: withLogin.swid } : undefined };
  } catch {
    return { teams: [] };
  }
}

function writeLocal(all) {
  try {
    window.localStorage.removeItem(storageKey(1));
    if (all.teams.length || all.login) window.localStorage.setItem(storageKey(), JSON.stringify(all));
    else window.localStorage.removeItem(storageKey());
  } catch { /* private mode */ }
}

let cache = null; // Promise<{ signedIn, teams: [{ key, game, leagueId, teamId }], login }>

function notify() {
  cache = null;
  try { window.dispatchEvent(new Event(FANTASY_EVENT)); } catch { /* old browsers */ }
}

async function session() {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data } = await getSupabaseSession();
    return data?.session || null;
  } catch {
    return null;
  }
}

function scoped(query) {
  const profileId = getActiveProfileId();
  return profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null);
}

async function credentialsRequest(method, auth, body) {
  const profileId = getActiveProfileId() || '';
  const res = await fetch(`/api/sports/fantasy/credentials${method === 'PUT' ? '' : `?profileId=${encodeURIComponent(profileId)}`}`, {
    method,
    headers: { Authorization: `Bearer ${auth.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify({ ...body, profileId: profileId || null }) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Couldn\u2019t reach the server.');
  return json;
}

async function insertTeam(userId, team) {
  const { error } = await supabase.from('fantasy_leagues').insert({
    user_id: userId, profile_id: getActiveProfileId(), game: team.game,
    league_id: String(team.leagueId), team_id: team.teamId ?? null, updated_at: new Date().toISOString(),
  });
  if (error?.code === '23505') {
    // Already tracked, or the database still allows one league per sport.
    throw new Error('That team is already on your list (or another team in this sport can\u2019t be added yet).');
  }
  if (error) throw new Error('Couldn\u2019t save your team.');
}

// Teams saved on this device before signing in move to the account once.
async function moveLocalToAccount(auth) {
  const local = readLocal();
  if (!local.teams.length && !local.login) return;
  for (const team of local.teams) await insertTeam(auth.user.id, team).catch(() => {});
  if (local.login) await credentialsRequest('PUT', auth, local.login);
  writeLocal({ teams: [] });
}

export function loadFantasy() {
  if (!cache) {
    cache = (async () => {
      const auth = await session();
      if (!auth) {
        const local = readLocal();
        return {
          signedIn: false,
          teams: local.teams,
          login: local.login ? { saved: true, swidHint: local.login.swid.replace(/[{}]/g, '').slice(-4) } : { saved: false },
        };
      }
      await moveLocalToAccount(auth).catch(() => { /* try again next load */ });
      const { data } = await scoped(supabase.from('fantasy_leagues').select('id, game, league_id, team_id').eq('user_id', auth.user.id).order('id'));
      const teams = (data || []).map((row) => ({ key: String(row.id), rowId: row.id, game: row.game, leagueId: row.league_id, teamId: row.team_id ?? undefined }));
      const login = await credentialsRequest('GET', auth).catch(() => ({ saved: false }));
      return { signedIn: true, teams, login };
    })().catch(() => ({ signedIn: false, teams: [], login: { saved: false } }));
  }
  return cache;
}

// Track another team (any sport, any number per sport).
export async function addFantasyTeam(game, { leagueId, teamId }) {
  const auth = await session();
  const team = { key: `${game}:${leagueId}:${teamId ?? ''}`, game, leagueId: String(leagueId), teamId };
  if (auth) {
    await insertTeam(auth.user.id, team);
  } else {
    const local = readLocal();
    if (local.teams.some((t) => t.key === team.key)) throw new Error('That team is already on your list.');
    writeLocal({ ...local, teams: [...local.teams, team] });
  }
  notify();
}

// Which team in the league is yours (picked after the league loads).
export async function setFantasyTeam(entry, teamId) {
  const auth = await session();
  if (auth && entry.rowId) {
    const { error } = await supabase.from('fantasy_leagues').update({ team_id: teamId, updated_at: new Date().toISOString() }).eq('id', entry.rowId);
    if (error) throw new Error('Couldn\u2019t save your team.');
  } else {
    const local = readLocal();
    writeLocal({ ...local, teams: local.teams.map((t) => (t.key === entry.key ? { ...t, teamId, key: `${t.game}:${t.leagueId}:${teamId}` } : t)) });
  }
  notify();
}

export async function removeFantasyTeam(entry) {
  const auth = await session();
  if (auth && entry.rowId) {
    await supabase.from('fantasy_leagues').delete().eq('id', entry.rowId);
  } else {
    const local = readLocal();
    writeLocal({ ...local, teams: local.teams.filter((t) => t.key !== entry.key) });
  }
  notify();
}

// The private-league login is one per profile (it's the ESPN account), so it
// covers every league at once.
export async function saveEspnLogin(s2, swid) {
  const auth = await session();
  if (auth) await credentialsRequest('PUT', auth, { s2, swid });
  else writeLocal({ ...readLocal(), login: { s2, swid } });
  notify();
}

export async function forgetEspnLogin() {
  const auth = await session();
  if (auth) {
    await credentialsRequest('DELETE', auth);
  } else {
    const { login, ...rest } = readLocal();
    writeLocal(rest);
  }
  notify();
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

const rosterCache = new Map(); // key -> { at, promise }

export async function fetchFantasyLeague(game, league, { fresh = false } = {}) {
  const auth = await session();
  const local = auth ? null : readLocal().login;
  const profileId = getActiveProfileId() || '';
  const key = `${game}:${league.leagueId}:${auth ? `${auth.user.id}:${profileId}` : (local?.swid || '')}`;
  const hit = rosterCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < 20_000) return hit.promise;
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth.access_token}`;
  else if (local?.s2 && local?.swid) {
    headers['x-espn-s2'] = local.s2;
    headers['x-espn-swid'] = local.swid;
  }
  const query = auth && profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const promise = fetch(`/api/sports/fantasy/${game}/${league.leagueId}${query}`, { headers, signal: AbortSignal.timeout(15000) })
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(body.error || 'ESPN Fantasy isn\u2019t answering right now.');
        error.needsCredentials = Boolean(body.needsCredentials);
        throw error;
      }
      return body;
    });
  rosterCache.set(key, { at: Date.now(), promise });
  promise.catch(() => rosterCache.delete(key));
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

// One tracked team at a glance: its team in the league data, this week's
// opponent, and the starters (with their points so far).
export function summarizeTeam(game, data, entry) {
  const team = pickMyTeam(data, entry);
  if (!team) return null;
  const opponent = team.matchup?.opponentId != null ? (data.teams || []).find((t) => t.id === team.matchup.opponentId) || null : null;
  const roster = sortRoster(game, team.roster || []);
  const starters = roster.filter((player) => !isBenchSlot(game, player.slotId));
  const starterPoints = Math.round(starters.reduce((sum, player) => sum + (player.points || 0), 0) * 10) / 10;
  return { team, opponent, roster, starters, points: team.matchup?.points ?? starterPoints, opponentPoints: team.matchup?.opponentPoints ?? null };
}

// Starters whose pro team is in one of the games on right now.
export function playingNow(players, liveTeams) {
  return players.filter((player) => playingInGame(player, liveTeams));
}

export function formatPoints(value) {
  if (value == null) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

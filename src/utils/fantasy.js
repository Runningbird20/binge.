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

function readLocal() {
  try { return JSON.parse(window.localStorage.getItem(storageKey()) || '{}') || {}; } catch { return {}; }
}

function writeLocal(all) {
  try {
    if (Object.keys(all).length) window.localStorage.setItem(storageKey(), JSON.stringify(all));
    else window.localStorage.removeItem(storageKey());
  } catch { /* private mode */ }
}

let cache = null; // Promise<{ signedIn, leagues: { [game]: { leagueId, teamId } }, login }>

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

async function upsertLeague(userId, game, league) {
  const { data: existing } = await scoped(supabase.from('fantasy_leagues').select('id').eq('user_id', userId).eq('game', game)).maybeSingle();
  const row = { league_id: String(league.leagueId), team_id: league.teamId ?? null, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await supabase.from('fantasy_leagues').update(row).eq('id', existing.id)
    : await supabase.from('fantasy_leagues').insert({ ...row, user_id: userId, profile_id: getActiveProfileId(), game });
  if (error) throw new Error('Couldn\u2019t save your league.');
}

// Leagues saved on this device before signing in move to the account once.
async function moveLocalToAccount(auth) {
  const local = readLocal();
  const games = Object.keys(local);
  if (!games.length) return;
  for (const game of games) {
    if (local[game]?.leagueId) await upsertLeague(auth.user.id, game, local[game]);
  }
  const withLogin = games.map((game) => local[game]).find((league) => league?.s2 && league?.swid);
  if (withLogin) await credentialsRequest('PUT', auth, { s2: withLogin.s2, swid: withLogin.swid });
  writeLocal({});
}

export function loadFantasy() {
  if (!cache) {
    cache = (async () => {
      const auth = await session();
      if (!auth) {
        const local = readLocal();
        const withLogin = Object.values(local).find((league) => league?.s2 && league?.swid);
        return { signedIn: false, leagues: local, login: withLogin ? { saved: true, swidHint: withLogin.swid.replace(/[{}]/g, '').slice(-4) } : { saved: false } };
      }
      await moveLocalToAccount(auth).catch(() => { /* try again next load */ });
      const { data } = await scoped(supabase.from('fantasy_leagues').select('game, league_id, team_id').eq('user_id', auth.user.id));
      const leagues = Object.fromEntries((data || []).map((row) => [row.game, { leagueId: row.league_id, teamId: row.team_id ?? undefined }]));
      const login = await credentialsRequest('GET', auth).catch(() => ({ saved: false }));
      return { signedIn: true, leagues, login };
    })().catch(() => ({ signedIn: false, leagues: {}, login: { saved: false } }));
  }
  return cache;
}

export async function saveFantasyLeague(game, league) {
  const auth = await session();
  const current = (await loadFantasy()).leagues[game];
  const next = { ...current, ...league };
  if (auth) await upsertLeague(auth.user.id, game, next);
  else writeLocal({ ...readLocal(), [game]: { ...readLocal()[game], ...next } });
  notify();
}

export async function removeFantasyLeague(game) {
  const auth = await session();
  if (auth) {
    await scoped(supabase.from('fantasy_leagues').delete().eq('user_id', auth.user.id).eq('game', game));
  } else {
    const local = readLocal();
    delete local[game];
    writeLocal(local);
  }
  notify();
}

// The private-league login is one per profile (it's the ESPN account), so it
// covers every sport's league at once.
export async function saveEspnLogin(s2, swid) {
  const auth = await session();
  if (auth) {
    await credentialsRequest('PUT', auth, { s2, swid });
  } else {
    const local = readLocal();
    Object.keys(local).forEach((game) => { local[game] = { ...local[game], s2, swid }; });
    writeLocal(local);
  }
  notify();
}

export async function forgetEspnLogin() {
  const auth = await session();
  if (auth) {
    await credentialsRequest('DELETE', auth);
  } else {
    const local = readLocal();
    Object.keys(local).forEach((game) => { const { s2, swid, ...rest } = local[game]; local[game] = rest; });
    writeLocal(local);
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
  const local = auth ? null : readLocal()[game];
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

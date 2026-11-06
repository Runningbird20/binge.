// Followed teams (per profile, synced): their games go to the top of
// Sports, and the server sends game-start and close-game alerts for them.
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

export const TEAMS_EVENT = 'binge:teams';

// ESPN leagues people can follow teams in (path → label).
export const FOLLOWABLE_LEAGUES = [
  ['football/nfl', 'NFL'],
  ['basketball/nba', 'NBA'],
  ['baseball/mlb', 'MLB'],
  ['hockey/nhl', 'NHL'],
  ['basketball/wnba', 'WNBA'],
  ['football/college-football', 'College Football'],
  ['basketball/mens-college-basketball', 'College Basketball'],
  ['soccer/usa.1', 'MLS'],
  ['soccer/eng.1', 'Premier League'],
  ['soccer/esp.1', 'LaLiga'],
  ['soccer/ita.1', 'Serie A'],
  ['soccer/ger.1', 'Bundesliga'],
  ['soccer/fra.1', 'Ligue 1'],
  ['soccer/mex.1', 'Liga MX'],
];

let cache = null; // Promise<rows> for cacheProfile
let cacheProfile;

function notify() {
  cache = null;
  try { window.dispatchEvent(new Event(TEAMS_EVENT)); } catch { /* old browsers */ }
}

async function userId() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

export function listFollowedTeams() {
  // Per profile: switching from one profile to another must not keep showing
  // the first one's teams (the cache outlived profile switches).
  const profileId = getActiveProfileId() || null;
  if (cache && cacheProfile !== profileId) cache = null;
  if (!cache) {
    cacheProfile = profileId;
    cache = (async () => {
      const id = await userId();
      if (!id) return [];
      let query = supabase.from('followed_teams').select('*').eq('user_id', id).order('created_at');
      const profileId = getActiveProfileId();
      query = profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null);
      const { data } = await query;
      return data || [];
    })().catch(() => []);
  }
  return cache;
}

export async function followTeam({ leaguePath, team }) {
  const id = await userId();
  if (!id) throw new Error('Sign in to follow teams.');
  const { error } = await supabase.from('followed_teams').insert({
    user_id: id,
    profile_id: getActiveProfileId(),
    league_path: leaguePath,
    team_id: String(team.id),
    team_name: team.name,
    team_abbr: team.short || team.abbr || null,
    logo: team.logo || null,
  });
  if (error && !/duplicate/i.test(error.message)) throw new Error('Couldn’t follow that team.');
  notify();
}

export async function unfollowTeam(rowId) {
  await supabase.from('followed_teams').delete().eq('id', rowId);
  notify();
}

export async function setTeamAlerts(rowId, alerts) {
  await supabase.from('followed_teams').update({ alerts }).eq('id', rowId);
  notify();
}

// Whether a game is one of these followed teams'. ESPN's team id when the
// game has a scoreboard (exact, and right across sports: the Kings are an NBA
// and an NHL team); otherwise the same league family and a strict name match
// (same nickname, or one name the other's short form). The general teamsMatch
// also accepts any shared word, which made "New York Knicks" match every New
// York team.
export function followedTeamPlays(followed, stream, teams) {
  const sport = (path) => String(path || '').split('/')[0];
  const espnTeams = stream.score?.teams || [];
  return followed.some((team) => {
    const ids = espnTeams.map((t) => t.id).filter(Boolean);
    if (ids.length && stream.score?.path) {
      return stream.score.path === team.league_path && ids.includes(String(team.team_id));
    }
    if (!teams) return false;
    if (stream.score?.path && sport(stream.score.path) !== sport(team.league_path)) return false;
    return [teams.home, teams.away].some((name) => sameTeamName(team.team_name, name));
  });
}

const CLUB_SUFFIX = new Set(['fc', 'cf', 'sc', 'afc', 'ac', 'cfc', 'ssc', 'bk', 'if', 'sv']);
const words = (name) => String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word && !CLUB_SUFFIX.has(word));

export function sameTeamName(followedName, gameName) {
  const a = words(followedName);
  const b = words(gameName);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  // Every word of the shorter name is in the longer one ("Real Madrid" /
  // "Real Madrid CF"). A shared last word alone isn't enough: "Atlético
  // Madrid", "Newcastle United". One word counts only as the other name's
  // nickname ("Knicks" / "New York Knicks") or as the whole followed name.
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (!shorter.every((word) => longer.includes(word))) return false;
  if (shorter.length >= 2) return true;
  const word = shorter[0];
  return word.length >= 4 && (word === longer[longer.length - 1] || shorter === a);
}

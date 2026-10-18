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

let cache = null; // Promise<rows>

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
  if (!cache) {
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

import { followedTeamPlays, sameTeamName } from './teams';

jest.mock('./supabase', () => ({ supabase: null, isSupabaseConfigured: false }));

describe('followed teams on the Sports page', () => {
  test.each([
    ['New York Knicks', 'Knicks', true],
    ['New York Knicks', 'New York Knicks', true],
    ['New York Knicks', 'New York Rangers', false],
    ['New York Knicks', 'Brooklyn Nets', false],
    ['Manchester United', 'Manchester City', false],
    ['Manchester United', 'Newcastle United', false],
    ['Manchester United', 'Man United', false], // abbreviations: the ESPN id match covers these
    ['Arsenal', 'Arsenal FC', true],
    ['Arsenal', 'Chelsea', false],
    ['Real Madrid', 'Real Madrid CF', true],
    ['Real Madrid', 'Atlético Madrid', false],
    ['Los Angeles Lakers', 'Los Angeles Clippers', false],
    ['Los Angeles Lakers', 'Lakers', true],
    ['Inter Miami CF', 'Inter', false],
  ])('%s vs %s → %s', (followed, game, expected) => {
    expect(sameTeamName(followed, game)).toBe(expected);
  });

  test('ESPN team ids decide when the game has a scoreboard', () => {
    const kings = [{ team_name: 'Los Angeles Kings', team_id: '8', league_path: 'hockey/nhl' }];
    const nbaKings = { score: { path: 'basketball/nba', teams: [{ id: '23', name: 'Sacramento Kings' }, { id: '12', name: 'Boston Celtics' }] } };
    const nhlKings = { score: { path: 'hockey/nhl', teams: [{ id: '8', name: 'Los Angeles Kings' }, { id: '1', name: 'Boston Bruins' }] } };
    expect(followedTeamPlays(kings, nbaKings, { home: 'Sacramento Kings', away: 'Boston Celtics' })).toBe(false);
    expect(followedTeamPlays(kings, nhlKings, { home: 'Los Angeles Kings', away: 'Boston Bruins' })).toBe(true);
  });

  test('without a scoreboard, names in the same sport only', () => {
    const knicks = [{ team_name: 'New York Knicks', team_id: '18', league_path: 'basketball/nba' }];
    expect(followedTeamPlays(knicks, {}, { home: 'New York Rangers', away: 'Boston Bruins' })).toBe(false);
    expect(followedTeamPlays(knicks, {}, { home: 'Knicks', away: 'Celtics' })).toBe(true);
  });
});

import { fantasyGameFor, isBenchSlot, parseLeagueInput, pickMyTeam, playingInGame, sortRoster } from './fantasy';

describe('fantasy', () => {
  it('maps the sport being watched to its ESPN Fantasy game', () => {
    expect(fantasyGameFor('football/nfl')).toBe('ffl');
    expect(fantasyGameFor('baseball/mlb')).toBe('flb');
    expect(fantasyGameFor('football/college-football')).toBeNull();
  });

  it('reads a league id from a bare number or an ESPN link', () => {
    expect(parseLeagueInput(' 123456 ')).toEqual({ leagueId: '123456' });
    expect(parseLeagueInput('https://fantasy.espn.com/football/team?leagueId=987&teamId=4&seasonId=2026')).toEqual({ leagueId: '987', teamId: 4 });
    expect(parseLeagueInput('my league')).toBeNull();
  });

  it('orders a lineup starters first, bench and IR last', () => {
    const roster = [{ id: 1, slotId: 20 }, { id: 2, slotId: 4 }, { id: 3, slotId: 0 }, { id: 4, slotId: 21 }];
    expect(sortRoster('ffl', roster).map((p) => p.id)).toEqual([3, 2, 1, 4]);
    expect(isBenchSlot('ffl', 20)).toBe(true);
    expect(isBenchSlot('flb', 16)).toBe(true);
  });

  it('finds players on either team in the game by ESPN team id or abbreviation', () => {
    const teams = [{ id: '23', short: 'PIT' }, { id: '27', short: 'TB' }];
    expect(playingInGame({ proTeamId: 23, proTeam: 'Pit' }, teams)).toBe(true);
    expect(playingInGame({ proTeamId: 99, proTeam: 'TB' }, teams)).toBe(true);
    expect(playingInGame({ proTeamId: 11, proTeam: 'IND' }, teams)).toBe(false);
  });

  it('uses the saved team, else the one the SWID owns', () => {
    const data = { teams: [{ id: 1 }, { id: 2, mine: true }] };
    expect(pickMyTeam(data, { teamId: 1 }).id).toBe(1);
    expect(pickMyTeam(data, {}).id).toBe(2);
  });
});

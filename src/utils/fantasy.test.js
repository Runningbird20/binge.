import { fantasyGameFor, formatPoints, isBenchSlot, parseLeagueInput, pickMyTeam, playingInGame, playingNow, sortRoster, summarizeTeam } from './fantasy';

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

  it('summarizes a tracked team: its matchup, opponent and starters', () => {
    const data = { teams: [
      { id: 1, name: 'Mine', abbrev: 'ME', matchup: { points: 87.4, opponentId: 2, opponentPoints: 92.1 },
        roster: [{ id: 10, slotId: 0, points: 20 }, { id: 11, slotId: 20, points: 5 }] },
      { id: 2, name: 'Rival', abbrev: 'RIV', roster: [] },
    ] };
    const summary = summarizeTeam('ffl', data, { teamId: 1 });
    expect(summary.team.name).toBe('Mine');
    expect(summary.opponent.name).toBe('Rival');
    expect(summary.points).toBe(87.4);
    expect(summary.opponentPoints).toBe(92.1);
    expect(summary.starters.map((p) => p.id)).toEqual([10]);
    expect(summarizeTeam('ffl', { teams: [{ id: 3, roster: [{ id: 1, slotId: 0, points: 7.25 }] }] }, { teamId: 3 }).points).toBe(7.3);
  });

  it('counts starters playing right now and formats points', () => {
    const starters = [{ proTeamId: 23, proTeam: 'PIT' }, { proTeamId: 11, proTeam: 'IND' }];
    expect(playingNow(starters, [{ short: 'PIT' }])).toHaveLength(1);
    expect(formatPoints(12)).toBe('12');
    expect(formatPoints(12.345)).toBe('12.3');
  });
});

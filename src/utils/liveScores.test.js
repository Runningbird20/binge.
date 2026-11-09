import { fetchTeamLooks, periodLabel } from './liveScores';

describe('periodLabel', () => {
  it('numbers regulation periods', () => {
    expect(periodLabel('football/nfl', 4)).toBe('4');
    expect(periodLabel('basketball/nba', 3)).toBe('3');
    expect(periodLabel('hockey/nhl', 3)).toBe('3');
  });

  it('labels football overtimes OT, 2OT…', () => {
    expect(periodLabel('football/nfl', 5)).toBe('OT');
    expect(periodLabel('football/college-football', 7)).toBe('3OT');
  });

  it('labels basketball overtimes after 4 quarters, or 2 halves in men’s college', () => {
    expect(periodLabel('basketball/nba', 5)).toBe('OT');
    expect(periodLabel('basketball/wnba', 6)).toBe('2OT');
    expect(periodLabel('basketball/mens-college-basketball', 3)).toBe('OT');
    expect(periodLabel('basketball/mens-college-basketball', 2)).toBe('2');
  });

  it('labels hockey OT, then a shootout in the regular season but more OTs in the playoffs', () => {
    expect(periodLabel('hockey/nhl', 4, 2)).toBe('OT');
    expect(periodLabel('hockey/nhl', 5, 2)).toBe('SO');
    expect(periodLabel('hockey/nhl', 5, 3)).toBe('2OT');
    expect(periodLabel('hockey/nhl', 7, 3)).toBe('4OT');
  });

  it('leaves other sports numbered', () => {
    expect(periodLabel('baseball/mlb', 10)).toBe('10');
    expect(periodLabel('soccer/eng.1', 3)).toBe('3');
  });
});

describe('fetchTeamLooks (cards for games past the scoreboards)', () => {
  const realTimeout = AbortSignal.timeout;
  const team = (displayName, location, name, abbr, color) => ({
    id: abbr, displayName, shortDisplayName: name, location, name, color,
    logos: [{ rel: ['full', 'default'], href: `https://logo.example/${abbr}.png` }, { rel: ['full', 'dark'], href: `https://logo.example/dark/${abbr}.png` }],
  });
  const reply = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  beforeEach(() => {
    AbortSignal.timeout = () => new AbortController().signal;
    global.fetch = jest.fn((url) => {
      if (String(url).includes('football/nfl/teams')) {
        return reply({ sports: [{ leagues: [{ teams: [
          { team: team('Washington Commanders', 'Washington', 'Commanders', 'wsh', '5a1414') },
          { team: team('New York Giants', 'New York', 'Giants', 'nyg', '003c7f') },
          { team: team('New York Jets', 'New York', 'Jets', 'nyj', '115740') },
        ] }] }] });
      }
      if (String(url).includes('college-football/scoreboard')) {
        return reply({ events: [{ competitions: [{ conferenceCompetition: true, groups: { id: '1', name: 'Atlantic Coast Conference', shortName: 'ACC', isConference: true }, competitors: [
          { team: { id: '228', displayName: 'Clemson Tigers', shortDisplayName: 'Clemson', location: 'Clemson', name: 'Tigers', color: 'f56600', conferenceId: '1', logo: 'https://logo.example/clem.png' } },
          { team: { id: '59', displayName: 'Georgia Tech Yellow Jackets', shortDisplayName: 'Georgia Tech', location: 'Georgia Tech', name: 'Yellow Jackets', color: '003057', conferenceId: '1', logo: 'https://logo.example/gt.png' } },
        ] }] }, { competitions: [{ conferenceCompetition: true, groups: { id: '8', name: 'Southeastern Conference', isConference: true }, competitors: [
          { team: { id: '61', displayName: 'Georgia Bulldogs', location: 'Georgia', name: 'Bulldogs', conferenceId: '8', logo: 'https://logo.example/uga.png' } },
          { team: { id: '142', displayName: 'Missouri Tigers', location: 'Missouri', name: 'Tigers', conferenceId: '8', logo: 'https://logo.example/miz.png' } },
        ] }] }] });
      }
      return reply({});
    });
  });
  afterEach(() => { delete global.fetch; AbortSignal.timeout = realTimeout; });

  it('finds both teams by name, in the order of the game’s name, with the default logos', async () => {
    const looks = await fetchTeamLooks([{ id: 'g1', league: 'NFL', name: 'Washington Commanders vs New York Giants', startsAt: 1 }]);
    expect(looks.get('g1')).toEqual({
      logos: { home: 'https://logo.example/wsh.png', away: 'https://logo.example/nyg.png' },
      colors: ['#5a1414', '#003c7f'],
      conference: null,
    });
  });

  it('gives nothing for a name that fits two teams, rather than a wrong logo', async () => {
    const looks = await fetchTeamLooks([{ id: 'g2', league: 'NFL', name: 'Washington vs New York', startsAt: 1 }]);
    expect(looks.has('g2')).toBe(false);
  });

  it('college football comes from the week’s scoreboard; leagues without a source are left alone', async () => {
    const looks = await fetchTeamLooks([
      { id: 'g3', league: 'College Football', name: 'Georgia Tech at Clemson', teams: { home: 'Georgia Tech', away: 'Clemson' }, startsAt: 1 },
      { id: 'g4', league: 'Wrestling', name: 'WWE Raw', startsAt: 1 },
    ]);
    expect(looks.get('g3').logos).toEqual({ home: 'https://logo.example/gt.png', away: 'https://logo.example/clem.png' });
    expect(looks.get('g3').conference).toBe('Atlantic Coast Conference');
    expect(looks.has('g4')).toBe(false);
    expect(global.fetch.mock.calls.map(([url]) => String(url)).some((url) => url.includes('college-football/teams'))).toBe(false);
  });

  it('a college football game that already has logos is still asked about its conference', async () => {
    const looks = await fetchTeamLooks([{
      id: 'g5', league: 'College Football', name: 'Missouri at Georgia', teams: { home: 'Georgia', away: 'Missouri' },
      logos: { home: 'a.png', away: 'b.png' }, colors: ['#000001', '#000002'], startsAt: 1,
    }]);
    expect(looks.get('g5').conference).toBe('Southeastern Conference');
  });
});


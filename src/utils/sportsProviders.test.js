import { canonicalCategory, countFeedsBySwitch, mergeNormalized, splitTeamsFromTitle, sportsSwitchKeys, teamsMatch, withoutDisabledFeeds } from './sportsProviders';

const T = 1791500000;

function raw(name, category, startsAt, provider, extra = {}) {
  return { name, category, startsAt, endsAt: startsAt + 10800, alwaysLive: false, replay: false, provider, ...extra };
}

test('parses every separator the providers use', () => {
  expect(splitTeamsFromTitle('Baltimore Ravens at Atlanta Falcons')).toEqual({ home: 'Baltimore Ravens', away: 'Atlanta Falcons' });
  expect(splitTeamsFromTitle('Duke Blue Devils - Georgia Tech Yellow Jackets')).toEqual({ home: 'Duke Blue Devils', away: 'Georgia Tech Yellow Jackets' });
  expect(splitTeamsFromTitle('Lens vs. Lyon')).toEqual({ home: 'Lens', away: 'Lyon' });
});

test('PPV "Football" is soccer', () => {
  expect(canonicalCategory('Football')).toBe('Soccer');
  expect(canonicalCategory('Ice Hockey')).toBe('Hockey');
});

test('team names match across city/abbreviation differences but not across teams', () => {
  expect(teamsMatch('LA Clippers', 'Los Angeles Clippers')).toBe(true);
  expect(teamsMatch('Manchester United', 'Man United')).toBe(true);
  expect(teamsMatch('Manchester United', 'Leeds United')).toBe(false);
  expect(teamsMatch('Manchester City', 'Manchester United')).toBe(false);
});

test('the same game from three providers becomes one entry with every server', () => {
  const merged = mergeNormalized([
    raw('Baltimore Ravens at Atlanta Falcons', 'American Football', T, { id: 'ppv', embedUrl: 'a', label: 'PPV · NBC' }, { tag: 'NFL' }),
    raw('Baltimore Ravens vs Atlanta Falcons', 'American Football', T + 600, { id: 'streamed', source: 'admin', matchId: 'x' }, { teams: { home: 'Baltimore Ravens', away: 'Atlanta Falcons' } }),
    raw('Atlanta Falcons vs Baltimore Ravens', 'American Football', T, { id: 'streamfree', embedUrl: 'b' }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].providers).toHaveLength(3);
  expect(merged[0].league).toBe('NFL');
  expect(merged[0].providers[0].id).toBe('ppv');
});

test('different games and far-apart times stay separate', () => {
  const merged = mergeNormalized([
    raw('Chicago Bears at Green Bay Packers', 'American Football', T, { id: 'ppv', embedUrl: 'a' }),
    raw('Chicago Bears at Detroit Lions', 'American Football', T, { id: 'ppv', embedUrl: 'b' }),
    raw('Chicago Bears at Green Bay Packers', 'American Football', T + 7 * 86400, { id: 'ppv', embedUrl: 'c' }),
  ]);
  expect(merged).toHaveLength(3);
});

test('racing sessions are not parsed as two teams, and schedule listings are dropped', () => {
  const merged = mergeNormalized([
    raw('Singapore Grand Prix - Practice 1', 'Racing', T, { id: 'ppv', embedUrl: 'a' }),
    raw('NFL Streams Schedule', 'Basketball', T, { id: 'streamed', source: 'delta', matchId: 'y' }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].name).toBe('Singapore Grand Prix - Practice 1');
  expect(merged[0].teams).toBeNull();
});

describe('admin feed switches', () => {
  const feeds = [
    { name: 'A vs B', provider: { id: 'ppv', embedUrl: 'x' } },
    { name: 'A vs B', provider: { id: 'streamed', source: 'alpha', matchId: '1' } },
    { name: 'A vs B', provider: { id: 'streamed', source: 'bravo', matchId: '1' } },
    { name: 'C vs D', provider: { id: 'streamfree', embedUrl: 'y' } },
  ];

  test('keys cover the provider and a Streamed source', () => {
    expect(sportsSwitchKeys(feeds[1].provider)).toEqual(['sports:streamed', 'sports:streamed:alpha']);
    expect(sportsSwitchKeys(feeds[0].provider)).toEqual(['sports:ppv']);
  });

  test('a switched-off source or provider drops only its feeds', () => {
    expect(withoutDisabledFeeds(feeds, new Set(['sports:streamed:alpha']))).toHaveLength(3);
    expect(withoutDisabledFeeds(feeds, new Set(['sports:streamed'])).map((f) => f.provider.id)).toEqual(['ppv', 'streamfree']);
    expect(withoutDisabledFeeds(feeds, new Set())).toBe(feeds);
  });

  test('counts feeds per switch', () => {
    expect(countFeedsBySwitch(feeds)).toEqual({
      'sports:ppv': 1, 'sports:streamed': 2, 'sports:streamed:alpha': 1, 'sports:streamed:bravo': 1, 'sports:streamfree': 1,
    });
  });
});

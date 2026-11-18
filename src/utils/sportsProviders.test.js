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
    raw('Baltimore Ravens vs Atlanta Falcons', 'American Football', T + 600, { id: 'timstreams', embedUrl: 'c', label: 'TimStreams' }, { teams: { home: 'Baltimore Ravens', away: 'Atlanta Falcons' } }),
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
    raw('NFL Streams Schedule', 'Basketball', T, { id: 'timstreams', embedUrl: 'd' }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].name).toBe('Singapore Grand Prix - Practice 1');
  expect(merged[0].teams).toBeNull();
});

describe('admin feed switches', () => {
  const feeds = [
    { name: 'A vs B', provider: { id: 'ppv', embedUrl: 'x' } },
    { name: 'A vs B', provider: { id: 'timstreams', embedUrl: 'z' } },
    { name: 'E vs F', provider: { id: 'timstreams', embedUrl: 'w' } },
    { name: 'C vs D', provider: { id: 'streamfree', embedUrl: 'y' } },
  ];

  test('one switch per provider', () => {
    expect(sportsSwitchKeys(feeds[1].provider)).toEqual(['sports:timstreams']);
    expect(sportsSwitchKeys(feeds[0].provider)).toEqual(['sports:ppv']);
    expect(sportsSwitchKeys(undefined)).toEqual([]);
  });

  test('a switched-off provider drops only its feeds', () => {
    expect(withoutDisabledFeeds(feeds, new Set(['sports:timstreams'])).map((f) => f.provider.id)).toEqual(['ppv', 'streamfree']);
    expect(withoutDisabledFeeds(feeds, new Set())).toBe(feeds);
  });

  test('counts feeds per switch', () => {
    expect(countFeedsBySwitch(feeds)).toEqual({ 'sports:ppv': 1, 'sports:timstreams': 2, 'sports:streamfree': 1 });
  });
});

describe('canonicalLeague', () => {
  const { canonicalLeague } = require('./sportsProviders');
  it('gives each league one name across feeds', () => {
    expect(canonicalLeague('NCAAF')).toBe('College Football');
    expect(canonicalLeague('College Football')).toBe('College Football');
    expect(canonicalLeague('La Liga')).toBe('LaLiga');
    expect(canonicalLeague('F1')).toBe('Formula 1');
    expect(canonicalLeague('Eredivisie')).toBe('Eredivisie');
  });
});

describe('merged logos', () => {
  it('follow the order of the game name', () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { category: 'American Football', startsAt: now - 600, endsAt: now + 3600 };
    const merged = mergeNormalized([
      { ...base, name: 'North Carolina Tar Heels vs Pittsburgh Panthers', provider: { id: 'ppv', embedUrl: 'https://a.example/1' } },
      { ...base, name: 'Pittsburgh Panthers vs North Carolina Tar Heels', logos: { home: 'pitt.png', away: 'unc.png' }, provider: { id: 'streamfree', embedUrl: 'https://b.example/1' } },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toMatch(/^North Carolina/);
    expect(merged[0].logos).toEqual({ home: 'unc.png', away: 'pitt.png' });
  });

  it('team colors follow it too, so each glows behind its own logo', () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { category: 'American Football', startsAt: now - 600, endsAt: now + 3600 };
    const merged = mergeNormalized([
      { ...base, name: 'North Carolina Tar Heels vs Pittsburgh Panthers', provider: { id: 'ppv', embedUrl: 'https://a.example/1' } },
      { ...base, name: 'Pittsburgh at North Carolina', teams: { home: 'Pittsburgh', away: 'North Carolina' }, colors: ['#003594', '#7bafd4'], provider: { id: 'timstreams', embedUrl: 'https://c.example/1' } },
    ]);
    expect(merged[0].name).toMatch(/^North Carolina/);
    expect(merged[0].colors).toEqual(['#7bafd4', '#003594']);
  });
});

describe('sameGame', () => {
  const { sameGame } = require('./sportsProviders');
  const now = Math.floor(Date.now() / 1000);
  it('finds a game again after a feed renamed a team', () => {
    const a = { category: 'American Football', name: 'Georgia Bulldogs vs Alabama Crimson Tide', startsAt: now };
    const b = { category: 'American Football', name: 'Alabama vs Georgia', startsAt: now + 600 };
    expect(sameGame(a, b)).toBe(true);
  });
  it('keeps different games apart', () => {
    const a = { category: 'American Football', name: 'Georgia Bulldogs vs Alabama Crimson Tide', startsAt: now };
    expect(sameGame(a, { category: 'American Football', name: 'LSU Tigers vs Kentucky Wildcats', startsAt: now })).toBe(false);
    expect(sameGame(a, { ...a, startsAt: now + 6 * 3600 })).toBe(false);
  });
});

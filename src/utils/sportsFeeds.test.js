import { easternToUnix, fetchPpvNormalized, fetchStreamfreeNormalized, fetchTimstreamsNormalized, fetchTvChannelGamesNormalized } from './sportsFeeds';
import { mergeNormalized } from './sportsProviders';

const now = Math.floor(Date.now() / 1000);
const reply = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

// jsdom has no AbortSignal.timeout (every real browser and Node 24 do).
const realTimeout = AbortSignal.timeout;
beforeEach(() => { AbortSignal.timeout = () => new AbortController().signal; });
afterEach(() => { delete global.fetch; AbortSignal.timeout = realTimeout; jest.restoreAllMocks(); });

test('StreamFree sources count whether they come as objects or plain URLs', async () => {
  global.fetch = jest.fn(() => reply({
    streams: [
      {
        name: 'Ferencvaros vs AC Milan', category: 'soccer', match_timestamp: now,
        team1: { name: 'Ferencvaros' }, team2: { name: 'AC Milan' },
        sources: [
          { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/game1080p', live: false },
          { quality: 'HD', url: 'https://strmfree.st/embed/soccer/game720p', live: false },
        ],
      },
      { name: 'Old format', category: 'soccer', match_timestamp: now, sources: ['https://strmfree.st/embed/soccer/old'] },
      { name: 'Nothing yet', category: 'soccer', match_timestamp: now, sources: [] },
    ],
  }));
  const listings = await fetchStreamfreeNormalized();
  expect(listings.map((entry) => entry.provider.embedUrl)).toEqual([
    'https://strmfree.st/embed/soccer/game1080p',
    'https://strmfree.st/embed/soccer/game720p',
    'https://strmfree.st/embed/soccer/old',
  ]);
  expect(listings[0]).toMatchObject({ category: 'Soccer', teams: { home: 'Ferencvaros', away: 'AC Milan' } });
});

test('the server’s options reach the request: its own timeout and extra headers', async () => {
  global.fetch = jest.fn(() => reply({ success: true, streams: [] }));
  await fetchPpvNormalized({ timeoutMs: 8000, headers: { 'User-Agent': 'binge-test' } });
  const [, init] = global.fetch.mock.calls[0];
  expect(init.headers).toEqual({ Accept: 'application/json', 'User-Agent': 'binge-test' });
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

// ── TimStreams and college games on TV channels ──

// Answers each request by the first route whose key is in its URL.
function serve(routes) {
  global.fetch = jest.fn((url) => {
    const match = Object.keys(routes).find((part) => String(url).includes(part));
    return reply(match ? routes[match] : { events: [] });
  });
}
const iso = (unix) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
// The feeds read the time only through Date.now().
const at = (ms) => jest.spyOn(Date, 'now').mockReturnValue(ms);

test('TimStreams times are US Eastern, in standard and daylight time', () => {
  expect(easternToUnix('2026-11-09T19:00')).toBe(Date.UTC(2026, 10, 10, 0, 0) / 1000); // EST, UTC-5
  expect(easternToUnix('2026-07-04T19:00')).toBe(Date.UTC(2026, 6, 4, 23, 0) / 1000); // EDT, UTC-4
  expect(easternToUnix('')).toBe(0);
});

test('TimStreams events: "Away @ Home", the league from its genres, free streams only', async () => {
  at(Date.UTC(2026, 10, 9, 22, 0));
  serve({
    '/api/live-upcoming': {
      genres: [{ id: 7, name: 'Basketball', sub_categories: [{ id: 1, name: 'National Basketball Association' }] }],
      events: [{
        name: 'Los Angeles Lakers @ Atlanta Hawks', genre: 7, sub_genre: 1, time: '2026-11-09T19:00', logo: '/img/nba-1.png',
        streams: [{ name: 'NBA League Pass', url: 'https://embed.example/a', vip: false }, { name: 'VIP', url: 'https://embed.example/b', vip: true }],
      }],
    },
  });
  const items = await fetchTimstreamsNormalized();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    category: 'Basketball',
    tag: 'NBA',
    teams: { home: 'Atlanta Hawks', away: 'Los Angeles Lakers' },
    startsAt: Date.UTC(2026, 10, 10, 0, 0) / 1000,
    poster: 'https://tim-streams.com/img/nba-1.png',
    provider: { id: 'timstreams', embedUrl: 'https://embed.example/a', label: 'TimStreams · NBA League Pass' },
  });
});

describe('college games on TV channels', () => {
  const saturday = Date.UTC(2026, 10, 14, 15, 0) / 1000; // 10am Eastern
  const team = (location) => ({ location, logo: `https://logo.example/${location}.png` });
  const game = (id, startsAt, networks, [away, home], state = 'pre', conference = null) => ({
    id,
    date: iso(startsAt),
    status: { type: { state } },
    competitions: [{
      ...(conference ? { conferenceCompetition: true, groups: { id: '1', name: conference, isConference: true } } : {}),
      broadcasts: [{ market: 'national', names: networks }],
      competitors: [{ homeAway: 'home', team: team(home) }, { homeAway: 'away', team: team(away) }],
    }],
  });
  const channels = {
    channels: ['ESPNU', 'Big Ten Network', 'ABC', 'SEC Network'].map((name) => ({ name, streams: [{ name: 'TimStreams', url: `https://embed.example/${name}`, vip: false }] })),
  };

  beforeEach(() => at(saturday * 1000));

  test('a game on a carried network gets that channel as its server; streaming-only and finished games don’t', async () => {
    serve({
      '/api/channels': channels,
      'college-football': { events: [
        game('1', saturday + 3600, ['ESPNU'], ['Kent State', 'Buffalo']),
        game('2', saturday + 3600, ['ESPN+'], ['Ohio', 'Akron']),
        game('3', saturday - 4 * 3600, ['BTN'], ['Iowa', 'Purdue'], 'post'),
        game('4', saturday + 7200, ['BTN'], ['Rutgers', 'Maryland']),
      ] },
    });
    const items = await fetchTvChannelGamesNormalized();
    expect(items.map((item) => [item.name, item.provider.label])).toEqual([
      ['Kent State at Buffalo', 'ESPNU · TimStreams'],
      ['Rutgers at Maryland', 'Big Ten Network · TimStreams'],
    ]);
    expect(items[0]).toMatchObject({ category: 'American Football', tag: 'College Football', teams: { home: 'Buffalo', away: 'Kent State' } });
  });

  test('football is listed a week ahead from ESPN’s current week: Saturday’s CW game shows on Monday', async () => {
    const monday = saturday - 5 * 86400;
    at(monday * 1000);
    serve({
      '/api/channels': { channels: [{ name: 'CW', streams: [{ name: 'TimStreams', url: 'https://embed.example/CW', vip: false }] }] },
      'college-football': { events: [game('1', saturday + 1800, ['CW'], ['Georgia Tech', 'Clemson'])] },
      'mens-college-basketball': { events: [game('2', saturday + 3600, ['ESPN'], ['Duke', 'Kansas'])] },
    });
    const items = await fetchTvChannelGamesNormalized();
    expect(items.map((item) => [item.name, item.provider.label])).toEqual([['Georgia Tech at Clemson', 'CW · TimStreams']]);
    const footballUrls = global.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('college-football'));
    expect(footballUrls).toHaveLength(1);
    expect(footballUrls[0]).not.toMatch(/dates=/);
  });

  test('an over-the-air network is skipped when another of its games shares the window (regional splits)', async () => {
    serve({
      '/api/channels': channels,
      'college-football': { events: [
        game('1', saturday + 3600, ['ABC'], ['Georgia', 'Missouri']),
        game('2', saturday + 3600, ['ABC'], ['Duke', 'Miami']),
        game('3', saturday + 6 * 3600, ['ABC'], ['USC', 'Indiana']),
      ] },
    });
    const items = await fetchTvChannelGamesNormalized();
    expect(items.map((item) => item.name)).toEqual(['USC at Indiana']);
  });

  test('women’s games are tagged, and never merge into the men’s game between the same schools', async () => {
    serve({
      '/api/channels': channels,
      'womens-college-basketball': { events: [game('w1', saturday + 3600, ['SEC Network'], ['Texas', 'Tennessee'])] },
    });
    const women = await fetchTvChannelGamesNormalized();
    expect(women[0].tag).toBe("Women's College Basketball");
    const men = {
      name: 'Texas vs Tennessee', category: 'Basketball', tag: 'College Basketball', startsAt: saturday + 2 * 3600, endsAt: saturday + 5 * 3600,
      alwaysLive: false, replay: false, provider: { id: 'ppv', embedUrl: 'https://ppv.example/1' },
    };
    const merged = mergeNormalized([men, ...women]);
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((entry) => entry.id)).size).toBe(2);
    expect(merged.find((entry) => entry.league === "Women's College Basketball").providers[0].label).toBe('SEC Network · TimStreams');
  });

  test('a channel joins the servers of a game another feed already lists', async () => {
    serve({
      '/api/channels': channels,
      'college-football': { events: [game('1', saturday + 3600, ['ESPNU'], ['Kent State', 'Buffalo'])] },
    });
    const tv = await fetchTvChannelGamesNormalized();
    const ppv = {
      name: 'Kent State Golden Flashes vs Buffalo Bulls', category: 'American Football', startsAt: saturday + 3600, endsAt: saturday + 4 * 3600,
      alwaysLive: false, replay: false, provider: { id: 'ppv', embedUrl: 'https://ppv.example/2', label: 'PPV' },
    };
    const merged = mergeNormalized([ppv, ...tv]);
    expect(merged).toHaveLength(1);
    expect(merged[0].providers.map((provider) => provider.label)).toEqual(['PPV', 'ESPNU · TimStreams']);
  });

  test('a conference game carries its conference, and a non-conference one doesn’t', async () => {
    serve({
      '/api/channels': channels,
      'college-football': { events: [
        game('1', saturday + 3600, ['ESPNU'], ['Georgia Tech', 'Clemson'], 'pre', 'Atlantic Coast Conference'),
        game('2', saturday + 7200, ['ESPNU'], ['Kent State', 'Buffalo']),
      ] },
    });
    const items = await fetchTvChannelGamesNormalized();
    expect(items.map((item) => item.conference)).toEqual(['Atlantic Coast Conference', null]);
    expect(mergeNormalized(items).find((entry) => /Clemson/.test(entry.name)).conference).toBe('Atlantic Coast Conference');
  });
});

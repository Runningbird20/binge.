import { fetchPpvNormalized, fetchStreamfreeNormalized } from './sportsFeeds';

const now = Math.floor(Date.now() / 1000);
const reply = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

// jsdom has no AbortSignal.timeout (every real browser and Node 24 do).
const realTimeout = AbortSignal.timeout;
beforeEach(() => { AbortSignal.timeout = () => new AbortController().signal; });
afterEach(() => { delete global.fetch; AbortSignal.timeout = realTimeout; });

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

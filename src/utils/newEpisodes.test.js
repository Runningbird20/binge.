import { findNewEpisodes } from './newEpisodes';
import { tmdbGet } from './tmdb';

jest.mock('./tmdb', () => ({ ...jest.requireActual('./tmdb'), tmdbGet: jest.fn() }));

// Local noon, in June: no clock change in the three weeks before it.
const NOW = new Date(2026, 5, 10, 12, 0, 0);

const daysAgo = (days) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });

const show = (mediaId, tmdbId, extra = {}) => ({ media_type: 'tv_show', media_id: mediaId, source_key: `tmdb:tv:${tmdbId}`, title: `Show ${mediaId}`, ...extra });
const lastAired = (season, episode, airDate) => ({ last_episode_to_air: { season_number: season, episode_number: episode, air_date: airDate } });

// TMDB answers per /tv/{id}; anything not listed is unknown (null).
function tmdbReturns(byTmdbId) {
  tmdbGet.mockImplementation(async (path) => {
    const id = Number(path.split('/').pop());
    return byTmdbId[id] ?? null;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => jest.useRealTimers());

test('a show you’re behind on gets a New Episode entry for its newest aired episode', async () => {
  tmdbReturns({ 100: lastAired(2, 6, daysAgo(3)) });
  const result = await findNewEpisodes({
    continueWatching: [show(10, 100, { title: 'Severance', current_season: 2, current_episode: 4, image_url: '/sev.jpg' })],
  });

  expect(tmdbGet).toHaveBeenCalledWith('/tv/100');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: 10,
    media_type: 'tv_show',
    title: 'Severance',
    poster_url: '/sev.jpg',
    current_season: 2,
    current_episode: 6,
    _badge: 'New Episode',
    _subtitle: `S2 · E6 out ${shortDay(daysAgo(3))}`,
    _airedAt: daysAgo(3),
  });
});

test('a show you’re caught up on gets nothing; a new season’s first episode counts', async () => {
  tmdbReturns({
    100: lastAired(2, 6, daysAgo(3)),
    200: lastAired(2, 10, daysAgo(3)),
    300: lastAired(3, 1, daysAgo(3)),
  });
  const result = await findNewEpisodes({
    continueWatching: [
      show(1, 100, { current_season: 2, current_episode: 6 }), // on the newest one
      show(2, 200, { current_season: 3, current_episode: 1 }), // already past it
      show(3, 300, { current_season: 2, current_episode: 10 }), // finished season 2, season 3 is out
    ],
  });

  expect(result.map((entry) => [entry.id, entry.current_season, entry.current_episode])).toEqual([[3, 3, 1]]);
});

test('only episodes from the last three weeks count as new', async () => {
  tmdbReturns({
    100: lastAired(1, 5, daysAgo(21)),
    200: lastAired(1, 5, daysAgo(22)),
    300: lastAired(1, 5, daysAgo(0)),
    400: { last_episode_to_air: null },
    500: lastAired(1, 5, null),
  });
  const result = await findNewEpisodes({
    continueWatching: [100, 200, 300, 400, 500].map((tmdbId) => show(tmdbId / 100, tmdbId, { current_season: 1, current_episode: 2 })),
  });

  expect(result.map((entry) => entry.id).sort()).toEqual([1, 3]);
});

test('a show in both Continue Watching and My List is listed once, from where you are in Continue Watching', async () => {
  tmdbReturns({ 100: lastAired(2, 6, daysAgo(3)) });

  // Caught up in Continue Watching: the My List copy (no progress) doesn't make it new.
  const caughtUp = await findNewEpisodes({
    continueWatching: [show(10, 100, { current_season: 2, current_episode: 6 })],
    watchlist: [show('10', 100, { status: 'watching' })],
  });
  expect(caughtUp).toEqual([]);
  expect(tmdbGet).toHaveBeenCalledTimes(1);

  const behind = await findNewEpisodes({
    continueWatching: [show(10, 100, { current_season: 2, current_episode: 2 })],
    watchlist: [show('10', 100, { current_season: 2, current_episode: 1 })],
  });
  expect(behind).toHaveLength(1);
  expect(behind[0]).toMatchObject({ id: 10, current_season: 2, current_episode: 6 });
});

test('a show on My List you haven’t started counts its latest episode as new', async () => {
  tmdbReturns({ 100: lastAired(1, 3, daysAgo(2)), 200: lastAired(4, 2, daysAgo(2)) });
  const result = await findNewEpisodes({
    watchlist: [
      show(1, 100, { status: 'plan_to_watch', poster_url: '/p1.jpg' }),
      show(2, 200, { status: 'watching', current_season: 4, current_episode: 1 }),
    ],
  });

  expect(result.map((entry) => [entry.id, entry.current_season, entry.current_episode, entry.poster_url])).toEqual([
    [1, 1, 3, '/p1.jpg'],
    [2, 4, 2, undefined],
  ]);
});

test('a show marked Watched on My List gets no badge', async () => {
  tmdbReturns({ 100: lastAired(3, 1, daysAgo(2)) });
  const result = await findNewEpisodes({ watchlist: [show(1, 100, { status: 'watched' })] });
  expect(result).toEqual([]);
  expect(tmdbGet).not.toHaveBeenCalled();
});

test('movies and titles without a TMDB id are skipped without asking TMDB', async () => {
  tmdbReturns({ 100: lastAired(1, 3, daysAgo(2)) });
  const result = await findNewEpisodes({
    continueWatching: [
      { media_type: 'movie', media_id: 5, source_key: 'tmdb:movie:100' },
      { media_type: 'tv_show', media_id: 6, current_season: 1, current_episode: 1 },
    ],
    watchlist: [{ media_type: 'tv_show', media_id: 7, source_key: 'plex:abc' }],
  });

  expect(result).toEqual([]);
  expect(tmdbGet).not.toHaveBeenCalled();
});

test('a TMDB id stored directly on the row works too, and a TMDB failure just drops that show', async () => {
  tmdbReturns({ 100: lastAired(1, 3, daysAgo(2)) });
  const result = await findNewEpisodes({
    continueWatching: [
      { media_type: 'tv_show', media_id: 1, tmdb_id: 100, current_season: 1, current_episode: 1 },
      show(2, 999, { current_season: 1, current_episode: 1 }), // TMDB has nothing
    ],
  });

  expect(result.map((entry) => entry.id)).toEqual([1]);
});

test('the newest releases come first', async () => {
  tmdbReturns({
    100: lastAired(1, 2, daysAgo(10)),
    200: lastAired(1, 2, daysAgo(1)),
    300: lastAired(1, 2, daysAgo(5)),
  });
  const result = await findNewEpisodes({
    continueWatching: [100, 200, 300].map((tmdbId) => show(tmdbId / 100, tmdbId, { current_season: 1, current_episode: 1 })),
  });

  expect(result.map((entry) => entry.id)).toEqual([2, 3, 1]);
});

test('only the first 40 shows are checked, Continue Watching before My List', async () => {
  tmdbGet.mockImplementation(async () => lastAired(9, 9, daysAgo(1)));
  const continueWatching = Array.from({ length: 40 }, (_, i) => show(i + 1, 1000 + i, { current_season: 1, current_episode: 1 }));
  const result = await findNewEpisodes({ continueWatching, watchlist: [show(99, 5000)] });

  expect(tmdbGet).toHaveBeenCalledTimes(40);
  expect(tmdbGet).not.toHaveBeenCalledWith('/tv/5000');
  expect(result.map((entry) => entry.id)).not.toContain(99);
});

import { episodeKey, episodesUpTo, episodesUpToNumbered, followingInSeason, isAfter, lastOf, nextEpisode, realEpisodeNumber, seasonEpisodes, unwatchedOnly } from './episodeMarking';

const NOW = new Date('2026-11-04T12:00:00Z');
const seasons = [
  { season_number: 0, episode_count: 3 }, // specials
  { season_number: 1, episode_count: 3, air_date: '2024-01-01' },
  { season_number: 2, episode_count: 4, air_date: '2025-01-01' },
  { season_number: 3, episode_count: 8, air_date: '2027-02-01' }, // announced
];
const season2 = [1, 2, 3, 4].map((number) => ({ number, airDate: `2025-01-0${number}` }));

test('mark season watched covers the aired episodes of that season only', () => {
  const airing = [{ number: 1, airDate: '2026-10-01' }, { number: 2, airDate: '2026-11-01' }, { number: 3, airDate: '2026-11-08' }];
  expect(seasonEpisodes(4, airing, NOW)).toEqual([{ season: 4, episode: 1 }, { season: 4, episode: 2 }]);
});

test('watched up to here covers earlier seasons in full, not specials', () => {
  expect(episodesUpTo(seasons, 2, 2)).toEqual([
    { season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 },
    { season: 2, episode: 1 }, { season: 2, episode: 2 },
  ]);
  expect(episodesUpTo(seasons, 1, 1)).toEqual([{ season: 1, episode: 1 }]);
});

test('episodes already watched are not written again (their watch times stay)', () => {
  const watched = new Map([[episodeKey(1, 1), '2026-01-01'], [episodeKey(1, 3), null]]);
  expect(unwatchedOnly(episodesUpTo(seasons, 1, 3), watched)).toEqual([{ season: 1, episode: 2 }]);
});

test('the show picks up at the next aired episode, across seasons', () => {
  expect(nextEpisode({ season: 2, episode: 2 }, seasons, season2, NOW)).toEqual({ season: 2, episode: 3 });
  // Season 2 finished; season 3 hasn't started yet.
  expect(nextEpisode({ season: 2, episode: 4 }, seasons, season2, NOW)).toBeNull();
  const season1 = [1, 2, 3].map((number) => ({ number, airDate: '2024-01-01' }));
  expect(nextEpisode({ season: 1, episode: 3 }, seasons, season1, NOW)).toEqual({ season: 2, episode: 1 });
  // The next episode is announced but hasn't aired.
  expect(nextEpisode({ season: 4, episode: 1 }, seasons, [{ number: 1, airDate: '2026-10-01' }, { number: 2, airDate: '2026-12-01' }], NOW)).toBeNull();
});

test('ordering: later episodes, and the latest of a list', () => {
  expect(isAfter({ season: 2, episode: 1 }, { season: 1, episode: 9 })).toBe(true);
  expect(isAfter({ season: 1, episode: 2 }, { season: 1, episode: 2 })).toBe(false);
  expect(isAfter({ season: 1, episode: 1 }, null)).toBe(true);
  expect(lastOf([{ season: 1, episode: 3 }, { season: 2, episode: 1 }, { season: 1, episode: 9 }])).toEqual({ season: 2, episode: 1 });
});

describe('shows numbered from the series start (One Piece)', () => {
  const season22 = [1089, 1090, 1091, 1128, 1129].map((number) => ({ number }));

  test('a real number stays as it is', () => {
    expect(realEpisodeNumber(season22, 1128)).toBe(1128);
  });

  test('a place in the season becomes its real number', () => {
    expect(realEpisodeNumber(season22, 1)).toBe(1089);
    expect(realEpisodeNumber(season22, 4)).toBe(1128);
  });

  test('a normal season keeps its numbers', () => {
    expect(realEpisodeNumber([1, 2, 3].map((number) => ({ number })), 2)).toBe(2);
  });

  test('the next episode comes from the list, not +1', () => {
    expect(followingInSeason(season22, 1091)).toBe(1128);
    expect(followingInSeason(season22, 4)).toBe(1129);
    expect(followingInSeason(season22, 1129)).toBeNull();
  });
});

describe('watched up to here, numbered from the series start', () => {
  const seasons = [{ season_number: 1, episode_count: 5 }, { season_number: 2, episode_count: 3 }];
  const season1 = [1, 2, 3, 4, 5].map((number) => ({ number }));
  const season2 = [6, 7, 8].map((number) => ({ number }));

  test('marks the real numbers of earlier seasons and this one', async () => {
    const loadSeason = jest.fn((n) => Promise.resolve(n === 1 ? season1 : season2));
    const list = await episodesUpToNumbered(seasons, 2, 7, season2, loadSeason);
    expect(list.map((entry) => `${entry.season}:${entry.episode}`)).toEqual(['1:1', '1:2', '1:3', '1:4', '1:5', '2:6', '2:7']);
  });

  test('a normal show keeps the counts, with no requests', async () => {
    const loadSeason = jest.fn();
    const list = await episodesUpToNumbered(seasons, 2, 2, [1, 2, 3].map((number) => ({ number })), loadSeason);
    expect(list).toEqual(episodesUpTo(seasons, 2, 2));
    expect(loadSeason).not.toHaveBeenCalled();
  });

  test('a season that fails to load falls back to its count', async () => {
    const loadSeason = jest.fn(() => Promise.reject(new Error('offline')));
    const list = await episodesUpToNumbered(seasons, 2, 6, season2, loadSeason);
    expect(list.map((entry) => `${entry.season}:${entry.episode}`)).toEqual(['1:1', '1:2', '1:3', '1:4', '1:5', '2:6']);
  });
});

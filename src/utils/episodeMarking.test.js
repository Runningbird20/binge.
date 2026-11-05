import { episodeKey, episodesUpTo, isAfter, lastOf, nextEpisode, seasonEpisodes, unwatchedOnly } from './episodeMarking';

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

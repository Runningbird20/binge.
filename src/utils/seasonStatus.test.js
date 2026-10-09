import { friendlyDay, seasonStatus } from './seasonStatus';

const now = new Date('2026-10-09T15:00:00'); // a Friday
const show = (extra = {}) => ({
  status: 'Returning Series',
  seasons: [{ season_number: 1, episode_count: 8, air_date: '2024-01-01' }, { season_number: 2, episode_count: 10, air_date: '2026-09-01' }],
  ...extra,
});

test('episodes left in a finished season', () => {
  expect(seasonStatus(show(), 1, 5, now)).toBe('3 episodes left in Season 1');
  expect(seasonStatus(show(), 1, 7, now)).toBe('Season finale next');
  expect(seasonStatus(show(), 1, 8, now)).toBe('Season 2 is out');
});

test('a season still airing counts only aired episodes', () => {
  const airing = show({ next_episode_to_air: { season_number: 2, episode_number: 7, air_date: '2026-10-14' } });
  expect(seasonStatus(airing, 2, 3, now)).toBe('3 episodes left in Season 2');
  expect(seasonStatus(airing, 2, 6, now)).toBe('Next episode Wednesday');
});

test('a new season on the way', () => {
  const coming = show({ seasons: [{ season_number: 1, episode_count: 8, air_date: '2024-01-01' }], next_episode_to_air: { season_number: 2, episode_number: 1, air_date: '2026-10-10' } });
  expect(seasonStatus(coming, 1, 8, now)).toBe('Season 2 starts tomorrow');
});

test('ended shows and friendly days', () => {
  expect(seasonStatus(show({ status: 'Ended' }), 2, 10, now)).toBe('Series finale');
  expect(friendlyDay('2026-10-09', now)).toBe('today');
  expect(friendlyDay('2026-11-02', now)).toBe('Nov 2');
});

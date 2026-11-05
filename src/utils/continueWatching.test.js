import { hasSavedPosition, lastAiredEpisode } from './continueWatching';
import { positionKey, savePosition } from './playbackPositions';

beforeEach(() => localStorage.clear());

test('the newest aired episode comes from TMDB’s last_episode_to_air', () => {
  expect(lastAiredEpisode({ last_episode_to_air: { season_number: 5, episode_number: 16 } })).toEqual({ season: 5, episode: 16 });
  expect(lastAiredEpisode({ last_episode_to_air: { season_number: 0, episode_number: 2 } })).toBeNull(); // a special
  expect(lastAiredEpisode({})).toBeNull();
  expect(lastAiredEpisode(null)).toBeNull();
});

test('a saved position counts from either the synced row or this device', () => {
  const show = { media_type: 'tv_show', media_id: 7, current_season: 2, current_episode: 3 };
  expect(hasSavedPosition(show)).toBe(false);
  expect(hasSavedPosition({ ...show, position_seconds: 0 })).toBe(false);
  expect(hasSavedPosition({ ...show, position_seconds: 120 })).toBe(true);
  savePosition(positionKey('tv_show', 7, 2, 3), 300, 2700);
  expect(hasSavedPosition(show)).toBe(true);
});

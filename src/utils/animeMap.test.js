import { animeEpisode } from './animeMap';

// The shapes scripts/generate-anime-map.js writes (from real anime-lists rows).
const map = {
  tv: {
    209867: [[1, 209939, 38], [1, 182255, 28], [1, 154587, 0]], // Frieren: three AniList entries in TMDB season 1
    37854: [[-1, 21, 0]], // One Piece: one entry, the series' own numbers
    1429: [[0, 18397, 0], [1, 16498, 0], [3, 104578, 12], [3, 99147, 0]], // Attack on Titan
  },
  movie: { 568160: 101921 },
};

test('a season split over AniList entries is matched by offset', () => {
  expect(animeEpisode(map, 'tv_show', 209867, 1, 5)).toEqual({ id: 154587, episode: 5 });
  expect(animeEpisode(map, 'tv_show', 209867, 1, 29)).toEqual({ id: 182255, episode: 1 });
  expect(animeEpisode(map, 'tv_show', 209867, 1, 40)).toEqual({ id: 209939, episode: 2 });
  expect(animeEpisode(map, 'tv_show', 1429, 3, 13)).toEqual({ id: 104578, episode: 1 });
});

test('a series-wide entry keeps the episode number, for a season numbered that way', () => {
  expect(animeEpisode(map, 'tv_show', 37854, 1, 4)).toEqual({ id: 21, episode: 4 });
  expect(animeEpisode(map, 'tv_show', 37854, 22, 1128, { seriesNumbered: true })).toEqual({ id: 21, episode: 1128 });
  expect(animeEpisode(map, 'tv_show', 37854, 22, 40)).toBeNull();
});

test('films and titles not in the map', () => {
  expect(animeEpisode(map, 'movie', 568160)).toEqual({ id: 101921, episode: 1 });
  expect(animeEpisode(map, 'tv_show', 1399, 1, 1)).toBeNull();
  expect(animeEpisode(null, 'tv_show', 37854, 1, 1)).toBeNull();
});

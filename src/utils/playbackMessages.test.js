import { readServerEpisode } from './playbackMessages';

test('VidRift says which episode is playing, and when its own player switches', () => {
  expect(readServerEpisode({ type: 'vidrift:episode', tmdbId: 1399, mediaType: 'tv', season: 2, episode: 3 }, '1399'))
    .toEqual({ season: 2, episode: 3, switching: true });
  expect(readServerEpisode(JSON.stringify({ type: 'vidrift:progress', tmdbId: 1399, season: 1, episode: 4, currentTime: 50 }), 1399))
    .toEqual({ season: 1, episode: 4, switching: false });
});

test('nothing for other titles, movies, other servers, or the episode that just finished', () => {
  expect(readServerEpisode({ type: 'vidrift:episode', tmdbId: 1, season: 1, episode: 2 }, 1399)).toBeNull();
  expect(readServerEpisode({ type: 'vidrift:progress', tmdbId: 27205, mediaType: 'movie', season: null, episode: null }, 27205)).toBeNull();
  expect(readServerEpisode({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', season: 1, episode: 2 } }, 1399)).toBeNull();
  expect(readServerEpisode({ type: 'vidrift:nextup-play', tmdbId: 1399, season: 1, episode: 1 }, 1399)).toBeNull();
  expect(readServerEpisode('not json', 1399)).toBeNull();
});

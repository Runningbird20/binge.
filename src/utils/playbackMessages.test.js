import { readPlayback, readServerEpisode } from './playbackMessages';

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

// Messages as VixSrc and VidSpark sent them (2026-11-09).
test('VixSrc: PLAYER_EVENT with the event under `event`', () => {
  expect(readPlayback({ type: 'PLAYER_EVENT', event: { event: 'timeupdate', currentTime: 1, duration: 8348.333333, video_id: '170060' } }))
    .toEqual({ time: 1, duration: 8348.333333 });
  expect(readPlayback({ type: 'PLAYER_EVENT', event: { event: 'play', data: { type: 'play', newstate: 'playing' }, video_id: '170060' } }).state).toBe('play');
  expect(readPlayback({ type: 'PLAYER_EVENT', event: { event: 'pause', data: { type: 'pause' }, video_id: '170060' } }).state).toBe('pause');
  expect(readPlayback({ type: 'PLAYER_EVENT', event: { event: 'ended', data: { type: 'complete' }, video_id: '170060' } }).state).toBe('ended');
  // Its seeked carries currentTime: null, which must not read as a time.
  expect(readPlayback({ type: 'PLAYER_EVENT', event: { event: 'seeked', currentTime: null } }).time > 0).toBe(false);
});

test('Vidy-style PLAYER_EVENT (under `data`) still reads the same', () => {
  expect(readPlayback({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', currentTime: 12, duration: 3000 } }))
    .toEqual({ time: 12, duration: 3000 });
});

test('VidSpark: { source, event, currentTime, duration }', () => {
  expect(readPlayback({ source: 'vidspark-player', event: 'timeupdate', currentTime: 3.9, duration: 8348, percentage: 0 }))
    .toEqual({ time: 3.9, duration: 8348 });
  expect(readPlayback({ source: 'vidspark-player', event: 'play', currentTime: 0, duration: 8348.375 }).state).toBe('play');
  expect(readPlayback({ source: 'vidspark-player', event: 'pause', currentTime: 3.9, duration: 8348.375 }).state).toBe('pause');
  expect(readPlayback({ source: 'vidspark-player', event: 'ended', currentTime: 8348.4, duration: 8348.4 }).state).toBe('ended');
  expect(readPlayback({ source: 'someone-else', event: 'play', currentTime: 1 })).toBeNull();
});

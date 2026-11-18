import { isSpoiler, progressPoint } from './spoilers';

test('progress is the furthest episode watched or the resume point, whichever is later', () => {
  expect(progressPoint(new Set(['1:1', '1:2', '2:3', '1:9']))).toEqual({ season: 2, episode: 3 });
  expect(progressPoint(new Set(['1:1']), { season: 2, episode: 4 })).toEqual({ season: 2, episode: 4 });
  expect(progressPoint(new Set(['3:1']), { season: 2, episode: 4 })).toEqual({ season: 3, episode: 1 });
  expect(progressPoint(new Set(), { season: '2', episode: undefined })).toEqual({ season: 2, episode: 1 });
  expect(progressPoint(new Set(['bad', '0:0']))).toBeNull();
  expect(progressPoint(null)).toBeNull();
});

test('an episode is a spoiler when it’s past that point and not watched', () => {
  const watched = new Set(['1:1', '1:5']);
  const progress = progressPoint(watched, { season: 1, episode: 2 }); // S1 E5
  expect(isSpoiler(1, 3, watched, progress)).toBe(false); // skipped, but behind you
  expect(isSpoiler(1, 5, watched, progress)).toBe(false);
  expect(isSpoiler(1, 6, watched, progress)).toBe(true);
  expect(isSpoiler(2, 1, watched, progress)).toBe(true);
  // Rewatching ahead: a watched episode is never hidden.
  expect(isSpoiler(3, 1, new Set(['3:1']), { season: 1, episode: 1 })).toBe(false);
  // A show not started: everything is ahead.
  expect(isSpoiler(1, 1, new Set(), null)).toBe(true);
});

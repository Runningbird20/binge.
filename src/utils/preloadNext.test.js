import { preloadIsPlaying } from './preloadNext';
import { readPlayback } from './playbackMessages';

describe('preloadIsPlaying', () => {
  test('a play event or a moving clock means the hidden frame is audible', () => {
    expect(preloadIsPlaying({ state: 'play' })).toBe(true);
    expect(preloadIsPlaying({ time: 3.2, duration: 1400 })).toBe(true);
    expect(preloadIsPlaying(readPlayback({ type: 'vidrift:progress', currentTime: 4, duration: 1400 }))).toBe(true);
  });

  test('loading, paused or finished frames are left alone', () => {
    expect(preloadIsPlaying(null)).toBe(false);
    expect(preloadIsPlaying({ time: 0, duration: 1400 })).toBe(false);
    expect(preloadIsPlaying({ time: 0.2 })).toBe(false);
    expect(preloadIsPlaying({ state: 'pause', time: 12 })).toBe(false);
    expect(preloadIsPlaying({ state: 'ended' })).toBe(false);
    expect(preloadIsPlaying({ time: Number.NaN })).toBe(false);
  });
});

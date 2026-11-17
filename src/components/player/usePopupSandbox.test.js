import { act, renderHook } from '@testing-library/react';
import usePopupSandbox from './usePopupSandbox';
import { SANDBOX_CHECK_SECONDS, SANDBOX_FLAGS, shouldSandbox } from '../../utils/popupSandbox';

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => jest.useRealTimers());

function setup(props = {}) {
  const playbackRef = { current: { time: 0, playing: false } };
  const view = renderHook((current) => usePopupSandbox({ provider: 'vidrift', itemId: 1, season: 1, episode: 1, playbackRef, ...current }), { initialProps: props });
  return { ...view, playbackRef };
}

function elapse(seconds) {
  act(() => { jest.advanceTimersByTime(seconds * 1000); });
}

// The server reports playback: its time moves a second every second.
function play(playbackRef, seconds) {
  for (let second = 0; second < seconds; second += 1) {
    playbackRef.current.time += 1;
    playbackRef.current.playing = true;
    elapse(1);
  }
}

test('a server that plays 5 seconds sandboxed stays sandboxed', () => {
  const { result, playbackRef } = setup();
  expect(result.current.sandbox).toBe(SANDBOX_FLAGS);
  play(playbackRef, 6);
  elapse(SANDBOX_CHECK_SECONDS * 3); // stalled afterwards: the check is over
  expect(result.current.sandboxed).toBe(true);
});

test('a reported time alone isn’t playback: a player that sends its start position and stops reloads unsandboxed', () => {
  const { result, playbackRef } = setup();
  playbackRef.current.time = 1200;
  playbackRef.current.playing = true;
  elapse(SANDBOX_CHECK_SECONDS - 1);
  expect(result.current.sandboxed).toBe(true);
  elapse(1);
  expect(result.current.sandboxed).toBe(false);
});

test('playing less than 5 seconds isn’t enough either', () => {
  const { result, playbackRef } = setup();
  play(playbackRef, 3);
  elapse(SANDBOX_CHECK_SECONDS);
  expect(result.current.sandboxed).toBe(false);
});

test('no playback while sandboxed: the same server reloads unsandboxed, and is remembered if that load plays 5 seconds', () => {
  const { result, playbackRef } = setup();
  elapse(SANDBOX_CHECK_SECONDS);
  expect(result.current.sandboxed).toBe(false);
  expect(result.current.sandbox).toBeUndefined();
  expect(shouldSandbox('vidrift', true)).toBe(true); // not remembered yet: it may just lack the title
  play(playbackRef, 3);
  expect(shouldSandbox('vidrift', true)).toBe(true);
  play(playbackRef, 3);
  expect(shouldSandbox('vidrift', true)).toBe(false);
});

test('the time the sandboxed load left behind doesn’t count for the unsandboxed retry', () => {
  const { result, playbackRef } = setup();
  playbackRef.current.time = 1200;
  playbackRef.current.playing = true;
  elapse(SANDBOX_CHECK_SECONDS);
  expect(result.current.sandboxed).toBe(false);
  elapse(5);
  expect(shouldSandbox('vidrift', true)).toBe(true);
  play(playbackRef, 6);
  expect(shouldSandbox('vidrift', true)).toBe(false);
});

test('a pause after playback started (the viewer’s) holds the check', () => {
  const { result, playbackRef } = setup();
  play(playbackRef, 2);
  playbackRef.current.playing = false;
  elapse(SANDBOX_CHECK_SECONDS * 3);
  expect(result.current.sandboxed).toBe(true);
  play(playbackRef, 5);
  elapse(SANDBOX_CHECK_SECONDS * 3); // 5 seconds played: the check is over
  expect(result.current.sandboxed).toBe(true);
});

test('VidSpark, which often waits for a click, stays sandboxed until it reports a time, then needs 5 seconds like the rest', () => {
  const { result, playbackRef } = setup({ provider: 'vidspark' });
  elapse(SANDBOX_CHECK_SECONDS * 3); // the viewer hasn’t clicked play yet
  expect(result.current.sandboxed).toBe(true);
  play(playbackRef, 2); // started, then froze
  elapse(SANDBOX_CHECK_SECONDS);
  expect(result.current.sandboxed).toBe(false);
});

test('if the unsandboxed retry doesn’t play either, nothing is remembered (failover takes it from there)', () => {
  const { result } = setup();
  elapse(60);
  expect(result.current.sandboxed).toBe(false);
  expect(shouldSandbox('vidrift', true)).toBe(true);
});

test('the next episode or server starts sandboxed again', () => {
  const { result, rerender } = setup();
  elapse(SANDBOX_CHECK_SECONDS);
  expect(result.current.sandboxed).toBe(false);
  rerender({ episode: 2 });
  expect(result.current.sandboxed).toBe(true);
});

test('servers known to refuse the sandbox load normally from the start', () => {
  expect(setup({ provider: 'vidy' }).result.current.sandboxed).toBe(false);
  expect(setup({ provider: '2embed' }).result.current.sandboxed).toBe(false);
  expect(setup({ provider: 'cinesrc' }).result.current.sandboxed).toBe(true);
});

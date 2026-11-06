import { act, renderHook } from '@testing-library/react';
import usePopupSandbox from './usePopupSandbox';
import { SANDBOX_CHECK_SECONDS, SANDBOX_FLAGS, shouldSandbox } from '../../utils/popupSandbox';

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => jest.useRealTimers());

function setup(props = {}) {
  const playbackRef = { current: { time: 0 } };
  const view = renderHook((current) => usePopupSandbox({ provider: 'vidrift', itemId: 1, season: 1, episode: 1, playbackRef, ...current }), { initialProps: props });
  return { ...view, playbackRef };
}

test('a server that plays sandboxed stays sandboxed', () => {
  const { result, playbackRef } = setup();
  expect(result.current.sandbox).toBe(SANDBOX_FLAGS);
  playbackRef.current.time = 4;
  act(() => { jest.advanceTimersByTime((SANDBOX_CHECK_SECONDS + 5) * 1000); });
  expect(result.current.sandboxed).toBe(true);
});

test('no playback while sandboxed: the same server reloads unsandboxed, and is remembered if it then plays', () => {
  const { result, playbackRef } = setup();
  act(() => { jest.advanceTimersByTime(SANDBOX_CHECK_SECONDS * 1000); });
  expect(result.current.sandboxed).toBe(false);
  expect(result.current.sandbox).toBeUndefined();
  expect(shouldSandbox('vidrift', true)).toBe(true); // not remembered yet: it may just lack the title
  playbackRef.current.time = 2;
  act(() => { jest.advanceTimersByTime(1000); });
  expect(shouldSandbox('vidrift', true)).toBe(false);
});

test('if the unsandboxed retry doesn’t play either, nothing is remembered (failover takes it from there)', () => {
  const { result } = setup();
  act(() => { jest.advanceTimersByTime(60 * 1000); });
  expect(result.current.sandboxed).toBe(false);
  expect(shouldSandbox('vidrift', true)).toBe(true);
});

test('the next episode or server starts sandboxed again', () => {
  const { result, rerender } = setup();
  act(() => { jest.advanceTimersByTime(SANDBOX_CHECK_SECONDS * 1000); });
  expect(result.current.sandboxed).toBe(false);
  rerender({ episode: 2 });
  expect(result.current.sandboxed).toBe(true);
});

test('servers known to refuse the sandbox load normally from the start', () => {
  expect(setup({ provider: 'vidy' }).result.current.sandboxed).toBe(false);
  expect(setup({ provider: '2embed' }).result.current.sandboxed).toBe(false);
  expect(setup({ provider: 'cinesrc' }).result.current.sandboxed).toBe(true);
});

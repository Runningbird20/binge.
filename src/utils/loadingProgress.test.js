import { trackedFetch, getLoadingProgress } from './loadingProgress';

test('tracks concurrent completions including failed requests, then resets', async () => {
  jest.useFakeTimers();
  const original = global.fetch;
  let finish;
  let fail;
  global.fetch = jest.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const first = trackedFetch('/first');
  const second = trackedFetch('/second');
  const secondResult = second.catch(() => null);
  expect(getLoadingProgress()).toEqual({ total: 2, completed: 0, active: 2 });
  finish({ ok: true });
  await first;
  expect(getLoadingProgress()).toEqual({ total: 2, completed: 1, active: 1 });
  fail(new Error('Offline'));
  await secondResult;
  expect(getLoadingProgress()).toEqual({ total: 2, completed: 2, active: 0 });
  jest.advanceTimersByTime(300);
  expect(getLoadingProgress()).toEqual({ total: 0, completed: 0, active: 0 });
  global.fetch = original;
  jest.useRealTimers();
});

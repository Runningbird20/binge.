import { RETRY_AFTER_MS, createPlaybackMeter, forgetRefusal, popupsBlocked, rememberRefusal, shouldSandbox } from './popupSandbox';
import { PROVIDERS } from './embedProviders';

// Feeds the meter one reported time per second, as usePopupSandbox does.
function playedAfter(times, staleTime) {
  const read = createPlaybackMeter(staleTime);
  return times.map((time, second) => read(time, 1000 + second * 1000));
}

test('the meter counts playback from the first time reported, not from 0', () => {
  // Resumed at 20:00: the first report is the position, not 20 minutes played.
  const readings = playedAfter([0, 1200, 1201, 1202, 1203, 1204, 1205]);
  expect(readings[0]).toEqual({ started: false, played: 0 });
  expect(readings[1]).toEqual({ started: true, played: 0 });
  expect(readings[6].played).toBe(5);
  // A position reported and never moving is no playback at all.
  expect(playedAfter([1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200])[7].played).toBe(0);
});

test('a time left over from the previous load of the same server is ignored', () => {
  expect(playedAfter([95, 95, 95], 95)[2]).toEqual({ started: false, played: 0 });
  // The new load starting over from the beginning still counts.
  expect(playedAfter([95, 1, 2, 3, 4, 5, 6], 95)[6].played).toBe(5);
});

test('a seek starts the count again', () => {
  // A small time, then a jump to the resume position: the jump isn't playback.
  expect(playedAfter([0.5, 1200, 1201, 1202])[3].played).toBe(2);
  // Jumping back too.
  expect(playedAfter([10, 11, 12, 3, 4])[4].played).toBe(1);
});

test('a server that reports only every 5 seconds (VidRift) still counts', () => {
  const readings = playedAfter([0, 5, 5, 5, 5, 10]);
  expect(readings[5].played).toBe(5);
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
}

test('only servers tested to play sandboxed are sandboxed', () => {
  const storage = memoryStorage();
  expect(shouldSandbox('vidrift', true, { storage })).toBe(true);
  // Untested: what it reports can't prove the sandbox works.
  expect(shouldSandbox('newserver', undefined, { storage })).toBe(false);
  expect(shouldSandbox('vidlink', false, { storage })).toBe(false);
  expect(shouldSandbox('', true, { storage })).toBe(false);
});

test('the servers sandboxed are the ones that played 5 seconds sandboxed (2026-11-16)', () => {
  window.localStorage.clear();
  expect(PROVIDERS.filter((entry) => popupsBlocked(entry.id)).map((entry) => entry.id))
    .toEqual(['vidrift', 'cinesrc', 'vidspark', 'vidcore', 'embedwave']);
});

test('a refusal learned on this device lasts 14 days, then the sandbox is tried again', () => {
  const storage = memoryStorage();
  rememberRefusal('vidy', { storage, now: 1000 });
  expect(shouldSandbox('vidy', true, { storage, now: 1000 + RETRY_AFTER_MS - 1 })).toBe(false);
  expect(shouldSandbox('vidy', true, { storage, now: 1000 + RETRY_AFTER_MS })).toBe(true);
  expect(shouldSandbox('vidrift', true, { storage, now: 2000 })).toBe(true); // only that server
  forgetRefusal('vidy', { storage });
  expect(shouldSandbox('vidy', true, { storage, now: 2000 })).toBe(true);
});

test('blocked or broken storage just means "sandbox it"', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  expect(() => rememberRefusal('vidy', { storage: broken })).not.toThrow();
  expect(shouldSandbox('vidy', true, { storage: broken })).toBe(true);
  expect(shouldSandbox('vidy', true, { storage: { getItem: () => 'not json', setItem() {} } })).toBe(true);
});

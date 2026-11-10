import { formatClock, getPositionEntry, getResumePosition, mergeRemotePosition, positionKey, savePosition } from './playbackPositions';

beforeEach(() => window.localStorage.clear());

test('keys are per movie or per episode', () => {
  expect(positionKey('movie', 5)).toBe('movie:5');
  expect(positionKey('tv_show', 9, 2, 3)).toBe('tv:9:2:3');
});

test('nothing to resume when barely started or at the credits', () => {
  savePosition('movie:1', 12, 6000);
  expect(getResumePosition('movie:1')).toBeNull();
  savePosition('movie:1', 5950, 6000);
  expect(getResumePosition('movie:1')).toBeNull();
  savePosition('movie:1', 1800.7, 6000);
  expect(getResumePosition('movie:1')).toBe(1800);
});

test('another device\'s position wins only when it is newer', () => {
  savePosition('movie:2', 600, 6000);
  const local = getPositionEntry('movie:2');
  expect(mergeRemotePosition('movie:2', 900, 6000, local.at - 1000)).toBe(false);
  expect(getResumePosition('movie:2')).toBe(600);
  expect(mergeRemotePosition('movie:2', 900, 6000, local.at + 1000)).toBe(true);
  expect(getResumePosition('movie:2')).toBe(900);
  expect(mergeRemotePosition('movie:2', 0, 6000, Date.now() + 5000)).toBe(false);
});

test('clock format', () => {
  expect(formatClock(65)).toBe('1:05');
  expect(formatClock(3725)).toBe('1:02:05');
  expect(formatClock(-3)).toBe('0:00');
});

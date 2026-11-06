import { describeWatchTime, formatWatchTime, isFinished, splitFinished } from './libraryStats';

test('watch time reads as years, months, weeks, days and a clock', () => {
  const D = 1440;
  expect(formatWatchTime(0)).toBe('0d 00:00:00');
  expect(formatWatchTime(45)).toBe('0d 00:45:00');
  expect(formatWatchTime(750)).toBe('0d 12:30:00');
  expect(formatWatchTime(2 * D + 14 * 60 + 30)).toBe('2d 14:30:00');
  expect(formatWatchTime(17 * D + 14 * 60 + 30)).toBe('2w 3d 14:30:00');
  expect(formatWatchTime(30 * D)).toBe('1m 0w 0d 00:00:00');
  expect(formatWatchTime(365 * D + 14 * D + 3 * 60)).toBe('1y 0m 2w 0d 03:00:00');
  expect(formatWatchTime((2 * 365 + 2 * 30 + 3 * 7 + 4) * D + 5)).toBe('2y 2m 3w 4d 00:05:00');
  expect(formatWatchTime(undefined)).toBe('0d 00:00:00');
});

test('screen readers get it spelled out', () => {
  const D = 1440;
  expect(describeWatchTime(0)).toBe('0 minutes');
  expect(describeWatchTime(61)).toBe('1 hour 1 minute');
  expect(describeWatchTime(750)).toBe('12 hours 30 minutes');
  expect(describeWatchTime(17 * D + 14 * 60 + 30)).toBe('2 weeks 3 days 14 hours 30 minutes');
  expect(describeWatchTime(365 * D + 30 * D + D + 1)).toBe('1 year 1 month 1 day 1 minute');
});

test('finished titles leave My List for Watched, newest first', () => {
  const { list, finished } = splitFinished([
    { id: 1, status: 'plan_to_watch' },
    { id: 2, status: 'watched', updated_at: '2026-01-01T00:00:00Z' },
    { id: 3, status: 'watching' },
    { id: 4, status: 'read', updated_at: '2026-06-01T00:00:00Z' },
    { id: 5, status: 'watched', added_at: '2025-01-01T00:00:00Z' },
    { id: 6, status: 'reading' },
  ]);
  expect(list.map((item) => item.id)).toEqual([1, 3, 6]);
  expect(finished.map((item) => item.id)).toEqual([4, 2, 5]);
  expect(isFinished({ status: 'plan_to_read' })).toBe(false);
});

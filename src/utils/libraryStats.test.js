import { describeWatchTime, formatWatchTime } from './libraryStats';

test('watch time reads as a clock, hours counting past a day', () => {
  expect(formatWatchTime(0)).toBe('00:00:00');
  expect(formatWatchTime(45)).toBe('00:45:00');
  expect(formatWatchTime(750)).toBe('12:30:00');
  expect(formatWatchTime(60 * 1234 + 5)).toBe('1234:05:00');
  expect(formatWatchTime(undefined)).toBe('00:00:00');
});

test('screen readers get it spelled out', () => {
  expect(describeWatchTime(0)).toBe('0 minutes');
  expect(describeWatchTime(61)).toBe('1 hour 1 minute');
  expect(describeWatchTime(750)).toBe('12 hours 30 minutes');
  expect(describeWatchTime(120)).toBe('2 hours');
});

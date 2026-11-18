import { timeAgo } from './timeAgo';

const NOW = Date.parse('2026-11-16T20:00:00Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test('reads like a sentence: just now, minutes, hours, yesterday, days', () => {
  expect(timeAgo(minutesAgo(0.2), NOW)).toBe('just now');
  expect(timeAgo(minutesAgo(5), NOW)).toBe('5 min ago');
  expect(timeAgo(minutesAgo(3 * 60), NOW)).toBe('3 h ago');
  expect(timeAgo(minutesAgo(30 * 60), NOW)).toBe('yesterday');
  expect(timeAgo(minutesAgo(4 * 24 * 60), NOW)).toBe('4 days ago');
});

test('a clock a little ahead of the server’s never shows a time in the future', () => {
  expect(timeAgo(minutesAgo(-2), NOW)).toBe('just now');
});

test('a missing or unreadable time reads "never"', () => {
  expect(timeAgo(null, NOW)).toBe('never');
  expect(timeAgo(undefined, NOW)).toBe('never');
  expect(timeAgo('not a date', NOW)).toBe('never');
});

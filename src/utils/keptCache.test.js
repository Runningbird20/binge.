import { clearKept, readKept, writeKept } from './keptCache';

beforeEach(() => window.localStorage.clear());

test('keeps a value for a week', () => {
  const now = Date.now();
  writeKept('row:a', [{ id: 1 }], { now });
  expect(readKept('row:a', { now })).toEqual([{ id: 1 }]);
  expect(readKept('row:a', { now: now + 8 * 24 * 3600 * 1000 })).toBeUndefined();
});

test('skips values too big to keep', () => {
  writeKept('row:big', 'x'.repeat(500_000));
  expect(readKept('row:big')).toBeUndefined();
});

test('signing out clears only kept entries', () => {
  writeKept('row:a', [1]);
  window.localStorage.setItem('other', 'stays');
  clearKept();
  expect(readKept('row:a')).toBeUndefined();
  expect(window.localStorage.getItem('other')).toBe('stays');
});

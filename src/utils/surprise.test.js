import { pickSurprise, surpriseKey, surprisePool } from './surprise';

const t = (id, extra = {}) => ({ id, media_type: 'movie', title: `T${id}`, ...extra });

test('the pool: top picks, then “Because you watched” rows, each title once, nothing not out yet', () => {
  const personal = {
    topPicks: [t(1), t(2, { _comingSoon: true }), t(3)],
    becauseYouWatched: [{ items: [t(3), t(4, { media_type: 'tv_show' }), t(5, { media_type: 'book' })] }],
  };
  expect(surprisePool(personal).map((item) => item.id)).toEqual([1, 3, 4]);
});

test('a profile with no history gets the trending fallback', () => {
  expect(surprisePool({ topPicks: [], becauseYouWatched: [] }, [t(9), t(8)]).map((item) => item.id)).toEqual([9, 8]);
  expect(surprisePool(null, [t(9)]).map((item) => item.id)).toEqual([9]);
  expect(surprisePool(null, [])).toEqual([]);
});

test('a pick leans toward the strongest titles and skips recent surprises', () => {
  const pool = [t(1), t(2), t(3)];
  expect(pickSurprise(pool, [], () => 0)).toBe(pool[0]);
  expect(pickSurprise(pool, [], () => 0.9999)).toBe(pool[2]);
  expect(pickSurprise(pool, [surpriseKey(pool[0])], () => 0)).toBe(pool[1]);
  // Everything recent: still picks something.
  expect(pickSurprise(pool, pool.map(surpriseKey), () => 0)).toBe(pool[0]);
  expect(pickSurprise([], [], () => 0)).toBeNull();
});

test('over many presses the top of the list comes up most', () => {
  const pool = Array.from({ length: 12 }, (_, i) => t(i + 1));
  const counts = new Map();
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 3000; i += 1) {
    const pick = pickSurprise(pool, [], random);
    counts.set(pick.id, (counts.get(pick.id) || 0) + 1);
  }
  expect(counts.get(1)).toBeGreaterThan(counts.get(12));
  expect(counts.size).toBe(12); // every title can come up
});

test('each button draws only from its own type, falling back to trending of that type', () => {
  const personal = { topPicks: [t(1), t(2, { media_type: 'tv_show' }), t(3)], becauseYouWatched: [] };
  expect(surprisePool(personal, [], { mediaType: 'movie' }).map((item) => item.id)).toEqual([1, 3]);
  expect(surprisePool(personal, [], { mediaType: 'tv_show' }).map((item) => item.id)).toEqual([2]);
  const moviesOnly = { topPicks: [t(1)], becauseYouWatched: [] };
  expect(surprisePool(moviesOnly, [t(7), t(8, { media_type: 'tv_show' })], { mediaType: 'tv_show' }).map((item) => item.id)).toEqual([8]);
});

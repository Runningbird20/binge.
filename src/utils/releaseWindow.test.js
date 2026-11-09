import { comingSoonCutoffIso, daysAgoIso, daysAheadIso, localIsoDate, releaseStatus, todayIso } from './releaseWindow';

function isoDaysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test('released, coming soon (<= 30 days) and hidden future titles', () => {
  expect(releaseStatus({ release_date: isoDaysFromNow(-3) })).toBe('released');
  expect(releaseStatus({ release_date: isoDaysFromNow(10) })).toBe('coming_soon');
  expect(releaseStatus({ release_date: isoDaysFromNow(45) })).toBe('future');
  expect(releaseStatus({ releaseDate: isoDaysFromNow(20) })).toBe('coming_soon');
});

test('TV rows with only a year use the year', () => {
  const year = new Date().getFullYear();
  expect(releaseStatus({ year })).toBe('released');
  expect(releaseStatus({ year: year + 1 })).toBe('future');
});

// The query dates are the viewer's calendar date, like TMDB's. toISOString()
// gave the UTC date: tomorrow in a US evening, yesterday east of UTC. On any
// machine outside UTC one of these two times catches that (CI runs in UTC,
// where the two dates always agree).
describe('query dates follow the local calendar', () => {
  afterEach(() => jest.useRealTimers());

  test('late at night and just after midnight are both still the same local day', () => {
    for (const [hour, minute] of [[23, 30], [0, 30]]) {
      jest.useFakeTimers().setSystemTime(new Date(2026, 10, 5, hour, minute));
      expect(todayIso()).toBe('2026-11-05');
      expect(daysAheadIso(1)).toBe('2026-11-06');
      expect(daysAgoIso(75)).toBe('2026-08-22');
      expect(comingSoonCutoffIso()).toBe('2026-12-05');
    }
  });

  test('localIsoDate pads month and day', () => {
    expect(localIsoDate(new Date(2026, 0, 7, 23, 59))).toBe('2026-01-07');
  });
});

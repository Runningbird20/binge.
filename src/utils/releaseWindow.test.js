import { releaseStatus } from './releaseWindow';

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

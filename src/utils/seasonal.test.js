import { easterSunday, nthWeekday, seasonFor } from './seasonal';
import { rowsFor, seasonalRow } from './browseRows';

jest.mock('./catalogQueries', () => ({ fetchCatalogBrowseRow: jest.fn() }));
jest.mock('./catalogLookup', () => ({ prepareCatalogItems: jest.fn(), resolveTmdbItems: jest.fn() }));

const on = (y, m, d) => new Date(y, m - 1, d, 15, 30);
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

describe('holiday dates', () => {
  test('Easter Sunday', () => {
    expect(iso(easterSunday(2026))).toBe('2026-04-05');
    expect(iso(easterSunday(2027))).toBe('2027-03-28');
    expect(iso(easterSunday(2028))).toBe('2028-04-16');
  });

  test('nth / last weekday of a month', () => {
    expect(iso(nthWeekday(2026, 11, 4, 4))).toBe('2026-11-26'); // Thanksgiving
    expect(iso(nthWeekday(2027, 11, 4, 4))).toBe('2027-11-25');
    expect(iso(nthWeekday(2027, 5, 1, -1))).toBe('2027-05-31'); // Memorial Day
    expect(iso(nthWeekday(2027, 5, 0, 2))).toBe('2027-05-09'); // Mother's Day
    expect(iso(nthWeekday(2027, 6, 0, 3))).toBe('2027-06-20'); // Father's Day
  });
});

describe('seasonFor', () => {
  test.each([
    [on(2026, 10, 10), 'movie', 'spooky-season', 'Spooky Season'],
    [on(2026, 10, 27), 'tv_show', 'halloween-night', 'Halloween Week'],
    [on(2026, 10, 31), 'movie', 'halloween-night', 'Happy Halloween'],
    [on(2026, 11, 5), 'movie', 'thanksgiving', 'Thanksgiving Movies'],
    [on(2026, 11, 22), 'movie', 'thanksgiving', 'Thanksgiving Week'],
    [on(2026, 11, 22), 'tv_show', 'thanksgiving', 'Comfort TV for Thanksgiving'],
    [on(2026, 11, 26), 'tv_show', 'thanksgiving', 'Happy Thanksgiving'],
    [on(2026, 11, 27), 'movie', 'christmas', 'The Holidays Start Now'],
    [on(2026, 12, 5), 'tv_show', 'christmas', 'Christmas Shows'],
    [on(2026, 12, 20), 'movie', 'christmas', 'Countdown to Christmas'],
    [on(2026, 12, 25), 'movie', 'christmas', 'Merry Christmas'],
    [on(2026, 12, 28), 'movie', 'new-year', 'Ring In the New Year'],
    [on(2026, 12, 28), 'tv_show', 'new-year', 'Binge a Limited Series'],
    [on(2027, 1, 1), 'movie', 'new-year', 'Happy New Year'],
    [on(2027, 1, 15), 'movie', 'winter', 'Snowed In'],
    [on(2027, 2, 5), 'movie', 'valentines', "Valentine's Day Romance"],
    [on(2027, 2, 14), 'tv_show', 'valentines', "Date Night for Valentine's"],
    [on(2028, 2, 29), 'movie', 'black-history-month', 'Celebrating Black History Month'],
    [on(2027, 3, 28), 'movie', 'easter', 'Happy Easter'],
    [on(2027, 3, 28), 'tv_show', 'march-madness', 'March Madness'], // no TV Easter query
    [on(2027, 5, 4), 'movie', 'may-the-4th', 'May the 4th Be With You'],
    [on(2027, 5, 9), 'movie', 'mothers-day', "Mother's Day Movies"],
    [on(2027, 5, 9), 'tv_show', 'spring', 'Feel-Good Comedies for Spring'],
    [on(2027, 6, 10), 'movie', 'pride', 'Pride Month'],
    [on(2027, 6, 20), 'movie', 'fathers-day', "Father's Day Movies"],
    [on(2027, 7, 4), 'movie', 'fourth-of-july', 'Fourth of July Movies'],
    [on(2027, 7, 4), 'tv_show', 'summer', 'Summer Binge'],
    [on(2027, 7, 25), 'tv_show', 'shark-week', 'Shark Week'],
    [on(2027, 8, 20), 'movie', 'back-to-school', 'Back to School'],
    [on(2027, 9, 15), 'movie', 'fall', 'Cozy Fall Mysteries'],
  ])('%s %s → %s', (date, type, id, title) => {
    const season = seasonFor(type, { date });
    expect(season.id).toBe(id);
    expect(season.title).toBe(title);
  });

  test('every day of the year has a row for both pages', () => {
    for (let d = on(2026, 1, 1); d.getFullYear() < 2029; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      for (const type of ['movie', 'tv_show']) {
        const season = seasonFor(type, { date: d });
        expect(season && season.title && Object.keys(season.params).length).toBeTruthy();
      }
    }
  });

  test('kids get only seasons with a kids query', () => {
    expect(seasonFor('movie', { date: on(2026, 10, 10), kids: true }).params).toEqual(expect.objectContaining({ with_keywords: expect.any(String) }));
    expect(seasonFor('movie', { date: on(2027, 6, 10), kids: true }).id).toBe('summer'); // Pride has no kids query
  });
});

describe('seasonal browse row', () => {
  test('sits second on the Movies and TV pages', () => {
    for (const type of ['movie', 'tv_show']) {
      const rows = rowsFor(type);
      expect(rows[0].id).toBe('trending');
      expect(rows[1].seasonal).toBe(true);
      expect(rows[1].id).toMatch(/^seasonal-/);
    }
  });

  test('kids rows are family-only versions', () => {
    const row = seasonalRow('movie', { kidsSafe: 'kids', date: on(2026, 12, 10) });
    expect(row.id).toBe('seasonal-christmas');
    expect(row.kind).toBeUndefined(); // a headline row, not reordered by taste
  });
});

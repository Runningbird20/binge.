import { KIDS_MOVIE_ROWS, MOVIE_ROWS, TV_ROWS, orderRowsForTaste, rowsFor, sortForTaste } from './browseRows';

test('the seasonal row sits second on every page', () => {
  for (const [type, kidsSafe] of [['movie', false], ['tv_show', false], ['movie', 'kids'], ['tv_show', 'toddler']]) {
    const rows = rowsFor(type, { kidsSafe });
    expect(rows[1].id).toMatch(/^seasonal-/);
    expect(rows[1].seasonal).toBe(true);
  }
});

test('child levels get the kids rows; Teens and No restrictions the normal ones', () => {
  expect(rowsFor('movie', { kidsSafe: 'kids' })[0].id).toBe(KIDS_MOVIE_ROWS[0].id);
  expect(rowsFor('movie', { kidsSafe: 'teens' })[0].id).toBe(MOVIE_ROWS[0].id);
  expect(rowsFor('tv_show')[0].id).toBe(TV_ROWS[0].id);
});

test('taste puts the genre rows a viewer watches first, headline rows stay on top', () => {
  const rows = [
    { id: 'top' },
    { id: 'comedy', kind: 'genre', genre: 'Comedy' },
    { id: 'horror', kind: 'genre', genre: 'Horror' },
    { id: 'korean', kind: 'language', language: 'ko' },
  ];
  const ordered = orderRowsForTaste(rows, { genres: ['Horror'], languages: ['ko'], languageShare: { ko: 0.1 } }).map((row) => row.id);
  expect(ordered[0]).toBe('top');
  expect(ordered.indexOf('horror')).toBeLessThan(ordered.indexOf('korean'));
  // A language row leads once a third of what they watch is in it.
  const leaning = orderRowsForTaste(rows, { genres: ['Horror'], languages: ['ko'], languageShare: { ko: 0.5 } }).map((row) => row.id);
  expect(leaning.indexOf('korean')).toBeLessThan(leaning.indexOf('horror'));
});

test('the seasonal row leads with the viewer\'s genres; popularity breaks ties', () => {
  const items = [{ id: 1, genre: 'Comedy' }, { id: 2, genre: 'Horror' }, { id: 3, genre: 'Drama' }];
  expect(sortForTaste(items, { genres: ['Horror'] }).map((item) => item.id)).toEqual([2, 1, 3]);
  expect(sortForTaste(items, null)).toBe(items);
});

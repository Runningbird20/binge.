import { decadeOf, filterItems, filterOptions, hasFilters, mediaTypeOf, readFilters } from './searchFilters';

const items = [
  { id: 1, media_type: 'movie', year: 2014, original_language: 'en' },
  { id: 2, media_type: 'tv_show', release_date: '2019-04-01', original_language: 'ko' },
  { id: 3, _type: 'tv', year: 2021, original_language: 'ko' },
  { id: 4, _type: 'book', year: 1954 }, // no language
  { id: 5, media_type: 'movie', year: null, original_language: 'ja' }, // no year
  { id: 6, media_type: 'movie', release_date: '2011-07-07', _tmdb: { originalLanguage: 'en' } },
];
const ids = (list) => list.map((item) => item.id);

test('filters come from the address and the result tags', () => {
  expect(readFilters(new URLSearchParams('q=x&type=movie&lang=ko'))).toEqual({ type: 'movie', decade: '', lang: 'ko' });
  expect(hasFilters({ type: '', decade: '', lang: '' })).toBe(false);
  expect(mediaTypeOf({ _type: 'tv' })).toBe('tv_show');
  expect(decadeOf({ year: 2019 })).toBe('2010');
  expect(decadeOf({ year: 1954 })).toBe('earlier');
  expect(decadeOf({})).toBe('');
});

test('each filter narrows every kind of result; unknown years and languages drop out', () => {
  expect(ids(filterItems(items, { type: 'tv_show', decade: '', lang: '' }))).toEqual([2, 3]);
  expect(ids(filterItems(items, { type: '', decade: '2010', lang: '' }))).toEqual([1, 2, 6]);
  expect(ids(filterItems(items, { type: '', decade: '', lang: 'en' }))).toEqual([1, 6]);
  expect(ids(filterItems(items, { type: 'movie', decade: '2010', lang: 'en' }))).toEqual([1, 6]);
  expect(ids(filterItems(items, { type: '', decade: '', lang: '' }))).toEqual([1, 2, 3, 4, 5, 6]);
  expect(filterItems(null, { type: 'movie' })).toEqual([]);
});

test('the chips offer what the results hold, newest decade first, busiest language first', () => {
  const options = filterOptions(items, { type: '', decade: '', lang: '' });
  expect(options.type.map((o) => o.label)).toEqual(['Movies', 'Series', 'Books']);
  expect(options.decade.map((o) => o.label)).toEqual(['2020s', '2010s', 'Before 1970']);
  expect(options.lang.map((o) => o.label)).toEqual(['English', 'Korean', 'Japanese']);
});

test('a chip list only shows when the results differ on it, and keeps the chosen value', () => {
  const english = [{ id: 1, media_type: 'movie', year: 2014, original_language: 'en' }, { id: 2, media_type: 'movie', year: 2001, original_language: 'en' }];
  const options = filterOptions(english, { type: '', decade: '', lang: '' });
  expect(options.type).toEqual([]); // all movies
  expect(options.lang).toEqual([]); // all English
  expect(options.decade.map((o) => o.value)).toEqual(['2010', '2000']);
  // Chosen but no longer in the results (another filter changed): still offered.
  expect(filterOptions(english, { type: '', decade: '', lang: 'ko' }).lang.map((o) => o.value)).toEqual(['en', 'ko']);
});

test('the other filters shape each list (no chip leads to nothing)', () => {
  const options = filterOptions(items, { type: 'movie', decade: '', lang: '' });
  // Only the movies' languages and decades are offered.
  expect(options.lang.map((o) => o.value)).toEqual(['en', 'ja']);
  // Every dated movie is from the 2010s: one choice isn't worth a bar.
  expect(options.decade).toEqual([]);
  // The type list itself still offers every type.
  expect(options.type.map((o) => o.value)).toEqual(['movie', 'tv_show', 'book']);
});

test('languages outside the app’s own list still get a name', () => {
  const options = filterOptions([
    { id: 1, media_type: 'movie', year: 2010, original_language: 'en' },
    { id: 2, media_type: 'movie', year: 2011, original_language: 'bg' },
  ], { type: '', decade: '', lang: '' });
  expect(options.lang.map((o) => o.label)).toEqual(['Bulgarian', 'English']);
});

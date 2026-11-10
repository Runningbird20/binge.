import { prepareCatalogItems, resolveTmdbItems } from './catalogLookup';
import * as catalogQueries from './catalogQueries';

const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

function rows(map) {
  jest.spyOn(catalogQueries, 'fetchCatalogByTmdbIds').mockImplementation(async (_type, ids) => new Map(ids.filter((id) => map[id]).map((id) => [id, map[id]])));
}

afterEach(() => jest.restoreAllMocks());

test('TMDB results become catalog items in TMDB\'s order, unmatched ones dropped', async () => {
  rows({ 101: { id: 1, title: 'A', source_key: 'tmdb:movie:101' }, 103: { id: 3, title: 'C', source_key: 'tmdb:movie:103' } });
  const items = await resolveTmdbItems([{ tmdbId: 103, releaseDate: '2001-01-01' }, { tmdbId: 102 }, { tmdbId: 101, releaseDate: '2000-01-01' }], 'movie');
  expect(items.map((item) => item.id)).toEqual([3, 1]);
  expect(items[0].media_type).toBe('movie');
});

test('the release window: later than 30 days is hidden, sooner is Coming Soon', async () => {
  rows({ 201: { id: 11, title: 'Far', source_key: 'tmdb:movie:201' }, 202: { id: 12, title: 'Soon', source_key: 'tmdb:movie:202' } });
  const items = await resolveTmdbItems([{ tmdbId: 201, releaseDate: future }, { tmdbId: 202, releaseDate: soon }], 'movie');
  expect(items.map((item) => item.id)).toEqual([12]);
  expect(items[0]._comingSoon).toBe(true);
});

test('a Kids profile keeps rated-for-kids titles, and unrated ones only if TMDB calls them family or animation', async () => {
  rows({
    301: { id: 21, title: 'R film', age_rating: 'R', source_key: 'tmdb:movie:301' },
    302: { id: 22, title: 'PG film', age_rating: 'PG', source_key: 'tmdb:movie:302' },
    303: { id: 23, title: 'Unrated cartoon', source_key: 'tmdb:movie:303' },
    304: { id: 24, title: 'Unrated thriller', source_key: 'tmdb:movie:304' },
  });
  const results = [
    { tmdbId: 301, releaseDate: '2010-01-01' }, { tmdbId: 302, releaseDate: '2010-01-01' },
    { tmdbId: 303, releaseDate: '2010-01-01', genreIds: [16] }, { tmdbId: 304, releaseDate: '2010-01-01', genreIds: [53] },
  ];
  const items = await resolveTmdbItems(results, 'movie', { kidsSafe: 'kids' });
  expect(items.map((item) => item.id)).toEqual([22, 23]);
});

test('catalog rows are de-duplicated and kept inside the release window', () => {
  const items = prepareCatalogItems([
    { id: 1, title: 'A', source_key: 'tmdb:movie:1', release_date: '2000-01-01' },
    { id: 1, title: 'A', source_key: 'tmdb:movie:1', release_date: '2000-01-01' },
    { id: 2, title: 'B', source_key: 'tmdb:movie:2', release_date: future },
  ], 'movie');
  expect(items.map((item) => item.id)).toEqual([1]);
});

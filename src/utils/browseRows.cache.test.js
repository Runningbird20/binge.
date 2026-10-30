import { loadRowItems } from './browseRows';
import { resolveTmdbItems } from './catalogLookup';
jest.mock('./tmdb', () => ({ fetchDiscover: jest.fn(), fetchTrending: jest.fn() }));
jest.mock('./catalogQueries', () => ({ fetchCatalogBrowseRow: jest.fn().mockResolvedValue([]) }));
jest.mock('./catalogLookup', () => ({ prepareCatalogItems: jest.fn(), resolveTmdbItems: jest.fn() }));
test('deduplicates requests and reuses rows while isolating kids content', async () => {
  const items = Array.from({ length: 6 }, (_, id) => ({ id }));
  resolveTmdbItems.mockResolvedValue(items);
  const definition = { id: 'cache-test', tmdb: jest.fn().mockResolvedValue([{}]) };
  const [first, second] = await Promise.all([loadRowItems(definition, 'movie'), loadRowItems(definition, 'movie')]);
  expect(first).toBe(second);
  expect(definition.tmdb).toHaveBeenCalledTimes(1);
  expect(await loadRowItems(definition, 'movie')).toBe(first);
  expect(definition.tmdb).toHaveBeenCalledTimes(1);
  await loadRowItems(definition, 'movie', { kidsSafe: true });
  expect(definition.tmdb).toHaveBeenCalledTimes(2);
});

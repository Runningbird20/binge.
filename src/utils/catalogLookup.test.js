import { prepareCatalogItems, resolveTmdbItems } from './catalogLookup';
import { fetchCatalogByTmdbIds } from './catalogQueries';

jest.mock('./catalogQueries', () => ({ fetchCatalogByTmdbIds: jest.fn() }));

// catalogLookup remembers every TMDB id it has looked up for the rest of the
// tab, so each test below uses its own ids.

// A local calendar day `days` from today, the way the release window reads dates.
function dayFromToday(days) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// A normalized TMDB list result (tmdb.js normalizeTmdbResult).
const tmdbResult = (tmdbId, extra = {}) => ({
  tmdbId,
  title: `TMDB ${tmdbId}`,
  releaseDate: dayFromToday(-200),
  originalLanguage: 'en',
  genreIds: [],
  posterPath: null,
  backdropPath: null,
  overview: '',
  ...extra,
});

// A catalog movie row (catalogQueries' browse columns).
const catalogMovie = (id, extra = {}) => ({
  id,
  title: `Movie ${id}`,
  year: 2020,
  imdb_id: `tt${id}`,
  release_date: dayFromToday(-200),
  poster_url: `https://catalog.example/${id}.jpg`,
  original_language: 'en',
  age_rating: 'PG',
  ...extra,
});

// The catalog holds these rows, keyed by TMDB id.
function catalogHas(rowsByTmdbId) {
  fetchCatalogByTmdbIds.mockImplementation(async (mediaType, tmdbIds) => new Map(
    tmdbIds.filter((id) => rowsByTmdbId[id]).map((id) => [id, rowsByTmdbId[id]])
  ));
}

const ids = (items) => items.map((item) => item.id);

beforeEach(() => catalogHas({}));

describe('resolveTmdbItems', () => {
  test('turns a TMDB list into catalog titles in TMDB’s order, leaving out titles that aren’t on binge.', async () => {
    catalogHas({ 103: catalogMovie(3), 101: catalogMovie(1), 104: catalogMovie(4) });

    const items = await resolveTmdbItems([tmdbResult(104), tmdbResult(101), tmdbResult(102), tmdbResult(103)], 'movie');

    expect(ids(items)).toEqual([4, 1, 3]);
    expect(items.every((item) => item.media_type === 'movie')).toBe(true);
  });

  test('cards keep the catalog’s poster and language, and take what the catalog lacks from TMDB', async () => {
    catalogHas({
      111: catalogMovie(11, { original_language: 'ko', overview: 'Catalog blurb.' }),
      112: catalogMovie(12, { poster_url: null, original_language: null, overview: 'Catalog blurb.' }),
    });

    const [complete, sparse] = await resolveTmdbItems([
      tmdbResult(111, { posterPath: '/p111.jpg', backdropPath: '/b111.jpg', originalLanguage: 'en', overview: '' }),
      tmdbResult(112, { posterPath: '/p112.jpg', backdropPath: '/b112.jpg', originalLanguage: 'ja', overview: 'TMDB blurb.' }),
    ], 'movie');

    expect(complete).toMatchObject({
      poster_url: 'https://catalog.example/11.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/b111.jpg',
      original_language: 'ko',
      overview: 'Catalog blurb.',
    });
    expect(sparse).toMatchObject({
      poster_url: 'https://image.tmdb.org/t/p/w500/p112.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/b112.jpg',
      original_language: 'ja',
      overview: 'TMDB blurb.',
    });
    // The scorers and taste sorting read TMDB's own data off the item.
    expect(sparse._tmdb).toMatchObject({ tmdbId: 112, originalLanguage: 'ja' });
  });

  test('a title shows once, even when TMDB lists it twice or the catalog holds two copies of it', async () => {
    catalogHas({
      201: catalogMovie(21, { imdb_id: 'tt0201' }),
      202: catalogMovie(22, { imdb_id: 'tt0201' }), // a second import of the same film
      203: catalogMovie(23),
    });

    const items = await resolveTmdbItems([tmdbResult(201), tmdbResult(202), tmdbResult(201), tmdbResult(203)], 'movie');

    expect(ids(items)).toEqual([21, 23]);
  });

  test('remakes that share a name stay separate titles', async () => {
    catalogHas({
      211: catalogMovie(31, { title: 'Dune', year: 1984, imdb_id: null }),
      212: catalogMovie(32, { title: 'Dune', year: 2021, imdb_id: null }),
    });

    const items = await resolveTmdbItems([tmdbResult(211), tmdbResult(212)], 'movie');

    expect(ids(items)).toEqual([31, 32]);
  });

  test('released titles show, titles out within 30 days show as Coming Soon, and later ones are hidden', async () => {
    catalogHas({
      301: catalogMovie(41, { release_date: dayFromToday(-10) }),
      302: catalogMovie(42, { release_date: dayFromToday(10) }),
      303: catalogMovie(43, { release_date: dayFromToday(60) }),
    });

    const items = await resolveTmdbItems([
      tmdbResult(301, { releaseDate: dayFromToday(-10) }),
      tmdbResult(302, { releaseDate: dayFromToday(10) }),
      tmdbResult(303, { releaseDate: dayFromToday(60) }),
    ], 'movie');

    expect(items.map((item) => [item.id, item._comingSoon])).toEqual([[41, false], [42, true]]);
  });

  test('a series premiering within 30 days shows as Coming Soon from TMDB’s first-air date, since the catalog only has its year', async () => {
    const thisYear = new Date().getFullYear();
    catalogHas({
      311: { id: 51, title: 'New Show', year: thisYear, age_rating: 'TV-14' },
      312: { id: 52, title: 'Old Show', year: 2015, age_rating: 'TV-14' },
    });

    const items = await resolveTmdbItems([
      tmdbResult(311, { releaseDate: dayFromToday(10) }),
      tmdbResult(312, { releaseDate: '2015-01-10' }),
    ], 'tv_show');

    expect(items.map((item) => [item.id, item.media_type, item._comingSoon])).toEqual([[51, 'tv_show', true], [52, 'tv_show', false]]);
  });

  describe('maturity levels', () => {
    const RATED = { 401: 'G', 402: 'TV-Y', 403: 'PG', 404: 'TV-Y7', 405: 'TV-PG', 406: 'PG-13', 407: 'TV-14', 408: 'R', 409: 'TV-MA', 410: 'NC-17' };
    const ratedResults = Object.keys(RATED).map((tmdbId) => tmdbResult(Number(tmdbId)));
    const ratingsShown = (items) => items.map((item) => item.age_rating);

    beforeEach(() => catalogHas(Object.fromEntries(
      Object.entries(RATED).map(([tmdbId, rating]) => [tmdbId, catalogMovie(Number(tmdbId) * 10, { age_rating: rating })])
    )));

    test.each([
      ['An unrestricted', false, ['G', 'TV-Y', 'PG', 'TV-Y7', 'TV-PG', 'PG-13', 'TV-14', 'R', 'TV-MA', 'NC-17']],
      ['A Toddler', 'toddler', ['G', 'TV-Y']],
      ['A Kids', 'kids', ['G', 'TV-Y', 'PG', 'TV-Y7', 'TV-PG']],
      ['A Kids (passed as plain `true`)', true, ['G', 'TV-Y', 'PG', 'TV-Y7', 'TV-PG']],
      ['A Teens', 'teens', ['G', 'TV-Y', 'PG', 'TV-Y7', 'TV-PG', 'PG-13', 'TV-14']],
    ])('%s profile sees exactly the ratings its level allows', async (_name, kidsSafe, expected) => {
      const items = await resolveTmdbItems(ratedResults, 'movie', { kidsSafe });
      expect(ratingsShown(items)).toEqual(expected);
    });

    test.each(['toddler', 'kids', 'teens'])('an unrated title reaches a %s profile only when TMDB tags it Family, Animation or Kids', async (kidsSafe) => {
      catalogHas({
        421: catalogMovie(61, { age_rating: null }),
        422: catalogMovie(62, { age_rating: null }),
        423: catalogMovie(63, { age_rating: null }),
        424: catalogMovie(64, { age_rating: null }),
        425: catalogMovie(65, { age_rating: null }),
      });
      const results = [
        tmdbResult(421, { genreIds: [28, 53] }), // Action, Thriller
        tmdbResult(422, { genreIds: [16, 28] }), // Animation
        tmdbResult(423, { genreIds: [10751] }), // Family
        tmdbResult(424, { genreIds: [10762] }), // Kids
        tmdbResult(425, { genreIds: undefined }),
      ];

      expect(ids(await resolveTmdbItems(results, 'movie', { kidsSafe }))).toEqual([62, 63, 64]);
      expect(ids(await resolveTmdbItems(results, 'movie'))).toEqual([61, 62, 63, 64, 65]);
    });
  });

  test('each TMDB title is looked up in the catalog once, whether or not it’s on binge.', async () => {
    catalogHas({ 501: catalogMovie(71) });

    await resolveTmdbItems([tmdbResult(501), tmdbResult(502)], 'movie');
    const again = await resolveTmdbItems([tmdbResult(502), tmdbResult(501), tmdbResult(503)], 'movie');

    expect(ids(again)).toEqual([71]);
    expect(fetchCatalogByTmdbIds.mock.calls).toEqual([['movie', [501, 502]], ['movie', [503]]]);
  });

  test('a movie and a series with the same TMDB id are different titles', async () => {
    catalogHas({ 511: catalogMovie(81) });
    await resolveTmdbItems([tmdbResult(511)], 'movie');

    catalogHas({ 511: { id: 82, title: 'A Series', year: 2019 } });
    const series = await resolveTmdbItems([tmdbResult(511)], 'tv_show');

    expect(series.map((item) => [item.id, item.media_type])).toEqual([[82, 'tv_show']]);
    expect(fetchCatalogByTmdbIds).toHaveBeenLastCalledWith('tv_show', [511]);
  });

  test('nothing to match: no list, or results without a TMDB id', async () => {
    await expect(resolveTmdbItems(undefined, 'movie')).resolves.toEqual([]);
    await expect(resolveTmdbItems([null, { title: 'No id' }], 'movie')).resolves.toEqual([]);
    expect(fetchCatalogByTmdbIds).not.toHaveBeenCalled();
  });

  test('a catalog error gives an empty list rather than breaking the row', async () => {
    fetchCatalogByTmdbIds.mockRejectedValue(new Error('catalog unreachable'));
    await expect(resolveTmdbItems([tmdbResult(601), tmdbResult(602)], 'movie')).resolves.toEqual([]);
  });

  test('a catalog that didn’t answer isn’t remembered as “not on binge.”: the next list asks again', async () => {
    fetchCatalogByTmdbIds.mockRejectedValueOnce(new Error('catalog unreachable'));
    await expect(resolveTmdbItems([tmdbResult(611)], 'movie')).resolves.toEqual([]);
    catalogHas({ 611: catalogMovie(611) });
    expect(ids(await resolveTmdbItems([tmdbResult(611)], 'movie'))).toEqual([611]);
    expect(fetchCatalogByTmdbIds).toHaveBeenCalledTimes(2);
  });
});

describe('prepareCatalogItems', () => {
  test('catalog rows get their type and the release window: Coming Soon tagged, later titles hidden', () => {
    const items = prepareCatalogItems([
      catalogMovie(1, { release_date: dayFromToday(-20) }),
      catalogMovie(2, { release_date: dayFromToday(10) }),
      catalogMovie(3, { release_date: dayFromToday(60) }),
      catalogMovie(4, { release_date: null, year: null }), // date unknown: shown
    ], 'movie');

    expect(items.map((item) => [item.id, item.media_type, item._comingSoon])).toEqual([
      [1, 'movie', false],
      [2, 'movie', true],
      [4, 'movie', false],
    ]);
  });

  test('a series with only a year is hidden until that year starts', () => {
    const thisYear = new Date().getFullYear();
    const items = prepareCatalogItems([
      { id: 11, title: 'Running Now', year: thisYear },
      { id: 12, title: 'Next Year', year: thisYear + 1 },
    ], 'tv_show');

    expect(items.map((item) => [item.id, item.media_type, item._comingSoon])).toEqual([[11, 'tv_show', false]]);
  });

  test('duplicate catalog copies of one title show once', () => {
    const items = prepareCatalogItems([
      catalogMovie(21, { imdb_id: 'tt0021' }),
      catalogMovie(22, { imdb_id: 'TT0021' }), // a second import of the same film
      catalogMovie(23, { title: 'Alien', year: 1979, imdb_id: null }),
      catalogMovie(24, { title: 'ALIEN!', year: 1979, imdb_id: null }),
    ], 'movie');

    expect(ids(items)).toEqual([21, 23]);
  });

  test('no rows, no items', () => {
    expect(prepareCatalogItems(undefined, 'movie')).toEqual([]);
  });
});

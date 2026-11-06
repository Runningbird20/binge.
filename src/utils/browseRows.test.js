import {
  KIDS_MOVIE_ROWS,
  KIDS_TV_ROWS,
  MOVIE_ROWS,
  TV_ROWS,
  loadRowItems,
  orderRowsForTaste,
  rowsFor,
  seasonalRow,
  sortForTaste,
} from './browseRows';
import { fetchDiscover, fetchTrending } from './tmdb';
import { fetchCatalogBrowseRow, fetchCatalogByTmdbIds } from './catalogQueries';
import { todayIso } from './releaseWindow';

// The network modules are mocked; catalogLookup (TMDB → catalog matching,
// release window, maturity) runs for real so the rows are what users see.
// Row results and catalog matches are remembered for the rest of the tab, so
// each test uses its own row ids and TMDB ids. The seasonal row's own date
// rules are covered in seasonal.test.js.
jest.mock('./tmdb', () => ({ ...jest.requireActual('./tmdb'), fetchDiscover: jest.fn(), fetchTrending: jest.fn() }));
jest.mock('./catalogQueries', () => ({ fetchCatalogBrowseRow: jest.fn(), fetchCatalogByTmdbIds: jest.fn() }));

const on = (y, m, d) => new Date(y, m - 1, d, 15, 30);
const ids = (list) => list.map((entry) => entry.id);
const isSeasonal = (id) => id.startsWith('seasonal-');

// A local calendar day `days` from today, the way the release window reads dates.
function dayFromToday(days) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const tmdbResult = (tmdbId, extra = {}) => ({ tmdbId, title: `TMDB ${tmdbId}`, releaseDate: dayFromToday(-200), genreIds: [], ...extra });
const catalogTitle = (id, extra = {}) => ({ id, title: `Title ${id}`, year: 2020, imdb_id: `tt${id}`, release_date: dayFromToday(-200), ...extra });

// The catalog holds these rows, keyed by TMDB id.
function catalogHas(rowsByTmdbId) {
  fetchCatalogByTmdbIds.mockImplementation(async (mediaType, tmdbIds) => new Map(
    tmdbIds.filter((id) => rowsByTmdbId[id]).map((id) => [id, rowsByTmdbId[id]])
  ));
}

beforeEach(() => {
  fetchDiscover.mockResolvedValue(null);
  fetchTrending.mockResolvedValue(null);
  fetchCatalogBrowseRow.mockResolvedValue([]);
  catalogHas({});
});

describe('which rows a profile gets', () => {
  afterEach(() => jest.useRealTimers());

  test('toddler and kids profiles get only the kids rows', () => {
    for (const kidsSafe of ['toddler', 'kids', true]) {
      expect(ids(rowsFor('movie', { kidsSafe })).filter((id) => !isSeasonal(id))).toEqual(ids(KIDS_MOVIE_ROWS));
      expect(ids(rowsFor('tv_show', { kidsSafe })).filter((id) => !isSeasonal(id))).toEqual(ids(KIDS_TV_ROWS));
    }
  });

  test('teens browse the same rows as adults, Horror included; their titles are filtered by rating instead', () => {
    const teens = ids(rowsFor('movie', { kidsSafe: 'teens' }));
    expect(teens).toEqual(ids(rowsFor('movie')));
    expect(teens).toContain('genre-27');
    expect(ids(rowsFor('tv_show', { kidsSafe: 'teens' }))).toEqual(ids(rowsFor('tv_show')));
  });

  test('every kids row asks TMDB only for family titles: movies rated PG or lower, Kids or Family series', async () => {
    for (const definition of rowsFor('movie', { kidsSafe: 'kids' })) {
      fetchDiscover.mockClear();
      await definition.tmdb();
      expect(fetchDiscover).toHaveBeenCalledWith('movie', expect.objectContaining({ certification_country: 'US', 'certification.lte': 'PG' }));
    }
    for (const definition of rowsFor('tv_show', { kidsSafe: 'toddler' })) {
      fetchDiscover.mockClear();
      await definition.tmdb();
      expect(fetchDiscover).toHaveBeenCalledWith('tv_show', expect.objectContaining({ with_genres: expect.stringMatching(/10762|10751/) }));
    }
    // Never TMDB's unfiltered trending list.
    expect(fetchTrending).not.toHaveBeenCalled();
  });

  test('Hidden Gems asks for highly rated titles few people have seen, already out, and no short films', async () => {
    await MOVIE_ROWS.find((row) => row.id === 'hidden-gems').tmdb();
    expect(fetchDiscover).toHaveBeenLastCalledWith('movie', expect.objectContaining({
      sort_by: 'vote_average.desc',
      'vote_average.gte': expect.any(String),
      'vote_count.lte': expect.any(String),
      'with_runtime.gte': expect.any(String),
      'primary_release_date.lte': todayIso(),
    }));

    await TV_ROWS.find((row) => row.id === 'hidden-gems').tmdb();
    const [, tvParams] = fetchDiscover.mock.calls[fetchDiscover.mock.calls.length - 1];
    expect(tvParams).toMatchObject({ 'vote_count.lte': expect.any(String), 'first_air_date.lte': todayIso() });
    expect(tvParams).not.toHaveProperty('with_runtime.gte');
  });

  test('a kids profile’s rows simply start without a seasonal row when the season has no kids version', () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(on(2026, 9, 15)); // Cozy Fall Mysteries: grown-ups only
    expect(ids(rowsFor('movie', { kidsSafe: 'kids' }))).toEqual(ids(KIDS_MOVIE_ROWS));
    expect(ids(rowsFor('movie'))[1]).toBe('seasonal-fall');
  });
});

describe('seasonalRow', () => {
  test('the row’s title and TMDB query follow the date, and only list titles already out', async () => {
    const christmas = seasonalRow('movie', { date: on(2026, 12, 20) });
    expect(christmas).toMatchObject({ id: 'seasonal-christmas', title: 'Countdown to Christmas', seasonal: true, fallback: { genre: 'Family' } });
    await christmas.tmdb();
    expect(fetchDiscover).toHaveBeenLastCalledWith('movie', expect.objectContaining({
      with_keywords: '207317|1991',
      without_genres: '27', // no Christmas horror
      'primary_release_date.lte': todayIso(),
    }));

    const halloween = seasonalRow('tv_show', { date: on(2026, 10, 27) });
    expect(halloween).toMatchObject({ id: 'seasonal-halloween-night', title: 'Halloween Week' });
    await halloween.tmdb();
    expect(fetchDiscover).toHaveBeenLastCalledWith('tv_show', expect.objectContaining({ 'first_air_date.lte': todayIso() }));
  });

  test('a kids profile’s seasonal row keeps the family filters on top of the holiday’s', async () => {
    await seasonalRow('movie', { kidsSafe: 'kids', date: on(2026, 10, 10) }).tmdb();
    const [, movieParams] = fetchDiscover.mock.calls[0];
    expect(movieParams).toMatchObject({ certification_country: 'US', 'certification.lte': 'PG', with_genres: '10751|16' });
    expect(movieParams.with_keywords).toEqual(expect.stringContaining('3335')); // Halloween, not Spooky Season's horror genre

    await seasonalRow('tv_show', { kidsSafe: 'toddler', date: on(2026, 12, 10) }).tmdb();
    expect(fetchDiscover).toHaveBeenLastCalledWith('tv_show', expect.objectContaining({ with_genres: '10762|10751', with_keywords: '207317|1991' }));
  });

  test('a kids profile gets no seasonal row, rather than the grown-up one, when the season has no kids version', () => {
    expect(seasonalRow('movie', { date: on(2026, 9, 15) }).title).toBe('Cozy Fall Mysteries');
    expect(seasonalRow('movie', { kidsSafe: 'kids', date: on(2026, 9, 15) })).toBeNull();
    expect(seasonalRow('tv_show', { date: on(2027, 2, 5) }).id).toBe('seasonal-valentines');
    expect(seasonalRow('tv_show', { kidsSafe: 'toddler', date: on(2027, 2, 5) })).toBeNull();
  });

  test('teens get the grown-up seasonal row, filtered by rating later like their other rows', async () => {
    const row = seasonalRow('movie', { kidsSafe: 'teens', date: on(2026, 10, 10) });
    expect(row.id).toBe('seasonal-spooky-season');
    await row.tmdb();
    const [, params] = fetchDiscover.mock.calls[0];
    expect(params).toMatchObject({ with_genres: '27' });
    expect(params).not.toHaveProperty('certification.lte');
  });
});

describe('sortForTaste', () => {
  test('popularity (TMDB’s order) still breaks ties between equally good matches, whatever the genre’s spelling', () => {
    const items = [
      { id: 1, genre: 'Comedy' },
      { id: 2, genre: 'Thriller,  horror' },
      { id: 3, genre: 'Horror' },
      { id: 4, genre: 'Comedy' },
    ];
    expect(ids(sortForTaste(items, { genres: ['Horror'], languages: [] }))).toEqual([2, 3, 1, 4]);
  });

  test('English titles get no language boost, however much English the profile watches', () => {
    const items = [
      { id: 1, genre: 'Drama', original_language: 'en' },
      { id: 2, genre: 'Drama', original_language: 'en' },
      { id: 3, genre: 'Drama', original_language: 'ko' },
    ];
    const taste = { genres: [], languages: ['en', 'ko'], languageShare: { en: 0.7, ko: 0.3 } };
    expect(ids(sortForTaste(items, taste))).toEqual([1, 3, 2]);
  });

  test('a title’s language comes from TMDB when the catalog row doesn’t have one', () => {
    const items = [
      { id: 1, genre: 'Comedy', original_language: 'en' },
      { id: 2, genre: 'Comedy', original_language: null, _tmdb: { originalLanguage: 'ko' } },
    ];
    const taste = { genres: ['Horror'], languages: ['ko'], languageShare: { ko: 0.6 } };
    expect(ids(sortForTaste(items, taste))).toEqual([2, 1]);
  });

  test('an empty row stays empty', () => {
    expect(sortForTaste([], { genres: ['Horror'], languages: ['ko'] })).toEqual([]);
  });
});

describe('orderRowsForTaste', () => {
  const MOVIE_TASTE_ROWS = ids(MOVIE_ROWS.filter((row) => row.kind));

  test('without a taste, rows keep their order, except Coming Soon waits below the first three taste rows', () => {
    const order = ids(orderRowsForTaste(rowsFor('movie'), null));
    expect(order.slice(0, 10)).toEqual([
      'trending', expect.stringMatching(/^seasonal-/), 'new', 'popular', 'top-rated', 'hidden-gems',
      'lang-ko', 'lang-hi', 'lang-ja-16',
      'coming-soon',
    ]);
    expect(order.slice(10)).toEqual(MOVIE_TASTE_ROWS.slice(3));
  });

  test('a K-drama fan’s series lead with K-Dramas, then their favourite genres, then the rest in the usual order', () => {
    const taste = { genres: ['Crime', 'Drama'], languages: ['ko', 'en'], languageShare: { ko: 0.5, en: 0.5 } };
    expect(ids(orderRowsForTaste(rowsFor('tv_show'), taste))).toEqual([
      'trending', expect.stringMatching(/^seasonal-/), 'new', 'popular', 'top-rated', 'hidden-gems',
      'lang-ko-18', 'genre-80', 'genre-18',
      'lang-ja-16', 'lang-zh-18', 'lang-es', 'lang-hi',
      'genre-10759', 'genre-35', 'genre-10765', 'genre-9648', 'genre-10764', 'genre-99', 'genre-10762',
    ]);
  });

  test('a language the profile only dips into comes after its favourite genres, and leads once it’s a third of what they watch', () => {
    const dabbler = { genres: ['Horror', 'Comedy'], languages: ['en', 'fr'], languageShare: { en: 0.92, fr: 0.08 } };
    expect(ids(orderRowsForTaste(rowsFor('movie'), dabbler)).slice(6, 11)).toEqual(['genre-27', 'genre-35', 'lang-fr', 'coming-soon', 'lang-ko']);

    const fan = { ...dabbler, languageShare: { en: 0.6, fr: 0.4 } };
    expect(ids(orderRowsForTaste(rowsFor('movie'), fan)).slice(6, 10)).toEqual(['lang-fr', 'genre-27', 'genre-35', 'coming-soon']);
  });

  test('kids rows keep their fixed order whatever the taste', () => {
    const taste = { genres: ['Animation', 'Comedy'], languages: ['ja'], languageShare: { ja: 0.9 } };
    const rows = rowsFor('tv_show', { kidsSafe: 'kids' });
    expect(ids(orderRowsForTaste(rows, taste))).toEqual(ids(rows));
  });
});

describe('loadRowItems', () => {
  test('a row is TMDB’s live list matched to the catalog, in TMDB’s order', async () => {
    catalogHas(Object.fromEntries([17, 16, 15, 14, 13, 12].map((id) => [id, catalogTitle(id * 10)])));
    const definition = { id: 'test-live', tmdb: jest.fn().mockResolvedValue([11, 12, 13, 14, 15, 16, 17].map((id) => tmdbResult(id))), fallback: { sort: 'popularity' } };

    const items = await loadRowItems(definition, 'movie');

    expect(ids(items)).toEqual([120, 130, 140, 150, 160, 170]); // 11 isn't on binge.
    expect(fetchCatalogBrowseRow).not.toHaveBeenCalled();
  });

  test('when TMDB is unreachable, the row fills from the catalog with the same release window', async () => {
    fetchCatalogBrowseRow.mockResolvedValue([
      catalogTitle(1, { release_date: dayFromToday(-30) }),
      catalogTitle(2, { release_date: dayFromToday(10) }),
      catalogTitle(3, { release_date: dayFromToday(90) }),
    ]);
    const definition = { id: 'test-offline', tmdb: jest.fn().mockResolvedValue(null), fallback: { genre: 'Horror' } };

    const items = await loadRowItems(definition, 'movie');

    expect(fetchCatalogBrowseRow).toHaveBeenCalledWith('movie', { genre: 'Horror', kidsSafe: false, limit: 30 });
    expect(items.map((item) => [item.id, item.media_type, item._comingSoon])).toEqual([[1, 'movie', false], [2, 'movie', true]]);
  });

  test('a short TMDB list is topped up from the catalog without repeating a title', async () => {
    catalogHas({ 21: catalogTitle(210), 22: catalogTitle(220), 23: catalogTitle(230) });
    fetchCatalogBrowseRow.mockResolvedValue([catalogTitle(220), catalogTitle(900), catalogTitle(901), catalogTitle(902)]);
    const definition = { id: 'test-short', tmdb: jest.fn().mockResolvedValue([tmdbResult(21), tmdbResult(22), tmdbResult(23)]), fallback: { sort: 'rating' } };

    expect(ids(await loadRowItems(definition, 'movie'))).toEqual([210, 220, 230, 900, 901, 902]);
  });

  test('a catalog error still leaves the titles TMDB found', async () => {
    catalogHas({ 41: catalogTitle(410) });
    fetchCatalogBrowseRow.mockRejectedValue(new Error('catalog unreachable'));
    const definition = { id: 'test-catalog-down', tmdb: jest.fn().mockResolvedValue([tmdbResult(41)]), fallback: { sort: 'popularity' } };

    expect(ids(await loadRowItems(definition, 'movie'))).toEqual([410]);
  });

  test('a Teens profile browsing Horror sees PG-13 horror but not R, from TMDB and from the catalog', async () => {
    fetchDiscover.mockResolvedValue([
      tmdbResult(81),
      tmdbResult(82),
      tmdbResult(83, { genreIds: [27, 53] }), // unrated horror
    ]);
    catalogHas({ 81: catalogTitle(810, { age_rating: 'R' }), 82: catalogTitle(820, { age_rating: 'PG-13' }), 83: catalogTitle(830, { age_rating: null }) });
    const horror = rowsFor('movie', { kidsSafe: 'teens' }).find((row) => row.id === 'genre-27');

    const items = await loadRowItems(horror, 'movie', { kidsSafe: 'teens' });

    expect(ids(items)).toEqual([820]);
    expect(fetchCatalogBrowseRow).toHaveBeenCalledWith('movie', { genre: 'Horror', kidsSafe: 'teens', limit: 30 });
  });

  test('a Toddler profile’s kids row only shows titles within its level, from TMDB and from the catalog', async () => {
    fetchDiscover.mockResolvedValue([tmdbResult(91), tmdbResult(92)]);
    catalogHas({ 91: catalogTitle(910, { age_rating: 'TV-PG' }), 92: catalogTitle(920, { age_rating: 'TV-Y' }) });
    fetchCatalogBrowseRow.mockResolvedValue([catalogTitle(990, { age_rating: 'TV-Y' })]);
    const popular = rowsFor('tv_show', { kidsSafe: 'toddler' }).find((row) => row.id === 'kids-popular');

    const items = await loadRowItems(popular, 'tv_show', { kidsSafe: 'toddler' });

    expect(ids(items)).toEqual([920, 990]);
    expect(fetchCatalogBrowseRow).toHaveBeenCalledWith('tv_show', { sort: 'popularity', kidsSafe: 'toddler', limit: 30 });
  });

  test('the Coming Soon row only shows titles that aren’t out yet, and has no catalog stand-in', async () => {
    fetchDiscover.mockResolvedValue([
      tmdbResult(51, { releaseDate: dayFromToday(12) }),
      tmdbResult(52, { releaseDate: dayFromToday(-3) }),
      tmdbResult(53, { releaseDate: dayFromToday(20) }),
    ]);
    catalogHas({
      51: catalogTitle(510, { release_date: dayFromToday(12) }),
      52: catalogTitle(520, { release_date: dayFromToday(-3) }),
      53: catalogTitle(530, { release_date: dayFromToday(20) }),
    });
    const comingSoon = rowsFor('movie').find((row) => row.id === 'coming-soon');

    const items = await loadRowItems(comingSoon, 'movie');

    expect(items.map((item) => [item.id, item._comingSoon])).toEqual([[510, true], [530, true]]);
    expect(fetchCatalogBrowseRow).not.toHaveBeenCalled();
  });

  test('an empty row is tried again on the next visit rather than remembered as empty', async () => {
    const definition = { id: 'test-retry', tmdb: jest.fn().mockResolvedValue(null), fallback: { sort: 'newest' } };
    expect(await loadRowItems(definition, 'movie')).toEqual([]);

    definition.tmdb.mockResolvedValue([tmdbResult(61)]);
    catalogHas({ 61: catalogTitle(610) });
    expect(ids(await loadRowItems(definition, 'movie'))).toEqual([610]);
    expect(definition.tmdb).toHaveBeenCalledTimes(2);
  });
});

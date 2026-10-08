// Row definitions for the Netflix-style Movies / TV / Home browse pages.
// Each row has a TMDB source (live, correctly sorted) and a catalog-table
// fallback with the same intent, so rows still fill when TMDB is down.
import { fetchDiscover, fetchTrending } from './tmdb';
import { fetchCatalogBrowseRow } from './supabaseMovieCatalog';
import { prepareCatalogItems, resolveTmdbItems } from './catalogLookup';
import { comingSoonCutoffIso, daysAgoIso, todayIso } from './releaseWindow';

const MIN_ROW_ITEMS = 6;

// "Hidden gems": rated highly by the people who saw them, but seen by few —
// the titles a popularity-ranked service never surfaces. A random page of
// the result each visit keeps the row fresh.
function hiddenGemsRow(mediaType) {
  return row(
    'hidden-gems',
    'Hidden Gems',
    () => fetchDiscover(mediaType, {
      sort_by: 'vote_average.desc',
      'vote_average.gte': mediaType === 'movie' ? '7.3' : '7.8',
      'vote_count.gte': mediaType === 'movie' ? '300' : '60',
      ...(mediaType === 'movie' ? { 'with_runtime.gte': '75' } : {}), // no shorts
      'vote_count.lte': mediaType === 'movie' ? '2500' : '900',
      without_genres: '10770|99|10767|10763',
      page: String(1 + Math.floor(Math.random() * 3)),
      ...dateParams(mediaType, null, todayIso()),
    }),
    { sort: 'rating' },
    { subtitle: 'Loved by the few who found them' }
  );
}

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateParams(mediaType, from, to) {
  const field = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
  const params = {};
  if (from) params[`${field}.gte`] = from;
  if (to) params[`${field}.lte`] = to;
  return params;
}

function kidsParams(mediaType) {
  return mediaType === 'movie'
    ? { certification_country: 'US', 'certification.lte': 'PG', with_genres: '10751|16' }
    : { with_genres: '10762|10751' };
}

// `tmdb`: () => Promise<normalized TMDB results | null>
// `fallback`: options for fetchCatalogBrowseRow
function row(id, title, tmdb, fallback, extra = {}) {
  return { id, title, tmdb, fallback, ...extra };
}

function genreRow(mediaType, genreId, genreName, title) {
  return row(
    `genre-${genreId}`,
    title || genreName,
    () => fetchDiscover(mediaType, {
      with_genres: String(genreId),
      'vote_count.gte': mediaType === 'movie' ? '200' : '80',
      ...dateParams(mediaType, null, todayIso()),
    }),
    { genre: genreName },
    { genre: genreName, kind: 'genre' }
  );
}

function languageRow(mediaType, language, title, extraParams = {}, fallbackGenre = '') {
  return row(
    `lang-${language}${extraParams.with_genres ? `-${extraParams.with_genres}` : ''}`,
    // Low-vote anime/drama on TMDB includes adult titles TMDB doesn't flag
    // as adult; rows that need it pass a higher vote_count.gte below.
    title,
    () => fetchDiscover(mediaType, {
      with_original_language: language,
      'vote_count.gte': '20',
      ...dateParams(mediaType, null, todayIso()),
      ...extraParams,
    }),
    { language, genre: fallbackGenre },
    { language, kind: 'language' }
  );
}

export const MOVIE_ROWS = [
  row('trending', 'Trending Now', () => fetchTrending('movie', 'week'), { sort: 'popularity' }, { ranked: true }),
  row('new', 'New Releases', () => fetchDiscover('movie', { ...dateParams('movie', daysAgoIso(75), todayIso()), 'vote_count.gte': '15' }), { sort: 'newest', releasedAfter: daysAgoIso(75) }),
  row('popular', 'Popular on binge.', () => fetchDiscover('movie', { 'vote_count.gte': '300', ...dateParams('movie', null, todayIso()) }), { sort: 'popularity' }),
  row('top-rated', 'Critically Acclaimed', () => fetchDiscover('movie', { sort_by: 'vote_average.desc', 'vote_count.gte': '3000' }), { sort: 'rating' }),
  hiddenGemsRow('movie'),
  row('coming-soon', 'Coming Soon', () => fetchDiscover('movie', { ...dateParams('movie', tomorrowIso(), comingSoonCutoffIso()), sort_by: 'popularity.desc' }), null, { comingSoon: true }),
  languageRow('movie', 'ko', 'Korean Movies'),
  languageRow('movie', 'hi', 'Bollywood Hits'),
  languageRow('movie', 'ja', 'Anime Films', { with_genres: '16', 'vote_count.gte': '300' }, 'Animation'),
  languageRow('movie', 'es', 'Spanish-Language Movies'),
  languageRow('movie', 'fr', 'French Cinema'),
  genreRow('movie', 28, 'Action', 'Action & Adventure'),
  genreRow('movie', 35, 'Comedy', 'Comedies'),
  genreRow('movie', 53, 'Thriller', 'Thrillers'),
  genreRow('movie', 27, 'Horror', 'Horror'),
  genreRow('movie', 878, 'Science Fiction', 'Sci-Fi'),
  genreRow('movie', 10749, 'Romance', 'Romance'),
  genreRow('movie', 80, 'Crime', 'Crime'),
  genreRow('movie', 18, 'Drama', 'Dramas'),
  genreRow('movie', 16, 'Animation', 'Animated Movies'),
  genreRow('movie', 10751, 'Family', 'Family Movie Night'),
  genreRow('movie', 99, 'Documentary', 'Documentaries'),
];

export const TV_ROWS = [
  row('trending', 'Trending Now', () => fetchTrending('tv_show', 'week'), { sort: 'popularity' }, { ranked: true }),
  row('new', 'New Series', () => fetchDiscover('tv_show', { ...dateParams('tv_show', daysAgoIso(120), todayIso()), 'vote_count.gte': '5' }), { sort: 'newest', releasedAfter: daysAgoIso(365) }),
  row('popular', 'Popular on binge.', () => fetchDiscover('tv_show', { 'vote_count.gte': '200' }), { sort: 'popularity' }),
  row('top-rated', 'Bingeworthy Classics', () => fetchDiscover('tv_show', { sort_by: 'vote_average.desc', 'vote_count.gte': '1500' }), { sort: 'rating' }),
  hiddenGemsRow('tv_show'),
  languageRow('tv_show', 'ko', 'K-Dramas', { with_genres: '18', 'vote_count.gte': '40' }, 'Drama'),
  languageRow('tv_show', 'ja', 'Anime Series', { with_genres: '16', 'vote_count.gte': '300' }, 'Animation'),
  languageRow('tv_show', 'zh', 'C-Dramas', { with_genres: '18' }, 'Drama'),
  languageRow('tv_show', 'es', 'Spanish-Language Series'),
  languageRow('tv_show', 'hi', 'Indian Series'),
  genreRow('tv_show', 10759, 'Action & Adventure', 'Action & Adventure'),
  genreRow('tv_show', 35, 'Comedy', 'Comedy Series'),
  genreRow('tv_show', 80, 'Crime', 'Crime TV'),
  genreRow('tv_show', 18, 'Drama', 'TV Dramas'),
  genreRow('tv_show', 10765, 'Sci-Fi & Fantasy', 'Sci-Fi & Fantasy'),
  genreRow('tv_show', 9648, 'Mystery', 'Mysteries'),
  genreRow('tv_show', 10764, 'Reality', 'Reality TV'),
  genreRow('tv_show', 99, 'Documentary', 'Docuseries'),
  genreRow('tv_show', 10762, 'Kids', 'Kids & Family'),
];

// Kids profiles get their own row set: every TMDB query is restricted to
// family/kids content (and US certification <= PG for movies), and the
// catalog fallback applies the same age_rating allowlist as the old pages.
function kidsRow(mediaType, id, title, params, fallback = {}) {
  return row(id, title, () => fetchDiscover(mediaType, {
    ...kidsParams(mediaType),
    ...dateParams(mediaType, null, todayIso()),
    'vote_count.gte': '30',
    ...params,
  }), fallback);
}

export const KIDS_MOVIE_ROWS = [
  kidsRow('movie', 'kids-popular', 'Popular with Kids', {}, { sort: 'popularity' }),
  kidsRow('movie', 'kids-animated', 'Animated Adventures', { with_genres: '16' }, { genre: 'Animation' }),
  kidsRow('movie', 'kids-new', 'New for Kids', dateParams('movie', daysAgoIso(365), todayIso()), { sort: 'newest' }),
  kidsRow('movie', 'kids-top', 'Family Favorites', { sort_by: 'vote_average.desc', 'vote_count.gte': '1000' }, { genre: 'Family' }),
  kidsRow('movie', 'kids-fantasy', 'Magic & Fantasy', { with_genres: '14' }, { genre: 'Fantasy' }),
  kidsRow('movie', 'kids-comedy', 'Laugh Out Loud', { with_genres: '35' }, { genre: 'Comedy' }),
];

export const KIDS_TV_ROWS = [
  kidsRow('tv_show', 'kids-popular', 'Popular with Kids', {}, { sort: 'popularity' }),
  kidsRow('tv_show', 'kids-animated', 'Cartoons', { with_genres: '10762,16' }, { genre: 'Animation' }),
  kidsRow('tv_show', 'kids-top', 'Family Favorites', { sort_by: 'vote_average.desc', 'vote_count.gte': '200' }, { genre: 'Family' }),
  kidsRow('tv_show', 'kids-new', 'New Episodes for Kids', dateParams('tv_show', daysAgoIso(365), todayIso()), { sort: 'newest' }),
];

export function rowsFor(mediaType, { kidsSafe = false } = {}) {
  if (kidsSafe) return mediaType === 'tv_show' ? KIDS_TV_ROWS : KIDS_MOVIE_ROWS;
  return mediaType === 'tv_show' ? TV_ROWS : MOVIE_ROWS;
}

// Order rows for a profile's taste: fixed headline rows first, then the
// language and genre rows they actually watch (strongest first), then the
// rest in their default order — "made for you" ordering rather than one
// fixed list for everyone.
export function orderRowsForTaste(rows, taste) {
  const genreRank = new Map((taste?.genres || []).map((genre, index) => [genre.toLowerCase(), index]));
  const languageRank = new Map((taste?.languages || []).map((language, index) => [language, index]));

  const headline = rows.filter((entry) => !entry.kind);
  const tasteRows = rows.filter((entry) => entry.kind);

  const scored = tasteRows.map((entry, index) => {
    let rank = 100 + index;
    if (entry.kind === 'language' && languageRank.has(entry.language) && entry.language !== 'en') {
      rank = languageRank.get(entry.language);
    } else if (entry.kind === 'genre' && genreRank.has(String(entry.genre).toLowerCase())) {
      rank = 10 + genreRank.get(String(entry.genre).toLowerCase());
    }
    return { entry, rank };
  });

  scored.sort((a, b) => a.rank - b.rank);
  // Keep the headline "Coming Soon" row below the first few taste rows so
  // the top of the page is all watchable-now.
  const comingSoon = headline.filter((entry) => entry.comingSoon);
  const rest = headline.filter((entry) => !entry.comingSoon);
  const tasteOrdered = scored.map(({ entry }) => entry);
  return [...rest, ...tasteOrdered.slice(0, 3), ...comingSoon, ...tasteOrdered.slice(3)];
}

export async function loadRowItems(definition, mediaType, { kidsSafe = false } = {}) {
  let items = [];

  if (definition.tmdb) {
    const results = await definition.tmdb();
    if (results) {
      items = await resolveTmdbItems(results, mediaType, { kidsSafe });
    }
  }

  if (items.length < MIN_ROW_ITEMS && definition.fallback) {
    const fallbackRows = await fetchCatalogBrowseRow(mediaType, { ...definition.fallback, kidsSafe, limit: 30 }).catch(() => []);
    const fallbackItems = prepareCatalogItems(fallbackRows, mediaType);
    const seen = new Set(items.map((item) => item.id));
    items = [...items, ...fallbackItems.filter((item) => !seen.has(item.id))];
  }

  if (definition.comingSoon) {
    items = items.filter((item) => item._comingSoon);
  }

  return items;
}

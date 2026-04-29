import { isSupabaseConfigured, supabase } from './supabase';
import { api } from '../api';

const MOVIE_COLUMNS = [
  'id',
  'title',
  'year',
  'genre',
  'director',
  'writers',
  'cast_members',
  'age_rating',
  'overview',
  'synopsis',
  'poster_url',
  'source_key',
  'external_id',
  'release_date',
  'imdb_id',
  'vote_average',
  'popularity',
  'rotten_tomatoes_score',
  'imdb_rating',
  'metacritic_score',
  'ratings_enriched_at',
].join(', ');

const MOVIE_BROWSE_COLUMNS = [
  'id',
  'title',
  'year',
  'genre',
  'director',
  'poster_url',
  'source_key',
  'external_id',
  'release_date',
  'imdb_id',
  'vote_average',
  'popularity',
  'rotten_tomatoes_score',
  'imdb_rating',
  'metacritic_score',
  'ratings_enriched_at',
].join(', ');

const TV_SHOW_COLUMNS = [
  'id',
  'title',
  'year',
  'genre',
  'creator',
  'writers',
  'cast_members',
  'age_rating',
  'overview',
  'synopsis',
  'poster_url',
  'seasons',
  'source_key',
  'external_id',
].join(', ');

const TV_SHOW_BROWSE_COLUMNS = [
  'id',
  'title',
  'year',
  'genre',
  'creator',
  'poster_url',
  'seasons',
  'source_key',
  'external_id',
].join(', ');

const BOOK_COLUMNS = [
  'id',
  'title',
  'author',
  'year',
  'genre',
  'synopsis',
  'cover_url',
  'item_url',
  'source_key',
].join(', ');

const DESCRIPTION_FALLBACK = 'No description available yet.';
const CURATED_MOVIE_GENRE_PREFERENCES = [
  'Action',
  'Drama',
  'Comedy',
  'Science Fiction',
  'Thriller',
  'Crime',
  'Animation',
  'Horror',
  'Romance',
  'Adventure',
];

const CURATED_TV_GENRE_PREFERENCES = [
  'Drama',
  'Crime',
  'Action & Adventure',
  'Comedy',
  'Sci-Fi & Fantasy',
  'Mystery',
  'Animation',
  'Reality',
  'Family',
  'Documentary',
];

const THIS_YEAR = new Date().getFullYear();

// Client-side cache for popular titles so we only call the API once per session
const _popularCache = {};

async function fetchPopularTitles(type) {
  if (_popularCache[type]) return _popularCache[type];
  try {
    const data = await api.get(`/media/popular-titles?type=${type}`);
    const titles = Array.isArray(data?.titles) ? data.titles : [];
    _popularCache[type] = titles;
    return titles;
  } catch {
    return [];
  }
}

// Build a Supabase OR filter string from a list of titles using ILIKE
function buildPopularOrFilter(titles) {
  if (!titles.length) return null;
  // Use word-boundary-style matching: wrap each title in %...% to handle slight variations
  return titles
    .slice(0, 40) // Supabase OR has a practical limit
    .map(t => `title.ilike.%${t.replace(/%/g, '')}%`)
    .join(',');
}

function requireSupabaseCatalog() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  return supabase;
}

function normalizeMovie(movie) {
  if (!movie) return null;

  return {
    ...movie,
    overview: movie.overview || movie.synopsis || DESCRIPTION_FALLBACK,
    synopsis: movie.synopsis || movie.overview || DESCRIPTION_FALLBACK,
    poster_url: movie.poster_url || null,
  };
}

function normalizeMovieBrowseEntry(movie) {
  if (!movie) return null;

  return {
    ...normalizeMovie(movie),
    _summary: true,
  };
}

function normalizeTvShow(show) {
  if (!show) return null;

  return {
    ...show,
    overview: show.overview || show.synopsis || DESCRIPTION_FALLBACK,
    synopsis: show.synopsis || show.overview || DESCRIPTION_FALLBACK,
    poster_url: show.poster_url || null,
    seasons: Number.isFinite(Number(show.seasons)) ? Number(show.seasons) : null,
  };
}

function normalizeTvShowBrowseEntry(show) {
  if (!show) return null;

  return {
    ...normalizeTvShow(show),
    _summary: true,
  };
}

function normalizeBook(book) {
  if (!book) return null;

  return {
    ...book,
    synopsis: book.synopsis || DESCRIPTION_FALLBACK,
    cover_url: book.cover_url || null,
    item_url: book.item_url || null,
  };
}

function normalizeSearchValue(value) {
  return String(value || '')
    .replace(/[,%_"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampPositiveInteger(value, fallback) {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return fallback;
  }

  return Math.floor(nextValue);
}

function shuffleItems(items) {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]];
  }

  return nextItems;
}

function buildTitleRankMap(titles = []) {
  const ranks = new Map();
  titles.forEach((title, index) => {
    const key = normalizeSearchValue(title).toLowerCase();
    if (key && !ranks.has(key)) {
      ranks.set(key, index);
    }
  });
  return ranks;
}

function sortItemsByTitleRank(items, titles = []) {
  const ranks = buildTitleRankMap(titles);
  if (!ranks.size) return shuffleItems(items);

  return [...items].sort((left, right) => {
    const leftRank = ranks.get(normalizeSearchValue(left?.title).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = ranks.get(normalizeSearchValue(right?.title).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left?.title || '').localeCompare(String(right?.title || ''));
  });
}

function buildIlikePattern(value) {
  const normalized = normalizeSearchValue(value)
    .split(' ')
    .filter(Boolean)
    .join('%');

  return normalized ? `%${normalized}%` : '';
}

function applyTitleGenreFilters(query, { search = '', genre = '' } = {}) {
  let nextQuery = query;
  const searchPattern = buildIlikePattern(search);

  if (searchPattern) {
    nextQuery = nextQuery.ilike('title', searchPattern);
  }

  if (genre) {
    nextQuery = nextQuery.ilike('genre', `%${normalizeSearchValue(genre)}%`);
  }

  return nextQuery;
}

function applyBookFilters(query, { search = '', genre = '' } = {}) {
  let nextQuery = query;
  const searchPattern = buildIlikePattern(search);

  if (searchPattern) {
    nextQuery = nextQuery.or(`title.ilike.${searchPattern},author.ilike.${searchPattern}`);
  }

  if (genre) {
    nextQuery = nextQuery.ilike('genre', `%${normalizeSearchValue(genre)}%`);
  }

  return nextQuery;
}

function applyBrowseSort(query, sortOrder = 'title-asc') {
  if (sortOrder === 'relevance' || sortOrder === 'popularity-desc') {
    // Best proxy for server-side relevance: popularity first, then recency, then title.
    // Used as a fallback when the API relevance endpoint is unavailable (e.g. Vercel timeout).
    return query
      .order('popularity', { ascending: false, nullsFirst: false })
      .order('year', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true });
  }

  if (sortOrder === 'year-desc') {
    return query
      .order('year', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true });
  }

  if (sortOrder === 'year-asc') {
    return query
      .order('year', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true });
  }

  if (sortOrder === 'title-desc') {
    return query.order('title', { ascending: false });
  }

  return query.order('title', { ascending: true });
}

function pickCuratedGenres(allGenres, preferredGenres, max = 6) {
  const selected = [];

  for (const preferredGenre of preferredGenres) {
    if (allGenres.includes(preferredGenre) && !selected.includes(preferredGenre)) {
      selected.push(preferredGenre);
    }

    if (selected.length >= max) {
      return selected;
    }
  }

  for (const genre of allGenres) {
    if (!selected.includes(genre)) {
      selected.push(genre);
    }

    if (selected.length >= max) {
      return selected;
    }
  }

  return selected;
}

async function fetchGenreValues(viewName) {
  const client = requireSupabaseCatalog();
  const { data, error } = await client
    .from(viewName)
    .select('genre')
    .order('genre', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || [])
    .map((row) => row.genre)
    .filter(Boolean);
}

export async function fetchSupabaseMovieGenres() {
  return fetchGenreValues('movie_genres');
}

export async function fetchSupabaseTvShowGenres() {
  return fetchGenreValues('tv_show_genres');
}

export async function fetchSupabaseBookGenres() {
  return fetchGenreValues('book_genres');
}

export async function fetchSupabaseMovieCatalogSegment({
  offset = 0,
  limit = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
  includeCount = true,
  includeFacets = true,
  includeUpcoming = false,
} = {}) {
  const client = requireSupabaseCatalog();

  let moviesQuery = client
    .from('movies')
    .select(MOVIE_BROWSE_COLUMNS, includeCount ? { count: 'exact' } : undefined);

  moviesQuery = applyTitleGenreFilters(moviesQuery, { search, genre });
  // Hide future releases from browse unless explicitly requested (e.g. upcoming sort)
  if (!includeUpcoming) {
    moviesQuery = moviesQuery.lte('year', THIS_YEAR);
  }
  moviesQuery = applyBrowseSort(moviesQuery, sortOrder);

  const tasks = [
    moviesQuery.range(offset, offset + limit - 1),
  ];

  if (includeFacets) {
    tasks.push(fetchSupabaseMovieGenres().catch(() => []));
  }

  const [movieResult, genres = []] = await Promise.all(tasks);

  if (movieResult.error) {
    throw movieResult.error;
  }

  return {
    items: (movieResult.data || []).map((movie) => normalizeMovieBrowseEntry(movie)),
    total: movieResult.count == null ? null : Number(movieResult.count),
    facets: { genres },
  };
}

export async function fetchSupabaseMoviesPage({
  page = 1,
  pageSize = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const offset = Math.max(0, (page - 1) * pageSize);
  const segment = await fetchSupabaseMovieCatalogSegment({
    offset,
    limit: pageSize,
    search,
    genre,
    sortOrder,
    includeCount: true,
    includeFacets: true,
  });
  const items = segment.items;
  const total = segment.total ?? items.length;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: segment.facets,
  };
}

export async function fetchSupabaseMovieById(movieId) {
  const client = requireSupabaseCatalog();
  const { data, error } = await client
    .from('movies')
    .select(MOVIE_COLUMNS)
    .eq('id', movieId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeMovie(data);
}

export async function fetchSupabaseRandomMoviePosters({
  count = 4,
  sampleWindow = 32,
} = {}) {
  const client = requireSupabaseCatalog();
  const desiredCount = clampPositiveInteger(count, 4);
  const desiredSampleWindow = clampPositiveInteger(sampleWindow, 32);

  const { count: totalWithPosters, error: countError } = await client
    .from('movies')
    .select('id', { count: 'exact', head: true })
    .not('poster_url', 'is', null)
    .neq('poster_url', '');

  if (countError) {
    throw countError;
  }

  const total = Number(totalWithPosters) || 0;
  if (total === 0) {
    return [];
  }

  const rangeSize = Math.max(desiredCount, Math.min(desiredSampleWindow, total));
  const maxOffset = Math.max(0, total - rangeSize);
  const offset = maxOffset > 0
    ? Math.floor(Math.random() * (maxOffset + 1))
    : 0;

  const { data, error } = await client
    .from('movies')
    .select(MOVIE_BROWSE_COLUMNS)
    .not('poster_url', 'is', null)
    .neq('poster_url', '')
    .order('title', { ascending: true })
    .range(offset, offset + rangeSize - 1);

  if (error) {
    throw error;
  }

  return shuffleItems((data || []).map((movie) => normalizeMovieBrowseEntry(movie)))
    .slice(0, desiredCount);
}

export async function fetchSupabaseMovieCuratedRows() {
  const client = requireSupabaseCatalog();
  const [genres, popularTitles] = await Promise.all([
    fetchSupabaseMovieGenres(),
    fetchPopularTitles('movie'),
  ]);
  const curatedGenres = pickCuratedGenres(genres, CURATED_MOVIE_GENRE_PREFERENCES);
  const popularFilter = buildPopularOrFilter(popularTitles);

  // Featured row: popular known titles if available, otherwise recent
  let featuredQuery = client
    .from('movies')
    .select(MOVIE_COLUMNS)
    .not('poster_url', 'is', null)
    .lte('year', THIS_YEAR);
  if (popularFilter) {
    featuredQuery = featuredQuery.or(popularFilter);
  }
  featuredQuery = featuredQuery.order('title', { ascending: true }).limit(24);

  const [featuredResult, upcomingResult, ...genreResults] = await Promise.all([
    featuredQuery,
    client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .not('poster_url', 'is', null)
      .gt('year', THIS_YEAR)
      .order('year', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(12),
    ...curatedGenres.map((genre) => client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .ilike('genre', `%${genre}%`)
      .not('poster_url', 'is', null)
      .lte('year', THIS_YEAR)
      .order('title', { ascending: true })
      .limit(30)),
  ]);

  if (featuredResult.error) throw featuredResult.error;

  const rows = [
    {
      id: 'featured',
      title: 'Featured Picks',
      seeAll: '/movies?sort=relevance',
      items: sortItemsByTitleRank((featuredResult.data || []).map((movie) => normalizeMovie(movie)), popularTitles),
    },
  ];

  genreResults.forEach((result, index) => {
    if (result.error) throw result.error;

    const genre = curatedGenres[index];
    const items = shuffleItems((result.data || []).map((movie) => normalizeMovie(movie)));

    if (genre && items.length > 0) {
      rows.push({
        id: `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: genre,
        seeAll: `/movies?genre=${encodeURIComponent(genre)}`,
        items,
      });
    }
  });

  // Upcoming releases — always last
  const upcomingItems = (upcomingResult.data || []).map((movie) => normalizeMovie(movie));
  if (upcomingItems.length > 0) {
    rows.push({
      id: 'upcoming',
      title: 'Upcoming Releases',
      seeAll: '/movies?sort=year-asc',
      items: upcomingItems,
    });
  }

  return rows.filter((row) => row.items.length > 0);
}

export async function fetchSupabaseTvShowsPage({
  page = 1,
  pageSize = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const offset = Math.max(0, (page - 1) * pageSize);
  const segment = await fetchSupabaseTvShowCatalogSegment({
    offset,
    limit: pageSize,
    search,
    genre,
    sortOrder,
    includeCount: true,
    includeFacets: true,
  });
  const items = segment.items;
  const total = segment.total ?? items.length;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: segment.facets,
  };
}

export async function fetchSupabaseTvShowCatalogSegment({
  offset = 0,
  limit = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
  includeCount = true,
  includeFacets = true,
  includeUpcoming = false,
} = {}) {
  const client = requireSupabaseCatalog();

  let showsQuery = client
    .from('tv_shows')
    .select(TV_SHOW_BROWSE_COLUMNS, includeCount ? { count: 'exact' } : undefined);

  showsQuery = applyTitleGenreFilters(showsQuery, { search, genre });
  if (!includeUpcoming) {
    showsQuery = showsQuery.lte('year', THIS_YEAR);
  }
  showsQuery = applyBrowseSort(showsQuery, sortOrder);

  const tasks = [
    showsQuery.range(offset, offset + limit - 1),
  ];

  if (includeFacets) {
    tasks.push(fetchSupabaseTvShowGenres().catch(() => []));
  }

  const [showResult, genres = []] = await Promise.all(tasks);

  if (showResult.error) {
    throw showResult.error;
  }

  return {
    items: (showResult.data || []).map((show) => normalizeTvShowBrowseEntry(show)),
    total: showResult.count == null ? null : Number(showResult.count),
    facets: { genres },
  };
}

export async function fetchSupabaseTvShowById(showId) {
  const client = requireSupabaseCatalog();
  const { data, error } = await client
    .from('tv_shows')
    .select(TV_SHOW_COLUMNS)
    .eq('id', showId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeTvShow(data);
}

export async function fetchSupabaseTvShowCuratedRows() {
  const client = requireSupabaseCatalog();
  const [genres, popularTitles] = await Promise.all([
    fetchSupabaseTvShowGenres(),
    fetchPopularTitles('tv'),
  ]);
  const curatedGenres = pickCuratedGenres(genres, CURATED_TV_GENRE_PREFERENCES);
  const popularFilter = buildPopularOrFilter(popularTitles);

  let featuredQuery = client
    .from('tv_shows')
    .select(TV_SHOW_COLUMNS)
    .not('poster_url', 'is', null)
    .lte('year', THIS_YEAR);
  if (popularFilter) {
    featuredQuery = featuredQuery.or(popularFilter);
  }
  featuredQuery = featuredQuery.order('title', { ascending: true }).limit(24);

  const [featuredResult, upcomingResult, ...genreResults] = await Promise.all([
    featuredQuery,
    client
      .from('tv_shows')
      .select(TV_SHOW_COLUMNS)
      .not('poster_url', 'is', null)
      .gt('year', THIS_YEAR)
      .order('year', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(12),
    ...curatedGenres.map((genre) => client
      .from('tv_shows')
      .select(TV_SHOW_COLUMNS)
      .ilike('genre', `%${normalizeSearchValue(genre)}%`)
      .not('poster_url', 'is', null)
      .lte('year', THIS_YEAR)
      .order('title', { ascending: true })
      .limit(30)),
  ]);

  if (featuredResult.error) throw featuredResult.error;

  const rows = [
    {
      id: 'featured',
      title: 'Featured Series',
      seeAll: '/tv-shows?sort=relevance',
      items: sortItemsByTitleRank((featuredResult.data || []).map((show) => normalizeTvShow(show)), popularTitles),
    },
  ];

  genreResults.forEach((result, index) => {
    if (result.error) throw result.error;

    const genre = curatedGenres[index];
    const items = shuffleItems((result.data || []).map((show) => normalizeTvShow(show)));

    if (genre && items.length > 0) {
      rows.push({
        id: `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: genre,
        seeAll: `/tv-shows?genre=${encodeURIComponent(genre)}`,
        items,
      });
    }
  });

  // Upcoming — always last
  const upcomingItems = (upcomingResult.data || []).map((show) => normalizeTvShow(show));
  if (upcomingItems.length > 0) {
    rows.push({
      id: 'upcoming',
      title: 'Upcoming Releases',
      seeAll: '/tv-shows?sort=year-asc',
      items: upcomingItems,
    });
  }

  return rows.filter((row) => row.items.length > 0);
}

export async function fetchSupabaseBooksPage({
  page = 1,
  pageSize = 24,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const client = requireSupabaseCatalog();
  const offset = Math.max(0, (page - 1) * pageSize);

  let booksQuery = client
    .from('books')
    .select(BOOK_COLUMNS, { count: 'exact' });

  booksQuery = applyBookFilters(booksQuery, { search, genre });
  booksQuery = applyBrowseSort(booksQuery, sortOrder);

  const [bookResult, genres] = await Promise.all([
    booksQuery.range(offset, offset + pageSize - 1),
    fetchSupabaseBookGenres().catch(() => []),
  ]);

  if (bookResult.error) {
    throw bookResult.error;
  }

  const items = (bookResult.data || []).map((book) => normalizeBook(book));
  const total = Number(bookResult.count) || items.length;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: { genres },
  };
}

export async function fetchSupabaseBookById(bookId) {
  const client = requireSupabaseCatalog();
  const { data, error } = await client
    .from('books')
    .select(BOOK_COLUMNS)
    .eq('id', bookId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeBook(data);
}

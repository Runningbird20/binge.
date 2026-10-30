import { isSupabaseConfigured, supabase } from './supabase';
import { api } from '../api';
import { ratingsFor } from './kidsMode';
import { comingSoonCutoffIso } from './releaseWindow';

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
  'original_language',
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
  'original_language',
  'age_rating',
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
  'original_language',
  'popularity',
  'vote_average',
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
  'original_language',
  'popularity',
  'vote_average',
  'age_rating',
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

// Stored TMDB popularity is gamed by crawler spikes on unrated softcore
// titles (e.g. "Siren" 2004 sat in the top 10 with a 4.5 score and no age
// rating). Popularity-sorted views require a real age rating or a decent
// score; TMDB-driven rows instead filter on vote counts.
const QUALITY_GATE = 'age_rating.not.is.null,vote_average.gte.6';


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

function applyGenreFilter(query, genre) {
  const values = (Array.isArray(genre) ? genre : [genre]).filter(Boolean);

  if (values.length === 0) {
    return query;
  }

  if (values.length === 1) {
    return query.ilike('genre', `%${normalizeSearchValue(values[0])}%`);
  }

  return query.or(
    values.map((value) => `genre.ilike.%${normalizeSearchValue(value)}%`).join(',')
  );
}

function applyTitleGenreFilters(query, { search = '', genre = '' } = {}) {
  let nextQuery = query;
  const searchPattern = buildIlikePattern(search);

  if (searchPattern) {
    nextQuery = nextQuery.ilike('title', searchPattern);
  }

  return applyGenreFilter(nextQuery, genre);
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
  if (sortOrder === 'popularity-desc') {
    return query
      .order('popularity', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true });
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

export async function fetchMovieGenres() {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const data = await api.get('/media/movies/genres');
      return Array.isArray(data?.genres) ? data.genres : [];
    } catch {
      return [];
    }
  }
  return fetchGenreValues('movie_genres');
}

export async function fetchTvShowGenres() {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const data = await api.get('/media/tv-shows/genres');
      return Array.isArray(data?.genres) ? data.genres : [];
    } catch {
      return [];
    }
  }
  return fetchGenreValues('tv_show_genres');
}

export async function fetchBookGenres() {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const data = await api.get('/media/books/genres');
      return Array.isArray(data?.genres) ? data.genres : [];
    } catch {
      return [];
    }
  }
  return fetchGenreValues('book_genres');
}

export async function fetchMovieCatalogSegment({
  offset = 0,
  limit = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
  includeCount = true,
  includeFacets = true,
  includeUpcoming = false,
  kidsSafe = false,
} = {}) {
  if (!isSupabaseConfigured || !supabase) {
    const pageNum = Math.floor(offset / limit) + 1;
    const params = new URLSearchParams({
      page: String(pageNum),
      page_size: String(limit),
      sort: sortOrder || 'title-asc',
    });
    if (search) params.set('search', search);
    if (Array.isArray(genre) && genre[0]) params.set('genre', genre[0]);
    else if (typeof genre === 'string' && genre) params.set('genre', genre);
    try {
      const data = await api.get(`/media/movies?${params.toString()}`);
      return {
        items: (data?.items || data || []).map((movie) => normalizeMovieBrowseEntry(movie)),
        total: data?.total != null ? Number(data.total) : null,
        facets: { genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [] },
      };
    } catch {
      return { items: [], total: 0, facets: { genres: [] } };
    }
  }

  const client = requireSupabaseCatalog();

  let moviesQuery = client
    .from('movies')
    .select(MOVIE_BROWSE_COLUMNS, includeCount ? { count: 'estimated' } : undefined);

  moviesQuery = applyTitleGenreFilters(moviesQuery, { search, genre });
  // Hide future releases from browse unless explicitly requested (e.g.
  // upcoming sort); anything more than 30 days out is hidden either way.
  if (!includeUpcoming) {
    moviesQuery = moviesQuery.lte('year', THIS_YEAR);
  }
  moviesQuery = moviesQuery.or(`release_date.is.null,release_date.lte.${comingSoonCutoffIso()}`);
  if (kidsSafe) {
    moviesQuery = moviesQuery.in('age_rating', ratingsFor(kidsSafe));
  }
  // The popularity index is partial on poster_url (see the streaming
  // redesign migration); filtering the same way lets the sort use it.
  if (sortOrder === 'popularity-desc') {
    moviesQuery = moviesQuery.not('poster_url', 'is', null).or(QUALITY_GATE);
  }
  moviesQuery = applyBrowseSort(moviesQuery, sortOrder);

  const tasks = [
    moviesQuery.range(offset, offset + limit - 1),
  ];

  if (includeFacets) {
    tasks.push(fetchMovieGenres().catch(() => []));
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

export async function fetchMoviesPage({
  page = 1,
  pageSize = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const offset = Math.max(0, (page - 1) * pageSize);
  const segment = await fetchMovieCatalogSegment({
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

export async function fetchMovieById(movieId) {
  if (!isSupabaseConfigured || !supabase) {
    const data = await api.get(`/media/movies/${movieId}`);
    return normalizeMovie(data);
  }

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

export async function fetchMovieCuratedRows() {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const data = await api.get('/media/movies/curated');
      if (Array.isArray(data?.rows) && data.rows.length > 0) {
        return data.rows.map((row) => ({
          ...row,
          items: (row.items || []).map((m) => normalizeMovie(m)),
        }));
      }
      const pageData = await api.get('/media/movies?page=1&page_size=24');
      const items = (pageData?.items || pageData || []).map((m) => normalizeMovie(m));
      return items.length > 0
        ? [{ id: 'popular', title: 'Popular Movies', items }]
        : [];
    } catch {
      return [];
    }
  }

  const client = requireSupabaseCatalog();
  const [genres, popularTitles] = await Promise.all([
    fetchMovieGenres(),
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

export async function fetchTvShowsPage({
  page = 1,
  pageSize = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const offset = Math.max(0, (page - 1) * pageSize);
  const segment = await fetchTvShowCatalogSegment({
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

export async function fetchTvShowCatalogSegment({
  offset = 0,
  limit = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
  includeCount = true,
  includeFacets = true,
  includeUpcoming = false,
  kidsSafe = false,
} = {}) {
  if (!isSupabaseConfigured || !supabase) {
    const pageNum = Math.floor(offset / limit) + 1;
    const params = new URLSearchParams({
      page: String(pageNum),
      page_size: String(limit),
      sort: sortOrder || 'title-asc',
    });
    if (search) params.set('search', search);
    if (Array.isArray(genre) && genre[0]) params.set('genre', genre[0]);
    else if (typeof genre === 'string' && genre) params.set('genre', genre);
    try {
      const data = await api.get(`/media/tv-shows?${params.toString()}`);
      return {
        items: (data?.items || data || []).map((show) => normalizeTvShowBrowseEntry(show)),
        total: data?.total != null ? Number(data.total) : null,
        facets: { genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [] },
      };
    } catch {
      return { items: [], total: 0, facets: { genres: [] } };
    }
  }

  const client = requireSupabaseCatalog();

  const effectiveSort = sortOrder === 'relevance' ? 'popularity-desc' : sortOrder;

  let showsQuery = client
    .from('tv_shows')
    .select(TV_SHOW_BROWSE_COLUMNS, includeCount ? { count: 'estimated' } : undefined);

  showsQuery = applyTitleGenreFilters(showsQuery, { search, genre });
  if (!includeUpcoming) {
    showsQuery = showsQuery.lte('year', THIS_YEAR);
  }
  if (kidsSafe) {
    showsQuery = showsQuery.in('age_rating', ratingsFor(kidsSafe));
  }
  if (effectiveSort === 'popularity-desc') {
    showsQuery = showsQuery.not('poster_url', 'is', null).or(QUALITY_GATE);
  }
  showsQuery = applyBrowseSort(showsQuery, effectiveSort);

  const tasks = [
    showsQuery.range(offset, offset + limit - 1),
  ];

  if (includeFacets) {
    tasks.push(fetchTvShowGenres().catch(() => []));
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

export async function fetchTvShowById(showId) {
  if (!isSupabaseConfigured || !supabase) {
    const data = await api.get(`/media/tv-shows/${showId}`);
    return normalizeTvShow(data);
  }

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

export async function fetchTvShowCuratedRows() {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const data = await api.get('/media/tv-shows/curated');
      if (Array.isArray(data?.rows) && data.rows.length > 0) {
        return data.rows.map((row) => ({
          ...row,
          items: (row.items || []).map((s) => normalizeTvShow(s)),
        }));
      }
      const pageData = await api.get('/media/tv-shows?page=1&page_size=24');
      const items = (pageData?.items || pageData || []).map((s) => normalizeTvShow(s));
      return items.length > 0
        ? [{ id: 'popular', title: 'Popular Series', items }]
        : [];
    } catch {
      return [];
    }
  }

  const client = requireSupabaseCatalog();
  const [genres, popularTitles] = await Promise.all([
    fetchTvShowGenres(),
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

export async function fetchBooksPage({
  page = 1,
  pageSize = 24,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  if (!isSupabaseConfigured || !supabase) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort: sortOrder || 'title-asc',
    });
    if (search) params.set('search', search);
    if (genre) params.set('genre', genre);
    try {
      const data = await api.get(`/media/books?${params.toString()}`);
      return {
        items: (data?.items || data || []).map((book) => normalizeBook(book)),
        total: Number(data?.total) || 0,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil((Number(data?.total) || 0) / pageSize)),
        facets: { genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [] },
      };
    } catch {
      return { items: [], total: 0, page, pageSize, totalPages: 1, facets: { genres: [] } };
    }
  }

  const client = requireSupabaseCatalog();
  const offset = Math.max(0, (page - 1) * pageSize);

  let booksQuery = client
    .from('books')
    .select(BOOK_COLUMNS, { count: 'exact' });

  booksQuery = applyBookFilters(booksQuery, { search, genre });
  booksQuery = applyBrowseSort(booksQuery, sortOrder);

  const [bookResult, genres] = await Promise.all([
    booksQuery.range(offset, offset + pageSize - 1),
    fetchBookGenres().catch(() => []),
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

export async function fetchBookById(bookId) {
  if (!isSupabaseConfigured || !supabase) {
    const data = await api.get(`/media/books/${bookId}`);
    return normalizeBook(data);
  }

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

const RECOMMENDATION_SAMPLE_SOURCES = {
  movie: { table: 'movies', columns: MOVIE_BROWSE_COLUMNS, normalize: normalizeMovieBrowseEntry, filterReleased: true },
  tv_show: { table: 'tv_shows', columns: TV_SHOW_BROWSE_COLUMNS, normalize: normalizeTvShowBrowseEntry, filterReleased: true },
  book: { table: 'books', columns: BOOK_COLUMNS, normalize: normalizeBook, filterReleased: false },
};

// The planner's row estimate for a `genre ilike` filter is unreliable (it
// reported ~240 Drama movies), so genre-filtered samples pick an offset from
// this fixed range and step back toward 0 if it overshoots.
const GENRE_SAMPLE_MAX_OFFSET = 1500;
// An unsorted OFFSET still scans every skipped row, so very deep offsets into
// the 100k+ row tables run past the statement timeout.
const SAMPLE_MAX_OFFSET = 20000;

// Random catalog window for the recommender, built to stay under the
// database's statement timeout on the large catalog tables: no `count: 'exact'`
// (times out on every table) and no ORDER BY (a sorted genre-filtered scan
// also times out). The browse fetchers above need both, so they can't be
// reused here. Never throws — a failed sample just contributes no candidates.
export async function sampleCatalogForRecommendations(mediaType, { genre = '', limit = 60, kidsSafe = false } = {}) {
  const source = RECOMMENDATION_SAMPLE_SOURCES[mediaType];
  if (!source) return [];

  if (!isSupabaseConfigured || !supabase) {
    try {
      const endpoint = mediaType === 'tv_show' ? '/media/tv-shows' : mediaType === 'book' ? '/media/books' : '/media/movies';
      const params = new URLSearchParams({ page: '1', page_size: String(limit) });
      if (genre) params.set('genre', genre);
      if (kidsSafe) params.set('kids_safe', '1');
      const data = await api.get(`${endpoint}?${params.toString()}`);
      return (data?.items || data || []).map((item) => source.normalize(item));
    } catch {
      return [];
    }
  }

  const client = requireSupabaseCatalog();

  function applyFilters(query) {
    let nextQuery = applyGenreFilter(query, genre);
    if (source.filterReleased) {
      nextQuery = nextQuery.lte('year', THIS_YEAR);
      if (kidsSafe) {
        nextQuery = nextQuery.in('age_rating', ratingsFor(kidsSafe));
      }
    }
    return nextQuery;
  }

  let maxOffset = GENRE_SAMPLE_MAX_OFFSET;
  if (!genre) {
    const { count } = await applyFilters(
      client.from(source.table).select('id', { count: 'planned', head: true })
    ).then((result) => result, () => ({ count: null }));
    maxOffset = Math.min(SAMPLE_MAX_OFFSET, Math.max(0, (Number(count) || 0) - limit));
  }

  const offset = Math.floor(Math.random() * (maxOffset + 1));
  const offsets = [...new Set([offset, Math.floor(offset / 8), 0])];

  for (const nextOffset of offsets) {
    const { data, error } = await applyFilters(client.from(source.table).select(source.columns))
      .range(nextOffset, nextOffset + limit - 1)
      .then((result) => result, () => ({ data: null, error: true }));
    if (!error && data?.length) {
      return data.map((item) => source.normalize(item));
    }
  }

  return [];
}

const BROWSE_SOURCES = {
  movie: { table: 'movies', columns: MOVIE_BROWSE_COLUMNS, normalize: normalizeMovieBrowseEntry },
  tv_show: { table: 'tv_shows', columns: TV_SHOW_BROWSE_COLUMNS, normalize: normalizeTvShowBrowseEntry },
};

// Catalog rows for a batch of TMDB ids (via the unique source_key index).
// Used to turn TMDB trending/discover/recommendation lists into titles the
// app can actually open. Returns a Map of tmdbId -> catalog item.
export async function fetchCatalogByTmdbIds(mediaType, tmdbIds = []) {
  const source = BROWSE_SOURCES[mediaType];
  const ids = [...new Set(tmdbIds.filter((id) => Number.isFinite(Number(id))))];
  if (!source || ids.length === 0) return new Map();

  if (!isSupabaseConfigured || !supabase) {
    try {
      const out = new Map();
      const chunks = [];
      for (let index = 0; index < ids.length; index += 80) chunks.push(ids.slice(index, index + 80));

      await Promise.all(chunks.map(async (chunk) => {
        const data = await api.get(`/media/by-tmdb-ids?type=${mediaType}&ids=${chunk.join(',')}`);
        const items = data?.items || [];
        items.forEach((row) => {
          const tmdbId = Number(String(row.source_key).split(':')[2]);
          if (tmdbId) out.set(tmdbId, source.normalize(row));
        });
      }));

      return out;
    } catch {
      return new Map();
    }
  }

  const kind = mediaType === 'tv_show' ? 'tv' : 'movie';
  const client = requireSupabaseCatalog();
  const out = new Map();

  // PostgREST puts .in() values in the URL, so chunk to keep it short.
  const chunks = [];
  for (let index = 0; index < ids.length; index += 80) chunks.push(ids.slice(index, index + 80));

  await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await client
      .from(source.table)
      .select(source.columns)
      .in('source_key', chunk.map((id) => `tmdb:${kind}:${id}`));
    if (error) return;
    (data || []).forEach((row) => {
      const tmdbId = Number(String(row.source_key).split(':')[2]);
      if (tmdbId) out.set(tmdbId, source.normalize(row));
    });
  }));

  return out;
}

// Database-only browse row, sorted by the stored popularity / rating /
// release columns. The fallback when TMDB is unreachable, and the primary
// source for filters TMDB can't express against our catalog. Backed by the
// idx_*_popularity_poster / idx_*_lang_popularity indexes.
export async function fetchCatalogBrowseRow(mediaType, {
  genre = '',
  language = '',
  sort = 'popularity',
  releasedAfter = '',
  limit = 30,
  kidsSafe = false,
} = {}) {
  const source = BROWSE_SOURCES[mediaType];
  if (!source) return [];

  if (!isSupabaseConfigured || !supabase) {
    try {
      const endpoint = mediaType === 'tv_show' ? '/media/tv-shows' : '/media/movies';
      const params = new URLSearchParams({ page: '1', page_size: String(limit) });
      if (genre) params.set('genre', genre);
      if (sort) params.set('sort', sort);
      if (kidsSafe) params.set('kids_safe', '1');
      const data = await api.get(`${endpoint}?${params.toString()}`);
      return (data?.items || data || []).map((row) => source.normalize(row));
    } catch {
      return [];
    }
  }

  const client = requireSupabaseCatalog();
  const today = new Date().toISOString().slice(0, 10);

  let query = client
    .from(source.table)
    .select(source.columns)
    .not('poster_url', 'is', null)
    .not('source_key', 'is', null);

  query = applyGenreFilter(query, genre);
  if (language) query = query.eq('original_language', language);
  if (kidsSafe) query = query.in('age_rating', ratingsFor(kidsSafe));
  else query = query.or(QUALITY_GATE);

  if (mediaType === 'movie') {
    query = query.lte('release_date', today);
    if (releasedAfter) query = query.gte('release_date', releasedAfter);
  } else {
    query = query.lte('year', THIS_YEAR);
    if (releasedAfter) query = query.gte('year', Number(releasedAfter.slice(0, 4)));
  }

  if (sort === 'rating') {
    // vote_average alone favors obscure 10/10s with three votes; requiring
    // some popularity keeps "Top Rated" to titles people have heard of.
    query = query.gte('popularity', 8).order('vote_average', { ascending: false, nullsFirst: false });
  } else if (sort === 'newest') {
    query = mediaType === 'movie'
      ? query.order('release_date', { ascending: false, nullsFirst: false })
      : query.order('year', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('popularity', { ascending: false, nullsFirst: false });
  }

  const { data, error } = await query.limit(limit);
  if (error) return [];
  return (data || []).map((row) => source.normalize(row));
}

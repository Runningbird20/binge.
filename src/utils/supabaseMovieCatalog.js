import { isSupabaseConfigured, supabase } from './supabase';

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
  'Comedy',
  'Drama',
  'Science Fiction',
  'Thriller',
  'Animation',
  'Family',
  'Horror',
];

const CURATED_TV_GENRE_PREFERENCES = [
  'Drama',
  'Action & Adventure',
  'Comedy',
  'Crime',
  'Sci-Fi & Fantasy',
  'Mystery',
  'Animation',
  'Family',
];

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

function pickCuratedGenres(allGenres, preferredGenres) {
  const selected = [];

  for (const preferredGenre of preferredGenres) {
    if (allGenres.includes(preferredGenre) && !selected.includes(preferredGenre)) {
      selected.push(preferredGenre);
    }

    if (selected.length >= 4) {
      return selected;
    }
  }

  for (const genre of allGenres) {
    if (!selected.includes(genre)) {
      selected.push(genre);
    }

    if (selected.length >= 4) {
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

export async function fetchSupabaseMoviesPage({
  page = 1,
  pageSize = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const client = requireSupabaseCatalog();
  const offset = Math.max(0, (page - 1) * pageSize);

  let moviesQuery = client
    .from('movies')
    .select(MOVIE_COLUMNS, { count: 'exact' });

  moviesQuery = applyTitleGenreFilters(moviesQuery, { search, genre });
  moviesQuery = applyBrowseSort(moviesQuery, sortOrder);

  const [movieResult, genres] = await Promise.all([
    moviesQuery.range(offset, offset + pageSize - 1),
    fetchSupabaseMovieGenres().catch(() => []),
  ]);

  if (movieResult.error) {
    throw movieResult.error;
  }

  const items = (movieResult.data || []).map((movie) => normalizeMovie(movie));
  const total = Number(movieResult.count) || items.length;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: { genres },
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

export async function fetchSupabaseMovieCuratedRows() {
  const client = requireSupabaseCatalog();
  const genres = await fetchSupabaseMovieGenres();
  const curatedGenres = pickCuratedGenres(genres, CURATED_MOVIE_GENRE_PREFERENCES);

  const [featuredResult, ...genreResults] = await Promise.all([
    client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .not('poster_url', 'is', null)
      .order('year', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(12),
    ...curatedGenres.map((genre) => client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .ilike('genre', `%${genre}%`)
      .not('poster_url', 'is', null)
      .order('year', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(12)),
  ]);

  if (featuredResult.error) {
    throw featuredResult.error;
  }

  const rows = [
    {
      id: 'featured',
      title: 'Featured Picks',
      seeAll: '/movies?sort=year-desc',
      items: (featuredResult.data || []).map((movie) => normalizeMovie(movie)),
    },
  ];

  genreResults.forEach((result, index) => {
    if (result.error) {
      throw result.error;
    }

    const genre = curatedGenres[index];
    const items = (result.data || []).map((movie) => normalizeMovie(movie));

    if (genre && items.length > 0) {
      rows.push({
        id: `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: genre,
        seeAll: `/movies?genre=${encodeURIComponent(genre)}`,
        items,
      });
    }
  });

  return rows.filter((row) => row.items.length > 0);
}

export async function fetchSupabaseTvShowsPage({
  page = 1,
  pageSize = 48,
  search = '',
  genre = '',
  sortOrder = 'title-asc',
} = {}) {
  const client = requireSupabaseCatalog();
  const offset = Math.max(0, (page - 1) * pageSize);

  let showsQuery = client
    .from('tv_shows')
    .select(TV_SHOW_COLUMNS, { count: 'exact' });

  showsQuery = applyTitleGenreFilters(showsQuery, { search, genre });
  showsQuery = applyBrowseSort(showsQuery, sortOrder);

  const [showResult, genres] = await Promise.all([
    showsQuery.range(offset, offset + pageSize - 1),
    fetchSupabaseTvShowGenres().catch(() => []),
  ]);

  if (showResult.error) {
    throw showResult.error;
  }

  const items = (showResult.data || []).map((show) => normalizeTvShow(show));
  const total = Number(showResult.count) || items.length;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
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
  const genres = await fetchSupabaseTvShowGenres();
  const curatedGenres = pickCuratedGenres(genres, CURATED_TV_GENRE_PREFERENCES);

  const [featuredResult, ...genreResults] = await Promise.all([
    client
      .from('tv_shows')
      .select(TV_SHOW_COLUMNS)
      .not('poster_url', 'is', null)
      .order('year', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(12),
    ...curatedGenres.map((genre) => client
      .from('tv_shows')
      .select(TV_SHOW_COLUMNS)
      .ilike('genre', `%${normalizeSearchValue(genre)}%`)
      .not('poster_url', 'is', null)
      .order('year', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(12)),
  ]);

  if (featuredResult.error) {
    throw featuredResult.error;
  }

  const rows = [
    {
      id: 'featured',
      title: 'Featured Series',
      seeAll: '/tv-shows?sort=year-desc',
      items: (featuredResult.data || []).map((show) => normalizeTvShow(show)),
    },
  ];

  genreResults.forEach((result, index) => {
    if (result.error) {
      throw result.error;
    }

    const genre = curatedGenres[index];
    const items = (result.data || []).map((show) => normalizeTvShow(show));

    if (genre && items.length > 0) {
      rows.push({
        id: `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: genre,
        seeAll: `/tv-shows?genre=${encodeURIComponent(genre)}`,
        items,
      });
    }
  });

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

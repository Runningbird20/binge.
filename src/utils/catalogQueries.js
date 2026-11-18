import { isSupabaseConfigured, supabase } from './supabase';
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

const DESCRIPTION_FALLBACK = 'No description available yet.';

const THIS_YEAR = new Date().getFullYear();

// Stored TMDB popularity is gamed by crawler spikes on unrated softcore
// titles (e.g. "Siren" 2004 sat in the top 10 with a 4.5 score and no age
// rating). Popularity-sorted views require a real age rating or a decent
// score; TMDB-driven rows instead filter on vote counts.
const QUALITY_GATE = 'age_rating.not.is.null,vote_average.gte.6';

// The catalog is reached through the split client (/api/catalog on Turso);
// there is no second path. Without Supabase configured, reads throw here,
// and the callers show their "Couldn't load" state.
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

function fetchMovieGenres() {
  return fetchGenreValues('movie_genres');
}

function fetchTvShowGenres() {
  return fetchGenreValues('tv_show_genres');
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

export async function fetchMovieById(movieId) {
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
  const client = requireSupabaseCatalog();

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
  if (sortOrder === 'popularity-desc') {
    showsQuery = showsQuery.not('poster_url', 'is', null).or(QUALITY_GATE);
  }
  showsQuery = applyBrowseSort(showsQuery, sortOrder);

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

const BROWSE_SOURCES = {
  movie: { table: 'movies', columns: MOVIE_BROWSE_COLUMNS, normalize: normalizeMovieBrowseEntry },
  tv_show: { table: 'tv_shows', columns: TV_SHOW_BROWSE_COLUMNS, normalize: normalizeTvShowBrowseEntry },
};

// Catalog rows for a batch of TMDB ids (via the unique source_key index).
// Used to turn TMDB trending/discover/recommendation lists into titles the
// app can actually open. Returns a Map of tmdbId -> catalog item. Rejects when
// the catalog didn't answer, so callers can tell that from "not on binge."
// (catalogLookup must not remember a failure as "not in the catalog").
export async function fetchCatalogByTmdbIds(mediaType, tmdbIds = []) {
  const source = BROWSE_SOURCES[mediaType];
  const ids = [...new Set(tmdbIds.filter((id) => Number.isFinite(Number(id))))];
  if (!source || ids.length === 0) return new Map();

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
    if (error) throw error;
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
  if (!source || !isSupabaseConfigured || !supabase) return [];

  const client = supabase;
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

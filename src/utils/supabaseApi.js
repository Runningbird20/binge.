import {
  getSupabaseUser,
  requireSupabaseClient,
  toSupabaseError,
} from './supabase';
import { fetchSupabaseRatings, fetchSupabaseWatchlist } from './supabaseData';
import { generateSupabaseRecommendations } from './recommendations';
import {
  fetchSupabaseBookById,
  fetchSupabaseBooksPage,
  fetchSupabaseMovieById,
  fetchSupabaseMovieCuratedRows,
  fetchSupabaseMoviesPage,
  fetchSupabaseTvShowById,
  fetchSupabaseTvShowCuratedRows,
  fetchSupabaseTvShowsPage,
} from './supabaseMovieCatalog';
import { resolveUserType } from './userAccess';

const SEARCH_LIMIT = 8;
const TMDB_API_KEY = (
  process.env.REACT_APP_TMDB_API_KEY ||
  process.env.VITE_TMDB_API_KEY ||
  process.env.NEXT_PUBLIC_TMDB_API_KEY ||
  process.env.TMDB_API_KEY
)?.trim();

function parseApiPath(path) {
  const url = new URL(path, 'http://localhost');

  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
  };
}

function normalizeSearchTerm(value) {
  return String(value || '')
    .replace(/[,%_"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIlikePattern(value) {
  const normalized = normalizeSearchTerm(value)
    .split(' ')
    .filter(Boolean)
    .join('%');

  return normalized ? `%${normalized}%` : '';
}

// Returns ilike patterns covering punctuation-stripped variants.
// Kept to ≤3 patterns to avoid bloated OR filters that slow Supabase queries.
// "jojos" → ["%jojos%", "%jo%jos%"] so "JoJo's Bizarre Adventure" still matches.
function buildFuzzyIlikePatterns(value) {
  const stripped = String(value || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = stripped.split(' ').filter(w => w.length >= 2);
  if (!words.length) return [];

  const patterns = new Set();

  // Base: apostrophes/hyphens become word separators (handles "jojo's" input)
  const legacyNorm = normalizeSearchTerm(value).split(' ').filter(Boolean).join('%');
  if (legacyNorm) patterns.add(`%${legacyNorm}%`);

  // Pure stripped words joined (handles "jojos" — no punctuation in query)
  patterns.add(`%${words.join('%')}%`);

  // One interior split on the first word — bridges DB punctuation (e.g. "JoJo's").
  // Only add if the query is a single short word with no spaces (pure punctuation-free case).
  if (words.length === 1 && words[0].length <= 8 && patterns.size < 3) {
    const word = words[0];
    const mid = Math.floor(word.length / 2);
    patterns.add(`%${word.slice(0, mid)}%${word.slice(mid)}%`);
  }

  return [...patterns];
}

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildProfileMap(profiles = []) {
  return Object.fromEntries((profiles || []).map((profile) => [profile.id, profile]));
}

async function requireAuthenticatedUser() {
  const { data, error } = await getSupabaseUser();

  if (error) {
    throw toSupabaseError(error, 'Unable to read your Supabase auth session.', {
      resourceName: 'auth session',
    });
  }

  if (!data?.user) {
    throw new Error('Failed auth session. Please sign in again.');
  }

  return data.user;
}

async function getAuthenticatedUserOrNull() {
  const { data, error } = await getSupabaseUser();

  if (error) {
    throw toSupabaseError(error, 'Unable to read your Supabase auth session.', {
      resourceName: 'auth session',
    });
  }

  return data?.user || null;
}

async function requireViewerProfile() {
  const client = requireSupabaseClient();
  const user = await requireAuthenticatedUser();
  const { data, error } = await client
    .from('profiles')
    .select('id, username, is_admin, is_dev, bio, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw toSupabaseError(error, 'Unable to load your profile.', {
      resourceName: 'profiles',
    });
  }

  const userType = resolveUserType(data || user.user_metadata || {});

  return {
    ...data,
    id: user.id,
    user_type: userType,
    is_admin: userType === 'admin',
    is_dev: userType === 'dev',
  };
}

async function requireAdminProfile() {
  const profile = await requireViewerProfile();

  if (profile.user_type !== 'admin') {
    throw new Error('Failed auth session. Admin access is required.');
  }

  return profile;
}

async function fetchProfilesMap(userIds = []) {
  const ids = uniqueIds(userIds);
  if (!ids.length) {
    return {};
  }

  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('id, username, avatar_url, bio')
    .in('id', ids);

  if (error) {
    throw toSupabaseError(error, 'Unable to load profile details.', {
      resourceName: 'profiles',
    });
  }

  return buildProfileMap(data || []);
}

async function fetchTmdbSeason(searchParams) {
  const tmdbId = searchParams.get('tmdbId');
  const season = searchParams.get('season');

  if (!tmdbId || !season) {
    throw new Error('TMDB season lookup requires tmdbId and season.');
  }

  if (!TMDB_API_KEY) {
    throw new Error('TMDB is not configured. Set REACT_APP_TMDB_API_KEY.');
  }

  let response;
  try {
    response = await fetch(`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(season)}?api_key=${encodeURIComponent(TMDB_API_KEY)}`);
  } catch {
    throw new Error('Unable to reach TMDB. Check your network connection.');
  }

  if (!response.ok) {
    throw new Error(`TMDB season lookup failed with status ${response.status}.`);
  }

  const data = await response.json();
  return {
    season: data.season_number,
    episodeCount: data.episodes?.length || 0,
    episodes: (data.episodes || []).map((episode) => ({
      number: episode.episode_number,
      name: episode.name,
      airDate: episode.air_date,
    })),
  };
}

function normalizeEmbedRouteId(kind, value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  if (kind === 'tmdb' && /^\d+$/.test(normalized)) {
    return { kind: 'tmdb', value: normalized };
  }

  if (kind === 'imdb' && /^tt\d+$/i.test(normalized)) {
    return { kind: 'imdb', value: normalized.toLowerCase() };
  }

  return null;
}

async function searchTmdbId({ title, year, type }) {
  if (!TMDB_API_KEY || !title) {
    return { kind: null, value: null };
  }

  const mediaType = type === 'tv_show' ? 'tv' : 'movie';
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    query: title,
  });

  if (year) {
    params.set(mediaType === 'tv' ? 'first_air_date_year' : 'year', year);
  }

  const response = await fetch(`https://api.themoviedb.org/3/search/${mediaType}?${params}`);
  if (!response.ok) {
    return { kind: null, value: null };
  }

  const data = await response.json();
  const result = data.results?.[0];
  return result?.id
    ? { kind: 'tmdb', value: String(result.id), title: result.title || result.name || null }
    : { kind: null, value: null };
}

async function fetchTmdbShow(searchParams) {
  const tmdbId = String(searchParams.get('tmdbId') || '').trim();
  if (!tmdbId) {
    throw new Error('tmdbId required');
  }

  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY not set');
  }

  const response = await fetch(`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(TMDB_API_KEY)}`);
  if (!response.ok) {
    throw new Error('TMDB error');
  }

  const data = await response.json();
  return {
    numberOfSeasons: data.number_of_seasons || null,
    numberOfEpisodes: data.number_of_episodes || null,
    status: data.status || null,
    name: data.name || null,
  };
}

async function fetchAniListId(title) {
  const gql = `query ($title: String) {
    Media(search: $title, type: ANIME) { id title { romaji english } }
  }`;
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: gql, variables: { title } }),
  });
  if (!response.ok) throw new Error(`AniList error ${response.status}`);
  const data = await response.json();
  const media = data?.data?.Media;
  if (!media?.id) throw new Error('Not found on AniList');
  return {
    id: String(media.id),
    title: media.title?.english || media.title?.romaji || null,
  };
}

async function handleMediaGet(pathname, searchParams) {
  if (
    pathname === '/media/popular-titles' ||
    pathname === '/media/movies/curated' ||
    pathname === '/media/tv-shows/curated' ||
    ((pathname === '/media/movies' || pathname === '/media/tv-shows') && searchParams.get('sort') === 'relevance')
  ) {
    return null;
  }

  if (pathname === '/media/movies') {
    const pageSize = Number(searchParams.get('page_size') || searchParams.get('pageSize') || 48);
    return fetchSupabaseMoviesPage({
      page: Number(searchParams.get('page') || 1),
      pageSize,
      search: searchParams.get('search') || '',
      genre: searchParams.get('genre') || '',
      sortOrder: searchParams.get('sort') || 'title-asc',
    });
  }

  if (pathname === '/media/movies/curated') {
    return { rows: await fetchSupabaseMovieCuratedRows() };
  }

  const movieMatch = pathname.match(/^\/media\/movies\/([^/]+)$/);
  if (movieMatch) {
    const movie = await fetchSupabaseMovieById(decodeURIComponent(movieMatch[1]));
    if (!movie) throw new Error('Movie not found.');
    return movie;
  }

  if (pathname === '/media/tv-shows') {
    const pageSize = Number(searchParams.get('page_size') || searchParams.get('pageSize') || 48);
    return fetchSupabaseTvShowsPage({
      page: Number(searchParams.get('page') || 1),
      pageSize,
      search: searchParams.get('search') || '',
      genre: searchParams.get('genre') || '',
      sortOrder: searchParams.get('sort') || 'title-asc',
    });
  }

  if (pathname === '/media/tv-shows/curated') {
    return { rows: await fetchSupabaseTvShowCuratedRows() };
  }

  const tvMatch = pathname.match(/^\/media\/tv-shows\/([^/]+)$/);
  if (tvMatch) {
    const show = await fetchSupabaseTvShowById(decodeURIComponent(tvMatch[1]));
    if (!show) throw new Error('TV show not found.');
    return show;
  }

  if (pathname === '/media/books') {
    const pageSize = Number(searchParams.get('page_size') || searchParams.get('pageSize') || 24);
    return fetchSupabaseBooksPage({
      page: Number(searchParams.get('page') || 1),
      pageSize,
      search: searchParams.get('search') || '',
      genre: searchParams.get('genre') || '',
      sortOrder: searchParams.get('sort') || 'title-asc',
    });
  }

  const bookMatch = pathname.match(/^\/media\/books\/([^/]+)$/);
  if (bookMatch) {
    const book = await fetchSupabaseBookById(decodeURIComponent(bookMatch[1]));
    if (!book) throw new Error('Book not found.');
    return book;
  }

  if (pathname === '/media/anilist-id') {
    const title = searchParams.get('title') || '';
    if (!title) throw new Error('title required');
    return fetchAniListId(title);
  }

  if (pathname === '/media/embed-id') {
    return (
      normalizeEmbedRouteId('imdb', searchParams.get('imdb')) ||
      normalizeEmbedRouteId('tmdb', searchParams.get('tmdb')) ||
      await searchTmdbId({
        title: searchParams.get('title') || '',
        year: searchParams.get('year') || '',
        type: searchParams.get('type') || '',
      })
    );
  }

  if (pathname === '/media/tmdb-show') {
    return fetchTmdbShow(searchParams);
  }

  if (pathname === '/media/tmdb-season') {
    return fetchTmdbSeason(searchParams);
  }

  throw new Error(`Unsupported media route: ${pathname}`);
}

const _searchCache = new Map(); // key → { ts, payload }
const SEARCH_CACHE_TTL = 60_000;

async function handleSearch(searchParams) {
  const client = requireSupabaseClient();
  const rawQuery = searchParams.get('q') || '';
  const query = buildIlikePattern(rawQuery);
  const typesRaw = String(searchParams.get('types') || 'movies,tv,books,people');
  const types = new Set(typesRaw.split(',').map((v) => v.trim()).filter(Boolean));

  if (!query || normalizeSearchTerm(rawQuery).length < 2) {
    return { movies: [], tv: [], books: [], people: [] };
  }

  // Return cached result if still fresh
  const cacheKey = `${rawQuery.toLowerCase().trim()}|${typesRaw}`;
  const cached = _searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) return cached.payload;

  // Build fuzzy OR filter: covers punctuation-stripped variants so e.g.
  // "jojos" matches "JoJo's Bizarre Adventure" via the %jojo%s% pattern.
  const fuzzyPatterns = buildFuzzyIlikePatterns(rawQuery);
  function fuzzyOr(...fields) {
    return fuzzyPatterns.flatMap(p => fields.map(f => `${f}.ilike.${p}`)).join(',');
  }

  const tasks = [];

  if (types.has('movies')) {
    tasks.push(
      client
        .from('movies')
        .select('id, title, year, genre, poster_url, source_key, external_id')
        .or(fuzzyOr('title', 'genre'))
        .not('source_key', 'is', null)
        .order('year', { ascending: false, nullsFirst: false })
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) {
            throw toSupabaseError(error, 'Unable to search movies.', {
              resourceName: 'movies',
            });
          }

          return ['movies', data || []];
        })
    );
  }

  if (types.has('tv')) {
    tasks.push(
      client
        .from('tv_shows')
        .select('id, title, year, genre, poster_url, source_key, external_id')
        .or(fuzzyOr('title', 'genre'))
        .not('source_key', 'is', null)
        .order('year', { ascending: false, nullsFirst: false })
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) {
            throw toSupabaseError(error, 'Unable to search TV shows.', {
              resourceName: 'tv_shows',
            });
          }

          return ['tv', data || []];
        })
    );
  }

  if (types.has('books')) {
    tasks.push(
      client
        .from('books')
        .select('id, title, author, year, genre, cover_url, source_key, external_id')
        .or(fuzzyOr('title', 'author'))
        .not('source_key', 'is', null)
        .order('year', { ascending: false, nullsFirst: false })
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) {
            throw toSupabaseError(error, 'Unable to search books.', {
              resourceName: 'books',
            });
          }

          return ['books', data || []];
        })
    );
  }

  if (types.has('people')) {
    tasks.push(
      client
        .from('profiles')
        .select('id, username, avatar_url, bio')
        .or(fuzzyOr('username'))
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) {
            throw toSupabaseError(error, 'Unable to search people.', {
              resourceName: 'profiles',
            });
          }

          return ['people', data || []];
        })
    );
  }

  const results = await Promise.all(tasks);
  const payload = { movies: [], tv: [], books: [], people: [] };
  for (const [key, value] of results) payload[key] = value;

  _searchCache.set(cacheKey, { ts: Date.now(), payload });
  return payload;
}

async function handleNotifications(pathname) {
  const client = requireSupabaseClient();

  if (pathname === '/notifications/unread-count') {
    const user = await getAuthenticatedUserOrNull();
    if (!user) {
      return { count: 0 };
    }

    const { count, error } = await client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false);

    if (error) {
      throw toSupabaseError(error, 'Unable to load unread notifications.', {
        resourceName: 'notifications',
      });
    }

    return { count: count || 0 };
  }

  const user = await requireAuthenticatedUser();

  if (pathname === '/notifications') {
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw toSupabaseError(error, 'Unable to load notifications.', {
        resourceName: 'notifications',
      });
    }

    const actorMap = await fetchProfilesMap((data || []).map((notification) => notification.actor_id));
    return (data || []).map((notification) => ({
      ...notification,
      actor: notification.actor_id ? actorMap[notification.actor_id] || null : null,
    }));
  }

  throw new Error(`Unsupported notifications route: ${pathname}`);
}

async function handleNotificationMutation(method, pathname) {
  const client = requireSupabaseClient();
  const user = await requireAuthenticatedUser();

  if (method === 'POST' && pathname === '/notifications/read-all') {
    const { error } = await client
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);

    if (error) {
      throw toSupabaseError(error, 'Unable to mark notifications as read.', {
        resourceName: 'notifications',
      });
    }

    return { success: true };
  }

  const singleReadMatch = pathname.match(/^\/notifications\/read\/(\d+)$/);
  if (method === 'POST' && singleReadMatch) {
    const { error } = await client
      .from('notifications')
      .update({ read: true })
      .eq('id', Number(singleReadMatch[1]))
      .eq('user_id', user.id);

    if (error) {
      throw toSupabaseError(error, 'Unable to mark that notification as read.', {
        resourceName: 'notifications',
      });
    }

    return { success: true };
  }

  throw new Error(`Unsupported notifications route: ${pathname}`);
}

async function loadProfileByRouteParam(client, rawUsername, viewer = null) {
  const username = decodeURIComponent(rawUsername || '').trim();
  let query = client
    .from('profiles')
    .select('id, username, email, bio, avatar_url, created_at')
    .limit(1);

  if (username.toLowerCase() === 'me') {
    if (!viewer?.id) {
      return null;
    }
    query = query.eq('id', viewer.id);
  } else {
    query = query.ilike('username', username);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw toSupabaseError(error, 'Unable to load that profile.', {
      resourceName: 'profiles',
    });
  }

  return data || null;
}

async function handleProfileGet(pathname) {
  const profileMatch = pathname.match(/^\/profile\/([^/]+)$/);
  if (!profileMatch) {
    return null;
  }

  const client = requireSupabaseClient();
  const viewer = await getAuthenticatedUserOrNull();
  const profile = await loadProfileByRouteParam(client, profileMatch[1], viewer);

  if (!profile) {
    throw new Error('User not found.');
  }

  const isOwnProfile = viewer?.id === profile.id;
  const isPrivate = false;

  if (isPrivate && !isOwnProfile) {
    return {
      profile,
      ratings: [],
      watchlist: [],
      posts: [],
      isPrivate: true,
    };
  }

  const [ratings, watchlist] = await Promise.all([
    fetchSupabaseRatings({ userId: profile.id }).catch(() => []),
    fetchSupabaseWatchlist({ userId: profile.id }).catch(() => []),
  ]);

  return {
    profile,
    ratings,
    watchlist,
    isPrivate: false,
  };
}

async function handleAdminMutation(pathname, _body) {
  await requireAdminProfile();
  const client = requireSupabaseClient();

  const toggleMatch = pathname.match(/^\/admin\/users\/([^/]+)\/toggle-admin$/);
  if (toggleMatch) {
    const userId = toggleMatch[1];
    const { data: profile, error: fetchError } = await client
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      throw toSupabaseError(fetchError, 'User not found.', { resourceName: 'profiles' });
    }

    const { data, error } = await client
      .from('profiles')
      .update({ is_admin: !profile.is_admin })
      .eq('id', userId)
      .select('id, username, is_admin')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to update admin status.', { resourceName: 'profiles' });
    }

    return data;
  }

  throw new Error(`Unsupported admin route: ${pathname}`);
}

async function handleAdminGet(pathname, searchParams) {
  await requireAdminProfile();
  const client = requireSupabaseClient();

  if (pathname === '/admin/users') {
    const { data, error } = await client
      .from('profiles')
      .select('id, username, email, created_at, is_admin')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      throw toSupabaseError(error, 'Unable to load users.', { resourceName: 'profiles' });
    }

    return data || [];
  }

  throw new Error(`Unsupported admin route: ${pathname}`);
}

export async function executeSupabaseRoute(method, path, body) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const { pathname, searchParams } = parseApiPath(path);

  if (pathname === '/chat/recommendations') {
    if (normalizedMethod !== 'GET') {
      throw new Error(`Unsupported chat route: ${pathname}`);
    }

    return generateSupabaseRecommendations();
  }

  if (pathname === '/search') {
    return handleSearch(searchParams);
  }

  if (pathname.startsWith('/notifications')) {
    if (normalizedMethod === 'GET') {
      return handleNotifications(pathname);
    }

    return handleNotificationMutation(normalizedMethod, pathname);
  }

  if (pathname.startsWith('/media')) {
    if (normalizedMethod !== 'GET') {
      throw new Error(`Unsupported media route: ${pathname}`);
    }

    return handleMediaGet(pathname, searchParams);
  }

  if (pathname.startsWith('/profile')) {
    if (normalizedMethod === 'GET') {
      const profileResult = await handleProfileGet(pathname);
      if (profileResult !== null) {
        return profileResult;
      }
    }
  }

  if (pathname.startsWith('/admin')) {
    if (normalizedMethod === 'GET') {
      return handleAdminGet(pathname, searchParams);
    }

    if (normalizedMethod === 'PATCH') {
      return handleAdminMutation(pathname, body);
    }

    throw new Error(`Unsupported admin route: ${pathname}`);
  }

  return null;
}

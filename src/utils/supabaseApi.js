import {
  getSupabaseSession,
  getSupabaseUser,
  isSupabaseConfigured,
  requireSupabaseClient,
  toSupabaseError,
} from './supabase';
import { resolveUserType } from './userAccess';

const SEARCH_LIMIT = 8;
const FORUM_PAGE_LIMIT = 25;
const ADMIN_PAGE_LIMIT = 25;
const BULK_PAGE_SIZE = 1000;
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

function buildDaysAgoIso(days) {
  return new Date(Date.now() - (Number(days) || 0) * 24 * 60 * 60 * 1000).toISOString();
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

function enrichRowsWithProfiles(rows = [], profileMap = {}) {
  return rows.map((row) => ({
    ...row,
    profiles: row.user_id ? profileMap[row.user_id] || null : row.profiles || null,
  }));
}

async function loadForumBySlug(slug) {
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('forums')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    throw toSupabaseError(error, 'Unable to load the forum.', {
      resourceName: 'forums',
    });
  }

  if (!data) {
    throw new Error('Forum not found.');
  }

  return data;
}

async function refreshForumMemberCount(forumId) {
  const client = requireSupabaseClient();
  const { count, error } = await client
    .from('forum_members')
    .select('*', { count: 'exact', head: true })
    .eq('forum_id', forumId);

  if (error) {
    throw toSupabaseError(error, 'Unable to refresh the forum member count.', {
      resourceName: 'forum_members',
    });
  }

  const nextCount = Number(count) || 0;
  const updateResult = await client
    .from('forums')
    .update({ member_count: nextCount })
    .eq('id', forumId);

  if (updateResult.error) {
    throw toSupabaseError(updateResult.error, 'Unable to save the forum member count.', {
      resourceName: 'forums',
    });
  }

  return nextCount;
}

async function refreshPostCommentCount(postId) {
  const client = requireSupabaseClient();
  const { count, error } = await client
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (error) {
    throw toSupabaseError(error, 'Unable to refresh the comment count.', {
      resourceName: 'comments',
    });
  }

  const nextCount = Number(count) || 0;
  const updateResult = await client
    .from('posts')
    .update({ comment_count: nextCount })
    .eq('id', postId);

  if (updateResult.error) {
    throw toSupabaseError(updateResult.error, 'Unable to save the comment count.', {
      resourceName: 'posts',
    });
  }

  return nextCount;
}

async function getModerationAuthToken() {
  try {
    const legacyToken = window?.localStorage?.getItem('token');
    if (legacyToken) return legacyToken;
  } catch {}
  try {
    const { data } = await getSupabaseSession();
    return data?.session?.access_token || null;
  } catch {}
  return null;
}

async function maybeModerateForumContent(text, kind) {
  const apiBase = (
    process.env.REACT_APP_API_URL ||
    process.env.REACT_APP_LEGACY_API_URL ||
    ''
  ).replace(/\/+$/, '');

  try {
    const token = await getModerationAuthToken();
    const response = await fetch(`${apiBase}/api/chat/moderate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text, kind }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) return { allowed: true };

    const result = await response.json();
    return {
      allowed: result.allowed !== false,
      reason: typeof result.reason === 'string' ? result.reason : '',
    };
  } catch {
    return { allowed: true };
  }
}

async function fetchAllRows(tableName, selectColumns, configureQuery, resourceName = tableName) {
  const client = requireSupabaseClient();
  const rows = [];
  let from = 0;

  while (true) {
    let query = client
      .from(tableName)
      .select(selectColumns)
      .range(from, from + BULK_PAGE_SIZE - 1);

    if (typeof configureQuery === 'function') {
      query = configureQuery(query);
    }

    const { data, error } = await query;
    if (error) {
      throw toSupabaseError(error, `Unable to load ${resourceName}.`, {
        resourceName,
      });
    }

    const nextRows = data || [];
    rows.push(...nextRows);

    if (nextRows.length < BULK_PAGE_SIZE) {
      break;
    }

    from += BULK_PAGE_SIZE;
  }

  return rows;
}

function computeIntentBreakdown(logs = []) {
  const counter = new Map();

  for (const row of logs) {
    const intent = row.intent || 'unknown';
    counter.set(intent, (counter.get(intent) || 0) + 1);
  }

  return [...counter.entries()]
    .map(([intent, count]) => ({ intent, count }))
    .sort((left, right) => right.count - left.count);
}

function computeQueriesPerDay(logs = [], days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const counter = new Map();

  for (const row of logs) {
    const timestamp = new Date(row.created_at).getTime();
    if (Number.isNaN(timestamp) || timestamp < cutoff) {
      continue;
    }

    const dateKey = new Date(timestamp).toISOString().slice(0, 10);
    counter.set(dateKey, (counter.get(dateKey) || 0) + 1);
  }

  return [...counter.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function computeLatencyStats(logs = []) {
  const values = logs
    .map((row) => Number(row.latency_ms))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (!values.length) {
    return {
      avgLatencyMs: null,
      maxLatencyMs: null,
      p95LatencyMs: null,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(Math.floor(values.length * 0.95), values.length - 1);

  return {
    avgLatencyMs: Math.round(total / values.length),
    maxLatencyMs: values[values.length - 1],
    p95LatencyMs: values[p95Index],
  };
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function createRoomWithRetry(payload, attempts = 5) {
  const client = requireSupabaseClient();
  const user = await requireAuthenticatedUser();

  for (let index = 0; index < attempts; index += 1) {
    const roomId = generateRoomId();
    const { data, error } = await client
      .from('watch_rooms')
      .insert({
        id: roomId,
        host_id: user.id,
        title: payload.title,
        media_type: payload.media_type || 'movie',
        media_id: payload.media_id || null,
        tmdb_id: payload.tmdb_id || null,
        sync_provider: 'vidlink',
        sync_season: 1,
        sync_episode: 1,
        sync_is_playing: false,
        sync_current_time: 0,
      })
      .select('*')
      .single();

    if (!error && data) {
      return data;
    }

    if (error?.code !== '23505') {
      throw toSupabaseError(error, 'Unable to create the watch room.', {
        resourceName: 'watch_rooms',
      });
    }
  }

  throw new Error('Unable to generate a unique watch room code. Please try again.');
}

async function loadWatchRoom(roomId) {
  const client = requireSupabaseClient();
  const [{ data: room, error: roomError }, { data: messages, error: messageError }, { data: viewers, error: viewerError }] = await Promise.all([
    client.from('watch_rooms').select('*').eq('id', roomId).maybeSingle(),
    client.from('room_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(200),
    client.from('room_viewers').select('user_id, last_seen').eq('room_id', roomId).gt('last_seen', new Date(Date.now() - 30000).toISOString()),
  ]);

  if (roomError) {
    throw toSupabaseError(roomError, 'Unable to load the watch room.', {
      resourceName: 'watch_rooms',
    });
  }

  if (!room) {
    throw new Error('Room not found or has ended.');
  }

  if (messageError) {
    throw toSupabaseError(messageError, 'Unable to load room messages.', {
      resourceName: 'room_messages',
    });
  }

  if (viewerError) {
    throw toSupabaseError(viewerError, 'Unable to load room viewers.', {
      resourceName: 'room_viewers',
    });
  }

  const profileMap = await fetchProfilesMap([
    room.host_id,
    ...(messages || []).map((message) => message.user_id),
    ...(viewers || []).map((viewer) => viewer.user_id),
  ]);

  return {
    room: {
      ...room,
      host: profileMap[room.host_id] || null,
    },
    messages: enrichRowsWithProfiles(messages || [], profileMap),
    viewers: (viewers || []).map((viewer) => ({
      ...viewer,
      profiles: profileMap[viewer.user_id] || null,
    })),
  };
}

async function requireRoomHost(roomId) {
  const client = requireSupabaseClient();
  const user = await requireAuthenticatedUser();
  const { data, error } = await client
    .from('watch_rooms')
    .select('id, host_id')
    .eq('id', roomId)
    .maybeSingle();

  if (error) {
    throw toSupabaseError(error, 'Unable to load the watch room.', {
      resourceName: 'watch_rooms',
    });
  }

  if (!data) {
    throw new Error('Room not found or has ended.');
  }

  if (data.host_id !== user.id) {
    throw new Error('Only the host can perform that action.');
  }

  return user;
}

async function requireRoomParticipant(roomId) {
  const client = requireSupabaseClient();
  const user = await requireAuthenticatedUser();
  const { data, error } = await client
    .from('watch_rooms')
    .select('id, host_id, is_active')
    .eq('id', roomId)
    .maybeSingle();

  if (error) {
    throw toSupabaseError(error, 'Unable to load the watch room.', {
      resourceName: 'watch_rooms',
    });
  }

  if (!data || data.is_active === false) {
    throw new Error('Room not found or has ended.');
  }

  return { user, room: data };
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

async function handleSearch(searchParams) {
  const client = requireSupabaseClient();
  const rawQuery = searchParams.get('q') || '';
  const query = buildIlikePattern(rawQuery);
  const types = new Set(
    String(searchParams.get('types') || 'movies,tv,books,forums,people')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (!query || normalizeSearchTerm(rawQuery).length < 2) {
    return { movies: [], tv: [], books: [], forums: [], posts: [], people: [] };
  }

  const tasks = [];

  if (types.has('movies')) {
    tasks.push(
      client
        .from('movies')
        .select('id, title, year, genre, poster_url, source_key, external_id')
        .or(`title.ilike.${query},genre.ilike.${query}`)
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
        .or(`title.ilike.${query},genre.ilike.${query}`)
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
        .or(`title.ilike.${query},author.ilike.${query}`)
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

  if (types.has('forums')) {
    tasks.push(
      client
        .from('forums')
        .select('id, name, slug, icon, description, member_count')
        .ilike('name', query)
        .order('member_count', { ascending: false })
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) {
            throw toSupabaseError(error, 'Unable to search forums.', {
              resourceName: 'forums',
            });
          }

          return ['forums', data || []];
        })
    );

    tasks.push(
      client
        .from('posts')
        .select('id, title, flair, score, comment_count, created_at, forums(name, slug, icon)')
        .ilike('title', query)
        .eq('is_removed', false)
        .order('score', { ascending: false })
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) {
            throw toSupabaseError(error, 'Unable to search forum posts.', {
              resourceName: 'posts',
            });
          }

          return ['posts', data || []];
        })
    );
  }

  if (types.has('people')) {
    tasks.push(
      client
        .from('profiles')
        .select('id, username, avatar_url, bio')
        .ilike('username', query)
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
  const payload = {
    movies: [],
    tv: [],
    books: [],
    forums: [],
    posts: [],
    people: [],
  };

  for (const [key, value] of results) {
    payload[key] = value;
  }

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

async function handleForumGet(pathname, searchParams) {
  const client = requireSupabaseClient();

  if (pathname === '/forum') {
    const { data, error } = await client
      .from('forums')
      .select('*')
      .order('member_count', { ascending: false });

    if (error) {
      throw toSupabaseError(error, 'Unable to load forums.', {
        resourceName: 'forums',
      });
    }

    return data || [];
  }

  if (pathname === '/forum/search') {
    const query = buildIlikePattern(searchParams.get('q') || '');
    const { data, error } = await client
      .from('forums')
      .select('*')
      .ilike('name', query || '%')
      .order('member_count', { ascending: false })
      .limit(20);

    if (error) {
      throw toSupabaseError(error, 'Unable to search forums.', {
        resourceName: 'forums',
      });
    }

    return data || [];
  }

  if (pathname === '/forum/posts/feed') {
    const sort = searchParams.get('sort') || 'hot';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const from = (page - 1) * FORUM_PAGE_LIMIT;
    let query = client
      .from('posts')
      .select('*, forums(name, slug, icon)', { count: 'exact' })
      .eq('is_removed', false)
      .range(from, from + FORUM_PAGE_LIMIT - 1);

    if (sort === 'new') {
      query = query.order('created_at', { ascending: false });
    } else if (sort === 'top') {
      query = query.order('score', { ascending: false });
    } else {
      query = query.order('score', { ascending: false }).order('created_at', { ascending: false });
    }

    const { data, error, count } = await query;
    if (error) {
      throw toSupabaseError(error, 'Unable to load the forum feed.', {
        resourceName: 'posts',
      });
    }

    const profileMap = await fetchProfilesMap((data || []).map((post) => post.user_id));
    return {
      posts: enrichRowsWithProfiles(data || [], profileMap),
      total: count || 0,
      page,
    };
  }

  if (pathname === '/forum/user/my-forums') {
    const user = await requireAuthenticatedUser();
    const { data, error } = await client
      .from('forum_members')
      .select('role, forums(*)')
      .eq('user_id', user.id);

    if (error) {
      throw toSupabaseError(error, 'Unable to load your forums.', {
        resourceName: 'forum_members',
      });
    }

    return (data || []).map((membership) => ({
      ...membership.forums,
      role: membership.role,
    }));
  }

  const forumPostsMatch = pathname.match(/^\/forum\/([^/]+)\/posts$/);
  if (forumPostsMatch) {
    const forum = await loadForumBySlug(decodeURIComponent(forumPostsMatch[1]));
    const sort = searchParams.get('sort') || 'hot';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const from = (page - 1) * FORUM_PAGE_LIMIT;
    let query = client
      .from('posts')
      .select('*', { count: 'exact' })
      .eq('forum_id', forum.id)
      .eq('is_removed', false)
      .range(from, from + FORUM_PAGE_LIMIT - 1);

    if (sort === 'new') {
      query = query.order('created_at', { ascending: false });
    } else if (sort === 'top') {
      query = query.order('score', { ascending: false });
    } else {
      query = query.order('score', { ascending: false }).order('created_at', { ascending: false });
    }

    const { data, error, count } = await query;
    if (error) {
      throw toSupabaseError(error, 'Unable to load forum posts.', {
        resourceName: 'posts',
      });
    }

    const profileMap = await fetchProfilesMap((data || []).map((post) => post.user_id));
    return {
      posts: enrichRowsWithProfiles(data || [], profileMap),
      total: count || 0,
      page,
    };
  }

  const forumMatch = pathname.match(/^\/forum\/([^/]+)$/);
  if (forumMatch) {
    return loadForumBySlug(decodeURIComponent(forumMatch[1]));
  }

  const postDetailMatch = pathname.match(/^\/forum\/post\/(\d+)$/);
  if (postDetailMatch) {
    const postId = Number(postDetailMatch[1]);
    const [{ data: post, error: postError }, { data: comments, error: commentError }] = await Promise.all([
      client
        .from('posts')
        .select('*, forums(name, slug, icon)')
        .eq('id', postId)
        .maybeSingle(),
      client
        .from('comments')
        .select('*')
        .eq('post_id', postId)
        .order('score', { ascending: false }),
    ]);

    if (postError) {
      throw toSupabaseError(postError, 'Unable to load the post.', {
        resourceName: 'posts',
      });
    }

    if (!post) {
      throw new Error('Post not found.');
    }

    if (commentError) {
      throw toSupabaseError(commentError, 'Unable to load comments.', {
        resourceName: 'comments',
      });
    }

    const profileMap = await fetchProfilesMap([
      post.user_id,
      ...(comments || []).map((comment) => comment.user_id),
    ]);

    return {
      post: enrichRowsWithProfiles([post], profileMap)[0],
      comments: enrichRowsWithProfiles(comments || [], profileMap),
    };
  }

  throw new Error(`Unsupported forum route: ${pathname}`);
}

async function handleForumMutation(method, pathname, body) {
  const client = requireSupabaseClient();

  if (method === 'POST' && pathname === '/forum') {
    const user = await requireAuthenticatedUser();
    const name = String(body?.name || '').trim();
    if (!name) {
      throw new Error('Name is required.');
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { data, error } = await client
      .from('forums')
      .insert({
        name,
        slug,
        description: body?.description || '',
        icon: body?.icon || '💬',
        banner_color: body?.banner_color || '#1a1a1a',
        creator_id: user.id,
        rules: body?.rules || null,
      })
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to create the forum.', {
        resourceName: 'forums',
      });
    }

    const joinResult = await client
      .from('forum_members')
      .insert({
        forum_id: data.id,
        user_id: user.id,
        role: 'owner',
      });

    if (joinResult.error) {
      throw toSupabaseError(joinResult.error, 'Forum was created but ownership could not be recorded.', {
        resourceName: 'forum_members',
      });
    }

    return data;
  }

  const joinLeaveMatch = pathname.match(/^\/forum\/([^/]+)\/(join|leave)$/);
  if (method === 'POST' && joinLeaveMatch) {
    const user = await requireAuthenticatedUser();
    const forum = await loadForumBySlug(decodeURIComponent(joinLeaveMatch[1]));
    const action = joinLeaveMatch[2];

    if (action === 'join') {
      const upsertResult = await client
        .from('forum_members')
        .upsert(
          {
            forum_id: forum.id,
            user_id: user.id,
            role: 'member',
          },
          {
            onConflict: 'forum_id,user_id',
          }
        );

      if (upsertResult.error) {
        throw toSupabaseError(upsertResult.error, 'Unable to join the forum.', {
          resourceName: 'forum_members',
        });
      }
    } else {
      const deleteResult = await client
        .from('forum_members')
        .delete()
        .eq('forum_id', forum.id)
        .eq('user_id', user.id);

      if (deleteResult.error) {
        throw toSupabaseError(deleteResult.error, 'Unable to leave the forum.', {
          resourceName: 'forum_members',
        });
      }
    }

    await refreshForumMemberCount(forum.id);
    return { success: true };
  }

  const createPostMatch = pathname.match(/^\/forum\/([^/]+)\/posts$/);
  if (method === 'POST' && createPostMatch) {
    const user = await requireAuthenticatedUser();
    const title = String(body?.title || '').trim();
    if (!title) {
      throw new Error('Title is required.');
    }

    const moderation = await maybeModerateForumContent(`${title}\n\n${body?.body || ''}`, 'post');
    if (!moderation.allowed) {
      throw new Error(`Post removed by AI moderator: ${moderation.reason || 'Content policy violation.'}`);
    }

    const forum = await loadForumBySlug(decodeURIComponent(createPostMatch[1]));
    const { data, error } = await client
      .from('posts')
      .insert({
        forum_id: forum.id,
        user_id: user.id,
        title,
        body: body?.body || '',
        flair: body?.flair || null,
        tags: Array.isArray(body?.tags) ? body.tags : [],
      })
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to create the post.', {
        resourceName: 'posts',
      });
    }

    return data;
  }

  const postVoteMatch = pathname.match(/^\/forum\/post\/(\d+)\/vote$/);
  if (method === 'POST' && postVoteMatch) {
    const user = await requireAuthenticatedUser();
    const postId = Number(postVoteMatch[1]);
    const value = Number(body?.value);

    if (![1, -1, 0].includes(value)) {
      throw new Error('Vote value must be 1, -1, or 0.');
    }

    const { data: existingVote, error: voteLookupError } = await client
      .from('post_votes')
      .select('id, value')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (voteLookupError) {
      throw toSupabaseError(voteLookupError, 'Unable to load your current vote.', {
        resourceName: 'post_votes',
      });
    }

    const previousValue = existingVote?.value || 0;
    const delta = value - previousValue;

    if (value === 0 && existingVote) {
      const deleteResult = await client
        .from('post_votes')
        .delete()
        .eq('id', existingVote.id);

      if (deleteResult.error) {
        throw toSupabaseError(deleteResult.error, 'Unable to remove your vote.', {
          resourceName: 'post_votes',
        });
      }
    } else if (existingVote) {
      const updateResult = await client
        .from('post_votes')
        .update({ value })
        .eq('id', existingVote.id);

      if (updateResult.error) {
        throw toSupabaseError(updateResult.error, 'Unable to update your vote.', {
          resourceName: 'post_votes',
        });
      }
    } else if (value !== 0) {
      const insertResult = await client
        .from('post_votes')
        .insert({
          post_id: postId,
          user_id: user.id,
          value,
        });

      if (insertResult.error) {
        throw toSupabaseError(insertResult.error, 'Unable to save your vote.', {
          resourceName: 'post_votes',
        });
      }
    }

    if (delta !== 0) {
      const { data: post, error: postError } = await client
        .from('posts')
        .select('score')
        .eq('id', postId)
        .maybeSingle();

      if (postError) {
        throw toSupabaseError(postError, 'Unable to refresh the post score.', {
          resourceName: 'posts',
        });
      }

      const scoreResult = await client
        .from('posts')
        .update({ score: (post?.score || 0) + delta })
        .eq('id', postId);

      if (scoreResult.error) {
        throw toSupabaseError(scoreResult.error, 'Unable to save the post score.', {
          resourceName: 'posts',
        });
      }
    }

    return { success: true, delta };
  }

  const commentVoteMatch = pathname.match(/^\/forum\/comment\/(\d+)\/vote$/);
  if (method === 'POST' && commentVoteMatch) {
    const user = await requireAuthenticatedUser();
    const commentId = Number(commentVoteMatch[1]);
    const value = Number(body?.value);

    if (![1, -1, 0].includes(value)) {
      throw new Error('Vote value must be 1, -1, or 0.');
    }

    const { data: existingVote, error: voteLookupError } = await client
      .from('comment_votes')
      .select('id, value')
      .eq('comment_id', commentId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (voteLookupError) {
      throw toSupabaseError(voteLookupError, 'Unable to load your current vote.', {
        resourceName: 'comment_votes',
      });
    }

    const previousValue = existingVote?.value || 0;
    const delta = value - previousValue;

    if (value === 0 && existingVote) {
      const deleteResult = await client
        .from('comment_votes')
        .delete()
        .eq('id', existingVote.id);

      if (deleteResult.error) {
        throw toSupabaseError(deleteResult.error, 'Unable to remove your vote.', {
          resourceName: 'comment_votes',
        });
      }
    } else if (existingVote) {
      const updateResult = await client
        .from('comment_votes')
        .update({ value })
        .eq('id', existingVote.id);

      if (updateResult.error) {
        throw toSupabaseError(updateResult.error, 'Unable to update your vote.', {
          resourceName: 'comment_votes',
        });
      }
    } else if (value !== 0) {
      const insertResult = await client
        .from('comment_votes')
        .insert({
          comment_id: commentId,
          user_id: user.id,
          value,
        });

      if (insertResult.error) {
        throw toSupabaseError(insertResult.error, 'Unable to save your vote.', {
          resourceName: 'comment_votes',
        });
      }
    }

    if (delta !== 0) {
      const { data: comment, error: commentError } = await client
        .from('comments')
        .select('score')
        .eq('id', commentId)
        .maybeSingle();

      if (commentError) {
        throw toSupabaseError(commentError, 'Unable to refresh the comment score.', {
          resourceName: 'comments',
        });
      }

      const scoreResult = await client
        .from('comments')
        .update({ score: (comment?.score || 0) + delta })
        .eq('id', commentId);

      if (scoreResult.error) {
        throw toSupabaseError(scoreResult.error, 'Unable to save the comment score.', {
          resourceName: 'comments',
        });
      }
    }

    return { success: true, delta };
  }

  const createCommentMatch = pathname.match(/^\/forum\/post\/(\d+)\/comments$/);
  if (method === 'POST' && createCommentMatch) {
    const user = await requireAuthenticatedUser();
    const content = String(body?.body || '').trim();
    if (!content) {
      throw new Error('Comment body is required.');
    }

    const moderation = await maybeModerateForumContent(content, 'comment');
    if (!moderation.allowed) {
      throw new Error(`Comment removed by AI moderator: ${moderation.reason || 'Content policy violation.'}`);
    }

    const postId = Number(createCommentMatch[1]);
    const { data, error } = await client
      .from('comments')
      .insert({
        post_id: postId,
        user_id: user.id,
        body: content,
        parent_comment_id: body?.parent_comment_id || null,
      })
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to create the comment.', {
        resourceName: 'comments',
      });
    }

    await refreshPostCommentCount(postId);
    const profileMap = await fetchProfilesMap([user.id]);
    return enrichRowsWithProfiles([data], profileMap)[0];
  }

  const deletePostMatch = pathname.match(/^\/forum\/post\/(\d+)$/);
  if (method === 'DELETE' && deletePostMatch) {
    const user = await requireAuthenticatedUser();
    const postId = Number(deletePostMatch[1]);
    const deleteResult = await client
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', user.id);

    if (deleteResult.error) {
      throw toSupabaseError(deleteResult.error, 'Unable to delete the post.', {
        resourceName: 'posts',
      });
    }

    return { success: true };
  }

  const deleteCommentMatch = pathname.match(/^\/forum\/comment\/(\d+)$/);
  if (method === 'DELETE' && deleteCommentMatch) {
    const user = await requireAuthenticatedUser();
    const commentId = Number(deleteCommentMatch[1]);
    const { data: comment, error: lookupError } = await client
      .from('comments')
      .select('id, post_id')
      .eq('id', commentId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (lookupError) {
      throw toSupabaseError(lookupError, 'Unable to load the comment.', {
        resourceName: 'comments',
      });
    }

    const deleteResult = await client
      .from('comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', user.id);

    if (deleteResult.error) {
      throw toSupabaseError(deleteResult.error, 'Unable to delete the comment.', {
        resourceName: 'comments',
      });
    }

    if (comment?.post_id) {
      await refreshPostCommentCount(comment.post_id);
    }

    return { success: true };
  }

  const editCommentMatch = pathname.match(/^\/forum\/comment\/(\d+)$/);
  if (method === 'PATCH' && editCommentMatch) {
    const user = await requireAuthenticatedUser();
    const content = String(body?.body || '').trim();
    if (!content) {
      throw new Error('Body is required.');
    }

    const moderation = await maybeModerateForumContent(content, 'comment');
    if (!moderation.allowed) {
      throw new Error(`Edit rejected: ${moderation.reason || 'Content policy violation.'}`);
    }

    const { data, error } = await client
      .from('comments')
      .update({ body: content })
      .eq('id', Number(editCommentMatch[1]))
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw toSupabaseError(error, 'Unable to update the comment.', {
        resourceName: 'comments',
      });
    }

    if (!data) {
      throw new Error('Comment not found or not yours.');
    }

    return data;
  }

  const adminDeletePostMatch = pathname.match(/^\/forum\/admin\/post\/(\d+)$/);
  if (method === 'DELETE' && adminDeletePostMatch) {
    await requireAdminProfile();
    const postId = Number(adminDeletePostMatch[1]);

    const deleteComments = await client.from('comments').delete().eq('post_id', postId);
    if (deleteComments.error) {
      throw toSupabaseError(deleteComments.error, 'Unable to remove post comments.', {
        resourceName: 'comments',
      });
    }

    const deleteVotes = await client.from('post_votes').delete().eq('post_id', postId);
    if (deleteVotes.error) {
      throw toSupabaseError(deleteVotes.error, 'Unable to remove post votes.', {
        resourceName: 'post_votes',
      });
    }

    const deletePost = await client.from('posts').delete().eq('id', postId);
    if (deletePost.error) {
      throw toSupabaseError(deletePost.error, 'Unable to remove the post.', {
        resourceName: 'posts',
      });
    }

    return { success: true };
  }

  const adminPatchCommentMatch = pathname.match(/^\/forum\/admin\/comment\/(\d+)$/);
  if (method === 'PATCH' && adminPatchCommentMatch) {
    await requireAdminProfile();
    const { data, error } = await client
      .from('comments')
      .update({
        body: 'This comment was removed as it goes against community guidelines.',
        is_removed: true,
        removal_reason: body?.reason || 'Violated community guidelines',
      })
      .eq('id', Number(adminPatchCommentMatch[1]))
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to redact the comment.', {
        resourceName: 'comments',
      });
    }

    return data;
  }

  throw new Error(`Unsupported forum route: ${pathname}`);
}

async function handleWatchRoomGet(pathname) {
  const client = requireSupabaseClient();

  const roomMatch = pathname.match(/^\/watchroom\/([^/]+)$/);
  if (roomMatch) {
    return loadWatchRoom(decodeURIComponent(roomMatch[1]));
  }

  const syncMatch = pathname.match(/^\/watchroom\/([^/]+)\/sync$/);
  if (syncMatch) {
    const { data, error } = await client
      .from('watch_rooms')
      .select('sync_is_playing, sync_current_time, sync_updated_at, sync_provider, sync_season, sync_episode, host_id, tmdb_id, media_type, media_title, media_poster, is_active')
      .eq('id', decodeURIComponent(syncMatch[1]))
      .maybeSingle();

    if (error) {
      throw toSupabaseError(error, 'Unable to load room sync state.', {
        resourceName: 'watch_rooms',
      });
    }

    if (!data) {
      throw new Error('Room not found.');
    }

    return data;
  }

  const messagesMatch = pathname.match(/^\/watchroom\/([^/]+)\/messages\/since\/(\d+)$/);
  if (messagesMatch) {
    const roomId = decodeURIComponent(messagesMatch[1]);
    const timestamp = new Date(Number(messagesMatch[2])).toISOString();
    const { data, error } = await client
      .from('room_messages')
      .select('*')
      .eq('room_id', roomId)
      .gt('created_at', timestamp)
      .order('created_at', { ascending: true });

    if (error) {
      throw toSupabaseError(error, 'Unable to load new room messages.', {
        resourceName: 'room_messages',
      });
    }

    const profileMap = await fetchProfilesMap((data || []).map((message) => message.user_id));
    return enrichRowsWithProfiles(data || [], profileMap);
  }

  const viewersMatch = pathname.match(/^\/watchroom\/([^/]+)\/viewers$/);
  if (viewersMatch) {
    const roomId = decodeURIComponent(viewersMatch[1]);
    const { data, error } = await client
      .from('room_viewers')
      .select('user_id, last_seen')
      .eq('room_id', roomId)
      .gt('last_seen', new Date(Date.now() - 30000).toISOString());

    if (error) {
      throw toSupabaseError(error, 'Unable to load room viewers.', {
        resourceName: 'room_viewers',
      });
    }

    const profileMap = await fetchProfilesMap((data || []).map((viewer) => viewer.user_id));
    return (data || []).map((viewer) => ({
      ...viewer,
      profiles: profileMap[viewer.user_id] || null,
    }));
  }

  throw new Error(`Unsupported watch room route: ${pathname}`);
}

async function handleWatchRoomMutation(method, pathname, body) {
  const client = requireSupabaseClient();

  if (method === 'POST' && pathname === '/watchroom') {
    const title = String(body?.title || '').trim();
    if (!title) {
      throw new Error('Title required.');
    }

    return createRoomWithRetry({
      ...body,
      title,
    });
  }

  const syncMatch = pathname.match(/^\/watchroom\/([^/]+)\/sync$/);
  if (method === 'POST' && syncMatch) {
    const roomId = decodeURIComponent(syncMatch[1]);
    const { user, room } = await requireRoomParticipant(roomId);
    const update = {
      sync_is_playing: body?.is_playing,
      sync_current_time: body?.current_time,
      sync_updated_at: new Date().toISOString(),
    };
    if (room.host_id === user.id) {
      update.sync_provider = body?.provider;
      update.sync_season = body?.season;
      update.sync_episode = body?.episode;
    }

    Object.keys(update).forEach((key) => update[key] === undefined && delete update[key]);
    const { data, error } = await client
      .from('watch_rooms')
      .update(update)
      .eq('id', roomId)
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to update room sync.', {
        resourceName: 'watch_rooms',
      });
    }

    return data;
  }

  const mediaMatch = pathname.match(/^\/watchroom\/([^/]+)\/media$/);
  if (method === 'PATCH' && mediaMatch) {
    const roomId = decodeURIComponent(mediaMatch[1]);
    await requireRoomHost(roomId);
    const { data, error } = await client
      .from('watch_rooms')
      .update({
        tmdb_id: body?.tmdb_id || null,
        media_type: body?.media_type || 'movie',
        media_title: body?.media_title || null,
        media_poster: body?.media_poster || null,
        sync_current_time: 0,
        sync_is_playing: false,
        sync_season: 1,
        sync_episode: 1,
        sync_provider: 'vidlink',
      })
      .eq('id', roomId)
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to change room media.', {
        resourceName: 'watch_rooms',
      });
    }

    return data;
  }

  const messageMatch = pathname.match(/^\/watchroom\/([^/]+)\/message$/);
  if (method === 'POST' && messageMatch) {
    const roomId = decodeURIComponent(messageMatch[1]);
    const user = await requireAuthenticatedUser();
    const message = String(body?.message || '').trim();
    if (!message) {
      throw new Error('Message required.');
    }

    const { data, error } = await client
      .from('room_messages')
      .insert({
        room_id: roomId,
        user_id: user.id,
        message,
      })
      .select('*')
      .single();

    if (error) {
      throw toSupabaseError(error, 'Unable to send the room message.', {
        resourceName: 'room_messages',
      });
    }

    const profileMap = await fetchProfilesMap([user.id]);
    return enrichRowsWithProfiles([data], profileMap)[0];
  }

  const heartbeatMatch = pathname.match(/^\/watchroom\/([^/]+)\/heartbeat$/);
  if (method === 'POST' && heartbeatMatch) {
    const user = await getAuthenticatedUserOrNull();
    if (!user) {
      return { ok: true };
    }

    const result = await client
      .from('room_viewers')
      .upsert(
        {
          room_id: decodeURIComponent(heartbeatMatch[1]),
          user_id: user.id,
          last_seen: new Date().toISOString(),
        },
        {
          onConflict: 'room_id,user_id',
        }
      );

    if (result.error) {
      throw toSupabaseError(result.error, 'Unable to update room presence.', {
        resourceName: 'room_viewers',
      });
    }

    return { ok: true };
  }

  const transferHostMatch = pathname.match(/^\/watchroom\/([^/]+)\/host$/);
  if (method === 'PATCH' && transferHostMatch) {
    const roomId = decodeURIComponent(transferHostMatch[1]);
    await requireRoomHost(roomId);
    const username = String(body?.new_host_username || '').trim();
    if (!username) {
      throw new Error('A username is required to transfer the host role.');
    }

    const { data: nextHost, error: nextHostError } = await client
      .from('profiles')
      .select('id, username')
      .ilike('username', username)
      .maybeSingle();

    if (nextHostError) {
      throw toSupabaseError(nextHostError, 'Unable to find that user.', {
        resourceName: 'profiles',
      });
    }

    if (!nextHost) {
      throw new Error('User not found.');
    }

    const updateResult = await client
      .from('watch_rooms')
      .update({ host_id: nextHost.id })
      .eq('id', roomId);

    if (updateResult.error) {
      throw toSupabaseError(updateResult.error, 'Unable to transfer the host role.', {
        resourceName: 'watch_rooms',
      });
    }

    return { success: true };
  }

  const deleteRoomMatch = pathname.match(/^\/watchroom\/([^/]+)$/);
  if (method === 'DELETE' && deleteRoomMatch) {
    const roomId = decodeURIComponent(deleteRoomMatch[1]);
    await requireRoomHost(roomId);
    const result = await client
      .from('watch_rooms')
      .update({ is_active: false })
      .eq('id', roomId);

    if (result.error) {
      throw toSupabaseError(result.error, 'Unable to close the room.', {
        resourceName: 'watch_rooms',
      });
    }

    return { success: true };
  }

  throw new Error(`Unsupported watch room route: ${pathname}`);
}

async function handleProfileFollowGet(pathname) {
  const client = requireSupabaseClient();
  const followStatusMatch = pathname.match(/^\/profile\/([^/]+)\/follow-status$/);
  if (!followStatusMatch) {
    return null;
  }

  const user = await getAuthenticatedUserOrNull();
  if (!user) {
    return { following: false };
  }

  const username = decodeURIComponent(followStatusMatch[1]);
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .maybeSingle();

  if (profileError) {
    throw toSupabaseError(profileError, 'Unable to load that profile.', {
      resourceName: 'profiles',
    });
  }

  if (!profile || profile.id === user.id) {
    return { following: false };
  }

  const { data, error } = await client
    .from('follows')
    .select('follower_id')
    .eq('follower_id', user.id)
    .eq('following_id', profile.id)
    .maybeSingle();

  if (error) {
    throw toSupabaseError(error, 'Unable to load follow status.', {
      resourceName: 'follows',
    });
  }

  return { following: Boolean(data) };
}

async function handleProfileFollowMutation(method, pathname) {
  const client = requireSupabaseClient();
  const followMatch = pathname.match(/^\/profile\/([^/]+)\/follow$/);
  if (!followMatch) {
    return null;
  }

  const user = await requireAuthenticatedUser();
  const username = decodeURIComponent(followMatch[1]);
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, username')
    .ilike('username', username)
    .maybeSingle();

  if (profileError) {
    throw toSupabaseError(profileError, 'Unable to load that profile.', {
      resourceName: 'profiles',
    });
  }

  if (!profile) {
    throw new Error('User not found.');
  }

  if (profile.id === user.id) {
    throw new Error('You cannot follow yourself.');
  }

  if (method === 'POST') {
    const { error } = await client
      .from('follows')
      .upsert(
        { follower_id: user.id, following_id: profile.id },
        { onConflict: 'follower_id,following_id' }
      );

    if (error) {
      throw toSupabaseError(error, 'Unable to follow that member.', {
        resourceName: 'follows',
      });
    }

    return { success: true, following: true };
  }

  if (method === 'DELETE') {
    const { error } = await client
      .from('follows')
      .delete()
      .match({ follower_id: user.id, following_id: profile.id });

    if (error) {
      throw toSupabaseError(error, 'Unable to unfollow that member.', {
        resourceName: 'follows',
      });
    }

    return { success: true, following: false };
  }

  throw new Error(`Unsupported profile follow route: ${pathname}`);
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

  if (pathname === '/admin/stats') {
    const [logs, errors] = await Promise.all([
      fetchAllRows(
        'chat_logs',
        'id, user_id, intent, latency_ms, created_at',
        (query) => query.order('created_at', { ascending: false }),
        'chat_logs'
      ),
      fetchAllRows(
        'chat_errors',
        'id, user_id, error_type, error_message, created_at',
        (query) => query.order('created_at', { ascending: false }),
        'chat_errors'
      ).catch(() => []),
    ]);

    const now = Date.now();
    const last7DaysCutoff = now - 7 * 24 * 60 * 60 * 1000;
    const last30DaysCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const latencyStats = computeLatencyStats(logs);
    const errorRows = errors || [];

    return {
      totalQueries: logs.length,
      queriesLast7Days: logs.filter((row) => new Date(row.created_at).getTime() >= last7DaysCutoff).length,
      queriesLast30Days: logs.filter((row) => new Date(row.created_at).getTime() >= last30DaysCutoff).length,
      avgLatencyMs: latencyStats.avgLatencyMs,
      maxLatencyMs: latencyStats.maxLatencyMs,
      p95LatencyMs: latencyStats.p95LatencyMs,
      uniqueUsers: new Set(logs.map((row) => row.user_id).filter(Boolean)).size,
      totalErrors: errorRows.length,
      errorsLast7Days: errorRows.filter((row) => new Date(row.created_at).getTime() >= last7DaysCutoff).length,
      intentBreakdown: computeIntentBreakdown(logs),
      queriesPerDay: computeQueriesPerDay(logs, 30),
    };
  }

  if (pathname === '/admin/logs') {
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || ADMIN_PAGE_LIMIT)));
    const intent = String(searchParams.get('intent') || '').trim();
    const rawDays = Number(searchParams.get('days') || 0);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : null;
    const from = (page - 1) * limit;

    let query = client
      .from('chat_logs')
      .select('id, user_id, query, intent, response_length, sources_count, latency_ms, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (intent) {
      query = query.eq('intent', intent);
    }

    if (days) {
      query = query.gte('created_at', buildDaysAgoIso(days));
    }

    const { data, error, count } = await query;
    if (error) {
      throw toSupabaseError(error, 'Unable to load chat logs.', {
        resourceName: 'chat_logs',
      });
    }

    const profileMap = await fetchProfilesMap((data || []).map((row) => row.user_id));
    return {
      rows: (data || []).map((row) => ({
        ...row,
        username: profileMap[row.user_id]?.username || null,
      })),
      total: count || 0,
      page,
      limit,
    };
  }

  if (pathname === '/admin/errors') {
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 25)));
    const { data, error, count } = await client
      .from('chat_errors')
      .select('id, user_id, error_type, error_message, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { rows: [], total: 0 };
    }

    return {
      rows: data || [],
      total: count || 0,
    };
  }

  if (pathname === '/admin/users') {
    const { data, error } = await client
      .from('profiles')
      .select('id, username, email, created_at, is_admin, is_public')
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

  if (pathname === '/search') {
    return handleSearch(searchParams);
  }

  if (pathname.startsWith('/notifications')) {
    if (normalizedMethod === 'GET') {
      return handleNotifications(pathname);
    }

    return handleNotificationMutation(normalizedMethod, pathname);
  }

  if (pathname === '/media/tmdb-season') {
    if (normalizedMethod !== 'GET') {
      throw new Error(`Unsupported media route: ${pathname}`);
    }

    return fetchTmdbSeason(searchParams);
  }

  if (pathname.startsWith('/forum')) {
    if (normalizedMethod === 'GET') {
      return handleForumGet(pathname, searchParams);
    }

    return handleForumMutation(normalizedMethod, pathname, body);
  }

  if (pathname.startsWith('/watchroom')) {
    if (normalizedMethod === 'GET') {
      return handleWatchRoomGet(pathname);
    }

    return handleWatchRoomMutation(normalizedMethod, pathname, body);
  }

  if (pathname.startsWith('/profile')) {
    if (normalizedMethod === 'GET') {
      const result = await handleProfileFollowGet(pathname);
      if (result !== null) {
        return result;
      }
    }

    if (normalizedMethod === 'POST' || normalizedMethod === 'DELETE') {
      const result = await handleProfileFollowMutation(normalizedMethod, pathname);
      if (result !== null) {
        return result;
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

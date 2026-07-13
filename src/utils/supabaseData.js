import { getSupabaseSession, getSupabaseUser, isSupabaseConfigured, supabase } from './supabase';
import { resolveUserType } from './userAccess';
import {
  cacheMediaMetadata,
  getCachedMediaMetadata,
} from './mediaMetadataCache';

const PROFILE_TABLE = 'profiles';
const AUTH_REQUEST_TIMEOUT_MS = 8000;
const AUTH_MUTATION_TIMEOUT_MS = 15000;
const PROFILE_SYNC_TIMEOUT_MS = 4000;

const RATING_TABLES = {
  movie: {
    table: 'movie_ratings',
    columns: ['acting', 'writing', 'originality', 'pacing', 'cinematography'],
  },
  tv_show: {
    table: 'tv_show_ratings',
    columns: ['premise', 'originality', 'acting', 'cinematography', 'writing', 'pacing', 'resonance'],
  },
  book: {
    table: 'book_ratings',
    columns: ['prose', 'plot', 'characters', 'originality', 'pacing', 'resonance'],
  },
};

const MEDIA_METADATA_TABLES = {
  movie: {
    table: 'movies',
    columns: 'id, title, year, genre, poster_url',
  },
  tv_show: {
    table: 'tv_shows',
    columns: 'id, title, year, genre, poster_url',
  },
  book: {
    table: 'books',
    columns: 'id, title, year, genre, cover_url',
  },
};

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Add your Supabase URL and publishable key first.');
  }

  return supabase;
}

function toFriendlyError(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  const msg = (error.message || '').toLowerCase();

  // Supabase email rate limit (free tier: 3 emails/hour)
  if (msg.includes('email rate limit') || msg.includes('rate limit exceeded') || error.status === 429) {
    return 'Too many sign-up attempts. Please wait a few minutes and try again, or contact the site admin to set up a custom email provider.';
  }

  if (error.code === '23505') {
    const detail = `${error.message || ''} ${error.details || ''}`.toLowerCase();
    if (detail.includes('username')) {
      return 'Username is already in use.';
    }
    if (detail.includes('email')) {
      return 'Email is already in use.';
    }
    if (detail.includes('watchlist')) {
      return 'Already in watchlist.';
    }
    if (detail.includes('media_id')) {
      return 'You already saved that entry.';
    }
  }

  return error.message || fallbackMessage;
}

function buildUserProfile(authUser, profileRow) {
  const email = profileRow?.email || authUser?.email || '';
  const fallbackUsername =
    profileRow?.username ||
    authUser?.user_metadata?.username ||
    (email.includes('@') ? email.split('@')[0] : 'media-fan');
  const userType = resolveUserType({
    userType: profileRow?.userType ?? authUser?.user_metadata?.userType ?? authUser?.app_metadata?.userType,
    user_type: profileRow?.user_type ?? authUser?.user_metadata?.user_type ?? authUser?.app_metadata?.user_type,
    isAdmin: profileRow?.isAdmin ?? authUser?.user_metadata?.isAdmin ?? authUser?.app_metadata?.isAdmin,
    is_admin: profileRow?.is_admin ?? authUser?.user_metadata?.is_admin ?? authUser?.app_metadata?.is_admin,
    isDev: profileRow?.isDev ?? authUser?.user_metadata?.isDev ?? authUser?.app_metadata?.isDev,
    is_dev: profileRow?.is_dev ?? authUser?.user_metadata?.is_dev ?? authUser?.app_metadata?.is_dev,
  });

  return {
    id: authUser?.id || profileRow?.id,
    username: fallbackUsername,
    email,
    bio: profileRow?.bio || authUser?.user_metadata?.bio || '',
    avatarUrl: profileRow?.avatar_url || authUser?.user_metadata?.avatar_url || null,
    createdAt: profileRow?.created_at || authUser?.created_at || null,
    userType,
    isAdmin: userType === 'admin',
    isDev: userType === 'dev',
  };
}

export function buildSupabaseUserProfile(authUser, profileRow) {
  return buildUserProfile(authUser, profileRow);
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function isTimeoutError(error, timeoutMessage) {
  return error instanceof Error && error.message === timeoutMessage;
}

async function withTimeoutRetry(promiseFactory, timeoutMs, timeoutMessage, retries = 1) {
  let attemptsRemaining = retries;

  while (true) {
    try {
      return await withTimeout(promiseFactory(), timeoutMs, timeoutMessage);
    } catch (error) {
      if (!isTimeoutError(error, timeoutMessage) || attemptsRemaining <= 0) {
        throw error;
      }

      attemptsRemaining -= 1;
      console.warn(`[auth] ${timeoutMessage} Retrying request...`);
    }
  }
}

function buildFallbackProfileRow(authUser, overrides = {}) {
  return {
    id: authUser?.id || null,
    email: overrides.email ?? authUser?.email ?? '',
    username:
      overrides.username ??
      authUser?.user_metadata?.username ??
      (authUser?.email?.includes('@') ? authUser.email.split('@')[0] : 'media-fan'),
    bio: overrides.bio ?? authUser?.user_metadata?.bio ?? '',
    avatar_url:
      overrides.avatarUrl ??
      overrides.avatar_url ??
      authUser?.user_metadata?.avatar_url ??
      null,
    created_at: authUser?.created_at ?? null,
  };
}

async function getStoredSupabaseProfile(authUser, overrides = {}) {
  const fallbackProfile = buildUserProfile(authUser, buildFallbackProfileRow(authUser, overrides));

  if (!authUser?.id) {
    return {
      profile: fallbackProfile,
      hasStoredProfile: false,
    };
  }

  try {
    const profileRow = await withTimeout(
      getProfileRow(authUser.id),
      PROFILE_SYNC_TIMEOUT_MS,
      'Reading the Supabase profile timed out.'
    );

    if (profileRow) {
      return {
        profile: buildUserProfile(authUser, profileRow),
        hasStoredProfile: true,
      };
    }
  } catch {}

  return {
    profile: fallbackProfile,
    hasStoredProfile: false,
  };
}

async function getAuthenticatedUser() {
  const { data, error } = await withTimeout(
    getSupabaseUser(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Reading the current Supabase user timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to read your Supabase session.'));
  }

  if (!data.user) {
    throw new Error('Please log in to continue.');
  }

  return data.user;
}

async function getProfileRow(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from(PROFILE_TABLE)
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your profile.'));
  }

  return data;
}

async function saveProfileRow(userId, payload, hasExistingProfile) {
  const client = requireSupabase();
  const query = hasExistingProfile
    ? client.from(PROFILE_TABLE).update(payload).eq('id', userId)
    : client.from(PROFILE_TABLE).insert({ id: userId, ...payload });

  const { data, error } = await query.select().single();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to save your profile.'));
  }

  return data;
}

export async function ensureSupabaseProfile(authUser, overrides = {}) {
  const profileRow = await getProfileRow(authUser.id);

  const nextProfile = {
    email: overrides.email ?? profileRow?.email ?? authUser.email ?? '',
    username:
      overrides.username ??
      profileRow?.username ??
      authUser.user_metadata?.username ??
      (authUser.email?.includes('@') ? authUser.email.split('@')[0] : 'media-fan'),
    bio: overrides.bio ?? profileRow?.bio ?? authUser.user_metadata?.bio ?? '',
    avatar_url:
      overrides.avatarUrl ??
      overrides.avatar_url ??
      profileRow?.avatar_url ??
      authUser.user_metadata?.avatar_url ??
      null,
  };

  const profileNeedsWrite =
    !profileRow ||
    profileRow.email !== nextProfile.email ||
    profileRow.username !== nextProfile.username ||
    profileRow.bio !== nextProfile.bio ||
    (profileRow.avatar_url || null) !== (nextProfile.avatar_url || null);

  const savedProfile = profileNeedsWrite
    ? await saveProfileRow(authUser.id, nextProfile, Boolean(profileRow))
    : profileRow;

  return buildUserProfile(authUser, savedProfile);
}

export async function resolveSupabaseProfile(authUser, overrides = {}) {
  const { profile: fallbackProfile, hasStoredProfile } = await getStoredSupabaseProfile(authUser, overrides);

  if (hasStoredProfile) {
    void ensureSupabaseProfile(authUser, overrides).catch(() => {});
    return fallbackProfile;
  }

  try {
    return await withTimeout(
      ensureSupabaseProfile(authUser, overrides),
      PROFILE_SYNC_TIMEOUT_MS,
      'Supabase profile sync timed out.'
    );
  } catch (error) {
    console.warn('[auth] Falling back to auth metadata while profile sync is unavailable.', error);
    return fallbackProfile;
  }
}

export async function getSupabaseSessionProfile() {
  const { data, error } = await withTimeout(
    getSupabaseSession(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Restoring the Supabase session timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to restore your session.'));
  }

  if (!data.session?.user) {
    return null;
  }

  return resolveSupabaseProfile(data.session.user);
}

export async function signInWithSupabase({ email, password }) {
  const client = requireSupabase();
  const { data, error } = await withTimeoutRetry(
    () => client.auth.signInWithPassword({ email, password }),
    AUTH_MUTATION_TIMEOUT_MS,
    'Supabase sign-in timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to log in.'));
  }

  if (!data.user) {
    throw new Error('Unable to log in.');
  }

  return resolveSupabaseProfile(data.user);
}

export async function signUpWithSupabase({ username, email, password, bio, avatarUrl }) {
  const client = requireSupabase();
  const { data, error } = await withTimeoutRetry(
    () => client.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          bio,
          avatar_url: avatarUrl || null,
        },
      },
    }),
    AUTH_MUTATION_TIMEOUT_MS,
    'Supabase sign-up timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to create your account.'));
  }

  if (!data.user) {
    throw new Error('Unable to create your account.');
  }

  if (!data.session) {
    return {
      user: null,
      requiresEmailConfirmation: true,
    };
  }

  const user = await resolveSupabaseProfile(data.user, {
    username,
    email,
    bio,
    avatarUrl,
  });

  return {
    user,
    requiresEmailConfirmation: false,
  };
}

export async function signOutFromSupabase() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to log out.'));
  }
}

export async function updateSupabaseProfile({ username, email, bio, avatarUrl }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const metadataUpdates = {
    username,
    bio,
    avatar_url: avatarUrl || null,
  };

  const authPayload = {};
  if (email && email !== authUser.email) {
    authPayload.email = email;
  }
  authPayload.data = metadataUpdates;

  const { data, error } = await client.auth.updateUser(authPayload);
  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update your account.'));
  }

  return ensureSupabaseProfile(data.user || authUser, {
    username,
    email,
    bio,
    avatarUrl,
  });
}

export async function uploadSupabaseAvatar(file) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  if (!file) throw new Error('No file provided.');
  if (!file.type.startsWith('image/')) throw new Error('File must be an image (JPEG, PNG, WebP, etc.).');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');

  const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${authUser.id}/avatar.${ext}`;

  const { error: uploadError } = await client.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    if (uploadError.message?.includes('Bucket not found')) {
      throw new Error('Avatar storage is not configured. Ask an admin to create the "avatars" bucket in Supabase Storage.');
    }
    throw new Error(uploadError.message || 'Upload failed.');
  }

  const { data } = client.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the browser shows the new image immediately
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function updateSupabasePassword(newPassword) {
  const client = requireSupabase();
  const { error } = await client.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update your password.'));
  }
}

export async function fetchSupabaseProfiles({ excludeUserId = null, filter = '', limit = null } = {}) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  let query = client.from(PROFILE_TABLE).select('id,username,bio,avatar_url,created_at').order('created_at', { ascending: false });

  if (limit != null) {
    query = query.limit(limit);
  }

  let wrappedQuery = query;
  if (excludeUserId || excludeUserId === null) {
    wrappedQuery = wrappedQuery.not('id', 'eq', excludeUserId || authUser.id);
  }

  if (filter) {
    wrappedQuery = wrappedQuery.ilike('username', `%${filter}%`);
  }

  const { data, error } = await wrappedQuery;

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load profiles.'));
  }

  return data || [];
}

export function calculateTasteMatch(currentRatings = [], otherRatings = []) {
  const currentMap = new Map(
    currentRatings.map((rating) => [
      `${rating.media_type}:${rating.media_id}`,
      averageRatingValue(rating),
    ])
  );

  const shared = otherRatings
    .map((rating) => ({
      key: `${rating.media_type}:${rating.media_id}`,
      value: averageRatingValue(rating),
    }))
    .filter((rating) => currentMap.has(rating.key));

  if (!shared.length) {
    return 0;
  }

  const totalSimilarity = shared.reduce((sum, rating) => {
    const ownValue = currentMap.get(rating.key);
    const difference = Math.abs(ownValue - rating.value);
    return sum + Math.max(0, 1 - difference / 4);
  }, 0);

  return Math.round((totalSimilarity / shared.length) * 100);
}

function averageRatingValue(rating) {
  const schema = RATING_TABLES[rating.media_type];
  if (!schema) {
    return 0;
  }

  const values = schema.columns
    .map((column) => Number(rating[column]))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function enrichMediaRecord(record, mediaType, metadata) {
  const item = metadata || null;

  return {
    ...record,
    media_type: mediaType,
    title: item?.title || `Saved ${mediaType.replace('_', ' ')}`,
    year: item?.year ?? null,
    genre: item?.genre ?? null,
    image_url: item?.image_url || null,
  };
}

async function fetchMediaMetadataMap(mediaType, mediaIds) {
  const client = requireSupabase();
  const schema = MEDIA_METADATA_TABLES[mediaType];
  if (!schema || mediaIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client
    .from(schema.table)
    .select(schema.columns)
    .in('id', mediaIds);

  if (error) {
    return new Map();
  }

  return new Map(
    (data || [])
      .map((item) => {
        const metadata = cacheMediaMetadata(mediaType, item);
        return metadata ? [metadata.id, metadata] : null;
      })
      .filter(Boolean)
  );
}

async function enrichMediaRecords(records = []) {
  if (!Array.isArray(records)) {
    return [];
  }

  const pendingIdsByType = {
    movie: new Set(),
    tv_show: new Set(),
    book: new Set(),
  };

  records.forEach((record) => {
    const mediaType = record.media_type;
    const mediaId = Number(record.media_id);
    if (!MEDIA_METADATA_TABLES[mediaType] || !Number.isFinite(mediaId)) {
      return;
    }

    if (!getCachedMediaMetadata(mediaType, mediaId)) {
      pendingIdsByType[mediaType].add(mediaId);
    }
  });

  const fetchedMaps = {};
  await Promise.all(
    Object.entries(pendingIdsByType).map(async ([mediaType, pendingIds]) => {
      fetchedMaps[mediaType] = await fetchMediaMetadataMap(mediaType, [...pendingIds]);
    })
  );

  return records.map((record) => {
    const mediaType = record.media_type;
    const mediaId = Number(record.media_id);
    const metadata =
      getCachedMediaMetadata(mediaType, mediaId) ||
      fetchedMaps[mediaType]?.get(mediaId) ||
      null;

    return enrichMediaRecord(record, mediaType, metadata);
  });
}

export async function fetchSupabaseWatchlist({ mediaType = '', status = '', userId = null } = {}) {
  const client = requireSupabase();
  if (!userId) {
    const authUser = await getAuthenticatedUser();
    userId = authUser.id;
  }

  function applyFilters(query) {
    let nextQuery = query.eq('user_id', userId);

    if (mediaType) {
      nextQuery = nextQuery.eq('media_type', mediaType);
    }

    if (status) {
      nextQuery = nextQuery.eq('status', status);
    }

    return nextQuery;
  }

  let result = await applyFilters(
    client
      .from('watchlist')
      .select('id, user_id, media_type, media_id, status, added_at, current_season, current_episode, current_page, current_chapter, updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('added_at', { ascending: false })
  );

  if (result.error && /current_|updated_at|column|schema cache/i.test(result.error.message || '')) {
    result = await applyFilters(
      client
        .from('watchlist')
        .select('id, user_id, media_type, media_id, status, added_at')
        .order('added_at', { ascending: false })
    );
  }

  if (result.error) {
    throw new Error(toFriendlyError(result.error, 'Unable to load your library.'));
  }

  return enrichMediaRecords(result.data || []);
}

export async function addSupabaseWatchlistItem({ mediaType, mediaId, status = 'plan_to_watch', media = null }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const { data: existing, error: existingError } = await client
    .from('watchlist')
    .select('id')
    .eq('media_type', mediaType)
    .eq('media_id', Number(mediaId))
    .maybeSingle();

  if (existingError) {
    throw new Error(toFriendlyError(existingError, 'Unable to check your library.'));
  }

  if (existing) {
    throw new Error('Already in watchlist.');
  }

  const { data, error } = await client
    .from('watchlist')
    .insert({
      user_id: authUser.id,
      media_type: mediaType,
      media_id: Number(mediaId),
      status,
    })
    .select('id, media_type, media_id, status, added_at')
    .single();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to save that title.'));
  }

  const metadata = media ? cacheMediaMetadata(mediaType, media) : getCachedMediaMetadata(mediaType, mediaId);
  return enrichMediaRecord(data, data.media_type, metadata);
}

export async function updateSupabaseWatchlistStatus(id, status) {
  const client = requireSupabase();
  const { error } = await client
    .from('watchlist')
    .update({ status })
    .eq('id', id);

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update that library item.'));
  }
}

export async function removeSupabaseWatchlistItem(id) {
  const client = requireSupabase();
  const { error } = await client
    .from('watchlist')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to remove that library item.'));
  }
}

async function fetchRawRatingsForMediaType(mediaType, userId = null) {
  const client = requireSupabase();
  const schema = RATING_TABLES[mediaType];

  if (!schema) {
    return [];
  }

  if (!userId) {
    const authUser = await getAuthenticatedUser();
    userId = authUser.id;
  }

  const selectColumns = ['id', 'user_id', 'media_id', ...schema.columns, 'review', 'created_at'].join(', ');
  const { data, error } = await client
    .from(schema.table)
    .select(selectColumns)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your ratings.'));
  }

  return (data || []).map((record) => ({
    ...record,
    media_type: mediaType,
  }));
}

export async function fetchSupabaseRatings({ mediaType = '', userId = null } = {}) {
  if (mediaType) {
    const ratings = await fetchRawRatingsForMediaType(mediaType, userId);
    return enrichMediaRecords(ratings);
  }

  const selectedUserId = userId || (await getAuthenticatedUser()).id;
  const grouped = await Promise.all(
    Object.keys(RATING_TABLES).map((type) => fetchRawRatingsForMediaType(type, selectedUserId))
  );

  const enrichedRatings = await enrichMediaRecords(grouped.flat());
  return enrichedRatings
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
}

export async function fetchSupabaseRatingMap(mediaType) {
  const ratings = await fetchRawRatingsForMediaType(mediaType);
  return ratings.reduce((accumulator, rating) => {
    accumulator[rating.media_id] = rating;
    return accumulator;
  }, {});
}

export async function saveSupabaseRating({ mediaType, mediaId, categories, review = '', media = null }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const schema = RATING_TABLES[mediaType];

  if (!schema) {
    throw new Error('Invalid media type.');
  }

  const payload = {
    user_id: authUser.id,
    media_id: Number(mediaId),
    review: review || null,
  };

  schema.columns.forEach((column) => {
    payload[column] = Number(categories[column]);
  });

  const { error } = await client
    .from(schema.table)
    .upsert(payload, { onConflict: 'user_id,media_id' });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to save your rating.'));
  }

  if (media) {
    cacheMediaMetadata(mediaType, media);
  }
}

export async function fetchSupabaseDashboardCounts() {
  const client = requireSupabase();

  const watchlistCountPromise = client
    .from('watchlist')
    .select('id', { head: true, count: 'exact' });

  const ratingsCountPromises = Object.values(RATING_TABLES).map((schema) =>
    client.from(schema.table).select('id', { head: true, count: 'exact' })
  );

  const [watchlistResult, ...ratingResults] = await Promise.all([
    watchlistCountPromise,
    ...ratingsCountPromises,
  ]);

  const allErrors = [watchlistResult, ...ratingResults]
    .map((result) => result.error)
    .filter(Boolean);

  if (allErrors.length > 0) {
    throw new Error(toFriendlyError(allErrors[0], 'Unable to load your dashboard stats.'));
  }

  return {
    watchlist: Number(watchlistResult.count) || 0,
    ratings: ratingResults.reduce((sum, result) => sum + (Number(result.count) || 0), 0),
  };
}

function normalizeSharedListName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return slug || 'shared-list';
}

function buildShareCode(name) {
  const slug = normalizeSharedListName(name);
  const random = Math.random().toString(36).slice(2, 8);
  return `${slug}-${random}`;
}

async function generateUniqueShareCode(client, name) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareCode = buildShareCode(name);
    const { data, error } = await client
      .from('media_lists')
      .select('id')
      .eq('share_code', shareCode)
      .maybeSingle();

    if (error) {
      throw new Error(toFriendlyError(error, 'Unable to create a share code.'));
    }

    if (!data) {
      return shareCode;
    }
  }

  throw new Error('Unable to generate a unique share code. Please try again.');
}

function buildListPermissions(list, currentUserId, collaboratorUserIds = []) {
  const isOwner = list.user_id === currentUserId;
  const isCollaborator = collaboratorUserIds.includes(currentUserId);
  const canEdit = isOwner || isCollaborator;
  const canView = Boolean(list.is_public || canEdit);

  return {
    canView,
    canEdit,
    canManage: isOwner,
    canVote: canEdit,
    role: isOwner ? 'owner' : isCollaborator ? 'collaborator' : 'viewer',
  };
}

function buildConsensusPick(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const [topItem] = [...items].sort((left, right) => {
    if ((right.vibe_score || 0) !== (left.vibe_score || 0)) {
      return (right.vibe_score || 0) - (left.vibe_score || 0);
    }
    if ((right.upvotes || 0) !== (left.upvotes || 0)) {
      return (right.upvotes || 0) - (left.upvotes || 0);
    }
    if ((left.downvotes || 0) !== (right.downvotes || 0)) {
      return (left.downvotes || 0) - (right.downvotes || 0);
    }
    return (left.position || 0) - (right.position || 0);
  });

  return topItem || null;
}

function mergeMediaMetadata(item, metadata) {
  if (!metadata) {
    return item;
  }

  const imageUrl =
    item.media_type === 'book'
      ? metadata.cover_url || null
      : metadata.poster_url || null;

  return {
    ...item,
    title: metadata.title || item.title,
    year: metadata.year || item.year,
    genre: metadata.genre || item.genre,
    image_url: imageUrl || item.image_url || null,
    creator_name:
      item.media_type === 'movie'
        ? metadata.director || item.creator_name
        : item.media_type === 'tv_show'
        ? metadata.creator || item.creator_name
        : metadata.author || item.creator_name,
    synopsis:
      metadata.overview || metadata.synopsis || item.synopsis || null,
  };
}

async function fetchMediaMetadata(client, mediaType, ids) {
  if (!ids.length) {
    return [];
  }

  const table = mediaType === 'movie' ? 'movies' : mediaType === 'tv_show' ? 'tv_shows' : 'books';
  const selectColumns =
    mediaType === 'book'
      ? 'id,title,year,genre,cover_url,author,synopsis'
      : mediaType === 'movie'
      ? 'id,title,year,genre,poster_url,director,overview'
      : 'id,title,year,genre,poster_url,creator,overview';

  const { data, error } = await client.from(table).select(selectColumns).in('id', ids);
  if (error) {
    throw new Error(toFriendlyError(error, `Unable to load ${mediaType} metadata.`));
  }

  return data || [];
}

async function loadListItems(client, listId, currentUserId) {
  const { data: rows, error } = await client
    .from('media_list_items')
    .select('id,list_id,media_type,media_id,position,added_at')
    .eq('list_id', listId)
    .order('position', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load list items.'));
  }

  const items = rows || [];
  const groupedIds = items.reduce(
    (groups, item) => {
      if (!groups[item.media_type]) {
        groups[item.media_type] = new Set();
      }
      groups[item.media_type].add(item.media_id);
      return groups;
    },
    { movie: new Set(), tv_show: new Set(), book: new Set() }
  );

  const [movies, tvShows, books] = await Promise.all([
    fetchMediaMetadata(client, 'movie', [...groupedIds.movie]),
    fetchMediaMetadata(client, 'tv_show', [...groupedIds.tv_show]),
    fetchMediaMetadata(client, 'book', [...groupedIds.book]),
  ]);

  const metadataByType = {
    movie: Object.fromEntries((movies || []).map((item) => [item.id, item])),
    tv_show: Object.fromEntries((tvShows || []).map((item) => [item.id, item])),
    book: Object.fromEntries((books || []).map((item) => [item.id, item])),
  };

  const itemIds = items.map((item) => item.id);
  const { data: voteRows, error: voteError } = await client
    .from('media_list_votes')
    .select('list_item_id,user_id,value')
    .in('list_item_id', itemIds.length ? itemIds : [0]);

  if (voteError) {
    throw new Error(toFriendlyError(voteError, 'Unable to load list votes.'));
  }

  const voteMap = itemIds.reduce((acc, itemId) => {
    acc[itemId] = { vibe_score: 0, upvotes: 0, downvotes: 0, my_vote: 0 };
    return acc;
  }, {});

  (voteRows || []).forEach((vote) => {
    const itemVotes = voteMap[vote.list_item_id];
    if (!itemVotes) return;
    const value = Number(vote.value) || 0;
    itemVotes.vibe_score += value;
    if (value === 1) itemVotes.upvotes += 1;
    if (value === -1) itemVotes.downvotes += 1;
    if (vote.user_id === currentUserId) {
      itemVotes.my_vote = value;
    }
  });

  // Fetch user's watchlist status for items in this list
  let watchlistStatusMap = {};
  if (currentUserId && items.length) {
    const byType = items.reduce((acc, it) => {
      if (!acc[it.media_type]) acc[it.media_type] = [];
      acc[it.media_type].push(it.media_id);
      return acc;
    }, {});
    const wlQueries = Object.entries(byType).map(([mt, ids]) =>
      client.from('watchlist').select('media_type,media_id,status').eq('user_id', currentUserId).eq('media_type', mt).in('media_id', ids)
    );
    const wlResults = await Promise.all(wlQueries);
    wlResults.forEach(({ data }) => {
      (data || []).forEach(row => {
        watchlistStatusMap[`${row.media_type}:${row.media_id}`] = row.status;
      });
    });
  }

  return items
    .map((item) => {
      const metadata = metadataByType[item.media_type]?.[item.media_id] || null;
      const merged = mergeMediaMetadata(item, metadata);
      const votes = voteMap[item.id] || { vibe_score: 0, upvotes: 0, downvotes: 0, my_vote: 0 };
      return {
        ...merged,
        vibe_score: Number(votes.vibe_score) || 0,
        upvotes: Number(votes.upvotes) || 0,
        downvotes: Number(votes.downvotes) || 0,
        my_vote: Number(votes.my_vote) || 0,
        my_watchlist_status: watchlistStatusMap[`${item.media_type}:${item.media_id}`] || null,
      };
    })
    .filter((item) => Boolean(item.title));
}

async function buildSupabaseListPayload(client, list, currentUserId, collaboratorUserIds = []) {
  const ownerProfile = await client
    .from('profiles')
    .select('id,username')
    .eq('id', list.user_id)
    .maybeSingle();

  if (ownerProfile.error) {
    throw new Error(toFriendlyError(ownerProfile.error, 'Unable to load list owner details.'));
  }

  const collaboratorsQuery = await client
    .from('media_list_collaborators')
    .select('user_id')
    .eq('list_id', list.id);

  if (collaboratorsQuery.error) {
    throw new Error(toFriendlyError(collaboratorsQuery.error, 'Unable to load collaborator details.'));
  }

  const collaboratorUserIdsFromRows = (collaboratorsQuery.data || []).map((row) => row.user_id);
  const collaboratorProfiles = collaboratorUserIdsFromRows.length
    ? await client.from('profiles').select('id,username').in('id', collaboratorUserIdsFromRows)
    : { data: [] };

  if (collaboratorProfiles.error) {
    throw new Error(toFriendlyError(collaboratorProfiles.error, 'Unable to load collaborator profiles.'));
  }

  const allCollaborators = [
    {
      id: list.user_id,
      username: ownerProfile.data?.username || 'Unknown',
      role: 'owner',
    },
    ...(collaboratorProfiles.data || []).map((profile) => ({
      id: profile.id,
      username: profile.username,
      role: 'collaborator',
    })),
  ];

  const items = await loadListItems(client, list.id, currentUserId);
  const permissions = buildListPermissions(list, currentUserId, collaboratorUserIdsFromRows);

  return {
    id: list.id,
    name: list.name,
    share_code: list.share_code,
    is_public: Boolean(list.is_public),
    created_at: list.created_at,
    updated_at: list.updated_at,
    owner: {
      id: list.user_id,
      username: ownerProfile.data?.username || 'Unknown',
    },
    permissions,
    collaborators: allCollaborators,
    items,
    consensus_pick: buildConsensusPick(items),
  };
}

async function getOptionalSupabaseUserId() {
  const { data, error } = await getSupabaseSession();
  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to read Supabase session.'));
  }
  return data?.session?.user?.id || null;
}

async function fetchSupabaseListById(listId, currentUserId) {
  const client = requireSupabase();
  const { data: list, error } = await client.from('media_lists').select('*').eq('id', Number(listId)).maybeSingle();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load the list.'));
  }
  if (!list) {
    throw new Error('List not found.');
  }

  const collaboratorRows = await client
    .from('media_list_collaborators')
    .select('user_id')
    .eq('list_id', list.id);

  if (collaboratorRows.error) {
    throw new Error(toFriendlyError(collaboratorRows.error, 'Unable to load list collaborators.'));
  }

  const collaboratorUserIds = (collaboratorRows.data || []).map((row) => row.user_id);
  const permissions = buildListPermissions(list, currentUserId, collaboratorUserIds);

  if (!permissions.canView) {
    throw new Error('List not found.');
  }

  return buildSupabaseListPayload(client, list, currentUserId, collaboratorUserIds);
}

export async function fetchSupabaseLists() {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const currentUserId = authUser.id;

  const { data: collaboratorRows, error: collaboratorError } = await client
    .from('media_list_collaborators')
    .select('list_id')
    .eq('user_id', currentUserId);

  if (collaboratorError) {
    throw new Error(toFriendlyError(collaboratorError, 'Unable to load your lists.'));
  }

  const collaboratorListIds = (collaboratorRows || []).map((row) => row.list_id);
  const hasCollaboratorLists = collaboratorListIds.length > 0;

  const query = client.from('media_lists').select('id,name,share_code,is_public,created_at,updated_at,user_id');
  if (hasCollaboratorLists) {
    query.or(`user_id.eq.${currentUserId},id.in.(${collaboratorListIds.join(',')})`);
  } else {
    query.eq('user_id', currentUserId);
  }
  query.order('updated_at', { ascending: false }).order('created_at', { ascending: false });

  const { data: lists, error: listError } = await query;
  if (listError) {
    throw new Error(toFriendlyError(listError, 'Unable to load your lists.'));
  }

  const listRows = lists || [];
  if (!listRows.length) {
    return [];
  }

  const listIds = listRows.map((list) => list.id);
  const { data: itemRows, error: itemError } = await client
    .from('media_list_items')
    .select('list_id')
    .in('list_id', listIds);

  if (itemError) {
    throw new Error(toFriendlyError(itemError, 'Unable to load list counts.'));
  }

  const { data: collaboratorCountRows, error: collaboratorCountError } = await client
    .from('media_list_collaborators')
    .select('list_id')
    .in('list_id', listIds);

  if (collaboratorCountError) {
    throw new Error(toFriendlyError(collaboratorCountError, 'Unable to load collaborator counts.'));
  }

  const ownerIds = [...new Set(listRows.map((list) => list.user_id))];
  const { data: ownerProfiles, error: ownerError } = await client
    .from('profiles')
    .select('id,username')
    .in('id', ownerIds);

  if (ownerError) {
    throw new Error(toFriendlyError(ownerError, 'Unable to load list owners.'));
  }

  const itemCounts = (itemRows || []).reduce((acc, row) => {
    acc[row.list_id] = (acc[row.list_id] || 0) + 1;
    return acc;
  }, {});

  const collaboratorCounts = (collaboratorCountRows || []).reduce((acc, row) => {
    acc[row.list_id] = (acc[row.list_id] || 0) + 1;
    return acc;
  }, {});

  const ownerMap = Object.fromEntries((ownerProfiles || []).map((profile) => [profile.id, profile.username]));

  return listRows.map((list) => ({
    id: list.id,
    name: list.name,
    share_code: list.share_code,
    is_public: Boolean(list.is_public),
    created_at: list.created_at,
    updated_at: list.updated_at,
    owner_username: ownerMap[list.user_id] || 'Unknown',
    item_count: Number(itemCounts[list.id] || 0),
    collaborator_count: Number(collaboratorCounts[list.id] || 0),
    permissions: {
      canView: true,
      canEdit: true,
      canManage: list.user_id === currentUserId,
      canVote: true,
      role: list.user_id === currentUserId ? 'owner' : 'collaborator',
    },
  }));
}

export async function fetchSupabasePublicLists({ limit = 40, search = '' } = {}) {
  const client = requireSupabase();
  let query = client
    .from('media_lists')
    .select('id,name,share_code,is_public,created_at,updated_at,user_id')
    .eq('is_public', true)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`);
  }

  const { data: lists, error } = await query;
  if (error) throw new Error(toFriendlyError(error, 'Unable to load public lists.'));

  const listRows = lists || [];
  if (!listRows.length) return [];

  const listIds = listRows.map(l => l.id);
  const ownerIds = [...new Set(listRows.map(l => l.user_id))];

  const [{ data: itemRows }, { data: ownerProfiles }] = await Promise.all([
    client.from('media_list_items').select('list_id').in('list_id', listIds),
    client.from('profiles').select('id,username').in('id', ownerIds),
  ]);

  const itemCounts = (itemRows || []).reduce((acc, r) => {
    acc[r.list_id] = (acc[r.list_id] || 0) + 1;
    return acc;
  }, {});
  const ownerMap = Object.fromEntries((ownerProfiles || []).map(p => [p.id, p.username]));

  return listRows.map(list => ({
    id: list.id,
    name: list.name,
    share_code: list.share_code,
    is_public: true,
    created_at: list.created_at,
    updated_at: list.updated_at,
    owner_username: ownerMap[list.user_id] || 'Unknown',
    item_count: Number(itemCounts[list.id] || 0),
  }));
}

export async function createSupabaseList({ name, isPublic = false }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const normalizedName = String(name || '').trim().slice(0, 80);

  if (!normalizedName) {
    throw new Error('A list name is required.');
  }

  const shareCode = await generateUniqueShareCode(client, normalizedName);
  const { data, error } = await client
    .from('media_lists')
    .insert([{ user_id: authUser.id, name: normalizedName, share_code: shareCode, is_public: Boolean(isPublic) }])
    .select()
    .single();

  if (error || !data) {
    throw new Error(toFriendlyError(error, 'Unable to create the list.'));
  }

  return buildSupabaseListPayload(client, data, authUser.id);
}

export async function fetchSupabaseList(listId) {
  const authUser = await getAuthenticatedUser();
  return fetchSupabaseListById(listId, authUser.id);
}

export async function fetchSupabaseSharedList(shareCode) {
  const client = requireSupabase();
  const currentUserId = await getOptionalSupabaseUserId();
  const { data: list, error } = await client
    .from('media_lists')
    .select('*')
    .eq('share_code', shareCode)
    .maybeSingle();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load the shared list.'));
  }
  if (!list) {
    throw new Error('List not found.');
  }

  const collaboratorRows = await client
    .from('media_list_collaborators')
    .select('user_id')
    .eq('list_id', list.id);

  if (collaboratorRows.error) {
    throw new Error(toFriendlyError(collaboratorRows.error, 'Unable to load list collaborators.'));
  }

  const collaboratorUserIds = (collaboratorRows.data || []).map((row) => row.user_id);
  const permissions = buildListPermissions(list, currentUserId, collaboratorUserIds);

  if (!permissions.canView) {
    throw new Error('List not found.');
  }

  return buildSupabaseListPayload(client, list, currentUserId, collaboratorUserIds);
}

export async function updateSupabaseList(listId, { name, isPublic }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const { data: list, error: listError } = await client
    .from('media_lists')
    .select('*')
    .eq('id', Number(listId))
    .maybeSingle();

  if (listError) {
    throw new Error(toFriendlyError(listError, 'Unable to load the list.'));
  }
  if (!list) {
    throw new Error('List not found.');
  }
  if (list.user_id !== authUser.id) {
    throw new Error('You do not have permission to update this list.');
  }

  const normalizedName = String(name || '').trim().slice(0, 80);
  if (!normalizedName) {
    throw new Error('A list name is required.');
  }

  const { data: updatedList, error: updateError } = await client
    .from('media_lists')
    .update({ name: normalizedName, is_public: Boolean(isPublic) })
    .eq('id', Number(listId))
    .select()
    .single();

  if (updateError || !updatedList) {
    throw new Error(toFriendlyError(updateError, 'Unable to save the list settings.'));
  }

  return buildSupabaseListPayload(client, updatedList, authUser.id);
}

export async function deleteSupabaseList(listId) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const { data: list, error: listError } = await client
    .from('media_lists')
    .select('user_id')
    .eq('id', Number(listId))
    .maybeSingle();

  if (listError) {
    throw new Error(toFriendlyError(listError, 'Unable to load the list.'));
  }
  if (!list) {
    throw new Error('List not found.');
  }
  if (list.user_id !== authUser.id) {
    throw new Error('You do not have permission to delete this list.');
  }

  const { error: deleteError } = await client.from('media_lists').delete().eq('id', Number(listId));
  if (deleteError) {
    throw new Error(toFriendlyError(deleteError, 'Unable to delete the list.'));
  }

  return { success: true };
}

export async function inviteSupabaseListCollaborator(listId, username) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const { data: list, error: listError } = await client
    .from('media_lists')
    .select('*')
    .eq('id', Number(listId))
    .maybeSingle();

  if (listError) {
    throw new Error(toFriendlyError(listError, 'Unable to load the list.'));
  }
  if (!list) {
    throw new Error('List not found.');
  }
  if (list.user_id !== authUser.id) {
    throw new Error('You do not have permission to invite collaborators.');
  }

  const normalizedUsername = String(username || '').trim();
  if (!normalizedUsername) {
    throw new Error('A username is required to invite a collaborator.');
  }

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id,username')
    .ilike('username', normalizedUsername)
    .maybeSingle();

  if (profileError) {
    throw new Error(toFriendlyError(profileError, 'Unable to look up that username.'));
  }
  if (!profile) {
    throw new Error('No user with that username was found.');
  }
  if (profile.id === authUser.id) {
    throw new Error('The owner already has access to this list.');
  }

  const { data: existing, error: existingError } = await client
    .from('media_list_collaborators')
    .select('id')
    .match({ list_id: list.id, user_id: profile.id })
    .maybeSingle();

  if (existingError) {
    throw new Error(toFriendlyError(existingError, 'Unable to verify collaboration status.'));
  }
  if (existing) {
    throw new Error('That user is already a collaborator.');
  }

  const { error: insertError } = await client.from('media_list_collaborators').insert([
    { list_id: list.id, user_id: profile.id, invited_by_user_id: authUser.id },
  ]);

  if (insertError) {
    throw new Error(toFriendlyError(insertError, 'Unable to add collaborator.'));
  }

  return fetchSupabaseList(list.id);
}

export async function removeSupabaseListCollaborator(listId, collaboratorId) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const { data: list, error: listError } = await client
    .from('media_lists')
    .select('*')
    .eq('id', Number(listId))
    .maybeSingle();

  if (listError) {
    throw new Error(toFriendlyError(listError, 'Unable to load the list.'));
  }
  if (!list) {
    throw new Error('List not found.');
  }
  if (list.user_id !== authUser.id) {
    throw new Error('You do not have permission to remove collaborators.');
  }

  const { error: deleteError } = await client
    .from('media_list_collaborators')
    .delete()
    .match({ list_id: list.id, user_id: Number(collaboratorId) });

  if (deleteError) {
    throw new Error(toFriendlyError(deleteError, 'Unable to remove collaborator.'));
  }

  return fetchSupabaseList(list.id);
}

export async function voteSupabaseListItem(listId, itemId, value) {
  const authUser = await getAuthenticatedUser();
  const list = await fetchSupabaseList(listId);
  if (!list.permissions?.canEdit) {
    throw new Error('You do not have permission to vote in this list.');
  }

  const client = requireSupabase();
  const normalizedValue = Number(value);

  if (normalizedValue === 0) {
    const { error } = await client
      .from('media_list_votes')
      .delete()
      .match({ list_item_id: Number(itemId), user_id: authUser.id });
    if (error) {
      throw new Error(toFriendlyError(error, 'Unable to update your vote.'));
    }
  } else {
    const { error } = await client
      .from('media_list_votes')
      .upsert(
        {
          list_item_id: Number(itemId),
          user_id: authUser.id,
          value: normalizedValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: ['list_item_id', 'user_id'] }
      );

    if (error) {
      throw new Error(toFriendlyError(error, 'Unable to update your vote.'));
    }
  }

  return fetchSupabaseList(listId);
}

export async function moveSupabaseListItem(listId, itemId, direction) {
  const list = await fetchSupabaseList(listId);
  if (!list.permissions?.canEdit) {
    throw new Error('You do not have permission to change this list.');
  }

  const items = list.items;
  const currentIndex = items.findIndex((item) => Number(item.id) === Number(itemId));
  if (currentIndex === -1) {
    throw new Error('List item not found.');
  }

  const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (swapIndex < 0 || swapIndex >= items.length) {
    return list;
  }

  const itemA = items[currentIndex];
  const itemB = items[swapIndex];
  const client = requireSupabase();

  const [updateA, updateB] = await Promise.all([
    client
      .from('media_list_items')
      .update({ position: itemB.position })
      .match({ id: itemA.id, list_id: list.id }),
    client
      .from('media_list_items')
      .update({ position: itemA.position })
      .match({ id: itemB.id, list_id: list.id }),
  ]);

  if (updateA.error || updateB.error) {
    throw new Error(toFriendlyError(updateA.error || updateB.error, 'Unable to move list item.'));
  }

  return fetchSupabaseList(listId);
}

export async function removeSupabaseListItem(listId, itemId) {
  const list = await fetchSupabaseList(listId);
  if (!list.permissions?.canEdit) {
    throw new Error('You do not have permission to remove items from this list.');
  }

  const client = requireSupabase();
  const { error: deleteError } = await client
    .from('media_list_items')
    .delete()
    .match({ id: Number(itemId), list_id: list.id });

  if (deleteError) {
    throw new Error(toFriendlyError(deleteError, 'Unable to remove the list item.'));
  }

  const { data: remainingItems, error: remainingError } = await client
    .from('media_list_items')
    .select('id')
    .eq('list_id', list.id)
    .order('position', { ascending: true })
    .order('id', { ascending: true });

  if (remainingError) {
    throw new Error(toFriendlyError(remainingError, 'Unable to refresh list positions.'));
  }

  await Promise.all(
    (remainingItems || []).map((item, index) =>
      client.from('media_list_items').update({ position: index }).eq('id', item.id)
    )
  );

  return fetchSupabaseList(listId);
}

export async function addSupabaseListItem(listId, { mediaType, mediaId }) {
  const list = await fetchSupabaseList(listId);
  if (!list.permissions?.canEdit) {
    throw new Error('You do not have permission to add items to this list.');
  }

  const client = requireSupabase();
  const existingItemQuery = await client
    .from('media_list_items')
    .select('id')
    .match({ list_id: list.id, media_type: mediaType, media_id: Number(mediaId) })
    .maybeSingle();

  if (existingItemQuery.error) {
    throw new Error(toFriendlyError(existingItemQuery.error, 'Unable to verify whether this item already exists.'));
  }

  if (existingItemQuery.data) {
    throw new Error('This item is already in the list.');
  }

  const positionQuery = await client
    .from('media_list_items')
    .select('position')
    .eq('list_id', list.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (positionQuery.error) {
    throw new Error(toFriendlyError(positionQuery.error, 'Unable to determine list position.'));
  }

  const nextPosition = positionQuery.data ? Number(positionQuery.data.position || 0) + 1 : 0;

  const { error } = await client.from('media_list_items').insert([
    {
      list_id: list.id,
      media_type: mediaType,
      media_id: Number(mediaId),
      position: nextPosition,
    },
  ]);

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to add the item to the list.'));
  }

  return fetchSupabaseList(listId);
}

export async function submitSupabaseRequest({ title, media_type, year, reason }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const normalizedTitle = String(title || '').trim();
  const normalizedMediaType = String(media_type || '').trim();

  if (!normalizedTitle) {
    throw new Error('Title is required.');
  }
  if (!['movie', 'tv_show', 'book'].includes(normalizedMediaType)) {
    throw new Error('media_type must be movie, tv_show, or book.');
  }

  const { data: existing, error: existingError } = await client
    .from('media_requests')
    .select('id')
    .eq('user_id', authUser.id)
    .eq('media_type', normalizedMediaType)
    .eq('status', 'pending')
    .ilike('title', normalizedTitle);

  if (existingError) {
    throw new Error(toFriendlyError(existingError, 'Unable to verify existing requests.'));
  }
  if (existing?.length) {
    throw new Error('You already have a pending request for this title.');
  }

  const { data, error } = await client
    .from('media_requests')
    .insert([
      {
        user_id: authUser.id,
        title: normalizedTitle,
        media_type: normalizedMediaType,
        year: year ? Number(year) : null,
        reason: String(reason || '').trim() || null,
      },
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error(toFriendlyError(error, 'Unable to submit your request.'));
  }

  return data;
}

export async function fetchSupabaseAdminRequests(status) {
  const client = requireSupabase();
  const query = client.from('media_requests').select('id,user_id,title,media_type,year,reason,status,admin_note,created_at,updated_at');
  if (status && status !== 'all') {
    query.eq('status', status);
  }
  query.order('created_at', { ascending: false });

  const { data: requests, error } = await query;
  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load media requests.'));
  }

  const requestRows = requests || [];
  if (!requestRows.length) {
    return [];
  }

  const userIds = [...new Set(requestRows.map((request) => request.user_id))];
  const { data: profiles, error: profileError } = await client.from('profiles').select('id,username').in('id', userIds);
  if (profileError) {
    throw new Error(toFriendlyError(profileError, 'Unable to load request authors.'));
  }

  const profileMap = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile.username]));

  return requestRows.map((request) => ({
    ...request,
    username: profileMap[request.user_id] || 'Unknown',
  }));
}

export async function updateSupabaseRequestStatus(id, status, adminNote) {
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    throw new Error('Invalid status.');
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('media_requests')
    .update({ status, admin_note: String(adminNote || '').trim() || null, updated_at: new Date().toISOString() })
    .eq('id', Number(id))
    .select()
    .single();

  if (error || !data) {
    throw new Error(toFriendlyError(error, 'Unable to update the request.'));
  }

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('username')
    .eq('id', data.user_id)
    .maybeSingle();

  if (profileError) {
    throw new Error(toFriendlyError(profileError, 'Unable to load request author.'));
  }

  return {
    ...data,
    username: profile?.username || 'Unknown',
  };
}

// ─── Episode Progress (watched tracking) ──────────────────────────────────────

export async function fetchEpisodeProgress(mediaId) {
  const supabase = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('episode_progress')
    .select('season, episode, watched_at')
    .eq('user_id', user.id)
    .eq('media_id', mediaId);
  if (error) throw toFriendlyError(error, 'Failed to fetch episode progress');
  return data || [];
}

export async function markEpisodeWatched({ mediaId, season, episode }) {
  const supabase = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('episode_progress')
    .upsert({ user_id: user.id, media_id: mediaId, season, episode, watched_at: new Date().toISOString() },
             { onConflict: 'user_id,media_id,season,episode' });
  if (error) throw toFriendlyError(error, 'Failed to mark episode watched');
}

export async function unmarkEpisodeWatched({ mediaId, season, episode }) {
  const supabase = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('episode_progress')
    .delete()
    .eq('user_id', user.id)
    .eq('media_id', mediaId)
    .eq('season', season)
    .eq('episode', episode);
  if (error) throw toFriendlyError(error, 'Failed to unmark episode');
}

// ─── Watchlist Progress Update ─────────────────────────────────────────────────

export async function updateWatchlistProgress({ mediaType, mediaId, currentSeason, currentEpisode, currentPage, currentChapter, status, notes }) {
  const supabase = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Not signed in');

  // Auto-add to watchlist if not present
  const { data: existing } = await supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', user.id)
    .eq('media_type', mediaType)
    .eq('media_id', mediaId)
    .maybeSingle();

  const update = { updated_at: new Date().toISOString() };
  if (status !== undefined)         update.status = status;
  if (currentSeason !== undefined)  update.current_season = currentSeason;
  if (currentEpisode !== undefined) update.current_episode = currentEpisode;
  if (currentPage !== undefined)    update.current_page = currentPage;
  if (currentChapter !== undefined) update.current_chapter = currentChapter;
  if (notes !== undefined)          update.notes = notes;
  if (status === 'completed' || status === 'watched' || status === 'read') update.completed_at = new Date().toISOString();

  if (existing) {
    const { error } = await supabase.from('watchlist').update(update).eq('id', existing.id);
    if (error) throw toFriendlyError(error, 'Failed to update watchlist progress');
  } else {
    const { error } = await supabase.from('watchlist').insert({
      user_id: user.id, media_type: mediaType, media_id: mediaId,
      status: status || (mediaType === 'book' ? 'reading' : 'watching'),
      ...update,
    });
    if (error) throw toFriendlyError(error, 'Failed to add to watchlist');
  }
}

export async function fetchListComments(listId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('list_comments')
    .select('id,body,created_at,user_id,profiles(username,avatar_url)')
    .eq('list_id', listId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(toFriendlyError(error, 'Unable to load comments.'));
  return (data || []).map(c => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    user_id: c.user_id,
    author: c.profiles || { username: 'Unknown', avatar_url: null },
  }));
}

export async function addListComment(listId, body) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const clean = String(body || '').trim().slice(0, 1000);
  if (!clean) throw new Error('Comment cannot be empty.');
  const { error } = await client.from('list_comments').insert({ list_id: listId, user_id: authUser.id, body: clean });
  if (error) throw new Error(toFriendlyError(error, 'Unable to post comment.'));
}

export async function deleteListComment(commentId) {
  const client = requireSupabase();
  const { error } = await client.from('list_comments').delete().eq('id', commentId);
  if (error) throw new Error(toFriendlyError(error, 'Unable to delete comment.'));
}


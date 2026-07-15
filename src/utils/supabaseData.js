import { getSessionlessSupabaseClient, getSupabaseSession, getSupabaseUser, isSupabaseConfigured, supabase } from './supabase';
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

// Admin-initiated account creation — goes straight to Supabase Auth's public
// signUp() rather than through the server, using a session-isolated client
// so it doesn't log the admin out of their own session. Deliberately does
// NOT accept an is_admin flag here: the on_auth_user_changed trigger reads
// is_admin off client-supplied signup metadata, so honoring it from this
// call would let anyone self-grant admin via a raw signUp() call. Grant
// admin as a separate step through the server-verified toggle-admin route
// after the account exists.
export async function createSupabaseUserAsAdmin({ username, email, password, bio }) {
  const client = getSessionlessSupabaseClient();
  const { data, error } = await withTimeoutRetry(
    () => client.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          bio: bio || '',
        },
      },
    }),
    AUTH_MUTATION_TIMEOUT_MS,
    'Supabase sign-up timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to create the account.'));
  }

  if (!data.user) {
    throw new Error('Unable to create the account.');
  }

  return {
    id: data.user.id,
    username,
    email,
    bio: bio || '',
    is_admin: false,
    is_public: true,
    created_at: data.user.created_at,
    last_sign_in_at: null,
    requiresEmailConfirmation: !data.session,
  };
}

export async function signOutFromSupabase() {
  const client = requireSupabase();
  const { error } = await withTimeout(
    client.auth.signOut(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Signing out timed out.'
  );

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

export async function saveSupabaseRating({ mediaType, mediaId, categories, media = null, review }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const schema = RATING_TABLES[mediaType];

  if (!schema) {
    throw new Error('Invalid media type.');
  }

  const payload = {
    user_id: authUser.id,
    media_id: Number(mediaId),
  };

  schema.columns.forEach((column) => {
    payload[column] = Number(categories[column]);
  });

  // Only touch the review column when a value was explicitly passed in —
  // upsert() only overwrites keys present in the payload, so a quick
  // star-only save never clobbers an existing review.
  if (review !== undefined) {
    payload.review = review;
  }

  const { error } = await client
    .from(schema.table)
    .upsert(payload, { onConflict: 'user_id,media_id' });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to save your rating.'));
  }

  if (media) {
    cacheMediaMetadata(mediaType, media);
  }

  // Rating UI can live far from where a rating gets saved (e.g. Home's
  // Library hover badge vs. the details overlay opened on top of it, which
  // is a separate mounted component with its own local state). Broadcast
  // so any mounted screen showing this item's rating can update immediately
  // instead of only refreshing on its next full data fetch.
  window.dispatchEvent(new CustomEvent('binge:ratingSaved', {
    detail: { mediaType, mediaId: Number(mediaId), categories },
  }));
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

  // Only updates an existing entry — titles are added to the library
  // exclusively through the explicit "Add to Watchlist"/"Add to Library"
  // actions, never as a side effect of watching/reading progress.
  const { data: existing } = await supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', user.id)
    .eq('media_type', mediaType)
    .eq('media_id', mediaId)
    .maybeSingle();

  if (!existing) return;

  const update = { updated_at: new Date().toISOString() };
  if (status !== undefined)         update.status = status;
  if (currentSeason !== undefined)  update.current_season = currentSeason;
  if (currentEpisode !== undefined) update.current_episode = currentEpisode;
  if (currentPage !== undefined)    update.current_page = currentPage;
  if (currentChapter !== undefined) update.current_chapter = currentChapter;
  if (notes !== undefined)          update.notes = notes;
  if (status === 'completed' || status === 'watched' || status === 'read') update.completed_at = new Date().toISOString();

  const { error } = await supabase.from('watchlist').update(update).eq('id', existing.id);
  if (error) throw toFriendlyError(error, 'Failed to update watchlist progress');
}

// ─── Continue Watching ──────────────────────────────────────────────────────
// Deliberately its own table, not the watchlist: a title can be in progress
// without ever being added to the library, and library titles aren't
// automatically "in progress" just because they were saved. Starting
// playback writes here only; adding to the library is a separate, explicit
// action (addSupabaseWatchlistItem).

export async function fetchSupabaseContinueWatching() {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const { data, error } = await client
    .from('continue_watching')
    .select('id, media_type, media_id, current_season, current_episode, current_page, current_chapter, updated_at')
    .eq('user_id', authUser.id)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load continue watching.'));
  }

  return enrichMediaRecords(data || []);
}

export async function upsertSupabaseContinueWatching({ mediaType, mediaId, currentSeason, currentEpisode, currentPage, currentChapter }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const row = {
    user_id: authUser.id,
    media_type: mediaType,
    media_id: Number(mediaId),
    updated_at: new Date().toISOString(),
  };
  if (currentSeason !== undefined)  row.current_season = currentSeason;
  if (currentEpisode !== undefined) row.current_episode = currentEpisode;
  if (currentPage !== undefined)    row.current_page = currentPage;
  if (currentChapter !== undefined) row.current_chapter = currentChapter;

  const { error } = await client
    .from('continue_watching')
    .upsert(row, { onConflict: 'user_id,media_type,media_id' });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update continue watching.'));
  }
}

export async function removeSupabaseContinueWatching(id) {
  const client = requireSupabase();
  const { error } = await client
    .from('continue_watching')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to remove that from continue watching.'));
  }
}

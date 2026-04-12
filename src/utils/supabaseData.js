import { loadFallbackBooks, loadFallbackMovies, loadFallbackTvShows } from '../catalogFallback';
import { isSupabaseConfigured, supabase } from './supabase';

const PROFILE_TABLE = 'profiles';

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

let mediaLookupPromise;

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

  if (error.code === '23505') {
    const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
    if (message.includes('username')) {
      return 'Username is already in use.';
    }
    if (message.includes('email')) {
      return 'Email is already in use.';
    }
    if (message.includes('watchlist')) {
      return 'Already in watchlist.';
    }
    if (message.includes('media_id')) {
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

  return {
    id: authUser?.id || profileRow?.id,
    username: fallbackUsername,
    email,
    bio: profileRow?.bio || authUser?.user_metadata?.bio || '',
    avatarUrl: profileRow?.avatar_url || authUser?.user_metadata?.avatar_url || null,
    createdAt: profileRow?.created_at || authUser?.created_at || null,
  };
}

async function getAuthenticatedUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();

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

export async function getSupabaseSessionProfile() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to restore your session.'));
  }

  if (!data.session?.user) {
    return null;
  }

  return ensureSupabaseProfile(data.session.user);
}

export async function signInWithSupabase({ email, password }) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to log in.'));
  }

  if (!data.user) {
    throw new Error('Unable to log in.');
  }

  return ensureSupabaseProfile(data.user);
}

export async function signUpWithSupabase({ username, email, password, bio, avatarUrl }) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
        bio,
        avatar_url: avatarUrl || null,
      },
    },
  });

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

  const user = await ensureSupabaseProfile(data.user, {
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

export async function updateSupabasePassword(newPassword) {
  const client = requireSupabase();
  const { error } = await client.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update your password.'));
  }
}

async function getMediaLookup() {
  if (!mediaLookupPromise) {
    mediaLookupPromise = Promise.all([
      loadFallbackMovies(),
      loadFallbackTvShows(),
      loadFallbackBooks(),
    ]).then(([movies, tvShows, books]) => ({
      movie: new Map(movies.map((item) => [Number(item.id), item])),
      tv_show: new Map(tvShows.map((item) => [Number(item.id), item])),
      book: new Map(books.map((item) => [Number(item.id), item])),
    }));
  }

  return mediaLookupPromise;
}

function enrichMediaRecord(record, mediaType, mediaLookup) {
  const mediaMap = mediaLookup[mediaType] || new Map();
  const item = mediaMap.get(Number(record.media_id));

  return {
    ...record,
    media_type: mediaType,
    title: item?.title || `Saved ${mediaType.replace('_', ' ')}`,
    year: item?.year || null,
    genre: item?.genre || null,
    image_url: item?.poster_url || item?.cover_url || item?.image_url || null,
  };
}

export async function fetchSupabaseWatchlist({ mediaType = '', status = '' } = {}) {
  const client = requireSupabase();
  let query = client
    .from('watchlist')
    .select('id, user_id, media_type, media_id, status, added_at')
    .order('added_at', { ascending: false });

  if (mediaType) {
    query = query.eq('media_type', mediaType);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your library.'));
  }

  const mediaLookup = await getMediaLookup();
  return (data || []).map((record) => enrichMediaRecord(record, record.media_type, mediaLookup));
}

export async function addSupabaseWatchlistItem({ mediaType, mediaId, status = 'plan_to_watch' }) {
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

  const mediaLookup = await getMediaLookup();
  return enrichMediaRecord(data, data.media_type, mediaLookup);
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

async function fetchRatingsForMediaType(mediaType) {
  const client = requireSupabase();
  const schema = RATING_TABLES[mediaType];

  if (!schema) {
    return [];
  }

  const selectColumns = ['id', 'user_id', 'media_id', ...schema.columns, 'review', 'created_at'].join(', ');
  const { data, error } = await client
    .from(schema.table)
    .select(selectColumns)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your ratings.'));
  }

  const mediaLookup = await getMediaLookup();
  return (data || []).map((record) => enrichMediaRecord(record, mediaType, mediaLookup));
}

export async function fetchSupabaseRatings({ mediaType = '' } = {}) {
  if (mediaType) {
    return fetchRatingsForMediaType(mediaType);
  }

  const grouped = await Promise.all(
    Object.keys(RATING_TABLES).map((type) => fetchRatingsForMediaType(type))
  );

  return grouped
    .flat()
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
}

export async function fetchSupabaseRatingMap(mediaType) {
  const ratings = await fetchSupabaseRatings({ mediaType });
  return ratings.reduce((accumulator, rating) => {
    accumulator[rating.media_id] = rating;
    return accumulator;
  }, {});
}

export async function saveSupabaseRating({ mediaType, mediaId, categories, review = '' }) {
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

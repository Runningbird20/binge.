// Watchlist and ratings for the active profile, plus dashboard counts.
import { isSupabaseConfigured, supabase } from '../supabase';
import { cacheMediaMetadata, getCachedMediaMetadata } from '../mediaMetadataCache';
import { getActiveProfileId } from '../activeProfile';
import { RATING_TABLES, enrichMediaRecord, enrichMediaRecords, getAuthenticatedUser, requireSupabase, scopeToProfile, toFriendlyError } from './shared';

export function averageRatingValue(rating) {
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

export async function fetchSupabaseWatchlist({ mediaType = '', status = '', userId = null } = {}) {
  if (!isSupabaseConfigured || !supabase) return [];

  const client = requireSupabase();
  const isOwnWatchlist = !userId;
  if (!userId) {
    const authUser = await getAuthenticatedUser();
    userId = authUser.id;
  }
  // Only scope by the active profile when reading our own watchlist — a
  // followed user's watchlist (userId passed explicitly) has its own,
  // unrelated profile ids, so filtering by ours there would just 0-out.
  const profileId = isOwnWatchlist ? getActiveProfileId() : null;

  function applyFilters(query) {
    let nextQuery = query.eq('user_id', userId);

    if (profileId) {
      nextQuery = scopeToProfile(nextQuery, profileId);
    }

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
  const profileId = getActiveProfileId();

  let existingQuery = client
    .from('watchlist')
    .select('id')
    .eq('media_type', mediaType)
    .eq('media_id', Number(mediaId));
  if (profileId) existingQuery = scopeToProfile(existingQuery, profileId);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

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
      profile_id: profileId,
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

// Bulk status lookup for an entire catalog grid — lets browse pages show/edit
// each item's watchlist status inline (on the card itself) without a per-item
// round trip or having to open the watchlist page.
export async function fetchSupabaseWatchlistStatusMap(mediaType) {
  if (!isSupabaseConfigured || !supabase) return {};

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();

  let query = client
    .from('watchlist')
    .select('id, media_id, status, current_season, current_episode, current_page, current_chapter')
    .eq('user_id', authUser.id)
    .eq('media_type', mediaType);
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your library status.'));
  }

  return (data || []).reduce((accumulator, row) => {
    accumulator[row.media_id] = {
      id: row.id,
      status: row.status,
      current_season: row.current_season,
      current_episode: row.current_episode,
      current_page: row.current_page,
      current_chapter: row.current_chapter,
    };
    return accumulator;
  }, {});
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

const SIGN_IN_TO_TRACK = 'Sign in to keep track of what you’ve watched.';

// Puts library rows back to the statuses they had ([{ id, status }]).
async function restoreStatuses(client, changed) {
  const byStatus = new Map();
  changed.forEach(({ id, status }) => byStatus.set(status, [...(byStatus.get(status) || []), id]));
  const results = await Promise.all([...byStatus].map(([status, ids]) => client.from('watchlist').update({ status }).in('id', ids)));
  const failed = results.find((result) => result.error);
  if (failed) throw new Error(toFriendlyError(failed.error, 'Unable to update those library items.'));
}

// A franchise's "Mark all watched": the same as picking "Watched" on each
// movie, in one go. Movies already in the library get the status; the rest
// are added as watched. movies: [{ mediaId, entry }], entry being the row
// from fetchSupabaseWatchlistStatusMap (or null).
// → { added: [{ id, mediaId }], changed: [{ id, mediaId, status }] }: what
// undoMarkMoviesWatched needs to put everything back.
export async function markMoviesWatched(movies) {
  const changed = movies.filter((movie) => movie.entry?.id)
    .map((movie) => ({ id: movie.entry.id, mediaId: Number(movie.mediaId), status: movie.entry.status }));
  const fresh = movies.filter((movie) => !movie.entry?.id).map((movie) => Number(movie.mediaId));

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser().catch(() => { throw new Error(SIGN_IN_TO_TRACK); });
  const profileId = getActiveProfileId();
  const now = new Date().toISOString();

  if (changed.length) {
    const { error } = await client.from('watchlist')
      .update({ status: 'watched', completed_at: now })
      .in('id', changed.map((row) => row.id));
    if (error) throw new Error(toFriendlyError(error, 'Unable to update those library items.'));
  }

  let added = [];
  if (fresh.length) {
    const { data, error } = await client.from('watchlist')
      .upsert(fresh.map((mediaId) => ({
        user_id: authUser.id,
        profile_id: profileId,
        media_type: 'movie',
        media_id: mediaId,
        status: 'watched',
        completed_at: now,
      })), { onConflict: 'user_id,media_type,media_id,profile_id', ignoreDuplicates: true })
      .select('id, media_id');
    if (error) {
      // All or nothing: the statuses already changed go back.
      await restoreStatuses(client, changed).catch(() => {});
      throw new Error(toFriendlyError(error, 'Unable to save those movies.'));
    }
    added = (data || []).map((row) => ({ id: row.id, mediaId: Number(row.media_id) }));
  }
  return { added, changed };
}

// Undo for markMoviesWatched: removes the rows it added and puts the
// statuses it changed back.
export async function undoMarkMoviesWatched({ added = [], changed = [] }) {
  const client = requireSupabase();
  if (added.length) {
    const { error } = await client.from('watchlist').delete().in('id', added.map((row) => row.id));
    if (error) throw new Error(toFriendlyError(error, 'Unable to remove those library items.'));
  }
  if (changed.length) await restoreStatuses(client, changed);
}

// isOwnRatings is passed explicitly by the caller rather than re-derived
// from `userId` here — fetchSupabaseRatings' multi-type branch always
// resolves a concrete userId before calling this (even for "my own"
// lookups), so `!userId` alone can't distinguish "own" from "someone else's"
// by the time it reaches this function.
async function fetchRawRatingsForMediaType(mediaType, userId = null, isOwnRatings = !userId) {
  if (!isSupabaseConfigured || !supabase) return [];

  const client = requireSupabase();
  const schema = RATING_TABLES[mediaType];

  if (!schema) {
    return [];
  }

  if (!userId) {
    const authUser = await getAuthenticatedUser();
    userId = authUser.id;
  }
  // Only scope by the active profile for our own ratings — see the same
  // note on fetchSupabaseWatchlist above.
  const profileId = isOwnRatings ? getActiveProfileId() : null;

  const selectColumns = ['id', 'user_id', 'media_id', ...schema.columns, 'created_at'].join(', ');
  let query = client
    .from(schema.table)
    .select(selectColumns)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your ratings.'));
  }

  return (data || []).map((record) => ({
    ...record,
    media_type: mediaType,
  }));
}

export async function fetchSupabaseRatings({ mediaType = '', userId = null } = {}) {
  const isOwn = !userId;

  if (mediaType) {
    const ratings = await fetchRawRatingsForMediaType(mediaType, userId, isOwn);
    return enrichMediaRecords(ratings);
  }

  const selectedUserId = userId || (await getAuthenticatedUser()).id;
  const grouped = await Promise.all(
    Object.keys(RATING_TABLES).map((type) => fetchRawRatingsForMediaType(type, selectedUserId, isOwn))
  );

  const enrichedRatings = await enrichMediaRecords(grouped.flat());
  return enrichedRatings
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
}

export async function fetchSupabaseRatingMap(mediaType) {
  if (!isSupabaseConfigured || !supabase) return {};

  const ratings = await fetchRawRatingsForMediaType(mediaType);
  return ratings.reduce((accumulator, rating) => {
    accumulator[rating.media_id] = rating;
    return accumulator;
  }, {});
}

export async function saveSupabaseRating({ mediaType, mediaId, categories, media = null }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const schema = RATING_TABLES[mediaType];

  if (!schema) {
    throw new Error('Invalid media type.');
  }

  const profileId = getActiveProfileId();

  const payload = {
    user_id: authUser.id,
    profile_id: profileId,
    media_id: Number(mediaId),
  };

  schema.columns.forEach((column) => {
    payload[column] = Number(categories[column]);
  });

  const { error } = await client
    .from(schema.table)
    .upsert(payload, { onConflict: 'user_id,media_id,profile_id' });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to save your rating.'));
  }

  if (media) {
    cacheMediaMetadata(mediaType, media);
  }

  // A rated title lives in the "Ratings & Reviews" section, so remove it from
  // the watchlist/library to avoid showing it in both places. Best-effort —
  // the client-side rated-item filter reconciles the view even if this fails,
  // so a delete error must not fail the rating save itself.
  try {
    let deleteQuery = client
      .from('watchlist')
      .delete()
      .eq('user_id', authUser.id)
      .eq('media_type', mediaType)
      .eq('media_id', Number(mediaId));
    deleteQuery = profileId
      ? deleteQuery.eq('profile_id', profileId)
      : deleteQuery.is('profile_id', null);
    await deleteQuery;
  } catch {
    // Ignored — reconciled on next load by the rated-item filter.
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
  if (!isSupabaseConfigured || !supabase) return { watchlist: 0, ratings: 0 };

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

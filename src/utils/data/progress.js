// Viewing progress: episodes watched, watchlist progress, Continue Watching,
// watch history and hidden recommendations.
import { getSupabaseUser, isSupabaseConfigured, supabase } from '../supabase';
import { getActiveProfileId } from '../activeProfile';
import { RATING_TABLES, enrichMediaRecords, getAuthenticatedUser, requireSupabase, scopeToProfile, toFriendlyError } from './shared';

// ─── Episode Progress (watched tracking) ──────────────────────────────────────

export async function fetchEpisodeProgress(mediaId) {
  if (!isSupabaseConfigured || !supabase) return [];

  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) return [];
  const profileId = getActiveProfileId();
  let query = client
    .from('episode_progress')
    .select('season, episode, watched_at')
    .eq('user_id', user.id)
    .eq('media_id', mediaId);
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;
  if (error) throw toFriendlyError(error, 'Failed to fetch episode progress');
  return data || [];
}

// Which of these episodes are marked watched, as a Set of
// "mediaId:season:episode" (Home checks each Continue Watching show's newest
// episode). One small query per episode; Home asks for a handful.
// episodes: [{ mediaId, season, episode }]
export async function fetchWatchedAmong(episodes) {
  const key = (mediaId, season, episode) => `${Number(mediaId)}:${Number(season)}:${Number(episode)}`;
  const wanted = (episodes || []).slice(0, 30);
  if (!wanted.length) return new Set();
  if (!isSupabaseConfigured || !supabase) return new Set();

  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) return new Set();
  const profileId = getActiveProfileId();
  const results = await Promise.all(wanted.map(async ({ mediaId, season, episode }) => {
    let query = client
      .from('episode_progress')
      .select('id')
      .eq('user_id', user.id)
      .eq('media_id', Number(mediaId))
      .eq('season', Number(season))
      .eq('episode', Number(episode))
      .limit(1);
    if (profileId) query = scopeToProfile(query, profileId);
    const { data, error } = await query;
    return !error && data?.length ? key(mediaId, season, episode) : null;
  }));
  return new Set(results.filter(Boolean));
}

// media_id -> number of episodes watched, across every show — an engagement
// signal for recommendations (binging 30 episodes says more than one).
export async function fetchEpisodeProgressCounts() {
  if (!isSupabaseConfigured || !supabase) {
    return new Map();
  }

  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) return new Map();
  const profileId = getActiveProfileId();
  let query = client
    .from('episode_progress')
    .select('media_id')
    .eq('user_id', user.id)
    .limit(5000);
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;
  if (error) return new Map();
  const counts = new Map();
  (data || []).forEach((row) => {
    const id = Number(row.media_id);
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return counts;
}

// Every movie and series this profile has watched, as "movie:12" /
// "tv_show:34" keys: rated, marked Watched (or Watching) in the library, in
// Continue Watching, or with any episode watched. Ids only, paged past
// Supabase's 1000-row cap, so it stays cheap. A table that fails to load is
// left out rather than failing the rest. Keeps watched titles out of
// recommendations (utils/watchedTitles.js).
const WATCHED_STATUSES = ['watched', 'watching'];
const PAGE = 1000;

export async function fetchWatchedTitleKeys() {
  const keys = new Set();
  if (!isSupabaseConfigured || !supabase) return keys;
  try {
    const { data: { user } = {} } = await getSupabaseUser();
    if (!user) return keys;
    const client = requireSupabase();
    const profileId = getActiveProfileId();

    async function allRows(table, columns, refine = (query) => query) {
      const rows = [];
      for (let page = 0; page < 20; page += 1) {
        let query = refine(client.from(table).select(columns).eq('user_id', user.id));
        if (profileId) query = scopeToProfile(query, profileId);
        // eslint-disable-next-line no-await-in-loop
        const { data, error } = await query.order('id').range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    }

    const add = (mediaType) => (rows) => rows.forEach((row) => keys.add(`${row.media_type || mediaType}:${Number(row.media_id)}`));
    await Promise.allSettled([
      allRows(RATING_TABLES.movie.table, 'id, media_id').then(add('movie')),
      allRows(RATING_TABLES.tv_show.table, 'id, media_id').then(add('tv_show')),
      allRows('watchlist', 'id, media_type, media_id', (query) => query.in('media_type', ['movie', 'tv_show']).in('status', WATCHED_STATUSES)).then(add()),
      allRows('continue_watching', 'id, media_type, media_id', (query) => query.in('media_type', ['movie', 'tv_show'])).then(add()),
      allRows('episode_progress', 'id, media_id').then(add('tv_show')),
    ]);
  } catch {
    // Signed out or offline: nothing is known to be watched.
  }
  return keys;
}

export async function markEpisodeWatched({ mediaId, season, episode }) {
  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Not signed in');
  const profileId = getActiveProfileId();
  const { error } = await client
    .from('episode_progress')
    .upsert({ user_id: user.id, profile_id: profileId, media_id: mediaId, season, episode, watched_at: new Date().toISOString() },
             { onConflict: 'user_id,media_id,season,episode,profile_id' });
  if (error) throw toFriendlyError(error, 'Failed to mark episode watched');
}

export async function unmarkEpisodeWatched({ mediaId, season, episode }) {
  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Not signed in');
  const profileId = getActiveProfileId();
  let query = client
    .from('episode_progress')
    .delete()
    .eq('user_id', user.id)
    .eq('media_id', mediaId)
    .eq('season', season)
    .eq('episode', episode);
  if (profileId) query = query.eq('profile_id', profileId);
  const { error } = await query;
  if (error) throw toFriendlyError(error, 'Failed to unmark episode');
}

// Several episodes at once, from the episode list ("Mark season watched",
// "Watched up to here"). They were watched somewhere else at a time we don't
// know, so watched_at stays empty unless given (Undo puts back the original
// times): History and Wrapped only count what was watched here. Episodes
// already marked are left as they are (their watch times are kept).
// episodes: [{ season, episode, watchedAt? }]
export async function markEpisodesWatched({ mediaId, episodes }) {
  if (!episodes?.length) return;
  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Sign in to keep track of episodes.');
  const profileId = getActiveProfileId();
  const rows = episodes.map(({ season, episode, watchedAt }) => ({
    user_id: user.id,
    profile_id: profileId,
    media_id: mediaId,
    season,
    episode,
    watched_at: watchedAt || null,
  }));
  const { error } = await client
    .from('episode_progress')
    .upsert(rows, { onConflict: 'user_id,media_id,season,episode,profile_id', ignoreDuplicates: true });
  if (error) throw new Error(toFriendlyError(error, 'Couldn\'t save those episodes.'));
}

// The opposite, for several episodes (also the profile's older rows saved
// without a profile, which it shows as its own).
export async function unmarkEpisodesWatched({ mediaId, episodes }) {
  if (!episodes?.length) return;
  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Sign in to keep track of episodes.');
  const profileId = getActiveProfileId();
  const bySeason = new Map();
  episodes.forEach(({ season, episode }) => bySeason.set(season, [...(bySeason.get(season) || []), episode]));
  const results = await Promise.all([...bySeason].map(([season, numbers]) => {
    let query = client
      .from('episode_progress')
      .delete()
      .eq('user_id', user.id)
      .eq('media_id', mediaId)
      .eq('season', season)
      .in('episode', numbers);
    if (profileId) query = scopeToProfile(query, profileId);
    return query;
  }));
  const failed = results.find((result) => result.error);
  if (failed) throw new Error(toFriendlyError(failed.error, 'Couldn\'t update those episodes.'));
}

// ─── Watchlist Progress Update ─────────────────────────────────────────────────

export async function updateWatchlistProgress({ mediaType, mediaId, currentSeason, currentEpisode, currentPage, currentChapter, status, notes }) {
  const client = requireSupabase();
  const { data: { user } } = await getSupabaseUser();
  if (!user) throw new Error('Not signed in');
  const profileId = getActiveProfileId();

  // Only updates an existing entry — titles are added to the library
  // exclusively through the explicit "Add to Watchlist"/"Add to Library"
  // actions, never as a side effect of watching/reading progress.
  let existingQuery = client
    .from('watchlist')
    .select('id')
    .eq('user_id', user.id)
    .eq('media_type', mediaType)
    .eq('media_id', mediaId);
  if (profileId) existingQuery = existingQuery.eq('profile_id', profileId);
  const { data: existing } = await existingQuery.maybeSingle();

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
  if (!isSupabaseConfigured || !supabase) return [];

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();

  let query = client
    .from('continue_watching')
    .select('id, media_type, media_id, current_season, current_episode, current_page, current_chapter, position_seconds, duration_seconds, updated_at')
    .eq('user_id', authUser.id)
    .order('updated_at', { ascending: false });
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load continue watching.'));
  }

  return enrichMediaRecords(data || []);
}

export async function upsertSupabaseContinueWatching({ mediaType, mediaId, currentSeason, currentEpisode, currentPage, currentChapter, positionSeconds, durationSeconds }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();

  const row = {
    user_id: authUser.id,
    profile_id: profileId,
    media_type: mediaType,
    media_id: Number(mediaId),
    updated_at: new Date().toISOString(),
  };
  if (currentSeason !== undefined)  row.current_season = currentSeason;
  if (currentEpisode !== undefined) row.current_episode = currentEpisode;
  if (currentPage !== undefined)    row.current_page = currentPage;
  if (currentChapter !== undefined) row.current_chapter = currentChapter;
  if (positionSeconds !== undefined) row.position_seconds = Math.max(0, Math.floor(positionSeconds));
  if (durationSeconds !== undefined && durationSeconds > 0) row.duration_seconds = Math.floor(durationSeconds);

  const { error } = await client
    .from('continue_watching')
    .upsert(row, { onConflict: 'user_id,media_type,media_id,profile_id' });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update continue watching.'));
  }
}

// The synced resume point for one title: { season, episode, position,
// duration, updatedAt } or null. Lets playback pick up on another device.
export async function fetchSupabaseResumePoint({ mediaType, mediaId }) {
  if (!isSupabaseConfigured || !supabase || !mediaId) return null;
  const { data: { user } } = await getSupabaseUser();
  if (!user) return null;
  const profileId = getActiveProfileId();
  let query = supabase
    .from('continue_watching')
    .select('current_season, current_episode, position_seconds, duration_seconds, updated_at')
    .eq('user_id', user.id)
    .eq('media_type', mediaType)
    .eq('media_id', Number(mediaId))
    .limit(1);
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;
  if (error || !data?.[0]) return null;
  const row = data[0];
  return {
    season: row.current_season,
    episode: row.current_episode,
    position: row.position_seconds,
    duration: row.duration_seconds,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  };
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

// One title's Continue Watching row, by title (Undo after marking episodes
// put a show there that wasn't before).
export async function removeContinueWatchingFor({ mediaType, mediaId }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();
  let query = client
    .from('continue_watching')
    .delete()
    .eq('user_id', authUser.id)
    .eq('media_type', mediaType)
    .eq('media_id', Number(mediaId));
  if (profileId) query = scopeToProfile(query, profileId);
  const { error } = await query;
  if (error) throw new Error(toFriendlyError(error, 'Unable to remove that from continue watching.'));
}

// ─── Watch history & hidden recommendations ───────────────────────────

// Recently watched episodes (episode_progress), newest first, with titles.
// Episodes marked by hand from the episode list have no watch time and
// aren't part of the history.
export async function fetchEpisodeHistory(limit = 300) {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();
  let query = client
    .from('episode_progress')
    .select('media_id, season, episode, watched_at')
    .eq('user_id', authUser.id)
    .not('watched_at', 'is', null)
    .order('watched_at', { ascending: false })
    .limit(limit);
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;
  if (error) return [];
  return enrichMediaRecords((data || []).map((row) => ({ ...row, media_type: 'tv_show' })));
}

// Remove a title from watch history: its Continue Watching row and, for
// shows, its watched-episode records. Ratings and My List are untouched.
// profileId: the profile it was removed from (the Undo popup carries out
// the removal 10 seconds later, maybe after a profile switch); the active
// profile when left out.
export async function removeTitleFromHistory({ mediaType, mediaId, profileId: forProfile }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = forProfile !== undefined ? forProfile : getActiveProfileId();
  const scope = (query) => (profileId ? query.eq('profile_id', profileId) : query);
  const tasks = [
    scope(client.from('continue_watching').delete().eq('user_id', authUser.id).eq('media_type', mediaType).eq('media_id', Number(mediaId))),
  ];
  if (mediaType === 'tv_show') {
    tasks.push(scope(client.from('episode_progress').delete().eq('user_id', authUser.id).eq('media_id', Number(mediaId))));
  }
  const results = await Promise.all(tasks);
  const failed = results.find((result) => result.error);
  if (failed) throw new Error(toFriendlyError(failed.error, 'Unable to remove that from your history.'));
  window.dispatchEvent(new CustomEvent('binge:historyChanged'));
}

export async function fetchHiddenRecommendations() {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: { user } } = await getSupabaseUser();
  if (!user) return [];
  const profileId = getActiveProfileId();
  let query = supabase.from('recommendation_hidden').select('media_type, media_id').eq('user_id', user.id);
  query = profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

export async function setRecommendationHidden({ mediaType, mediaId, hidden }) {
  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();
  if (hidden) {
    const { error } = await client.from('recommendation_hidden').insert({
      user_id: authUser.id, profile_id: profileId || null, media_type: mediaType, media_id: Number(mediaId),
    });
    if (error && !/duplicate/i.test(error.message)) throw new Error(toFriendlyError(error, 'Unable to hide that title.'));
  } else {
    let query = client.from('recommendation_hidden').delete()
      .eq('user_id', authUser.id).eq('media_type', mediaType).eq('media_id', Number(mediaId));
    query = profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null);
    const { error } = await query;
    if (error) throw new Error(toFriendlyError(error, 'Unable to un-hide that title.'));
  }
  window.dispatchEvent(new CustomEvent('binge:historyChanged'));
}

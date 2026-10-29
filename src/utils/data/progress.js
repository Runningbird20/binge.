// Viewing progress: episodes watched, watchlist progress, Continue Watching,
// watch history and hidden recommendations.
import { getSupabaseUser, isSupabaseConfigured, supabase } from '../supabase';
import { getActiveProfileId } from '../activeProfile';
import { api } from '../../api';
import { enrichMediaRecords, getAuthenticatedUser, requireSupabase, scopeToProfile, toFriendlyError } from './shared';

// ─── Episode Progress (watched tracking) ──────────────────────────────────────

export async function fetchEpisodeProgress(mediaId) {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const stored = window.localStorage.getItem(`ep_progress_${mediaId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

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

export async function markEpisodeWatched({ mediaId, season, episode }) {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const key = `ep_progress_${mediaId}`;
      const stored = window.localStorage.getItem(key);
      const list = stored ? JSON.parse(stored) : [];
      if (!list.some((e) => e.season === season && e.episode === episode)) {
        list.push({ season, episode, watched_at: new Date().toISOString() });
        window.localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {}
    return;
  }

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
  if (!isSupabaseConfigured || !supabase) {
    try {
      const key = `ep_progress_${mediaId}`;
      const stored = window.localStorage.getItem(key);
      const list = stored ? JSON.parse(stored) : [];
      const updated = list.filter((e) => !(e.season === season && e.episode === episode));
      window.localStorage.setItem(key, JSON.stringify(updated));
    } catch {}
    return;
  }

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

// ─── Watchlist Progress Update ─────────────────────────────────────────────────

export async function updateWatchlistProgress({ mediaType, mediaId, currentSeason, currentEpisode, currentPage, currentChapter, status, notes }) {
  if (!isSupabaseConfigured || !supabase) {
    try {
      await api.patch('/watchlist/progress', {
        media_type: mediaType,
        media_id: mediaId,
        current_season: currentSeason,
        current_episode: currentEpisode,
        current_page: currentPage,
        current_chapter: currentChapter,
        status,
        notes,
      });
    } catch {}
    return;
  }

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
  if (!isSupabaseConfigured || !supabase) {
    try {
      const stored = window.localStorage.getItem('continue_watching');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

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
  if (!isSupabaseConfigured || !supabase) {
    try {
      const stored = window.localStorage.getItem('continue_watching');
      const list = stored ? JSON.parse(stored) : [];
      const idx = list.findIndex((x) => x.media_type === mediaType && Number(x.media_id) === Number(mediaId));
      const row = {
        id: idx >= 0 ? list[idx].id : Date.now(),
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
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...row };
      } else {
        list.unshift(row);
      }
      window.localStorage.setItem('continue_watching', JSON.stringify(list.slice(0, 50)));
    } catch {}
    return;
  }

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
  if (!isSupabaseConfigured || !supabase) {
    try {
      const stored = window.localStorage.getItem('continue_watching');
      if (stored) {
        const list = JSON.parse(stored).filter((x) => x.id !== id);
        window.localStorage.setItem('continue_watching', JSON.stringify(list));
      }
    } catch {}
    return;
  }

  const client = requireSupabase();
  const { error } = await client
    .from('continue_watching')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to remove that from continue watching.'));
  }
}

// ─── Watch history & hidden recommendations ───────────────────────────

// Recently watched episodes (episode_progress), newest first, with titles.
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
    .order('watched_at', { ascending: false })
    .limit(limit);
  if (profileId) query = scopeToProfile(query, profileId);
  const { data, error } = await query;
  if (error) return [];
  return enrichMediaRecords((data || []).map((row) => ({ ...row, media_type: 'tv_show' })));
}

// Remove a title from watch history: its Continue Watching row and, for
// shows, its watched-episode records. Ratings and My List are untouched.
export async function removeTitleFromHistory({ mediaType, mediaId }) {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const stored = window.localStorage.getItem('continue_watching');
      if (stored) {
        const list = JSON.parse(stored).filter((x) => !(x.media_type === mediaType && Number(x.media_id) === Number(mediaId)));
        window.localStorage.setItem('continue_watching', JSON.stringify(list));
      }
      window.localStorage.removeItem(`ep_progress_${mediaId}`);
      window.dispatchEvent(new CustomEvent('binge:historyChanged'));
    } catch {}
    return;
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  const profileId = getActiveProfileId();
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
  if (!isSupabaseConfigured || !supabase) {
    try {
      const stored = window.localStorage.getItem('hidden_recs');
      let list = stored ? JSON.parse(stored) : [];
      if (hidden) {
        if (!list.some((x) => x.media_type === mediaType && Number(x.media_id) === Number(mediaId))) {
          list.push({ media_type: mediaType, media_id: Number(mediaId) });
        }
      } else {
        list = list.filter((x) => !(x.media_type === mediaType && Number(x.media_id) === Number(mediaId)));
      }
      window.localStorage.setItem('hidden_recs', JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('binge:historyChanged'));
    } catch {}
    return;
  }

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

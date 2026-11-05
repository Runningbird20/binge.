// Supabase user data (Auth, profiles, watchlist, ratings, progress). The code
// lives in ./data/*; this module re-exports it so existing imports keep working.
import * as account from './data/account';
import * as library from './data/library';
import * as shared from './data/shared';
import * as progress from './data/progress';

// Writes that change what this profile has watched or saved say so, so
// recommendations can drop watched titles straight away (utils/watchedTitles.js)
// and personalized rows rebuild. Playback's own progress saves (every ~30s)
// don't announce.
function announcing(write) {
  return async (...args) => {
    const result = await write(...args);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('binge:historyChanged'));
    return result;
  };
}

export const buildSupabaseUserProfile = account.buildSupabaseUserProfile;
export const fetchAccountProfiles = account.fetchAccountProfiles;
export const createAccountProfile = account.createAccountProfile;
export const updateAccountProfile = account.updateAccountProfile;
export const deleteAccountProfile = account.deleteAccountProfile;
export const ensureSupabaseProfile = account.ensureSupabaseProfile;
export const resolveSupabaseProfile = account.resolveSupabaseProfile;
export const getSupabaseSessionProfile = account.getSupabaseSessionProfile;
export const signInWithSupabase = account.signInWithSupabase;
export const signUpWithSupabase = account.signUpWithSupabase;
export const createSupabaseUserAsAdmin = account.createSupabaseUserAsAdmin;
export const signOutFromSupabase = account.signOutFromSupabase;
export const updateSupabaseProfile = account.updateSupabaseProfile;
export const uploadSupabaseAvatar = account.uploadSupabaseAvatar;
export const updateSupabasePassword = account.updateSupabasePassword;
export const fetchSupabaseProfiles = account.fetchSupabaseProfiles;
export const calculateTasteMatch = account.calculateTasteMatch;
export const averageRatingValue = library.averageRatingValue;
export const fetchSupabaseWatchlist = library.fetchSupabaseWatchlist;
export const addSupabaseWatchlistItem = announcing(library.addSupabaseWatchlistItem);
export const fetchSupabaseWatchlistStatusMap = library.fetchSupabaseWatchlistStatusMap;
export const updateSupabaseWatchlistStatus = announcing(library.updateSupabaseWatchlistStatus);
export const removeSupabaseWatchlistItem = announcing(library.removeSupabaseWatchlistItem);
export const markMoviesWatched = announcing(library.markMoviesWatched);
export const undoMarkMoviesWatched = announcing(library.undoMarkMoviesWatched);
export const fetchSupabaseRatings = library.fetchSupabaseRatings;
export const fetchSupabaseRatingMap = library.fetchSupabaseRatingMap;
export const saveSupabaseRating = library.saveSupabaseRating;
export const fetchSupabaseDashboardCounts = library.fetchSupabaseDashboardCounts;
export const enrichMediaRecords = shared.enrichMediaRecords;
export const fetchEpisodeProgress = progress.fetchEpisodeProgress;
export const fetchEpisodeProgressCounts = progress.fetchEpisodeProgressCounts;
export const fetchWatchedTitleKeys = progress.fetchWatchedTitleKeys;
export const fetchWatchedAmong = progress.fetchWatchedAmong;
export const markEpisodeWatched = announcing(progress.markEpisodeWatched);
export const unmarkEpisodeWatched = announcing(progress.unmarkEpisodeWatched);
export const markEpisodesWatched = announcing(progress.markEpisodesWatched);
export const unmarkEpisodesWatched = announcing(progress.unmarkEpisodesWatched);
export const updateWatchlistProgress = progress.updateWatchlistProgress;
export const fetchSupabaseContinueWatching = progress.fetchSupabaseContinueWatching;
export const upsertSupabaseContinueWatching = progress.upsertSupabaseContinueWatching;
export const fetchSupabaseResumePoint = progress.fetchSupabaseResumePoint;
export const removeSupabaseContinueWatching = announcing(progress.removeSupabaseContinueWatching);
export const removeContinueWatchingFor = announcing(progress.removeContinueWatchingFor);
export const fetchEpisodeHistory = progress.fetchEpisodeHistory;
export const removeTitleFromHistory = progress.removeTitleFromHistory;
export const fetchHiddenRecommendations = progress.fetchHiddenRecommendations;
export const setRecommendationHidden = progress.setRecommendationHidden;

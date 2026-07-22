// Shared library/ratings math for the profile dashboards (Home + Profile).
//
// Two rules drive everything here:
//   1. A rated title counts as "watched" — it contributes to watch time and
//      the completed count even if the user never explicitly marked it watched.
//   2. A rated title lives in the "Ratings & Reviews" section, so it's dropped
//      from the watchlist/library view (see excludeRated) rather than shown in
//      both places.

// Rough runtime estimates — the catalog carries no per-title runtime, so the
// "minutes watched" stat approximates: a movie ≈ 115 min, a TV episode ≈ 45
// min, and ≈ 10 episodes per season.
const MOVIE_MINUTES = 115;
const TV_EPISODE_MINUTES = 45;
const TV_EPISODES_PER_SEASON = 10;
// A rated show usually has no tracked episode progress, so assume the user got
// through roughly a season's worth before rating it.
const RATED_TV_MINUTES = TV_EPISODES_PER_SEASON * TV_EPISODE_MINUTES;

function mediaKey(item) {
  return `${item.media_type}:${item.media_id}`;
}

export function getRatedKeys(ratings) {
  return new Set((ratings || []).map(mediaKey));
}

// A rated title is shown under Ratings & Reviews, so exclude it from the
// watchlist/library view even if a stale watchlist row still exists for it
// (rated before the auto-removal landed, or a best-effort delete that failed).
export function excludeRated(watchlist, ratings) {
  const rated = getRatedKeys(ratings);
  return (watchlist || []).filter((item) => !rated.has(mediaKey(item)));
}

function tvProgressMinutes(item) {
  const season = Number(item.current_season) || 0;
  const episode = Number(item.current_episode) || 0;
  if (!season && !episode) return 0;
  return (Math.max(season - 1, 0) * TV_EPISODES_PER_SEASON + episode) * TV_EPISODE_MINUTES;
}

// Estimated total watch time across both watchlist progress and rated titles.
// Each title is counted once; when a title has both watchlist progress and a
// rating, the (more accurate) progress-based estimate wins over the flat rated
// estimate. Books never contribute to watch time.
export function computeWatchMinutes(watchlist, ratings) {
  const counted = new Set();
  let minutes = 0;

  (watchlist || []).forEach((item) => {
    const key = mediaKey(item);
    if (item.media_type === 'movie' && item.status === 'watched') {
      minutes += MOVIE_MINUTES;
      counted.add(key);
    } else if (item.media_type === 'tv_show') {
      const tvMinutes = tvProgressMinutes(item);
      if (tvMinutes > 0) {
        minutes += tvMinutes;
        counted.add(key);
      }
    }
  });

  (ratings || []).forEach((rating) => {
    const key = mediaKey(rating);
    if (counted.has(key)) return;
    if (rating.media_type === 'movie') {
      minutes += MOVIE_MINUTES;
      counted.add(key);
    } else if (rating.media_type === 'tv_show') {
      minutes += RATED_TV_MINUTES;
      counted.add(key);
    }
  });

  return minutes;
}

// "Completed" = watched/read watchlist items plus every rated title (a rating
// implies the user finished it). Deduped by media so rating a title you'd
// already marked watched neither drops nor doubles the count.
export function countCompleted(watchlist, ratings) {
  const counted = new Set();
  (watchlist || []).forEach((item) => {
    if (item.status === 'watched' || item.status === 'read') {
      counted.add(mediaKey(item));
    }
  });
  (ratings || []).forEach((rating) => counted.add(mediaKey(rating)));
  return counted.size;
}

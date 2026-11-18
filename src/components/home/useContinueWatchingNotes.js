import { useEffect, useMemo, useState } from 'react';
import { fetchWatchedAmong } from '../../utils/supabaseData';
import { tmdbGet, tmdbIdFromItem } from '../../utils/tmdb';
import { seasonStatus } from '../../utils/seasonStatus';
import { hasSavedPosition, lastAiredEpisode } from '../../utils/continueWatching';

// "2 episodes left in Season 3" / "New season Friday" per show in Continue
// Watching (TMDB details are cached for 30 minutes). The same details find
// finished shows: the newest aired episode is marked watched and nothing is
// saved partway through, so the show leaves Continue Watching (it comes back
// when a new episode airs). Returns the notes and the list Continue Watching
// and the spotlight show; New Episodes and the calendar keep the full list.
export default function useContinueWatchingNotes(continueWatchingItems) {
  const [seasonNotes, setSeasonNotes] = useState({});
  const [finishedShows, setFinishedShows] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const shows = continueWatchingItems.filter((item) => item.media_type === 'tv_show').slice(0, 24);
    Promise.all(shows.map(async (item) => {
      const tmdbId = tmdbIdFromItem(item);
      if (!tmdbId) return null;
      const details = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      const note = seasonStatus(details, Number(item.current_season) || 1, Number(item.current_episode) || 1);
      return { item, key: `tv_show:${item.media_id ?? item.id}`, note, last: lastAiredEpisode(details) };
    })).then(async (entries) => {
      const found = entries.filter(Boolean);
      if (cancelled) return;
      setSeasonNotes(Object.fromEntries(found.filter((entry) => entry.note).map((entry) => [entry.key, entry.note])));
      const candidates = found.filter((entry) => entry.last && !hasSavedPosition(entry.item));
      const watched = candidates.length
        ? await fetchWatchedAmong(candidates.map(({ item, last }) => ({ mediaId: item.media_id, ...last }))).catch(() => new Set())
        : new Set();
      if (cancelled) return;
      const finished = candidates
        .filter(({ item, last }) => watched.has(`${Number(item.media_id)}:${last.season}:${last.episode}`))
        .map((entry) => entry.key);
      // Only a real change re-renders (the spotlight rebuilds from this list).
      setFinishedShows((current) => (finished.length === current.size && finished.every((key) => current.has(key)) ? current : new Set(finished)));
    });
    return () => { cancelled = true; };
  }, [continueWatchingItems]);

  const visibleContinueWatching = useMemo(
    () => continueWatchingItems.filter((item) => !finishedShows.has(`${item.media_type}:${item.media_id ?? item.id}`)),
    [continueWatchingItems, finishedShows],
  );

  return { seasonNotes, visibleContinueWatching };
}

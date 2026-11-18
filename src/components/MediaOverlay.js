import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import MediaDetailsModal from './MediaDetailsModal';
import { goBackTo, historyMark } from '../utils/historyBack';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlistStatusMap,
  updateSupabaseWatchlistStatus,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  fetchMovieById,
  fetchTvShowById,
} from '../utils/catalogQueries';

const CONFIG = {
  movie:    { fetchById: fetchMovieById,  homePath: '/movies' },
  tv_show:  { fetchById: fetchTvShowById, homePath: '/tv-shows' },
};

// Renders a movie/TV details modal as an overlay on top of whatever
// page the user was already on (Home, Profile, search results, etc.),
// instead of navigating to the full Movies/TV Shows catalog page.
// See App.js's background-location routing for how this gets mounted.
export default function MediaOverlay({ mediaType }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const backgroundLocation = location.state?.backgroundLocation;
  const playImmediately = searchParams.get('play') === '1' || searchParams.get('play') === 'true';
  const initialSeason = searchParams.get('season') || undefined;
  const initialEpisode = searchParams.get('episode') || undefined;
  const initialPosition = Number(searchParams.get('t')) || undefined;
  const numericId = Number(id);
  const config = CONFIG[mediaType];

  const [item, setItem] = useState(null);
  const [userRating, setUserRating] = useState(null);
  const [watchlistEntry, setWatchlistEntry] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setDetailMessage('');

    async function load() {
      try {
        const result = await config.fetchById(numericId);
        if (!cancelled && result?.id) setItem(result);
      } catch { /* nothing to open */ }
    }

    if (numericId) load();
    return () => { cancelled = true; };
  }, [numericId, config]);

  useEffect(() => {
    let cancelled = false;
    fetchSupabaseRatingMap(mediaType)
      .then((map) => { if (!cancelled) setUserRating(map?.[numericId] || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType, numericId]);

  // libraryVersion: bumped when the popup changes library rows itself (a
  // franchise's "Mark all watched" can include this title).
  const [libraryVersion, setLibraryVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchSupabaseWatchlistStatusMap(mediaType)
      .then((map) => { if (!cancelled) setWatchlistEntry(map[numericId] || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType, numericId, libraryVersion]);

  // Where this popup was opened from, so closing goes back there even after a
  // video's player has added its own history entries (utils/historyBack.js).
  const historyStartRef = useRef(null);
  if (backgroundLocation && historyStartRef.current?.locationKey !== location.key) {
    historyStartRef.current = { ...historyMark(), locationKey: location.key };
  }

  function goBack() {
    if (backgroundLocation) goBackTo(historyStartRef.current);
    else navigate(config.homePath);
  }

  async function handleRate(target, categories) {
    try {
      await saveSupabaseRating({ mediaType, mediaId: target.id, categories, media: target });
      setUserRating({ ...categories, media_id: target.id });
      setDetailMessage('Rating saved!');
    } catch (err) {
      setDetailMessage(err.message);
    }
  }

  async function handleWatchlist(target) {
    setIsAddingWatchlist(true);
    setDetailMessage('');
    try {
      const saved = await addSupabaseWatchlistItem({ mediaType, mediaId: target.id, media: target });
      setWatchlistEntry({ id: saved.id, status: saved.status });
      setDetailMessage(`"${target.title}" added to your watchlist.`);
    } catch (err) {
      setDetailMessage(err.message);
    } finally {
      setIsAddingWatchlist(false);
    }
  }

  function handleStatusChange(target, entry, nextStatus) {
    setWatchlistEntry((current) => ({ ...current, status: nextStatus }));
    if (!entry?.id) return;
    updateSupabaseWatchlistStatus(entry.id, nextStatus).catch(() => {
      setWatchlistEntry(entry);
    });
  }

  if (!item) return null;

  return (
    <MediaDetailsModal
      item={item}
      mediaType={mediaType}
      onClose={goBack}
      onRate={handleRate}
      onWatchlist={handleWatchlist}
      watchlistEntry={watchlistEntry}
      onStatusChange={handleStatusChange}
      userRating={userRating}
      isAddingWatchlist={isAddingWatchlist}
      detailMessage={detailMessage}
      autoPlay={playImmediately}
      initialSeason={initialSeason}
      initialEpisode={initialEpisode}
      initialPosition={initialPosition}
      // Opened from a Play button somewhere (Continue Watching, previews):
      // closing the player returns there instead of to a details page.
      closeOnPlayerExit={playImmediately && Boolean(backgroundLocation)}
      onLibraryChange={() => setLibraryVersion((version) => version + 1)}
    />
  );
}

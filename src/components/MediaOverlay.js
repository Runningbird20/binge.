import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import MediaDetailsModal from './MediaDetailsModal';
import { BookDetailsModal } from '../pages/Books';
import { loadFallbackBooks, loadFallbackMovies, loadFallbackTvShows } from '../catalogFallback';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlist,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  fetchSupabaseBookById,
  fetchSupabaseMovieById,
  fetchSupabaseTvShowById,
} from '../utils/supabaseMovieCatalog';

const CONFIG = {
  movie:    { fetchById: fetchSupabaseMovieById, apiPath: 'movies',    loadFallback: loadFallbackMovies,  homePath: '/movies' },
  tv_show:  { fetchById: fetchSupabaseTvShowById, apiPath: 'tv-shows', loadFallback: loadFallbackTvShows, homePath: '/tv-shows' },
  book:     { fetchById: fetchSupabaseBookById,   apiPath: 'books',    loadFallback: loadFallbackBooks,   homePath: '/books' },
};

// Renders a movie/TV/book details modal as an overlay on top of whatever
// page the user was already on (Home, Profile, search results, etc.),
// instead of navigating to the full Movies/TV Shows/Books catalog page.
// See App.js's background-location routing for how this gets mounted.
export default function MediaOverlay({ mediaType }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const backgroundLocation = location.state?.backgroundLocation;
  const playImmediately = searchParams.get('play') === '1' || searchParams.get('play') === 'true';
  const numericId = Number(id);
  const config = CONFIG[mediaType];

  const [item, setItem] = useState(null);
  const [browseOnly, setBrowseOnly] = useState(false);
  const [userRating, setUserRating] = useState(null);
  const [isInLibrary, setIsInLibrary] = useState(false);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setBrowseOnly(false);
    setDetailMessage('');

    async function load() {
      try {
        const result = await config.fetchById(numericId);
        if (!cancelled && result?.id) { setItem(result); return; }
      } catch { /* fall through */ }

      try {
        const result = await api.get(`/media/${config.apiPath}/${numericId}`);
        if (!cancelled && result?.id) { setItem(result); return; }
      } catch { /* fall through */ }

      try {
        const items = await config.loadFallback();
        const match = items.find((entry) => entry.id === numericId);
        if (!cancelled && match) { setItem(match); setBrowseOnly(true); }
      } catch { /* ignore missing fallback data */ }
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

  useEffect(() => {
    if (mediaType !== 'book') return undefined;
    let cancelled = false;
    fetchSupabaseWatchlist({ mediaType: 'book' })
      .then((list) => {
        if (!cancelled) setIsInLibrary((list || []).some((entry) => entry.media_id === numericId));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType, numericId]);

  function goBack() {
    if (backgroundLocation) navigate(-1);
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
      await addSupabaseWatchlistItem({ mediaType, mediaId: target.id, media: target });
      setDetailMessage(`"${target.title}" added to your watchlist.`);
    } catch (err) {
      setDetailMessage(err.message);
    } finally {
      setIsAddingWatchlist(false);
    }
  }

  async function handleAddToLibrary(book) {
    setDetailMessage('');
    setIsAddingWatchlist(true);
    try {
      await addSupabaseWatchlistItem({ mediaType: 'book', mediaId: book.id, status: 'plan_to_read', media: book });
      setIsInLibrary(true);
      setDetailMessage('Added to your Library.');
    } catch (err) {
      if (/already in watchlist/i.test(err.message)) {
        setIsInLibrary(true);
        setDetailMessage('This book is already in your Library.');
      } else {
        setDetailMessage(err.message);
      }
    } finally {
      setIsAddingWatchlist(false);
    }
  }

  if (!item) return null;

  if (mediaType === 'book') {
    return (
      <BookDetailsModal
        book={item}
        onClose={goBack}
        onAddToLibrary={handleAddToLibrary}
        isInLibrary={isInLibrary}
        isAddingToLibrary={isAddingWatchlist}
        onRate={handleRate}
        userRating={userRating}
        detailMessage={detailMessage}
        allowActions={!browseOnly}
        browseOnlyMessage="Fallback catalog mode is browse-only."
      />
    );
  }

  return (
    <MediaDetailsModal
      item={item}
      mediaType={mediaType}
      onClose={goBack}
      onRate={browseOnly ? undefined : handleRate}
      onWatchlist={browseOnly ? undefined : handleWatchlist}
      userRating={userRating}
      isAddingWatchlist={isAddingWatchlist}
      detailMessage={detailMessage}
      allowActions={!browseOnly}
      browseOnlyMessage="Fallback catalog mode is browse-only."
      autoPlay={playImmediately}
    />
  );
}

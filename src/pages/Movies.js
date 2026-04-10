import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import MediaDetailsModal from '../components/MediaDetailsModal';
import { api } from '../api';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  buildMediaGenreFacets,
  filterMediaItems,
  loadFallbackMovies,
} from '../catalogFallback';

function normalizeMediaItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

export default function Movies() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));

  const [movies, setMovies] = useState([]);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [genre, setGenre] = useState('');
  const [sortOrder, setSortOrder] = useState('title-asc');
  const [facets, setFacets] = useState({ genres: [] });
  const [userRatings, setUserRatings] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);

  const fetchMovies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (genre) params.set('genre', genre);
      if (sortOrder) params.set('sort', sortOrder);

      const data = await api.get(`/media/movies?${params}`);
      const items = normalizeMediaItems(data);
      if (items.length === 0) {
        throw new Error('Movie catalog is empty');
      }

      setMovies(items);
      setFacets({
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      });
      setUsingFallbackCatalog(false);
      // Auto-open modal if ?open=ID is in the URL
      if (openId) {
        const match = items.find((m) => m.id === openId);
        if (match) { setSelectedItem(match); setDetailMessage(''); }
      }
    } catch {
      try {
        const fallbackItems = await loadFallbackMovies();
        const filteredItems = filterMediaItems(fallbackItems, { search, genre, sortOrder });
        setMovies(filteredItems);
        setFacets({ genres: buildMediaGenreFacets(fallbackItems) });
        setUsingFallbackCatalog(true);

        if (openId) {
          const match = filteredItems.find((movie) => movie.id === openId);
          if (match) {
            setSelectedItem(match);
            setDetailMessage('');
          }
        }
      } catch {
        setMovies([]);
        setFacets({ genres: [] });
        setUsingFallbackCatalog(false);
      }
    } finally {
      setLoading(false);
    }
  }, [search, genre, sortOrder, openId]);

  useEffect(() => { fetchMovies(); }, [fetchMovies]);

  useEffect(() => {
    fetchSupabaseRatingMap('movie')
      .then(setUserRatings)
      .catch(() => {});
  }, []);

  async function handleRate(item, categories, review) {
    try {
      await saveSupabaseRating({ mediaType: 'movie', mediaId: item.id, categories, review });
      setUserRatings((cur) => ({ ...cur, [item.id]: { ...categories, media_id: item.id, review } }));
      setDetailMessage('Rating saved!');
    } catch (error) {
      setDetailMessage(error.message);
    }
  }

  async function handleWatchlist(item) {
    setIsAddingWatchlist(true);
    setDetailMessage('');
    try {
      await addSupabaseWatchlistItem({ mediaType: 'movie', mediaId: item.id });
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (error) {
      setDetailMessage(error.message);
    } finally {
      setIsAddingWatchlist(false);
    }
  }

  function openItemDetails(item) { setSelectedItem(item); setDetailMessage(''); }
  function closeItemDetails() { setSelectedItem(null); setDetailMessage(''); setIsAddingWatchlist(false); }
  function clearFilters() { setSearch(''); setGenre(''); setSortOrder('title-asc'); }

  const hasActiveFilters = Boolean(search || genre || sortOrder !== 'title-asc');
  const genreOptions = facets.genres;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Browse</p>
          <h1>Movies</h1>
          <p className="page-subtitle">
            Search the catalog, sort quickly, and open any title for ratings, watchlist saves, and shared-list planning.
          </p>
        </div>

        <section className="surface-panel">
          <div className="surface-panel-header">
            <div>
              <h2>Filter the Catalog</h2>
              <p className="surface-panel-copy">
                Search by title, narrow by genre, and sort without leaving the page.
              </p>
              {usingFallbackCatalog && (
                <p className="surface-panel-copy">Showing the bundled movie catalog snapshot.</p>
              )}
            </div>
            <p className="surface-panel-meta">
              {loading ? 'Loading movies...' : `${movies.length} movie${movies.length === 1 ? '' : 's'} found`}
            </p>
          </div>

          <div className="filter-bar">
            <input
              className="search-input"
              type="text"
              aria-label="Search movies"
              placeholder="Search movies..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="filter-input"
              aria-label="Genre"
              value={genre}
              onChange={(event) => setGenre(event.target.value)}
            >
              <option value="">All Genres</option>
              {genreOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <select
              className="filter-input"
              aria-label="Sort by"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            >
              <option value="title-asc">Title A-Z</option>
              <option value="title-desc">Title Z-A</option>
              <option value="year-desc">Newest First</option>
              <option value="year-asc">Oldest First</option>
            </select>
            {hasActiveFilters && (
              <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>

          {hasActiveFilters && !loading && (
            <p className="surface-panel-copy">Showing results for your active filters.</p>
          )}
        </section>

        <section className="surface-panel surface-panel-spacious">
          {loading ? (
            <div className="loading-state">Loading...</div>
          ) : movies.length === 0 ? (
            <div className="empty-state">
              <p>No movies found.</p>
              <p className="empty-hint">Try a different search or clear the filters.</p>
            </div>
          ) : (
            <div className="media-grid">
              {movies.map((movie) => (
                <MediaCard
                  key={movie.id}
                  item={movie}
                  mediaType="movie"
                  userRating={userRatings[movie.id]}
                  onWatchlist={usingFallbackCatalog ? undefined : handleWatchlist}
                  onOpenDetails={openItemDetails}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {selectedItem && (
        <MediaDetailsModal
          item={selectedItem}
          mediaType="movie"
          onClose={closeItemDetails}
          onRate={usingFallbackCatalog ? undefined : handleRate}
          onWatchlist={usingFallbackCatalog ? undefined : handleWatchlist}
          userRating={userRatings[selectedItem.id]}
          isAddingWatchlist={isAddingWatchlist}
          detailMessage={detailMessage}
          allowActions={!usingFallbackCatalog}
          browseOnlyMessage="Fallback catalog mode is browse-only."
        />
      )}
    </div>
  );
}

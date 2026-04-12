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
  loadFallbackTvShows,
} from '../catalogFallback';

function normalizeMediaItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

export default function TVShows() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));

  const [shows, setShows] = useState([]);
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

  const fetchShows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (genre) params.set('genre', genre);
      if (sortOrder) params.set('sort', sortOrder);

      const data = await api.get(`/media/tv-shows?${params}`);
      const items = normalizeMediaItems(data);
      if (items.length === 0) {
        throw new Error('TV catalog is empty');
      }

      setShows(items);
      setFacets({
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      });
      setUsingFallbackCatalog(false);
      // Auto-open modal if ?open=ID is in the URL
      if (openId) {
        const match = items.find((s) => s.id === openId);
        if (match) { setSelectedItem(match); setDetailMessage(''); }
      }
    } catch {
      try {
        const fallbackItems = await loadFallbackTvShows();
        const filteredItems = filterMediaItems(fallbackItems, { search, genre, sortOrder });
        setShows(filteredItems);
        setFacets({ genres: buildMediaGenreFacets(fallbackItems) });
        setUsingFallbackCatalog(true);

        if (openId) {
          const match = filteredItems.find((show) => show.id === openId);
          if (match) {
            setSelectedItem(match);
            setDetailMessage('');
          }
        }
      } catch {
        setShows([]);
        setFacets({ genres: [] });
        setUsingFallbackCatalog(false);
      }
    } finally {
      setLoading(false);
    }
  }, [search, genre, sortOrder, openId]);

  useEffect(() => { fetchShows(); }, [fetchShows]);

  useEffect(() => {
    fetchSupabaseRatingMap('tv_show')
      .then(setUserRatings)
      .catch(() => {});
  }, []);

  async function handleRate(item, categories, review) {
    try {
      await saveSupabaseRating({ mediaType: 'tv_show', mediaId: item.id, categories, review });
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
      await addSupabaseWatchlistItem({ mediaType: 'tv_show', mediaId: item.id });
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
          <h1>TV Shows</h1>
          <p className="page-subtitle">
            Explore series, compare genres, and jump from discovery into ratings, watchlists, and shared planning.
          </p>
        </div>

        <section className="surface-panel">
          <div className="surface-panel-header">
            <div>
              <h2>Filter the Catalog</h2>
              <p className="surface-panel-copy">
                Search by title, narrow by genre, and sort your shortlist in one place.
              </p>
              {usingFallbackCatalog && (
                <p className="surface-panel-copy">Showing the bundled TV catalog snapshot.</p>
              )}
            </div>
            <p className="surface-panel-meta">
              {loading ? 'Loading shows...' : `${shows.length} show${shows.length === 1 ? '' : 's'} found`}
            </p>
          </div>

          <div className="filter-bar">
            <input
              className="search-input"
              type="text"
              aria-label="Search TV shows"
              placeholder="Search TV shows..."
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
          ) : shows.length === 0 ? (
            <div className="empty-state">
              <p>No TV shows found.</p>
              <p className="empty-hint">Try a different search or clear the filters.</p>
            </div>
          ) : (
            <div className="media-grid">
              {shows.map((show) => (
                <MediaCard
                  key={show.id}
                  item={show}
                  mediaType="tv_show"
                  userRating={userRatings[show.id]}
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
          mediaType="tv_show"
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

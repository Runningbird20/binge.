import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import MediaDetailsModal from '../components/MediaDetailsModal';
import { api } from '../api';

function normalizeMediaItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

export default function TVShows() {
  const [shows, setShows] = useState([]);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [sortOrder, setSortOrder] = useState('title-asc');
  const [facets, setFacets] = useState({ genres: [] });
  const [userRatings, setUserRatings] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);

  const fetchShows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (genre) params.set('genre', genre);
      if (sortOrder) params.set('sort', sortOrder);
      const data = await api.get(`/media/tv-shows?${params}`);
      setShows(normalizeMediaItems(data));
      setFacets({
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      });
    } catch {
      setShows([]);
      setFacets({ genres: [] });
    } finally {
      setLoading(false);
    }
  }, [search, genre, sortOrder]);

  useEffect(() => {
    fetchShows();
  }, [fetchShows]);

  useEffect(() => {
    api.get('/ratings/my?media_type=tv_show')
      .then((ratings) => {
        const map = {};
        ratings.forEach((rating) => {
          map[rating.media_id] = rating.rating;
        });
        setUserRatings(map);
      })
      .catch(() => {});
  }, []);

  async function handleRate(item, rating) {
    try {
      await api.post('/ratings', { media_type: 'tv_show', media_id: item.id, rating });
      setUserRatings((prev) => ({ ...prev, [item.id]: rating }));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleWatchlist(item) {
    setIsAddingWatchlist(true);
    setDetailMessage('');
    try {
      await api.post('/watchlist', { media_type: 'tv_show', media_id: item.id });
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (err) {
      setDetailMessage(err.message);
    } finally {
      setIsAddingWatchlist(false);
    }
  }

  function openItemDetails(item) {
    setSelectedItem(item);
    setDetailMessage('');
  }

  function closeItemDetails() {
    setSelectedItem(null);
    setDetailMessage('');
    setIsAddingWatchlist(false);
  }

  function clearFilters() {
    setSearch('');
    setGenre('');
    setSortOrder('title-asc');
  }

  const hasActiveFilters = Boolean(search || genre || sortOrder !== 'title-asc');
  const genreOptions = facets.genres;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <div>
            <h1>TV Shows</h1>
            <p>Browse TV shows and open a tile to see full details and quick actions.</p>
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            aria-label="Search TV shows"
            placeholder="Search TV shows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="filter-input"
            aria-label="Genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          >
            <option value="">All Genres</option>
            {genreOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            className="filter-input"
            aria-label="Sort by"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
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

        <div className="books-results-header">
          <p className="books-results-count">
            {loading ? 'Loading shows...' : `${shows.length} show${shows.length === 1 ? '' : 's'} found`}
          </p>
          {hasActiveFilters && !loading && (
            <p className="books-results-summary">Showing results for your active filters.</p>
          )}
        </div>

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
                onRate={handleRate}
                onWatchlist={handleWatchlist}
                onOpenDetails={openItemDetails}
              />
            ))}
          </div>
        )}
      </main>

      {selectedItem && (
        <MediaDetailsModal
          item={selectedItem}
          mediaType="tv_show"
          onClose={closeItemDetails}
          onRate={handleRate}
          onWatchlist={handleWatchlist}
          userRating={userRatings[selectedItem.id]}
          isAddingWatchlist={isAddingWatchlist}
          detailMessage={detailMessage}
        />
      )}
    </div>
  );
}

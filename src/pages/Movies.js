import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import MediaDetailsModal from '../components/MediaDetailsModal';
import { api } from '../api';

const PAGE_SIZE = 48;

export default function Movies() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));

  const [movies, setMovies]         = useState([]);
  const [search, setSearch]         = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genre, setGenre]           = useState('');
  const [sortOrder, setSortOrder]   = useState('title-asc');
  const [facets, setFacets]         = useState({ genres: [] });
  const [userRatings, setUserRatings] = useState({});
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]             = useState(1);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const loadMoreRef = useRef(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1); setMovies([]); }, [debouncedSearch, genre, sortOrder]);

  // Fetch movies
  const fetchMovies = useCallback(async (pageNum) => {
    if (pageNum === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        page: pageNum,
        page_size: PAGE_SIZE,
        sort: sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (genre) params.set('genre', genre);

      const data = await api.get(`/media/movies?${params}`);
      const items = Array.isArray(data?.items) ? data.items : [];

      setMovies(prev => pageNum === 1 ? items : [...prev, ...items]);
      setTotal(data?.total || 0);
      setTotalPages(data?.totalPages || 1);
      if (data?.facets?.genres) setFacets({ genres: data.facets.genres });

      if (openId && pageNum === 1) {
        const match = items.find(m => m.id === openId);
        if (match) { setSelectedItem(match); setDetailMessage(''); }
      }
    } catch {
      if (pageNum === 1) setMovies([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, genre, sortOrder, openId]);

  useEffect(() => { fetchMovies(page); }, [page, fetchMovies]);

  // Infinite scroll
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const node = loadMoreRef.current;
    if (!node || loadingMore || page >= totalPages) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setPage(p => p + 1);
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadingMore, page, totalPages]);

  // Load user ratings
  useEffect(() => {
    api.get('/ratings/my?media_type=movie')
      .then(ratings => {
        const next = {};
        ratings.forEach(r => { next[r.media_id] = r; });
        setUserRatings(next);
      })
      .catch(() => {});
  }, []);

  async function handleRate(item, categories, review) {
    try {
      await api.post('/ratings', { media_type: 'movie', media_id: item.id, categories, review });
      setUserRatings(cur => ({ ...cur, [item.id]: { ...categories, media_id: item.id, review } }));
      setDetailMessage('Rating saved!');
    } catch (err) { setDetailMessage(err.message); }
  }

  async function handleWatchlist(item) {
    setIsAddingWatchlist(true);
    setDetailMessage('');
    try {
      await api.post('/watchlist', { media_type: 'movie', media_id: item.id });
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (err) { setDetailMessage(err.message); }
    finally { setIsAddingWatchlist(false); }
  }

  function openItemDetails(item) { setSelectedItem(item); setDetailMessage(''); }
  function closeItemDetails() { setSelectedItem(null); setDetailMessage(''); setIsAddingWatchlist(false); }
  function clearFilters() { setSearch(''); setGenre(''); setSortOrder('title-asc'); }

  const hasActiveFilters = Boolean(search || genre || sortOrder !== 'title-asc');

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
              <p className="surface-panel-copy">Search by title, narrow by genre, and sort without leaving the page.</p>
            </div>
            <p className="surface-panel-meta">
              {loading ? 'Loading...' : `${total.toLocaleString()} movie${total === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="filter-bar">
            <input
              className="search-input"
              type="text"
              aria-label="Search movies"
              placeholder="Search movies..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="filter-input" aria-label="Genre" value={genre} onChange={e => setGenre(e.target.value)}>
              <option value="">All Genres</option>
              {facets.genres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="filter-input" aria-label="Sort by" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
              <option value="title-asc">Title A-Z</option>
              <option value="title-desc">Title Z-A</option>
              <option value="year-desc">Newest First</option>
              <option value="year-asc">Oldest First</option>
            </select>
            {hasActiveFilters && <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>Clear</button>}
          </div>
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
            <>
              <div className="media-grid">
                {movies.map(movie => (
                  <MediaCard
                    key={movie.id}
                    item={movie}
                    mediaType="movie"
                    userRating={userRatings[movie.id]}
                    onWatchlist={handleWatchlist}
                    onOpenDetails={openItemDetails}
                  />
                ))}
              </div>
              <div style={{ textAlign: 'center', padding: '1rem', color: '#555', fontSize: '0.8rem' }}>
                {loadingMore && 'Loading more...'}
                {!loadingMore && page >= totalPages && movies.length > 0 && `All ${total.toLocaleString()} movies loaded`}
                {page < totalPages && !loadingMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
              </div>
            </>
          )}
        </section>
      </main>

      {selectedItem && (
        <MediaDetailsModal
          item={selectedItem}
          mediaType="movie"
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

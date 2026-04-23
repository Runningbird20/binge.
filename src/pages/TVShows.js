import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import MediaDetailsModal from '../components/MediaDetailsModal';
import MediaRow from '../components/MediaRow';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  fetchSupabaseTvShowById,
  fetchSupabaseTvShowCatalogSegment,
  fetchSupabaseTvShowCuratedRows,
} from '../utils/supabaseMovieCatalog';

const PAGE_SIZE = 48;
const BACKGROUND_SEGMENT_SIZE = 1000;
const BACKGROUND_REQUEST_BATCH_SIZE = 4;
const VISIBLE_BATCH_SIZE = 120;
const BACKGROUND_BATCH_DELAY_MS = 40;

function appendUniqueItems(currentItems, nextItems) {
  const seenIds = new Set(currentItems.map((item) => item.id));
  return [...currentItems, ...nextItems.filter((item) => !seenIds.has(item.id))];
}

function normalizeMediaItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function pauseBackgroundLoading() {
  return new Promise((resolve) => window.setTimeout(resolve, BACKGROUND_BATCH_DELAY_MS));
}

function BrowseView({ onItemClick, onWatchlist, userRatings, initialGenre, initialSearch, initialSort }) {
  const [shows, setShows] = useState([]);
  const [search, setSearch] = useState(initialSearch || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || '');
  const [genre, setGenre] = useState(initialGenre || '');
  const [sortOrder, setSortOrder] = useState(initialSort || 'title-asc');
  const [facets, setFacets] = useState({ genres: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const requestTokenRef = useRef(0);
  const loadMoreRef = useRef(null);
  const [renderedCount, setRenderedCount] = useState(VISIBLE_BATCH_SIZE);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const requestToken = ++requestTokenRef.current;

    setLoading(true);
    setLoadingMore(false);
    setShows([]);
    setTotal(0);
    setFacets({ genres: [] });
    setRenderedCount(VISIBLE_BATCH_SIZE);

    async function loadCatalog() {
      try {
        const data = await fetchSupabaseTvShowCatalogSegment({
          offset: 0,
          limit: PAGE_SIZE,
          search: debouncedSearch,
          genre,
          sortOrder,
          includeCount: true,
          includeFacets: true,
        });

        if (cancelled || requestTokenRef.current !== requestToken) return;

        const items = normalizeMediaItems(data);
        const totalCount = Number(data?.total) || items.length;

        setShows(items);
        setTotal(totalCount);
        setFacets({ genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [] });
        setRenderedCount(Math.min(VISIBLE_BATCH_SIZE, items.length || VISIBLE_BATCH_SIZE));
        setLoading(false);

        if (totalCount <= PAGE_SIZE) return;

        setLoadingMore(true);
        for (
          let offset = PAGE_SIZE;
          offset < totalCount;
          offset += BACKGROUND_SEGMENT_SIZE * BACKGROUND_REQUEST_BATCH_SIZE
        ) {
          const batchOffsets = Array.from(
            { length: BACKGROUND_REQUEST_BATCH_SIZE },
            (_, i) => offset + i * BACKGROUND_SEGMENT_SIZE
          ).filter((o) => o < totalCount);

          const batchResults = await Promise.all(
            batchOffsets.map((o) =>
              fetchSupabaseTvShowCatalogSegment({
                offset: o,
                limit: BACKGROUND_SEGMENT_SIZE,
                search: debouncedSearch,
                genre,
                sortOrder,
                includeCount: false,
                includeFacets: false,
              })
            )
          );

          if (requestTokenRef.current !== requestToken) return;

          setShows((current) =>
            appendUniqueItems(current, batchResults.flatMap((r) => normalizeMediaItems(r)))
          );
          await pauseBackgroundLoading();
        }
      } catch (err) {
        if (cancelled || requestTokenRef.current !== requestToken) return;
        console.error('Failed to load TV shows:', err.message);
        setShows([]);
        setTotal(0);
        setFacets({ genres: [] });
        setLoading(false);
      } finally {
        if (!cancelled && requestTokenRef.current === requestToken) {
          setLoadingMore(false);
        }
      }
    }

    loadCatalog();
    return () => { cancelled = true; };
  }, [debouncedSearch, genre, sortOrder]);

  const loadedCount = Math.min(shows.length, total);
  const visibleShows = shows.slice(0, renderedCount);

  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') return;
    const node = loadMoreRef.current;
    if (!node || loading || renderedCount >= loadedCount) return;

    let queued = false;
    const observer = new window.IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || queued) return;
        queued = true;
        setRenderedCount((c) => Math.min(c + VISIBLE_BATCH_SIZE, loadedCount));
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadedCount, loading, renderedCount]);

  return (
    <div className="browse-view">
      <div className="browse-view-filters">
        <input
          className="search-input"
          type="text"
          placeholder="Search TV shows..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-input" value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">All Genres</option>
          {facets.genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="filter-input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="title-asc">Title A-Z</option>
          <option value="title-desc">Title Z-A</option>
          <option value="year-desc">Newest First</option>
          <option value="year-asc">Oldest First</option>
        </select>
        {(search || genre || sortOrder !== 'title-asc') && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setSearch(''); setGenre(''); setSortOrder('title-asc'); }}>
            Clear
          </button>
        )}
        <span className="browse-view-count">
          {loading
            ? 'Loading shows...'
            : `${loadedCount.toLocaleString()} of ${total.toLocaleString()} show${total === 1 ? '' : 's'} loaded`}
        </span>
      </div>

      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : shows.length === 0 ? (
        <div className="empty-state"><p>No shows found.</p></div>
      ) : (
        <>
          <div className="media-grid">
            {visibleShows.map((show) => (
              <MediaCard
                key={show.id}
                item={show}
                mediaType="tv_show"
                userRating={userRatings[show.id]}
                onWatchlist={onWatchlist}
                onOpenDetails={onItemClick}
                showDescription={false}
              />
            ))}
          </div>
          <div className="infinite-scroll-footer">
            {loadingMore ? (
              <span>Loading catalog... {loadedCount.toLocaleString()} of {total.toLocaleString()} shows ready, showing {visibleShows.length.toLocaleString()}</span>
            ) : visibleShows.length < loadedCount ? (
              <span>Showing {visibleShows.length.toLocaleString()} of {loadedCount.toLocaleString()} loaded shows. Scroll to reveal more.</span>
            ) : (
              <span>All {total.toLocaleString()} shows loaded</span>
            )}
            {visibleShows.length < loadedCount && <div ref={loadMoreRef} style={{ height: 1 }} />}
          </div>
        </>
      )}
    </div>
  );
}

function CuratedView({ onItemClick, onSeeAll }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchSupabaseTvShowCuratedRows()
      .then((nextRows) => {
        if (!cancelled) setRows(nextRows.length > 0 ? nextRows : []);
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load curated rows:', err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="curated-loading"><div className="curated-loading-shimmer" /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No discovery rows are available right now.</p>
        <button type="button" className="btn-ghost btn-sm" onClick={() => onSeeAll({ seeAll: '/tv-shows' })}>
          Browse All
        </button>
      </div>
    );
  }

  return (
    <div className="curated-view">
      {rows.map((row, index) => (
        <div key={row.id} style={{ animationDelay: `${index * 0.06}s` }} className="curated-row-appear">
          <MediaRow row={row} mediaType="tv_show" onItemClick={onItemClick} onSeeAll={onSeeAll} />
        </div>
      ))}
    </div>
  );
}

export default function TVShows() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));
  const initialBrowseGenre = searchParams.get('genre') || '';
  const initialBrowseSearch = searchParams.get('search') || '';
  const initialBrowseSort = searchParams.get('sort') || 'title-asc';
  const startsInBrowseView = Boolean(initialBrowseGenre || initialBrowseSearch || initialBrowseSort !== 'title-asc');

  const [view, setView] = useState(startsInBrowseView ? 'browse' : 'curated');
  const [browseGenre, setBrowseGenre] = useState(initialBrowseGenre);
  const [browseSearch, setBrowseSearch] = useState(initialBrowseSearch);
  const [browseSort, setBrowseSort] = useState(initialBrowseSort);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const [userRatings, setUserRatings] = useState({});

  useEffect(() => {
    fetchSupabaseRatingMap('tv_show').then(setUserRatings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;

    fetchSupabaseTvShowById(openId)
      .then((item) => {
        if (!cancelled && item?.id) {
          setSelectedItem(item);
          setDetailMessage('');
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [openId]);

  async function openItemDetails(item) {
    setSelectedItem(item);
    setDetailMessage('');

    try {
      const detailed = await fetchSupabaseTvShowById(item.id);
      if (detailed?.id) {
        setSelectedItem((current) => current?.id === item.id ? detailed : current);
      }
    } catch {
      // keep summary
    }
  }

  function handleSeeAll(row) {
    const params = new URLSearchParams((row.seeAll || '').split('?')[1] || '');
    setBrowseGenre(params.get('genre') || '');
    setBrowseSearch(params.get('search') || '');
    setBrowseSort(params.get('sort') || 'title-asc');
    setView('browse');
  }

  async function handleRate(item, categories, review) {
    try {
      await saveSupabaseRating({ mediaType: 'tv_show', mediaId: item.id, categories, review, media: item });
      setUserRatings((current) => ({ ...current, [item.id]: { ...categories, media_id: item.id, review } }));
      setDetailMessage('Rating saved!');
    } catch (error) {
      setDetailMessage(error.message);
    }
  }

  async function handleWatchlist(item) {
    setIsAddingWatchlist(true);
    setDetailMessage('');
    try {
      await addSupabaseWatchlistItem({ mediaType: 'tv_show', mediaId: item.id, media: item });
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (error) {
      setDetailMessage(error.message);
    } finally {
      setIsAddingWatchlist(false);
    }
  }

  function closeItemDetails() {
    setSelectedItem(null);
    setDetailMessage('');
    setIsAddingWatchlist(false);
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">
        <div className="curated-page-header">
          <h1 className="curated-page-title">TV Shows</h1>
          <div className="curated-view-toggle">
            <button
              className={`curated-toggle-btn ${view === 'curated' ? 'active' : ''}`}
              onClick={() => { setBrowseGenre(''); setBrowseSearch(''); setBrowseSort('title-asc'); setView('curated'); }}
              type="button"
            >
              Discover
            </button>
            <button
              className={`curated-toggle-btn ${view === 'browse' ? 'active' : ''}`}
              onClick={() => setView('browse')}
              type="button"
            >
              Browse All
            </button>
          </div>
        </div>

        {view === 'curated' ? (
          <CuratedView onItemClick={openItemDetails} onSeeAll={handleSeeAll} />
        ) : (
          <BrowseView
            onItemClick={openItemDetails}
            onWatchlist={handleWatchlist}
            userRatings={userRatings}
            initialGenre={browseGenre}
            initialSearch={browseSearch}
            initialSort={browseSort}
          />
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
          allowActions={true}
        />
      )}
    </div>
  );
}
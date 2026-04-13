import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import MediaDetailsModal from '../components/MediaDetailsModal';
import MediaRow from '../components/MediaRow';
import { api } from '../api';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  fetchSupabaseTvShowById,
  fetchSupabaseTvShowCuratedRows,
  fetchSupabaseTvShowsPage,
} from '../utils/supabaseMovieCatalog';
import {
  buildMediaGenreFacets,
  filterMediaItems,
  loadFallbackTvShows,
} from '../catalogFallback';

const PAGE_SIZE = 48;

function normalizeMediaItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function appendUniqueItems(currentItems, nextItems) {
  const seenIds = new Set(currentItems.map((item) => item.id));
  return [...currentItems, ...nextItems.filter((item) => !seenIds.has(item.id))];
}

function buildFallbackBrowseResult(items, { page, search, genre, sortOrder }) {
  const filteredItems = filterMediaItems(items, { search, genre, sortOrder });
  const total = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIndex = Math.max(0, (page - 1) * PAGE_SIZE);

  return {
    items: filteredItems.slice(startIndex, startIndex + PAGE_SIZE),
    total,
    totalPages,
  };
}

function buildFallbackCuratedRows(items) {
  const featuredItems = filterMediaItems(items, { sortOrder: 'year-desc' }).slice(0, 12);
  const genres = buildMediaGenreFacets(items).slice(0, 4);

  return [
    {
      id: 'featured',
      title: 'Featured Series',
      seeAll: '/tv-shows?sort=year-desc',
      items: featuredItems,
    },
    ...genres.map((genre) => ({
      id: `genre-${genre}`,
      title: genre,
      seeAll: `/tv-shows?genre=${encodeURIComponent(genre)}`,
      items: filterMediaItems(items, { genre, sortOrder: 'year-desc' }).slice(0, 12),
    })),
  ].filter((row) => Array.isArray(row.items) && row.items.length > 0);
}

function BrowseView({
  onItemClick,
  onWatchlist,
  userRatings,
  initialGenre,
  initialSearch,
  initialSort,
}) {
  const [shows, setShows] = useState([]);
  const [search, setSearch] = useState(initialSearch || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || '');
  const [genre, setGenre] = useState(initialGenre || '');
  const [sortOrder, setSortOrder] = useState(initialSort || 'title-asc');
  const [facets, setFacets] = useState({ genres: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [search]);

  useEffect(() => {
    setPage(1);
    setShows([]);
  }, [debouncedSearch, genre, sortOrder]);

  const fetchShows = useCallback(async (pageNum) => {
    if (pageNum === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const data = await fetchSupabaseTvShowsPage({
        page: pageNum,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        genre,
        sortOrder,
      });
      const nextItems = normalizeMediaItems(data);
      if (pageNum === 1 && nextItems.length === 0 && !debouncedSearch && !genre) {
        throw new Error('TV catalog is empty');
      }

      setShows((current) => (pageNum === 1 ? nextItems : appendUniqueItems(current, nextItems)));
      setTotal(Number(data?.total) || nextItems.length);
      setTotalPages(Number(data?.totalPages) || 1);
      setFacets({
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      });
      setUsingFallbackCatalog(false);
    } catch {
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          page_size: String(PAGE_SIZE),
          sort: sortOrder,
        });

        if (debouncedSearch) params.set('search', debouncedSearch);
        if (genre) params.set('genre', genre);

        const data = await api.get(`/media/tv-shows?${params.toString()}`);
        const nextItems = normalizeMediaItems(data);
        if (pageNum === 1 && nextItems.length === 0 && !debouncedSearch && !genre) {
          throw new Error('TV catalog is empty');
        }

        setShows((current) => (pageNum === 1 ? nextItems : appendUniqueItems(current, nextItems)));
        setTotal(Number(data?.total) || nextItems.length);
        setTotalPages(Number(data?.totalPages) || 1);
        setFacets({
          genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
        });
        setUsingFallbackCatalog(false);
      } catch {
        try {
          const fallbackItems = await loadFallbackTvShows();
          const result = buildFallbackBrowseResult(fallbackItems, {
            page: pageNum,
            search: debouncedSearch,
            genre,
            sortOrder,
          });

          setShows((current) => (pageNum === 1 ? result.items : appendUniqueItems(current, result.items)));
          setTotal(result.total);
          setTotalPages(result.totalPages);
          setFacets({ genres: buildMediaGenreFacets(fallbackItems) });
          setUsingFallbackCatalog(true);
        } catch {
          if (pageNum === 1) {
            setShows([]);
            setTotal(0);
            setTotalPages(1);
            setFacets({ genres: [] });
            setUsingFallbackCatalog(false);
          }
        }
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, genre, sortOrder]);

  useEffect(() => {
    fetchShows(page);
  }, [page, fetchShows]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || loadingMore || page >= totalPages) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPage((current) => current + 1);
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadingMore, page, totalPages]);

  return (
    <div className="browse-view">
      <div className="browse-view-filters">
        <input
          className="search-input"
          type="text"
          placeholder="Search TV shows..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="filter-input"
          value={genre}
          onChange={(event) => setGenre(event.target.value)}
        >
          <option value="">All Genres</option>
          {facets.genres.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <select
          className="filter-input"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
        >
          <option value="title-asc">Title A-Z</option>
          <option value="title-desc">Title Z-A</option>
          <option value="year-desc">Newest First</option>
          <option value="year-asc">Oldest First</option>
        </select>
        {(search || genre || sortOrder !== 'title-asc') && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setSearch('');
              setGenre('');
              setSortOrder('title-asc');
            }}
          >
            Clear
          </button>
        )}
        <span className="browse-view-count">
          {loading ? 'Loading shows...' : `${total.toLocaleString()} show${total === 1 ? '' : 's'}${usingFallbackCatalog ? ' in bundled snapshot' : ''}`}
        </span>
      </div>

      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : shows.length === 0 ? (
        <div className="empty-state">
          <p>No shows found.</p>
        </div>
      ) : (
        <>
          <div className="media-grid">
            {shows.map((show) => (
              <MediaCard
                key={show.id}
                item={show}
                mediaType="tv_show"
                userRating={userRatings[show.id]}
                onWatchlist={usingFallbackCatalog ? undefined : onWatchlist}
                onOpenDetails={(item) => onItemClick(item, { browseOnly: usingFallbackCatalog })}
              />
            ))}
          </div>
          <div className="infinite-scroll-footer">
            {loadingMore && <span>Loading more...</span>}
            {!loadingMore && page >= totalPages && (
              <span>All {total.toLocaleString()} shows loaded</span>
            )}
            {page < totalPages && !loadingMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
          </div>
        </>
      )}
    </div>
  );
}

function CuratedView({ onItemClick, onSeeAll }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingFallbackRows, setUsingFallbackRows] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchRows() {
      setLoading(true);

      try {
        const nextRows = await fetchSupabaseTvShowCuratedRows();
        if (nextRows.length === 0) {
          throw new Error('No curated rows available');
        }

        if (!cancelled) {
          setRows(nextRows);
          setUsingFallbackRows(false);
        }
      } catch {
        try {
          const data = await api.get('/media/tv-shows/curated');
          const nextRows = Array.isArray(data?.rows) ? data.rows : [];
          if (nextRows.length === 0) {
            throw new Error('No curated rows available');
          }

          if (!cancelled) {
            setRows(nextRows);
            setUsingFallbackRows(false);
          }
        } catch {
          try {
            const fallbackItems = await loadFallbackTvShows();
            if (!cancelled) {
              setRows(buildFallbackCuratedRows(fallbackItems));
              setUsingFallbackRows(true);
            }
          } catch {
            if (!cancelled) {
              setRows([]);
              setUsingFallbackRows(false);
            }
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchRows();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="curated-loading">
        <div className="curated-loading-shimmer" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No discovery rows are available right now.</p>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => onSeeAll({ seeAll: '/tv-shows' })}
        >
          Browse All
        </button>
      </div>
    );
  }

  return (
    <div className="curated-view">
      {rows.map((row, index) => (
        <div
          key={row.id}
          style={{ animationDelay: `${index * 0.06}s` }}
          className="curated-row-appear"
        >
          <MediaRow
            row={row}
            mediaType="tv_show"
            onItemClick={(item) => onItemClick(item, { browseOnly: usingFallbackRows })}
            onSeeAll={onSeeAll}
          />
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
  const startsInBrowseView = Boolean(
    initialBrowseGenre || initialBrowseSearch || initialBrowseSort !== 'title-asc'
  );

  const [view, setView] = useState(startsInBrowseView ? 'browse' : 'curated');
  const [browseGenre, setBrowseGenre] = useState(initialBrowseGenre);
  const [browseSearch, setBrowseSearch] = useState(initialBrowseSearch);
  const [browseSort, setBrowseSort] = useState(initialBrowseSort);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemBrowseOnly, setSelectedItemBrowseOnly] = useState(false);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const [userRatings, setUserRatings] = useState({});

  useEffect(() => {
    fetchSupabaseRatingMap('tv_show')
      .then(setUserRatings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!openId) return undefined;

    let cancelled = false;

    async function loadOpenItem() {
      try {
        const item = await fetchSupabaseTvShowById(openId);
        if (!cancelled && item?.id) {
          setSelectedItem(item);
          setSelectedItemBrowseOnly(false);
          setDetailMessage('');
          return;
        }
      } catch {
        // Fall through to the legacy API and bundled catalog below.
      }

      try {
        const item = await api.get(`/media/tv-shows/${openId}`);
        if (!cancelled && item?.id) {
          setSelectedItem(item);
          setSelectedItemBrowseOnly(false);
          setDetailMessage('');
          return;
        }
      } catch {
        // Fall back to the bundled catalog below.
      }

      try {
        const fallbackItems = await loadFallbackTvShows();
        const match = fallbackItems.find((item) => item.id === openId);
        if (!cancelled && match) {
          setSelectedItem(match);
          setSelectedItemBrowseOnly(true);
          setDetailMessage('');
          setView('browse');
        }
      } catch {
        // Ignore missing fallback data.
      }
    }

    loadOpenItem();
    return () => {
      cancelled = true;
    };
  }, [openId]);

  function openItemDetails(item, { browseOnly = false } = {}) {
    setSelectedItem(item);
    setSelectedItemBrowseOnly(browseOnly);
    setDetailMessage('');
  }

  function handleSeeAll(row) {
    const url = row.seeAll || '';
    const params = new URLSearchParams(url.split('?')[1] || '');
    setBrowseGenre(params.get('genre') || '');
    setBrowseSearch(params.get('search') || '');
    setBrowseSort(params.get('sort') || 'title-asc');
    setView('browse');
  }

  function switchToDiscover() {
    setBrowseGenre('');
    setBrowseSearch('');
    setBrowseSort('title-asc');
    setView('curated');
  }

  async function handleRate(item, categories, review) {
    try {
      await saveSupabaseRating({
        mediaType: 'tv_show',
        mediaId: item.id,
        categories,
        review,
        media: item,
      });
      setUserRatings((current) => ({
        ...current,
        [item.id]: { ...categories, media_id: item.id, review },
      }));
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
    setSelectedItemBrowseOnly(false);
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
              onClick={switchToDiscover}
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
          onRate={selectedItemBrowseOnly ? undefined : handleRate}
          onWatchlist={selectedItemBrowseOnly ? undefined : handleWatchlist}
          userRating={userRatings[selectedItem.id]}
          isAddingWatchlist={isAddingWatchlist}
          detailMessage={detailMessage}
          allowActions={!selectedItemBrowseOnly}
          browseOnlyMessage="Fallback catalog mode is browse-only."
        />
      )}
    </div>
  );
}

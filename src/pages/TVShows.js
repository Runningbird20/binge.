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
  fetchSupabaseTvShowCatalogSegment,
  fetchSupabaseTvShowCuratedRows,
} from '../utils/supabaseMovieCatalog';
import {
  buildMediaGenreFacets,
  filterMediaItems,
  loadFallbackTvShows,
} from '../catalogFallback';

const PAGE_SIZE = 48;
const BACKGROUND_SEGMENT_SIZE = 1000;
const BACKGROUND_REQUEST_BATCH_SIZE = 4;
const VISIBLE_BATCH_SIZE = 120;
const BACKGROUND_BATCH_DELAY_MS = 40;

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

function pauseBackgroundLoading() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, BACKGROUND_BATCH_DELAY_MS);
  });
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
  const [total, setTotal] = useState(0);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const requestTokenRef = useRef(0);
  const fallbackItemsRef = useRef(null);
  const loadMoreRef = useRef(null);
  const [renderedCount, setRenderedCount] = useState(VISIBLE_BATCH_SIZE);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [search]);

  const fetchShowsPageFromApi = useCallback(async (pageNum) => {
    const params = new URLSearchParams({
      page: String(pageNum),
      page_size: String(PAGE_SIZE),
      sort: sortOrder,
    });

    if (debouncedSearch) params.set('search', debouncedSearch);
    if (genre) params.set('genre', genre);

    const data = await api.get(`/media/tv-shows?${params.toString()}`);
    const nextItems = normalizeMediaItems(data);

    return {
      items: nextItems,
      total: Number(data?.total) || nextItems.length,
      totalPages: Number(data?.totalPages) || 1,
      facets: {
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      },
      usingFallbackCatalog: false,
    };
  }, [debouncedSearch, genre, sortOrder]);

  const fetchShowsPageFromFallback = useCallback(async (pageNum) => {
    const fallbackItems = fallbackItemsRef.current || await loadFallbackTvShows();
    fallbackItemsRef.current = fallbackItems;

    const result = buildFallbackBrowseResult(fallbackItems, {
      page: pageNum,
      search: debouncedSearch,
      genre,
      sortOrder,
    });

    return {
      items: result.items,
      total: result.total,
      totalPages: result.totalPages,
      facets: { genres: buildMediaGenreFacets(fallbackItems) },
      usingFallbackCatalog: true,
    };
  }, [debouncedSearch, genre, sortOrder]);

  const fetchInitialShows = useCallback(async () => {
    try {
      const data = await fetchSupabaseTvShowCatalogSegment({
        offset: 0,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        genre,
        sortOrder,
        includeCount: true,
        includeFacets: true,
        includeUpcoming: sortOrder === 'year-asc',
      });
      const nextItems = normalizeMediaItems(data);
      if (nextItems.length === 0 && !debouncedSearch && !genre) {
        throw new Error('TV catalog is empty');
      }

      const totalCount = Number(data?.total) || nextItems.length;
      return {
        source: 'supabase',
        items: nextItems,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
        facets: {
          genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
        },
        usingFallbackCatalog: false,
      };
    } catch {
      try {
        const data = await fetchShowsPageFromApi(1);
        if (data.items.length === 0 && !debouncedSearch && !genre) {
          throw new Error('TV catalog is empty');
        }

        return { source: 'api', ...data };
      } catch {
        const data = await fetchShowsPageFromFallback(1);
        return { source: 'fallback', ...data };
      }
    }
  }, [debouncedSearch, genre, sortOrder, fetchShowsPageFromApi, fetchShowsPageFromFallback]);

  const loadRemainingShows = useCallback(async ({ source, totalCount, requestToken }) => {
    if (totalCount <= PAGE_SIZE) {
      setLoadingMore(false);
      return;
    }

    setLoadingMore(true);

    try {
      if (source === 'supabase') {
        for (
          let offset = PAGE_SIZE;
          offset < totalCount;
          offset += BACKGROUND_SEGMENT_SIZE * BACKGROUND_REQUEST_BATCH_SIZE
        ) {
          const batchOffsets = Array.from(
            { length: BACKGROUND_REQUEST_BATCH_SIZE },
            (_, index) => offset + (index * BACKGROUND_SEGMENT_SIZE)
          ).filter((batchOffset) => batchOffset < totalCount);

          const batchResults = await Promise.all(batchOffsets.map((batchOffset) => (
            fetchSupabaseTvShowCatalogSegment({
              offset: batchOffset,
              limit: BACKGROUND_SEGMENT_SIZE,
              search: debouncedSearch,
              genre,
              sortOrder,
              includeCount: false,
              includeFacets: false,
              includeUpcoming: sortOrder === 'year-asc',
            })
          )));

          if (requestTokenRef.current !== requestToken) {
            return;
          }

          setShows((current) => (
            appendUniqueItems(current, batchResults.flatMap((result) => normalizeMediaItems(result)))
          ));
          await pauseBackgroundLoading();
        }

        return;
      }

      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      for (let pageNum = 2; pageNum <= totalPages; pageNum += BACKGROUND_REQUEST_BATCH_SIZE) {
        const pageNumbers = Array.from(
          { length: Math.min(BACKGROUND_REQUEST_BATCH_SIZE, totalPages - pageNum + 1) },
          (_, index) => pageNum + index
        );

        const batchResults = await Promise.all(pageNumbers.map((nextPageNum) => (
          source === 'api'
            ? fetchShowsPageFromApi(nextPageNum)
            : fetchShowsPageFromFallback(nextPageNum)
        )));

        if (requestTokenRef.current !== requestToken) {
          return;
        }

        setShows((current) => (
          appendUniqueItems(current, batchResults.flatMap((result) => result.items))
        ));
        await pauseBackgroundLoading();
      }
    } finally {
      if (requestTokenRef.current === requestToken) {
        setLoadingMore(false);
      }
    }
  }, [debouncedSearch, genre, sortOrder, fetchShowsPageFromApi, fetchShowsPageFromFallback]);

  useEffect(() => {
    let cancelled = false;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    fallbackItemsRef.current = null;

    setLoading(true);
    setLoadingMore(false);
    setShows([]);
    setTotal(0);
    setFacets({ genres: [] });
    setUsingFallbackCatalog(false);
    setRenderedCount(VISIBLE_BATCH_SIZE);

    async function loadCatalog() {
      try {
        const initialResult = await fetchInitialShows();
        if (cancelled || requestTokenRef.current !== requestToken) {
          return;
        }

        setShows(initialResult.items);
        setTotal(initialResult.total);
        setFacets({
          genres: Array.isArray(initialResult?.facets?.genres) ? initialResult.facets.genres : [],
        });
        setUsingFallbackCatalog(initialResult.usingFallbackCatalog);
        setRenderedCount(Math.min(VISIBLE_BATCH_SIZE, initialResult.items.length || VISIBLE_BATCH_SIZE));
        setLoading(false);

        if (initialResult.total > initialResult.items.length) {
          await loadRemainingShows({
            source: initialResult.source,
            totalCount: initialResult.total,
            requestToken,
          });
        }
      } catch {
        if (cancelled || requestTokenRef.current !== requestToken) {
          return;
        }

        setShows([]);
        setTotal(0);
        setFacets({ genres: [] });
        setUsingFallbackCatalog(false);
        setLoading(false);
        setLoadingMore(false);
      }
    }

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [fetchInitialShows, loadRemainingShows]);

  const loadedCount = Math.min(shows.length, total);
  const visibleShows = shows.slice(0, renderedCount);

  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') {
      return undefined;
    }

    const node = loadMoreRef.current;
    if (!node || loading || renderedCount >= loadedCount) {
      return undefined;
    }

    let queuedExpansion = false;
    const observer = new window.IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || queuedExpansion) {
          return;
        }

        queuedExpansion = true;
        setRenderedCount((current) => Math.min(current + VISIBLE_BATCH_SIZE, loadedCount));
      },
      {
        rootMargin: '320px 0px',
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [loadedCount, loading, renderedCount]);

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
          {loading
            ? 'Loading shows...'
            : `${loadedCount.toLocaleString()} of ${total.toLocaleString()} show${total === 1 ? '' : 's'} loaded${usingFallbackCatalog ? ' from bundled snapshot' : ''}`}
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
            {visibleShows.map((show) => (
              <MediaCard
                key={show.id}
                item={show}
                mediaType="tv_show"
                userRating={userRatings[show.id]}
                onWatchlist={usingFallbackCatalog ? undefined : onWatchlist}
                onOpenDetails={(item) => onItemClick(item, { browseOnly: usingFallbackCatalog })}
                showDescription={false}
              />
            ))}
          </div>
          <div className="infinite-scroll-footer">
            {loadingMore ? (
              <span>
                Loading catalog... {loadedCount.toLocaleString()} of {total.toLocaleString()} shows ready, showing {visibleShows.length.toLocaleString()}
              </span>
            ) : visibleShows.length < loadedCount ? (
              <span>
                Showing {visibleShows.length.toLocaleString()} of {loadedCount.toLocaleString()} loaded shows. Scroll to reveal more.
              </span>
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

  async function openItemDetails(item, { browseOnly = false } = {}) {
    setSelectedItem(item);
    setSelectedItemBrowseOnly(browseOnly);
    setDetailMessage('');

    if (browseOnly || !item?._summary) {
      return;
    }

    try {
      const detailedItem = await fetchSupabaseTvShowById(item.id);
      if (detailedItem?.id) {
        setSelectedItem((current) => (current?.id === item.id ? detailedItem : current));
        return;
      }
    } catch {
      // Fall through to the legacy API below.
    }

    try {
      const detailedItem = await api.get(`/media/tv-shows/${item.id}`);
      if (detailedItem?.id) {
        setSelectedItem((current) => (current?.id === item.id ? detailedItem : current));
      }
    } catch {
      // Keep the summary item if full details are unavailable.
    }
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

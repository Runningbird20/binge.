import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MediaDetailsModal from '../components/MediaDetailsModal';
import { SkeletonGrid } from '../components/SkeletonCard';
import { api } from '../api';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  fetchSupabaseTvShowById,
  fetchSupabaseTvShowCatalogSegment,
} from '../utils/supabaseMovieCatalog';
import {
  buildMediaGenreFacets,
  filterMediaItems,
  loadFallbackTvShows,
} from '../catalogFallback';

const PAGE_SIZE = 48;
// Random-window sampling (borrowed from the recommendation engine): instead of
// paging through the catalog in a fixed order, jump to random offsets so the
// grid mixes eras and titles with no obvious order.
const SAMPLE_WINDOW = 60;
const WINDOWS_PER_BATCH = 3;
const VISIBLE_BATCH_SIZE = 60;
const MAX_EMPTY_BATCHES = 3;

function normalizeMediaItems(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function appendUniqueItems(currentItems, nextItems) {
  const seenIds = new Set(currentItems.map((item) => item.id));
  return [...currentItems, ...nextItems.filter((item) => !seenIds.has(item.id))];
}

function shuffleItems(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function hasPoster(item) {
  return Boolean(item?.poster_url || item?.cover_url || item?.image_url);
}

// Shuffle a batch, floating items that actually have artwork to the front so
// the grid stays visual while remaining unordered.
function orderBatch(items) {
  const shuffled = shuffleItems(items);
  return [...shuffled.filter(hasPoster), ...shuffled.filter((item) => !hasPoster(item))];
}

function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) {
        try {
          return decodeURIComponent(inner);
        } catch {
          return inner;
        }
      }
    }
  } catch {
    return url;
  }
  return url;
}

function PosterTile({ item, onClick }) {
  const [imgError, setImgError] = useState(false);
  const posterUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.image_url);
  const isNew = Number(item.year) >= new Date().getFullYear();

  return (
    <button type="button" className="poster-tile" onClick={() => onClick(item)} title={item.title}>
      <div className="poster-tile-frame">
        {posterUrl && !imgError ? (
          <img
            src={posterUrl}
            alt={item.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="poster-tile-placeholder">
            <span>{item.title?.charAt(0)}</span>
          </div>
        )}
        {isNew && <span className="poster-tile-badge">New</span>}
      </div>
      <p className="poster-tile-title">{item.title}</p>
      {item.year && <p className="poster-tile-year">{item.year}</p>}
    </button>
  );
}

function CatalogView({ onItemClick, initialGenre, initialSearch }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState(initialSearch || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || '');
  const [genre, setGenre] = useState(initialGenre || '');
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const [renderedCount, setRenderedCount] = useState(VISIBLE_BATCH_SIZE);
  const requestTokenRef = useRef(0);
  const sourceRef = useRef({ mode: 'supabase', totalPages: 1, nextPage: 2 });
  const emptyBatchesRef = useRef(0);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [search]);

  const fetchSupabaseWindows = useCallback(async ({ totalCount, existingCount }) => {
    if (debouncedSearch) {
      // Search results should stay deterministic: page through them in order.
      const data = await fetchSupabaseTvShowCatalogSegment({
        offset: existingCount,
        limit: SAMPLE_WINDOW * WINDOWS_PER_BATCH,
        search: debouncedSearch,
        genre,
        sortOrder: 'title-asc',
        includeCount: false,
        includeFacets: false,
        includeUpcoming: false,
      });
      return normalizeMediaItems(data);
    }

    const windowSize = Math.min(SAMPLE_WINDOW, Math.max(totalCount, 1));
    const maxOffset = Math.max(0, totalCount - windowSize);
    const offsets = Array.from({ length: WINDOWS_PER_BATCH }, () => (
      maxOffset > 0 ? Math.floor(Math.random() * (maxOffset + 1)) : 0
    ));

    const results = await Promise.all(offsets.map((offset) => (
      fetchSupabaseTvShowCatalogSegment({
        offset,
        limit: windowSize,
        search: '',
        genre,
        sortOrder: 'title-asc',
        includeCount: false,
        includeFacets: false,
        includeUpcoming: false,
      }).catch(() => null)
    )));

    return orderBatch(results.flatMap((result) => normalizeMediaItems(result)));
  }, [debouncedSearch, genre]);

  const fetchApiPage = useCallback(async (pageNum) => {
    const params = new URLSearchParams({
      page: String(pageNum),
      page_size: String(PAGE_SIZE),
      sort: 'year-desc',
    });

    if (debouncedSearch) params.set('search', debouncedSearch);
    if (genre) params.set('genre', genre);

    const data = await api.get(`/media/tv-shows?${params.toString()}`);
    return {
      items: normalizeMediaItems(data),
      total: Number(data?.total) || 0,
      totalPages: Number(data?.totalPages) || 1,
      facets: {
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      },
    };
  }, [debouncedSearch, genre]);

  useEffect(() => {
    let cancelled = false;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    emptyBatchesRef.current = 0;
    const fetchHadGenreFilter = Boolean(genre);
    const searching = Boolean(debouncedSearch);

    setLoading(true);
    setLoadingMore(false);
    setItems([]);
    setTotal(0);
    setUsingFallbackCatalog(false);
    setRenderedCount(VISIBLE_BATCH_SIZE);

    function adoptGenres(fetchedGenres) {
      if (!Array.isArray(fetchedGenres) || fetchedGenres.length === 0) return;
      setAllGenres((current) => (
        (!fetchHadGenreFilter && !searching) || current.length === 0 ? fetchedGenres : current
      ));
    }

    async function loadCatalog() {
      try {
        const probe = await fetchSupabaseTvShowCatalogSegment({
          offset: 0,
          limit: 1,
          search: debouncedSearch,
          genre,
          sortOrder: 'title-asc',
          includeCount: true,
          includeFacets: true,
          includeUpcoming: false,
        });
        const totalCount = Number(probe?.total) || 0;
        if (totalCount === 0 && !debouncedSearch && !genre) {
          throw new Error('TV catalog is empty');
        }

        if (cancelled || requestTokenRef.current !== requestToken) return;

        adoptGenres(probe?.facets?.genres);
        sourceRef.current = { mode: 'supabase' };
        setTotal(totalCount);

        if (totalCount === 0) {
          setItems([]);
          setLoading(false);
          return;
        }

        const firstBatch = await fetchSupabaseWindows({ totalCount, existingCount: 0 });
        if (cancelled || requestTokenRef.current !== requestToken) return;

        setItems(appendUniqueItems([], firstBatch));
        setLoading(false);
        return;
      } catch {
        // Fall through to the legacy API, then the bundled snapshot.
      }

      try {
        const data = await fetchApiPage(1);
        if (data.items.length === 0 && !debouncedSearch && !genre) {
          throw new Error('TV catalog is empty');
        }

        if (cancelled || requestTokenRef.current !== requestToken) return;

        adoptGenres(data.facets.genres);
        sourceRef.current = { mode: 'api', totalPages: data.totalPages, nextPage: 2 };
        setTotal(data.total || data.items.length);
        setItems(searching ? data.items : orderBatch(data.items));
        setLoading(false);
        return;
      } catch {
        // Fall through to the bundled snapshot.
      }

      try {
        const fallbackItems = await loadFallbackTvShows();
        if (cancelled || requestTokenRef.current !== requestToken) return;

        const pool = filterMediaItems(fallbackItems, {
          search: debouncedSearch,
          genre,
          sortOrder: searching ? 'title-asc' : 'year-desc',
        });

        adoptGenres(buildMediaGenreFacets(fallbackItems));
        sourceRef.current = { mode: 'fallback' };
        setTotal(pool.length);
        setItems(searching ? pool : orderBatch(pool));
        setUsingFallbackCatalog(true);
        setLoading(false);
      } catch {
        if (cancelled || requestTokenRef.current !== requestToken) return;
        setItems([]);
        setTotal(0);
        setLoading(false);
      }
    }

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, genre, fetchSupabaseWindows, fetchApiPage]);

  const loadMore = useCallback(async () => {
    const requestToken = requestTokenRef.current;
    const source = sourceRef.current;
    setLoadingMore(true);

    try {
      if (source.mode === 'supabase') {
        const batch = await fetchSupabaseWindows({ totalCount: total, existingCount: items.length });
        if (requestTokenRef.current !== requestToken) return;

        setItems((current) => {
          const next = appendUniqueItems(current, batch);
          emptyBatchesRef.current = next.length === current.length
            ? emptyBatchesRef.current + 1
            : 0;
          return next;
        });
        return;
      }

      if (source.mode === 'api') {
        const data = await fetchApiPage(source.nextPage);
        if (requestTokenRef.current !== requestToken) return;

        sourceRef.current = { ...source, nextPage: source.nextPage + 1 };
        setItems((current) => (
          appendUniqueItems(current, debouncedSearch ? data.items : orderBatch(data.items))
        ));
      }
      // Fallback mode already holds the full pool; nothing to fetch.
    } catch {
      emptyBatchesRef.current += 1;
    } finally {
      if (requestTokenRef.current === requestToken) {
        setLoadingMore(false);
      }
    }
  }, [debouncedSearch, items.length, total, fetchSupabaseWindows, fetchApiPage]);

  const visibleItems = items.slice(0, renderedCount);
  const canFetchMore = !usingFallbackCatalog
    && items.length < total
    && emptyBatchesRef.current < MAX_EMPTY_BATCHES
    && (sourceRef.current.mode !== 'api' || sourceRef.current.nextPage <= sourceRef.current.totalPages);
  const hasMore = renderedCount < items.length || canFetchMore;

  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') {
      return undefined;
    }

    const node = loadMoreRef.current;
    if (!node || loading || loadingMore || !hasMore) {
      return undefined;
    }

    let triggered = false;
    const observer = new window.IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || triggered) {
          return;
        }

        triggered = true;
        if (renderedCount < items.length) {
          setRenderedCount((current) => Math.min(current + VISIBLE_BATCH_SIZE, items.length + VISIBLE_BATCH_SIZE));
        }
        if (items.length - renderedCount < VISIBLE_BATCH_SIZE && canFetchMore) {
          loadMore();
        }
      },
      {
        rootMargin: '480px 0px',
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [loading, loadingMore, hasMore, renderedCount, items.length, canFetchMore, loadMore]);

  return (
    <div className="catalog-view">
      <div className="genre-bar-wrap">
        <div className="genre-bar" role="tablist" aria-label="Series genres">
          <button
            type="button"
            className={`genre-chip${genre === '' ? ' active' : ''}`}
            onClick={() => setGenre('')}
          >
            Featured
          </button>
          {allGenres.map((option) => (
            <button
              key={option}
              type="button"
              className={`genre-chip${genre === option ? ' active' : ''}`}
              onClick={() => setGenre(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonGrid count={20} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: '2rem', margin: 0 }}>📺</p>
          <p>No series match {debouncedSearch ? 'that search' : 'this genre'}.</p>
          <p className="empty-hint">Try a different genre or clear your search.</p>
        </div>
      ) : (
        <>
          <div className="poster-grid">
            {visibleItems.map((movie) => (
              <PosterTile key={movie.id} item={movie} onClick={onItemClick} />
            ))}
          </div>
          <div className="infinite-scroll-footer">
            {loadingMore ? (
              <span>Loading more series…</span>
            ) : hasMore ? (
              <span>Scroll for more</span>
            ) : (
              <span>
                {total.toLocaleString()} series
                {usingFallbackCatalog ? ' (offline snapshot)' : ''}
              </span>
            )}
            {hasMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
          </div>
        </>
      )}
    </div>
  );
}

export default function TVShows() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));
  const initialGenre = searchParams.get('genre') || '';
  const initialSearch = searchParams.get('search') || '';

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
        <div className="catalog-header">
          <h1 className="catalog-title">Series</h1>
        </div>

        <CatalogView
          onItemClick={openItemDetails}
          initialGenre={initialGenre}
          initialSearch={initialSearch}
        />
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

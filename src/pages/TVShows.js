import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import MediaDetailsModal from '../components/MediaDetailsModal';
import { SkeletonGrid } from '../components/SkeletonCard';
import PullToRefresh from '../components/PullToRefresh';
import useDebounce from '../hooks/useDebounce';
import { api } from '../api';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlistStatusMap,
  updateSupabaseWatchlistStatus,
  saveSupabaseRating,
} from '../utils/supabaseData';
import WatchlistStatusControl from '../components/WatchlistStatusControl';
import {
  fetchSupabaseTvShowById,
  fetchSupabaseTvShowCatalogSegment,
} from '../utils/supabaseMovieCatalog';
import {
  buildMediaGenreFacets,
  filterMediaItems,
  loadFallbackTvShows,
} from '../catalogFallback';
import { TV_GENRE_GROUPS, buildGenreGroups, sameGenreList } from '../genreGroups';
import { SORT_OPTIONS, sortModeToQuery } from '../utils/catalogSort';
import ThemedSelect from '../components/ThemedSelect';
import { useAuth } from '../contexts/AuthContext';

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
  const deduped = [];

  for (const item of nextItems) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    deduped.push(item);
  }

  return [...currentItems, ...deduped];
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

function PosterTile({ item, onClick, watchlistEntry, addingWatchlist, onAddWatchlist, onStatusChange }) {
  const [imgError, setImgError] = useState(false);
  const posterUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.image_url);
  const isNew = Number(item.year) >= new Date().getFullYear();

  return (
    <div className="poster-tile-wrap">
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

      {onAddWatchlist && (
        <div className="poster-tile-status" onClick={(event) => event.stopPropagation()}>
          <WatchlistStatusControl
            mediaType="tv_show"
            status={watchlistEntry?.status}
            adding={addingWatchlist}
            onAdd={() => onAddWatchlist(item)}
            onChange={(nextStatus) => onStatusChange(item, watchlistEntry, nextStatus)}
          />
        </div>
      )}
    </div>
  );
}

function CatalogView({
  onItemClick,
  initialGenre,
  refreshKey,
  watchlistStatusMap,
  addingWatchlistIds,
  onQuickAdd,
  onQuickStatusChange,
}) {
  const [items, setItems] = useState([]);
  const [activeLabel, setActiveLabel] = useState(initialGenre || '');
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebounce(searchInput, 350).trim();
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const [renderedCount, setRenderedCount] = useState(VISIBLE_BATCH_SIZE);
  const [sortMode, setSortMode] = useState('featured');
  const { activeProfile } = useAuth();
  const kidsSafe = Boolean(activeProfile?.is_kids);
  const requestTokenRef = useRef(0);
  const sourceRef = useRef({ mode: 'supabase', totalPages: 1, nextPage: 2 });
  const emptyBatchesRef = useRef(0);
  const loadMoreRef = useRef(null);
  const pendingInitialGenreRef = useRef(initialGenre || '');

  const genreGroups = useMemo(
    () => buildGenreGroups(TV_GENRE_GROUPS, allGenres),
    [allGenres]
  );

  // A deep link like ?genre=Adventure carries a raw facet value, not a group
  // label. Once the real groups are known, fold it into whichever chip owns it
  // so the right chip highlights and the query covers the whole group.
  useEffect(() => {
    const pending = pendingInitialGenreRef.current;
    if (!pending || genreGroups.length === 0) return;

    const match = genreGroups.find((group) => (
      group.values.some((value) => value.toLowerCase() === pending.toLowerCase())
    ));
    if (match) {
      setActiveLabel(match.label);
    }
    pendingInitialGenreRef.current = '';
  }, [genreGroups]);

  const genreValues = useMemo(() => {
    if (!activeLabel) return [];
    const activeGroup = genreGroups.find((group) => group.label === activeLabel);
    return activeGroup ? activeGroup.values : [activeLabel];
  }, [genreGroups, activeLabel]);

  const fetchSupabaseWindows = useCallback(async ({ totalCount }) => {
    const windowSize = Math.min(SAMPLE_WINDOW, Math.max(totalCount, 1));
    const maxOffset = Math.max(0, totalCount - windowSize);
    const offsets = Array.from({ length: WINDOWS_PER_BATCH }, () => (
      maxOffset > 0 ? Math.floor(Math.random() * (maxOffset + 1)) : 0
    ));

    const results = await Promise.all(offsets.map((offset) => (
      fetchSupabaseTvShowCatalogSegment({
        offset,
        limit: windowSize,
        search: searchTerm,
        genre: genreValues,
        sortOrder: 'title-asc',
        includeCount: false,
        includeFacets: false,
        includeUpcoming: false,
        kidsSafe,
      }).catch(() => null)
    )));

    return orderBatch(results.flatMap((result) => normalizeMediaItems(result)));
  }, [genreValues, searchTerm, kidsSafe]);

  // Real sequential, sorted pages — used whenever sortMode isn't 'featured'.
  const fetchSupabaseSortedPage = useCallback(async (offset, { includeCount = false, includeFacets = false } = {}) => {
    const { sortOrder, includeUpcoming } = sortModeToQuery(sortMode);
    const result = await fetchSupabaseTvShowCatalogSegment({
      offset,
      limit: PAGE_SIZE,
      search: searchTerm,
      genre: genreValues,
      sortOrder,
      includeUpcoming,
      includeCount,
      includeFacets,
      kidsSafe,
    });
    return { total: result.total, facets: result.facets, items: normalizeMediaItems(result) };
  }, [genreValues, searchTerm, sortMode, kidsSafe]);

  const fetchApiPage = useCallback(async (pageNum) => {
    const params = new URLSearchParams({
      page: String(pageNum),
      page_size: String(PAGE_SIZE),
      sort: 'year-desc',
    });

    // The legacy API only supports a single genre substring; this tier only
    // runs when Supabase is unreachable, so an approximate match is fine.
    if (genreValues[0]) params.set('genre', genreValues[0]);
    if (searchTerm) params.set('search', searchTerm);

    const data = await api.get(`/media/tv-shows?${params.toString()}`);
    return {
      items: normalizeMediaItems(data),
      total: Number(data?.total) || 0,
      totalPages: Number(data?.totalPages) || 1,
      facets: {
        genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
      },
    };
  }, [genreValues, searchTerm]);

  useEffect(() => {
    let cancelled = false;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    emptyBatchesRef.current = 0;
    const fetchHadGenreFilter = genreValues.length > 0;
    const fetchHadFilter = fetchHadGenreFilter || Boolean(searchTerm);

    setLoading(true);
    setLoadingMore(false);
    setItems([]);
    setTotal(0);
    setUsingFallbackCatalog(false);
    setRenderedCount(VISIBLE_BATCH_SIZE);

    function adoptGenres(fetchedGenres) {
      if (!Array.isArray(fetchedGenres) || fetchedGenres.length === 0) return;
      setAllGenres((current) => {
        if (fetchHadGenreFilter && current.length > 0) return current;
        // Bail out on an equal-content array so this doesn't retrigger the
        // fetch effect below (genreValues derives from allGenres via genreGroups).
        return sameGenreList(current, fetchedGenres) ? current : fetchedGenres;
      });
    }

    async function loadCatalog() {
      if (sortMode !== 'featured') {
        try {
          const page = await fetchSupabaseSortedPage(0, { includeCount: true, includeFacets: true });
          const totalCount = Number(page.total) || 0;
          if (totalCount === 0 && !fetchHadFilter) {
            throw new Error('TV catalog is empty');
          }

          if (cancelled || requestTokenRef.current !== requestToken) return;

          adoptGenres(page.facets?.genres);
          sourceRef.current = { mode: 'supabase-sorted', nextOffset: PAGE_SIZE };
          setTotal(totalCount);
          setItems(page.items);
          setLoading(false);
          return;
        } catch {
          // Fall through to the legacy API, then the bundled snapshot below.
        }
      } else {
      try {
        const probe = await fetchSupabaseTvShowCatalogSegment({
          offset: 0,
          limit: 1,
          search: searchTerm,
          genre: genreValues,
          sortOrder: 'title-asc',
          includeCount: true,
          includeFacets: true,
          includeUpcoming: false,
          kidsSafe,
        });
        const totalCount = Number(probe?.total) || 0;
        if (totalCount === 0 && !fetchHadFilter) {
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
      }

      try {
        const data = await fetchApiPage(1);
        if (data.items.length === 0 && !fetchHadFilter) {
          throw new Error('TV catalog is empty');
        }

        if (cancelled || requestTokenRef.current !== requestToken) return;

        adoptGenres(data.facets.genres);
        sourceRef.current = { mode: 'api', totalPages: data.totalPages, nextPage: 2 };
        setTotal(data.total || data.items.length);
        setItems(orderBatch(data.items));
        setLoading(false);
        return;
      } catch {
        // Fall through to the bundled snapshot.
      }

      try {
        const fallbackItems = await loadFallbackTvShows();
        if (cancelled || requestTokenRef.current !== requestToken) return;

        const pool = filterMediaItems(fallbackItems, {
          search: searchTerm,
          genre: genreValues,
          sortOrder: 'year-desc',
        });

        adoptGenres(buildMediaGenreFacets(fallbackItems));
        sourceRef.current = { mode: 'fallback' };
        setTotal(pool.length);
        setItems(orderBatch(pool));
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
  }, [genreValues, searchTerm, sortMode, kidsSafe, fetchSupabaseWindows, fetchSupabaseSortedPage, fetchApiPage, refreshKey]);

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

      if (source.mode === 'supabase-sorted') {
        const page = await fetchSupabaseSortedPage(source.nextOffset);
        if (requestTokenRef.current !== requestToken) return;

        sourceRef.current = { ...source, nextOffset: source.nextOffset + PAGE_SIZE };
        setItems((current) => {
          const next = appendUniqueItems(current, page.items);
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
        setItems((current) => appendUniqueItems(current, orderBatch(data.items)));
      }
      // Fallback mode already holds the full pool; nothing to fetch.
    } catch {
      emptyBatchesRef.current += 1;
    } finally {
      if (requestTokenRef.current === requestToken) {
        setLoadingMore(false);
      }
    }
  }, [items.length, total, fetchSupabaseWindows, fetchSupabaseSortedPage, fetchApiPage]);

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
      <div className="catalog-search-row">
        <div className="catalog-search-bar">
          <MagnifyingGlass size={18} weight="bold" className="catalog-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="catalog-search-input"
            placeholder="Search series…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="Search series"
          />
          {searchInput && (
            <button
              type="button"
              className="catalog-search-clear"
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
            >
              <X size={14} weight="bold" />
            </button>
          )}
        </div>
        <ThemedSelect
          className="catalog-sort-select"
          aria-label="Sort series by"
          value={sortMode}
          options={SORT_OPTIONS}
          onChange={(event) => setSortMode(event.target.value)}
        />
      </div>

      <GenreScrollBar ariaLabel="Series genres">
        <button
          type="button"
          className={`genre-chip${activeLabel === '' ? ' active' : ''}`}
          onClick={() => setActiveLabel('')}
        >
          Featured
        </button>
        {genreGroups.map((group) => (
          <button
            key={group.label}
            type="button"
            className={`genre-chip${activeLabel === group.label ? ' active' : ''}`}
            onClick={() => setActiveLabel(group.label)}
          >
            {group.label}
          </button>
        ))}
      </GenreScrollBar>

      {loading ? (
        <SkeletonGrid count={20} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: '2rem', margin: 0 }}>📺</p>
          <p>No series match {searchTerm ? `"${searchTerm}"` : 'this genre'}.</p>
          <p className="empty-hint">Try a different {searchTerm ? 'search term' : 'genre'}.</p>
        </div>
      ) : (
        <>
          <div className="poster-grid">
            {visibleItems.map((movie) => (
              <PosterTile
                key={movie.id}
                item={movie}
                onClick={onItemClick}
                watchlistEntry={watchlistStatusMap[movie.id]}
                addingWatchlist={addingWatchlistIds.has(movie.id)}
                onAddWatchlist={onQuickAdd}
                onStatusChange={onQuickStatusChange}
              />
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
  const playImmediately = searchParams.get('play') === '1' || searchParams.get('play') === 'true';

  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemBrowseOnly, setSelectedItemBrowseOnly] = useState(false);
  const [detailMessage, setDetailMessage] = useState('');
  const [userRatings, setUserRatings] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [watchlistStatusMap, setWatchlistStatusMap] = useState({});
  const [addingWatchlistIds, setAddingWatchlistIds] = useState(() => new Set());

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
    return new Promise((resolve) => setTimeout(resolve, 500));
  }

  useEffect(() => {
    fetchSupabaseRatingMap('tv_show')
      .then(setUserRatings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSupabaseWatchlistStatusMap('tv_show')
      .then((map) => { if (!cancelled) setWatchlistStatusMap(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleQuickAdd = useCallback(async (item) => {
    setAddingWatchlistIds((prev) => new Set(prev).add(item.id));
    setDetailMessage('');
    try {
      const saved = await addSupabaseWatchlistItem({ mediaType: 'tv_show', mediaId: item.id, media: item });
      setWatchlistStatusMap((prev) => ({ ...prev, [item.id]: { id: saved.id, status: saved.status } }));
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (error) {
      setDetailMessage(error.message);
    } finally {
      setAddingWatchlistIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, []);

  const handleQuickStatusChange = useCallback((item, entry, nextStatus) => {
    setWatchlistStatusMap((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: nextStatus } }));
    if (!entry?.id) return;
    updateSupabaseWatchlistStatus(entry.id, nextStatus).catch(() => {
      setWatchlistStatusMap((prev) => ({ ...prev, [item.id]: entry }));
    });
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
        media: item,
        review,
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

  function closeItemDetails() {
    setSelectedItem(null);
    setSelectedItemBrowseOnly(false);
    setDetailMessage('');
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">
        <PullToRefresh onRefresh={handleRefresh}>
          <div className="catalog-header">
            <h1 className="catalog-title">Series</h1>
          </div>

          <CatalogView
            onItemClick={openItemDetails}
            initialGenre={initialGenre}
            refreshKey={refreshKey}
            watchlistStatusMap={watchlistStatusMap}
            addingWatchlistIds={addingWatchlistIds}
            onQuickAdd={handleQuickAdd}
            onQuickStatusChange={handleQuickStatusChange}
          />
        </PullToRefresh>
      </main>

      {selectedItem && (
        <MediaDetailsModal
          item={selectedItem}
          mediaType="tv_show"
          onClose={closeItemDetails}
          onRate={selectedItemBrowseOnly ? undefined : handleRate}
          onWatchlist={selectedItemBrowseOnly ? undefined : handleQuickAdd}
          watchlistEntry={watchlistStatusMap[selectedItem.id]}
          onStatusChange={selectedItemBrowseOnly ? undefined : handleQuickStatusChange}
          userRating={userRatings[selectedItem.id]}
          isAddingWatchlist={addingWatchlistIds.has(selectedItem.id)}
          detailMessage={detailMessage}
          allowActions={!selectedItemBrowseOnly}
          browseOnlyMessage="Fallback catalog mode is browse-only."
          autoPlay={playImmediately}
        />
      )}
    </div>
  );
}

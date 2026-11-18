import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import ExpandableSearch from '../ExpandableSearch';
import GridTitleTile from '../GridTitleTile';
import GenreScrollBar from '../GenreScrollBar';
import LoadingBar from '../LoadingBar';
import ThemedSelect from '../ThemedSelect';
import useDebounce from '../../hooks/useDebounce';
import { useAuth } from '../../contexts/AuthContext';
import { buildGenreGroups, sameGenreList } from '../../utils/genreGroups';
import { SORT_OPTIONS, sortModeToQuery } from '../../utils/catalogSort';
import { maturityRestriction } from '../../utils/kidsMode';
import { getCached, setCached, buildCatalogCacheKey } from '../../utils/sessionCache';
import { identityKey } from '../../utils/mediaIdentity';
import { isBrowseable } from '../../utils/releaseWindow';
import { CATALOGS } from './catalogs';

// The filterable grid on Movies and Series (?view=all or ?genre=): search,
// sort, genre chips and an infinite grid of the catalog. Featured mode samples
// random windows of the catalog; every other sort pages through it in order.
// When the catalog can't be reached it says so, with Retry.
const PAGE_SIZE = 48;
// How many grid tiles get loading="eager" + high fetch priority. Covers the
// first visible row across common viewport widths so the browser starts
// fetching what's actually on screen immediately instead of waiting on the
// lazy-load IntersectionObserver trigger.
const EAGER_POSTER_COUNT = 8;
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

// Dedupes by id and by title identity (the Plex importer can create one
// row per file for what's really one release), and drops titles releasing
// more than 30 days out.
function appendUniqueItems(currentItems, nextItems) {
  const seenIds = new Set(currentItems.map((item) => item.id));
  const seenTitles = new Set(currentItems.map((item) => identityKey(item)));
  const deduped = [];

  for (const item of nextItems) {
    const titleKey = identityKey(item);
    if (seenIds.has(item.id) || seenTitles.has(titleKey) || !isBrowseable(item)) continue;
    seenIds.add(item.id);
    seenTitles.add(titleKey);
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

export default function CatalogView({
  mediaType,
  onItemClick,
  initialGenre,
  refreshKey,
  watchlistStatusMap,
  addingWatchlistIds,
  onQuickAdd,
  onQuickStatusChange,
}) {
  const catalog = CATALOGS[mediaType];
  const [items, setItems] = useState([]);
  const [activeLabel, setActiveLabel] = useState(initialGenre || '');
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebounce(searchInput, 350).trim();
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  // The catalog couldn't be reached at all: say so, with Retry.
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [renderedCount, setRenderedCount] = useState(VISIBLE_BATCH_SIZE);
  const [sortMode, setSortMode] = useState('popular');
  const { activeProfile } = useAuth();
  const kidsSafe = maturityRestriction(activeProfile);
  const requestTokenRef = useRef(0);
  const sourceRef = useRef({ mode: 'supabase' });
  const emptyBatchesRef = useRef(0);
  const loadMoreRef = useRef(null);
  const pendingInitialGenreRef = useRef(initialGenre || '');

  const genreGroups = useMemo(
    () => buildGenreGroups(catalog.genreGroups, allGenres),
    [catalog, allGenres]
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
    if (searchTerm || !activeLabel) return [];
    const activeGroup = genreGroups.find((group) => group.label === activeLabel);
    return activeGroup ? activeGroup.values : [activeLabel];
  }, [genreGroups, activeLabel, searchTerm]);

  const fetchSupabaseWindows = useCallback(async ({ totalCount }) => {
    const windowSize = Math.min(SAMPLE_WINDOW, Math.max(totalCount, 1));
    const maxOffset = Math.max(0, totalCount - windowSize);
    const offsets = Array.from({ length: WINDOWS_PER_BATCH }, () => (
      maxOffset > 0 ? Math.floor(Math.random() * (maxOffset + 1)) : 0
    ));

    const results = await Promise.all(offsets.map((offset) => (
      catalog.fetchSegment({
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
  }, [catalog, genreValues, searchTerm, kidsSafe]);

  // Real sequential, sorted pages — used whenever sortMode isn't 'featured'.
  // Unlike fetchSupabaseWindows this must NOT be reshuffled by orderBatch;
  // the whole point is a deterministic order (newest/oldest/A–Z/Z–A).
  const fetchSupabaseSortedPage = useCallback(async (offset, { includeCount = false, includeFacets = false } = {}) => {
    const { sortOrder, includeUpcoming } = sortModeToQuery(sortMode);
    const result = await catalog.fetchSegment({
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
  }, [catalog, genreValues, searchTerm, sortMode, kidsSafe]);

  useEffect(() => {
    let cancelled = false;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    emptyBatchesRef.current = 0;
    const fetchHadGenreFilter = genreValues.length > 0;
    const fetchHadFilter = fetchHadGenreFilter || Boolean(searchTerm);
    const cacheKey = buildCatalogCacheKey(catalog.cacheName, { genreValues, searchTerm, sortMode, kidsSafe });

    setLoadingMore(false);
    setRenderedCount(VISIBLE_BATCH_SIZE);

    // Stale-while-revalidate: if we've loaded this exact browse state before
    // this session, show it instantly instead of a blank skeleton, then
    // still refresh in the background below so it doesn't go stale.
    const cached = getCached(cacheKey);
    if (cached) {
      setLoading(false);
      setItems(cached.items);
      setTotal(cached.total);
      sourceRef.current = cached.source;
    } else {
      setLoading(true);
      setItems([]);
      setTotal(0);
    }
    setLoadFailed(false);

    function adoptGenres(fetchedGenres) {
      if (!Array.isArray(fetchedGenres) || fetchedGenres.length === 0) return;
      setAllGenres((current) => {
        if (fetchHadGenreFilter && current.length > 0) return current;
        // Bail out on an equal-content array so this doesn't retrigger the
        // fetch effect below (genreValues derives from allGenres via genreGroups).
        return sameGenreList(current, fetchedGenres) ? current : fetchedGenres;
      });
    }

    function persistCache(itemsSnapshot, totalSnapshot, genresSnapshot) {
      setCached(cacheKey, {
        items: itemsSnapshot,
        total: totalSnapshot,
        allGenres: Array.isArray(genresSnapshot) ? genresSnapshot : [],
        source: sourceRef.current,
      });
    }

    async function loadCatalog() {
      if (sortMode !== 'featured') {
        try {
          const page = await fetchSupabaseSortedPage(0, { includeCount: true, includeFacets: true });
          const totalCount = Number(page.total) || 0;
          if (totalCount === 0 && !fetchHadFilter) {
            throw new Error(`${catalog.title} catalog is empty`);
          }

          if (cancelled || requestTokenRef.current !== requestToken) return;

          adoptGenres(page.facets?.genres);
          sourceRef.current = { mode: 'supabase-sorted', nextOffset: PAGE_SIZE };
          setTotal(totalCount);
          setItems(page.items);
          setLoading(false);
          persistCache(page.items, totalCount, page.facets?.genres);
          return;
        } catch {
          // Couldn't load: handled below.
        }
      } else {
      try {
        const probe = await catalog.fetchSegment({
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
          throw new Error(`${catalog.title} catalog is empty`);
        }

        if (cancelled || requestTokenRef.current !== requestToken) return;

        adoptGenres(probe?.facets?.genres);
        sourceRef.current = { mode: 'supabase' };
        setTotal(totalCount);

        if (totalCount === 0) {
          setItems([]);
          setLoading(false);
          persistCache([], 0, probe?.facets?.genres);
          return;
        }

        const firstBatch = await fetchSupabaseWindows({ totalCount, existingCount: 0 });
        if (cancelled || requestTokenRef.current !== requestToken) return;

        const nextItems = appendUniqueItems([], firstBatch);
        setItems(nextItems);
        setLoading(false);
        persistCache(nextItems, totalCount, probe?.facets?.genres);
        return;
      } catch {
        // Couldn't load: handled below.
      }
      }

      if (cancelled || requestTokenRef.current !== requestToken) return;
      setLoading(false);
      // Results already on screen from this session stay; otherwise say so, with Retry.
      if (!cached) {
        setItems([]);
        setTotal(0);
        setLoadFailed(true);
      }
    }

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [catalog, genreValues, searchTerm, sortMode, kidsSafe, fetchSupabaseWindows, fetchSupabaseSortedPage, refreshKey, retryCount]);

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
      }
    } catch {
      emptyBatchesRef.current += 1;
    } finally {
      if (requestTokenRef.current === requestToken) {
        setLoadingMore(false);
      }
    }
  }, [items.length, total, fetchSupabaseWindows, fetchSupabaseSortedPage]);

  const visibleItems = items.slice(0, renderedCount);
  const canFetchMore = items.length < total
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
        <ExpandableSearch label={`Search ${catalog.many}`} value={searchInput} onChange={setSearchInput} />
        <ThemedSelect
          className="catalog-sort-select"
          aria-label={`Sort ${catalog.many} by`}
          value={sortMode}
          options={SORT_OPTIONS}
          onChange={(event) => setSortMode(event.target.value)}
        />
      </div>

      <GenreScrollBar collapsed={Boolean(searchInput.trim())} ariaLabel={`${catalog.label} genres`}>
        <button
          type="button"
          className={`genre-chip${activeLabel === '' ? ' active' : ''}`}
          aria-pressed={activeLabel === ''}
          onClick={() => setActiveLabel('')}
        >
          Featured
        </button>
        {genreGroups.map((group) => (
          <button
            key={group.label}
            type="button"
            className={`genre-chip${activeLabel === group.label ? ' active' : ''}`}
            aria-pressed={activeLabel === group.label}
            onClick={() => setActiveLabel(group.label)}
          >
            {group.label}
          </button>
        ))}
      </GenreScrollBar>

      {loading ? (
        <LoadingBar label="Loading titles…" />
      ) : loadFailed ? (
        <div className="empty-state" role="alert">
          <WarningCircle size={32} aria-hidden="true" />
          <p>Couldn’t load {catalog.many} right now.</p>
          <p className="empty-hint">Check your connection, then try again.</p>
          <button type="button" className="st-btn st-btn--ghost" onClick={() => setRetryCount((count) => count + 1)}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <catalog.Icon size={32} aria-hidden="true" />
          <p>No {catalog.many} match {searchTerm ? `"${searchTerm}"` : 'this genre'}.</p>
          <p className="empty-hint">Try a different {searchTerm ? 'search term' : 'genre'}.</p>
        </div>
      ) : (
        <>
          <div className="st-grid">
            {visibleItems.map((item, index) => (
              <GridTitleTile
                key={item.id}
                mediaType={mediaType}
                item={item}
                onClick={onItemClick}
                watchlistEntry={watchlistStatusMap[item.id]}
                addingWatchlist={addingWatchlistIds.has(item.id)}
                onAddWatchlist={onQuickAdd}
                onStatusChange={onQuickStatusChange}
                priority={index < EAGER_POSTER_COUNT}
              />
            ))}
          </div>
          <div className="infinite-scroll-footer">
            {loadingMore ? (
              <span>Loading more {catalog.many}…</span>
            ) : hasMore ? (
              <span>Scroll for more</span>
            ) : (
              <span>
                {total.toLocaleString()} {total === 1 ? catalog.one : catalog.many}
              </span>
            )}
            {hasMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
          </div>
        </>
      )}
    </div>
  );
}

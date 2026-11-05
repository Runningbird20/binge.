import ExpandableSearch from '../components/ExpandableSearch';
import SlidingTabs from '../components/SlidingTabs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import BookBrowseView from '../components/BookBrowseView';
import GenreScrollBar from '../components/GenreScrollBar';
import MangaTab from '../components/MangaTab';
import useDebounce from '../hooks/useDebounce';
import { api } from '../api';
import { SkeletonGrid } from '../components/SkeletonCard';
import PullToRefresh from '../components/PullToRefresh';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlistStatusMap,
  updateSupabaseWatchlistStatus,
  saveSupabaseRating,
} from '../utils/supabaseData';
import { fetchBookById, fetchBooksPage, fetchRandomBookWindow } from '../utils/catalogQueries';
import {
  buildMediaGenreFacets,
  filterBooksCatalog,
  loadFallbackBooks,
} from '../utils/catalogFallback';
import { BOOK_GENRE_GROUPS, buildGenreGroups, sameGenreList } from '../utils/genreGroups';
import { SORT_OPTIONS, sortModeToQuery } from '../utils/catalogSort';
import ThemedSelect from '../components/ThemedSelect';
import { getCached, setCached, buildCatalogCacheKey } from '../utils/sessionCache';
import { getCoverUrl, BookPosterTile } from '../components/books/BookCover';
import { BookDetailsModal } from '../components/books/BookDetailsModal';

// How many grid tiles get loading="eager" + high fetch priority. Covers the
// first visible row across common viewport widths so the browser starts
// fetching what's actually on screen immediately instead of waiting on the
// lazy-load IntersectionObserver trigger.
const EAGER_POSTER_COUNT = 8;
// Random-window sampling (same technique as Movies/Series): jump to random
// pages across the catalog instead of paging alphabetically, so the shelf
// mixes titles with no obvious order.
const SAMPLE_WINDOW = 60;
const WINDOWS_PER_BATCH = 3;
const VISIBLE_BATCH_SIZE = 60;
const MAX_EMPTY_BATCHES = 3;
const API_PAGE_SIZE = 48;
// sandbox intentionally omitted — the embedded reader detects sandbox attributes and stops working if one is present

function shuffleItems(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

// Shuffle a batch, floating items that actually have cover art to the front
// so the shelf stays visual while remaining unordered.
function orderBatch(items) {
  const shuffled = shuffleItems(items);
  return [...shuffled.filter((book) => Boolean(getCoverUrl(book))), ...shuffled.filter((book) => !getCoverUrl(book))];
}

function appendUniqueBooks(currentItems, nextItems) {
  const seenIds = new Set(currentItems.map((item) => item.id));
  const deduped = [];

  for (const item of nextItems) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    deduped.push(item);
  }

  return [...currentItems, ...deduped];
}

export default function Books() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));
  const showGrid = searchParams.get('view') === 'all';
  const [activeTab, setActiveTab] = useState('books');

  const [books, setBooks] = useState([]);
  const [activeLabel, setActiveLabel] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebounce(searchInput, 350).trim();
  const [refreshKey, setRefreshKey] = useState(0);
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const [renderedCount, setRenderedCount] = useState(VISIBLE_BATCH_SIZE);
  const [sortMode, setSortMode] = useState('featured');
  const [watchlistStatusMap, setWatchlistStatusMap] = useState({});
  const [userRatings, setUserRatings] = useState({});
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedBookBrowseOnly, setSelectedBookBrowseOnly] = useState(false);
  const [addingBookId, setAddingBookId] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const requestTokenRef = useRef(0);
  const sourceRef = useRef({ mode: 'supabase', totalPages: 1, nextPage: 2 });
  const emptyBatchesRef = useRef(0);
  const loadMoreRef = useRef(null);

  const genreGroups = useMemo(
    () => buildGenreGroups(BOOK_GENRE_GROUPS, allGenres),
    [allGenres]
  );

  const genreValues = useMemo(() => {
    if (searchTerm || !activeLabel) return [];
    const activeGroup = genreGroups.find((group) => group.label === activeLabel);
    return activeGroup ? activeGroup.values : [activeLabel];
  }, [genreGroups, activeLabel, searchTerm]);

  useEffect(() => {
    function handleScroll() {
      setShowScrollTop(window.scrollY > 360);
    }

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const fetchSupabaseWindows = useCallback(async ({ totalCount }) => {
    const windowSize = Math.min(SAMPLE_WINDOW, Math.max(totalCount, 1));
    const totalWindowPages = Math.max(1, Math.ceil(totalCount / windowSize));

    // Everything fits in one window (a narrow search): just fetch it.
    if (totalWindowPages === 1) {
      const result = await fetchBooksPage({
        page: 1, pageSize: windowSize, search: searchTerm, genre: genreValues, sortOrder: 'title-asc',
      }).catch(() => null);
      return orderBatch(Array.isArray(result?.items) ? result.items : []);
    }

    // Random windows start at a random id (a random page OFFSET read every
    // skipped row, which the catalog database bills).
    const windows = await Promise.all(Array.from({ length: WINDOWS_PER_BATCH }, () => (
      fetchRandomBookWindow({ size: windowSize, search: searchTerm, genre: genreValues }).catch(() => [])
    )));
    const seen = new Set();
    const items = windows.flat().filter((book) => (seen.has(book.id) ? false : seen.add(book.id)));
    return orderBatch(items);
  }, [genreValues, searchTerm]);

  // Real sequential, sorted pages — used whenever sortMode isn't 'featured'.
  const fetchSupabaseSortedPage = useCallback(async (page) => {
    const { sortOrder } = sortModeToQuery(sortMode);
    const result = await fetchBooksPage({
      page,
      pageSize: API_PAGE_SIZE,
      search: searchTerm,
      genre: genreValues,
      sortOrder,
    });
    return {
      total: result.total,
      facets: result.facets,
      items: Array.isArray(result?.items) ? result.items : [],
    };
  }, [genreValues, searchTerm, sortMode]);

  const fetchApiPage = useCallback(async (pageNum) => {
    const params = new URLSearchParams({
      page: String(pageNum),
      page_size: String(API_PAGE_SIZE),
      sort: 'year-desc',
    });

    // The legacy API only supports a single genre substring; this tier only
    // runs when Supabase is unreachable, so an approximate match is fine.
    if (genreValues[0]) params.set('genre', genreValues[0]);
    if (searchTerm) params.set('search', searchTerm);

    const data = await api.get(`/media/books?${params.toString()}`);
    return {
      items: Array.isArray(data?.items) ? data.items : [],
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
    const cacheKey = buildCatalogCacheKey('book', { genreValues, searchTerm, sortMode });

    setLoadingMore(false);
    setRenderedCount(VISIBLE_BATCH_SIZE);

    // Stale-while-revalidate: if we've loaded this exact browse state before
    // this session, show it instantly instead of a blank skeleton, then
    // still refresh in the background below so it doesn't go stale.
    const cached = getCached(cacheKey);
    if (cached) {
      setLoading(false);
      setBooks(cached.items);
      setTotal(cached.total);
      setUsingFallbackCatalog(cached.usingFallbackCatalog);
      sourceRef.current = cached.source;
    } else {
      setLoading(true);
      setBooks([]);
      setTotal(0);
      setUsingFallbackCatalog(false);
    }

    function adoptGenres(fetchedGenres) {
      if (!Array.isArray(fetchedGenres) || fetchedGenres.length === 0) return;
      setAllGenres((current) => {
        if (fetchHadGenreFilter && current.length > 0) return current;
        // Bail out on an equal-content array so this doesn't retrigger the
        // fetch effect below (genreValues derives from allGenres via genreGroups).
        return sameGenreList(current, fetchedGenres) ? current : fetchedGenres;
      });
    }

    function persistCache(itemsSnapshot, totalSnapshot, genresSnapshot, isFallback) {
      setCached(cacheKey, {
        items: itemsSnapshot,
        total: totalSnapshot,
        allGenres: Array.isArray(genresSnapshot) ? genresSnapshot : [],
        usingFallbackCatalog: Boolean(isFallback),
        source: sourceRef.current,
      });
    }

    async function loadCatalog() {
      if (sortMode !== 'featured') {
        try {
          const page = await fetchSupabaseSortedPage(1);
          const totalCount = Number(page.total) || 0;
          if (totalCount === 0 && !fetchHadFilter) {
            throw new Error('Book catalog is empty');
          }

          if (cancelled || requestTokenRef.current !== requestToken) return;

          adoptGenres(page.facets?.genres);
          sourceRef.current = { mode: 'supabase-sorted', nextPage: 2 };
          setTotal(totalCount);
          setBooks(page.items);
          setLoading(false);
          persistCache(page.items, totalCount, page.facets?.genres, false);
          return;
        } catch {
          // Fall through to the legacy API, then the bundled snapshot below.
        }
      } else {
      try {
        const probe = await fetchBooksPage({
          page: 1,
          pageSize: 1,
          search: searchTerm,
          genre: genreValues,
          sortOrder: 'title-asc',
        });
        const totalCount = Number(probe?.total) || 0;
        if (totalCount === 0 && !fetchHadFilter) {
          throw new Error('Book catalog is empty');
        }

        if (cancelled || requestTokenRef.current !== requestToken) return;

        adoptGenres(probe?.facets?.genres);
        sourceRef.current = { mode: 'supabase' };
        setTotal(totalCount);

        if (totalCount === 0) {
          setBooks([]);
          setLoading(false);
          persistCache([], 0, probe?.facets?.genres, false);
          return;
        }

        const firstBatch = await fetchSupabaseWindows({ totalCount });
        if (cancelled || requestTokenRef.current !== requestToken) return;

        const nextBooks = appendUniqueBooks([], firstBatch);
        setBooks(nextBooks);
        setLoading(false);
        persistCache(nextBooks, totalCount, probe?.facets?.genres, false);
        return;
      } catch {
        // Fall through to the legacy API, then the bundled snapshot.
      }
      }

      try {
        const data = await fetchApiPage(1);
        if (data.items.length === 0 && !fetchHadFilter) {
          throw new Error('Book catalog is empty');
        }

        if (cancelled || requestTokenRef.current !== requestToken) return;

        adoptGenres(data.facets.genres);
        sourceRef.current = { mode: 'api', totalPages: data.totalPages, nextPage: 2 };
        const orderedItems = orderBatch(data.items);
        const totalCount = data.total || data.items.length;
        setTotal(totalCount);
        setBooks(orderedItems);
        setLoading(false);
        persistCache(orderedItems, totalCount, data.facets.genres, false);
        return;
      } catch {
        // Fall through to the bundled snapshot.
      }

      try {
        const fallbackItems = await loadFallbackBooks();
        if (cancelled || requestTokenRef.current !== requestToken) return;

        const pool = filterBooksCatalog(fallbackItems, {
          search: searchTerm,
          genre: genreValues,
          sortOrder: 'year-desc',
          page: 1,
          pageSize: fallbackItems.length,
        });

        adoptGenres(buildMediaGenreFacets(fallbackItems));
        sourceRef.current = { mode: 'fallback' };
        setTotal(pool.total);
        setBooks(orderBatch(pool.items));
        setUsingFallbackCatalog(true);
        setLoading(false);
        // Not cached — see the equivalent note in Movies.js's loadCatalog.
      } catch {
        if (cancelled || requestTokenRef.current !== requestToken) return;
        setBooks([]);
        setTotal(0);
        setLoading(false);
      }
    }

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [genreValues, searchTerm, sortMode, fetchSupabaseWindows, fetchSupabaseSortedPage, fetchApiPage, refreshKey]);

  const loadMore = useCallback(async () => {
    const requestToken = requestTokenRef.current;
    const source = sourceRef.current;
    setLoadingMore(true);

    try {
      if (source.mode === 'supabase') {
        const batch = await fetchSupabaseWindows({ totalCount: total });
        if (requestTokenRef.current !== requestToken) return;

        setBooks((current) => {
          const next = appendUniqueBooks(current, batch);
          emptyBatchesRef.current = next.length === current.length
            ? emptyBatchesRef.current + 1
            : 0;
          return next;
        });
        return;
      }

      if (source.mode === 'supabase-sorted') {
        const page = await fetchSupabaseSortedPage(source.nextPage);
        if (requestTokenRef.current !== requestToken) return;

        sourceRef.current = { ...source, nextPage: source.nextPage + 1 };
        setBooks((current) => {
          const next = appendUniqueBooks(current, page.items);
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
        setBooks((current) => appendUniqueBooks(current, orderBatch(data.items)));
      }
      // Fallback mode already holds the full pool; nothing to fetch.
    } catch {
      emptyBatchesRef.current += 1;
    } finally {
      if (requestTokenRef.current === requestToken) {
        setLoadingMore(false);
      }
    }
  }, [total, fetchSupabaseWindows, fetchSupabaseSortedPage, fetchApiPage]);

  const visibleBooks = books.slice(0, renderedCount);
  const canFetchMore = !usingFallbackCatalog
    && books.length < total
    && emptyBatchesRef.current < MAX_EMPTY_BATCHES
    && (sourceRef.current.mode !== 'api' || sourceRef.current.nextPage <= sourceRef.current.totalPages);
  const hasMore = renderedCount < books.length || canFetchMore;

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
        if (renderedCount < books.length) {
          setRenderedCount((current) => Math.min(current + VISIBLE_BATCH_SIZE, books.length + VISIBLE_BATCH_SIZE));
        }
        if (books.length - renderedCount < VISIBLE_BATCH_SIZE && canFetchMore) {
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
  }, [loading, loadingMore, hasMore, renderedCount, books.length, canFetchMore, loadMore]);

  useEffect(() => {
    if (!openId) return undefined;

    let cancelled = false;

    async function loadOpenBook() {
      try {
        const book = await fetchBookById(openId);
        if (!cancelled && book?.id) {
          setSelectedBook(book);
          setSelectedBookBrowseOnly(false);
          setDetailMessage('');
          return;
        }
      } catch {
        // Fall through to the legacy API and bundled catalog below.
      }

      try {
        const book = await api.get(`/media/books/${openId}`);
        if (!cancelled && book?.id) {
          setSelectedBook(book);
          setSelectedBookBrowseOnly(false);
          setDetailMessage('');
          return;
        }
      } catch {
        // Fall back to the bundled catalog below.
      }

      try {
        const fallbackItems = await loadFallbackBooks();
        const match = fallbackItems.find((book) => book.id === openId);
        if (!cancelled && match) {
          setSelectedBook(match);
          setSelectedBookBrowseOnly(true);
          setDetailMessage('');
        }
      } catch {
        // Ignore missing fallback data.
      }
    }

    loadOpenBook();

    return () => {
      cancelled = true;
    };
  }, [openId]);

  useEffect(() => {
    let cancelled = false;

    fetchSupabaseWatchlistStatusMap('book')
      .then((map) => { if (!cancelled) setWatchlistStatusMap(map); })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchSupabaseRatingMap('book')
      .then(setUserRatings)
      .catch(() => {});
  }, []);

  function openBookDetails(book, { browseOnly = false } = {}) {
    setSelectedBook(book);
    setSelectedBookBrowseOnly(browseOnly);
    setDetailMessage('');
  }

  function closeBookDetails() {
    setSelectedBook(null);
    setSelectedBookBrowseOnly(false);
    setDetailMessage('');
    setAddingBookId(null);
  }

  async function handleRate(book, categories) {
    try {
      await saveSupabaseRating({ mediaType: 'book', mediaId: book.id, categories, media: book });
      setUserRatings((current) => ({ ...current, [book.id]: { ...categories, media_id: book.id } }));
      setDetailMessage('Rating saved!');
    } catch (err) {
      setDetailMessage(err.message);
    }
  }

  async function handleAddToLibrary(book) {
    setDetailMessage('');
    setAddingBookId(book.id);

    try {
      const saved = await addSupabaseWatchlistItem({
        mediaType: 'book',
        mediaId: book.id,
        status: 'plan_to_read',
        media: book,
      });

      setWatchlistStatusMap((current) => ({ ...current, [book.id]: { id: saved.id, status: saved.status } }));
      setDetailMessage('Added to your Library.');
    } catch (err) {
      if (/already in watchlist/i.test(err.message)) {
        setWatchlistStatusMap((current) => ({
          ...current,
          [book.id]: current[book.id] || { status: 'plan_to_read' },
        }));
        setDetailMessage('This book is already in your Library.');
      } else {
        setDetailMessage(err.message);
      }
    } finally {
      setAddingBookId(null);
    }
  }

  function handleQuickStatusChange(book, entry, nextStatus) {
    setWatchlistStatusMap((current) => ({ ...current, [book.id]: { ...current[book.id], status: nextStatus } }));
    if (!entry?.id) return;
    updateSupabaseWatchlistStatus(entry.id, nextStatus).catch(() => {
      setWatchlistStatusMap((current) => ({ ...current, [book.id]: entry }));
    });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
    return new Promise((resolve) => setTimeout(resolve, 500));
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">
        <PullToRefresh onRefresh={activeTab === 'books' ? handleRefresh : (() => {})}>
        <SlidingTabs className="st-tabs st-reading-tabs" role="tablist" aria-label="Reading">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'books'}
            className={`st-tab${activeTab === 'books' ? ' active' : ''}`}
            onClick={() => setActiveTab('books')}
          >
            Books
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manga'}
            className={`st-tab${activeTab === 'manga' ? ' active' : ''}`}
            onClick={() => setActiveTab('manga')}
          >
            Manga &amp; Comics
          </button>
        </SlidingTabs>

        {activeTab === 'manga' && <MangaTab />}

        {activeTab === 'books' && !showGrid && <BookBrowseView refreshKey={refreshKey} />}

        {activeTab === 'books' && showGrid && (
          <div className="catalog-view">
            <header className="st-page-head">
              <div>
                <h1 className="st-page-title">Books</h1>
              </div>
              <Link className="genre-chip st-pill-link" to="/books">Back to highlights</Link>
            </header>
            <div className="catalog-search-row">
              <ExpandableSearch label="Search books" value={searchInput} onChange={setSearchInput} />
              <ThemedSelect
                className="catalog-sort-select"
                aria-label="Sort books by"
                value={sortMode}
                options={SORT_OPTIONS}
                onChange={(event) => setSortMode(event.target.value)}
              />
            </div>

            <GenreScrollBar collapsed={Boolean(searchInput.trim())} ariaLabel="Book genres">
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
              <SkeletonGrid count={20} />
            ) : books.length === 0 ? (
              <div className="empty-state">
                <p style={{ fontSize: '2rem', margin: 0 }}>📖</p>
                <p>No books match {searchTerm ? `"${searchTerm}"` : 'this genre'}.</p>
                <p className="empty-hint">Try a different {searchTerm ? 'search term' : 'genre'}.</p>
              </div>
            ) : (
              <>
                <div className="st-grid">
                  {visibleBooks.map((book, index) => (
                    <BookPosterTile
                      key={book.id}
                      book={book}
                      onClick={() => openBookDetails(book, { browseOnly: usingFallbackCatalog })}
                      watchlistEntry={watchlistStatusMap[book.id]}
                      addingWatchlist={addingBookId === book.id}
                      onAddWatchlist={handleAddToLibrary}
                      onStatusChange={handleQuickStatusChange}
                      priority={index < EAGER_POSTER_COUNT}
                    />
                  ))}
                </div>
                <div className="infinite-scroll-footer">
                  {loadingMore ? (
                    <span>Loading more books…</span>
                  ) : hasMore ? (
                    <span>Scroll for more</span>
                  ) : (
                    <span>
                      {total.toLocaleString()} book{total === 1 ? '' : 's'}
                      {usingFallbackCatalog ? ' (offline snapshot)' : ''}
                    </span>
                  )}
                  {hasMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
                </div>
              </>
            )}
          </div>
        )}
        </PullToRefresh>
      </main>

      {selectedBook && (
        <BookDetailsModal
          book={selectedBook}
          onClose={closeBookDetails}
          onAddToLibrary={handleAddToLibrary}
          isInLibrary={!!watchlistStatusMap[selectedBook?.id]}
          isAddingToLibrary={addingBookId === selectedBook?.id}
          onRate={handleRate}
          userRating={userRatings[selectedBook?.id]}
          detailMessage={detailMessage}
          allowActions={!selectedBookBrowseOnly}
          browseOnlyMessage="Fallback catalog mode is browse-only."
        />
      )}

      {showScrollTop && (
        <button
          type="button"
          className="books-scroll-top"
          onClick={scrollToTop}
          aria-label="Back to top"
        >
          <span aria-hidden="true">^</span>
        </button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import MangaTab from '../components/MangaTab';
import RateReviewPanel from '../components/RateReviewPanel';
import MobileBookDetail from '../components/MobileBookDetail';
import useDeviceType from '../hooks/useDeviceType';
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
import WatchlistStatusControl from '../components/WatchlistStatusControl';
import {
  fetchSupabaseBookById,
  fetchSupabaseBooksPage,
} from '../utils/supabaseMovieCatalog';
import {
  buildMediaGenreFacets,
  filterBooksCatalog,
  loadFallbackBooks,
} from '../catalogFallback';
import { BOOK_GENRE_GROUPS, buildGenreGroups, sameGenreList } from '../genreGroups';
import { SORT_OPTIONS, sortModeToQuery } from '../utils/catalogSort';
import ThemedSelect from '../components/ThemedSelect';
import { findFreeEdition, checkFreeEditionCached } from '../utils/gutenbergApi';
import { getCached, setCached, buildCatalogCacheKey } from '../utils/sessionCache';

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

function getCoverUrl(book) {
  const rawUrl = book.cover_url || book.coverUrl || '';
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  if (rawUrl.startsWith('http://')) return rawUrl.replace(/^http:\/\//i, 'https://');
  return rawUrl;
}

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

const ARCHIVE_DOWNLOAD_EXTENSIONS = {
  pdf: ['.pdf'],
  epub: ['.epub'],
  txt: ['.txt', '.text'],
};

function BookCoverImage({ book, imageClassName, placeholderClassName, priority }) {
  const [coverUrl, setCoverUrl] = useState(() => getCoverUrl(book));

  useEffect(() => {
    setCoverUrl(getCoverUrl(book));
  }, [book]);

  if (!coverUrl) {
    return (
      <div className={placeholderClassName}>
        <span>{book.title?.charAt(0)}</span>
      </div>
    );
  }

  return (
    <img
      src={coverUrl}
      alt={book.title}
      className={imageClassName}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setCoverUrl('')}
    />
  );
}

function BookPosterTile({ book, onClick, watchlistEntry, addingWatchlist, onAddWatchlist, onStatusChange, priority }) {
  const [freeEdition, setFreeEdition] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkFreeEditionCached(book).then((match) => {
      if (!cancelled) setFreeEdition(Boolean(match));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.title, book.author]);

  return (
    <div className="poster-tile-wrap">
      <button
        type="button"
        className="poster-tile"
        onClick={onClick}
        title={book.title}
        aria-label={`Open details for ${book.title}`}
      >
        <div className="poster-tile-frame">
          <BookCoverImage
            book={book}
            imageClassName=""
            placeholderClassName="poster-tile-placeholder"
            priority={priority}
          />
          {freeEdition && (
            <span
              className="poster-tile-badge poster-tile-badge--free"
              title="Free to read on Project Gutenberg or Internet Archive"
            >
              Free to Read
            </span>
          )}
        </div>
        <p className="poster-tile-title">{book.title}</p>
        {book.author && <p className="poster-tile-year">{book.author}</p>}
      </button>

      {onAddWatchlist && (
        <div className="poster-tile-status" onClick={(event) => event.stopPropagation()}>
          <WatchlistStatusControl
            mediaType="book"
            status={watchlistEntry?.status}
            adding={addingWatchlist}
            onAdd={() => onAddWatchlist(book)}
            onChange={(nextStatus) => onStatusChange(book, watchlistEntry, nextStatus)}
          />
        </div>
      )}
    </div>
  );
}

export function BookDetailsModal({
  book,
  onClose,
  onAddToLibrary,
  isInLibrary,
  isAddingToLibrary,
  onRate,
  userRating,
  detailMessage,
  allowActions = true,
  browseOnlyMessage = '',
}) {
  const { isMobile } = useDeviceType();
  const [showReader, setShowReader] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  const rawId = book?.source_key?.startsWith('internet-archive:')
    ? book.source_key.replace('internet-archive:', '')
    : null;
  const isOlRecord = rawId?.startsWith('ol-') || rawId?.startsWith('ol/') || rawId?.startsWith('ol ');
  const archiveId = rawId && !isOlRecord ? rawId : null;
  const itemUrl = book?.item_url || book?.itemUrl || null;
  const canRead = Boolean(book?.title); // Reader searches Gutenberg if no direct source

  useEffect(() => {
    if (!book) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [book, onClose]);

  if (!book) return null;

  async function handleDownload(format) {
    if (!archiveId) return;

    setDownloading(format);
    setDownloadError('');

    try {
      const anchor = document.createElement('a');
      const metadataResponse = await fetch(`https://archive.org/metadata/${encodeURIComponent(archiveId)}`);
      if (!metadataResponse.ok) {
        throw new Error('Unable to look up the Internet Archive download files.');
      }

      const metadata = await metadataResponse.json();
      const allowedExtensions = ARCHIVE_DOWNLOAD_EXTENSIONS[format] || [];
      const file = (metadata.files || []).find((entry) => {
        const name = String(entry?.name || '').toLowerCase();
        return allowedExtensions.some((extension) => name.endsWith(extension));
      });

      if (!file?.name) {
        throw new Error(`No ${format.toUpperCase()} download is available for this title.`);
      }

      anchor.href = `https://archive.org/download/${encodeURIComponent(archiveId)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
      anchor.download = file.name;
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      setDownloadError(err.message || 'Download failed. This book may not be available.');
    } finally {
      setDownloading(null);
    }
  }

  async function handleRatingSave(categories, review) {
    if (typeof onRate !== 'function') return;
    await onRate(book, categories, review);
  }

  // Mobile gets the dedicated native-feeling layout
  if (isMobile) {
    return (
      <>
        <MobileBookDetail
          book={book}
          onClose={onClose}
          onAddToLibrary={onAddToLibrary}
          isInLibrary={isInLibrary}
          isAddingToLibrary={isAddingToLibrary}
          onRate={onRate}
          userRating={userRating}
          detailMessage={detailMessage}
          allowActions={allowActions}
          browseOnlyMessage={browseOnlyMessage}
          onReadNow={() => setShowReader(true)}
        />
        {showReader && (
          <BookReader
            book={book}
            archiveId={archiveId}
            itemUrl={itemUrl}
            onClose={() => setShowReader(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="book-detail-overlay" onClick={onClose}>
        <div
          className="book-detail-modal book-detail-modal-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-detail-title"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="book-detail-close"
            onClick={onClose}
            aria-label="Close book details"
          >
            <X size={18} weight="bold" />
          </button>

          <div className="book-detail-cover-panel">
            <div className="book-detail-cover-frame">
              <BookCoverImage
                book={book}
                imageClassName="book-detail-cover-image"
                placeholderClassName="book-detail-cover-placeholder"
              />
            </div>
            {canRead && (
              <button
                type="button"
                className="btn-watch book-detail-watch-now"
                onClick={() => setShowReader(true)}
              >
                Read Now
              </button>
            )}
          </div>

          <div className="book-detail-content">
            <p className="book-detail-kicker">Book Details</p>
            <h2 id="book-detail-title">{book.title}</h2>
            <p className="book-detail-author">by {book.author}</p>

            <div className="book-detail-meta">
              {book.genre && <span className="book-detail-meta-chip">{book.genre}</span>}
              {book.year && <span className="book-detail-meta-chip">{book.year}</span>}
            </div>

            {book.synopsis && <p className="book-detail-description">{book.synopsis}</p>}

            <div className="book-detail-summary">
              <div className="book-detail-summary-row">
                <span className="book-detail-summary-label">Author</span>
                <span>{book.author}</span>
              </div>
              <div className="book-detail-summary-row">
                <span className="book-detail-summary-label">Genre</span>
                <span>{book.genre || 'General Fiction'}</span>
              </div>
            </div>

            <div className="rating-section">
              <p className="rating-section-title">Your Rating</p>
              <RateReviewPanel
                mediaType="book"
                value={userRating}
                onSave={handleRatingSave}
                allowActions={allowActions}
                size="lg"
                actions={allowActions && (
                  <button
                    type="button"
                    className={`btn-primary book-detail-library-btn${isInLibrary ? ' is-saved' : ''}`}
                    onClick={() => onAddToLibrary(book)}
                    disabled={isInLibrary || isAddingToLibrary}
                  >
                    {isInLibrary ? 'In Your Library' : isAddingToLibrary ? 'Adding...' : 'Add to Library'}
                  </button>
                )}
              />
              {!allowActions && browseOnlyMessage && (
                <p className="book-detail-status">{browseOnlyMessage}</p>
              )}
              {detailMessage && <p className="book-detail-status">{detailMessage}</p>}
            </div>

            {archiveId && (
              <div className="book-detail-actions">
                <div className="book-download-row">
                  <span className="book-download-label">Download:</span>
                  {['pdf', 'epub', 'txt'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="book-download-btn"
                      onClick={() => handleDownload(fmt)}
                      disabled={downloading !== null}
                    >
                      {downloading === fmt ? '...' : 'Download'} {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
                {downloadError && (
                  <p className="book-download-error">{downloadError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showReader && canRead && (
        <BookReader
          book={book}
          archiveId={archiveId}
          itemUrl={itemUrl}
          onClose={() => setShowReader(false)}
        />
      )}
    </>
  );
}

function BookReader({ book, archiveId, itemUrl, onClose }) {
  const iframeRef = useRef(null);
  const modalRef  = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Resolved reading source
  const [embedUrl,  setEmbedUrl]  = useState(archiveId ? `https://archive.org/embed/${archiveId}` : null);
  const [source,    setSource]    = useState(archiveId ? 'archive' : null);
  const [searching, setSearching] = useState(!archiveId);
  const [notFound,  setNotFound]  = useState(false);

  useEffect(() => {
    if (archiveId) return; // Archive.org already resolved

    // Try Gutenberg URL in itemUrl first (fast path — no search needed)
    if (itemUrl) {
      const gutMatch = itemUrl.match(/gutenberg\.org\/(?:ebooks\/|files\/)(\d+)/);
      if (gutMatch) {
        setEmbedUrl(`/api/books/gutenberg/read/${gutMatch[1]}`);
        setSource('gutenberg');
        setSearching(false);
        return;
      }
    }

    // Otherwise search both free providers for a confidently-matching
    // public-domain edition (title + author, not just a title guess).
    // StrictMode double-invokes this effect once in dev — use a local
    // `cancelled` flag (reset naturally on every re-run) rather than an
    // AbortController, so the throwaway first run's cancellation can't get
    // misread as "no match found" and clobber the real run's result.
    let cancelled = false;
    findFreeEdition(book)
      .then((match) => {
        if (cancelled) return;
        if (match) {
          setEmbedUrl(match.embedUrl);
          setSource(match.source);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setSearching(false); });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onFsChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      (iframeRef.current || modalRef.current)?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  const noteText = source === 'archive'
    ? 'Powered by Internet Archive. Some books may require a free borrow.'
    : source === 'gutenberg'
    ? 'Powered by Project Gutenberg — free public domain reading.'
    : '';

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={(event) => event.stopPropagation()}>
        <div className="player-header">
          <div className="player-title">
            <span>Book</span>
            <div>
              <strong>{book.title}</strong>
              {book.author && <span className="player-year">by {book.author}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {embedUrl && (
              <button className="player-close" onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {isFullscreen ? '⊠' : '⊞'}
              </button>
            )}
            <button className="player-close" onClick={onClose} title="Close"><X size={16} weight="bold" /></button>
          </div>
        </div>

        <div className="player-frame-wrap">
          {searching ? (
            <div className="book-reader-state">
              <div className="manga-reader-spinner" />
              <p>Finding a readable version of <em>{book.title}</em>…</p>
            </div>
          ) : notFound ? (
            <div className="book-reader-state">
              <p style={{ fontSize: '2.5rem', margin: 0 }}>📚</p>
              <p style={{ fontWeight: 600, marginTop: '0.75rem' }}>
                No free online version found
              </p>
              <p style={{ color: '#888', fontSize: '0.87rem', maxWidth: '340px', textAlign: 'center' }}>
                <strong>{book.title}</strong> may be under copyright or not yet
                digitized by Project Gutenberg or the Internet Archive.
              </p>
              {itemUrl && (
                <a href={itemUrl} target="_blank" rel="noopener noreferrer"
                  className="btn-watch"
                  style={{ display: 'inline-block', marginTop: '1.25rem' }}>
                  View on Goodreads ↗
                </a>
              )}
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={embedUrl || ''}
              className="player-frame"
              allowFullScreen
              allow="fullscreen"
              title={`Read ${book.title}`}
              style={{ minHeight: '600px' }}
            />
          )}
        </div>

        {noteText && !searching && !notFound && (
          <p className="player-note">{noteText}</p>
        )}
      </div>
    </div>
  );
}

export default function Books() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));
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
    if (!activeLabel) return [];
    const activeGroup = genreGroups.find((group) => group.label === activeLabel);
    return activeGroup ? activeGroup.values : [activeLabel];
  }, [genreGroups, activeLabel]);

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
    const pages = Array.from({ length: WINDOWS_PER_BATCH }, () => (
      1 + Math.floor(Math.random() * totalWindowPages)
    ));

    const results = await Promise.all(pages.map((page) => (
      fetchSupabaseBooksPage({
        page,
        pageSize: windowSize,
        search: searchTerm,
        genre: genreValues,
        sortOrder: 'title-asc',
      }).catch(() => null)
    )));

    return orderBatch(results.flatMap((result) => (Array.isArray(result?.items) ? result.items : [])));
  }, [genreValues, searchTerm]);

  // Real sequential, sorted pages — used whenever sortMode isn't 'featured'.
  const fetchSupabaseSortedPage = useCallback(async (page) => {
    const { sortOrder } = sortModeToQuery(sortMode);
    const result = await fetchSupabaseBooksPage({
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
        const probe = await fetchSupabaseBooksPage({
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
        const book = await fetchSupabaseBookById(openId);
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

  async function handleRate(book, categories, review) {
    try {
      await saveSupabaseRating({ mediaType: 'book', mediaId: book.id, categories, media: book, review });
      setUserRatings((current) => ({ ...current, [book.id]: { ...categories, media_id: book.id, review } }));
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
        <div className="catalog-header">
          <h1 className="catalog-title">{activeTab === 'manga' ? 'Manga & Comics' : 'Books'}</h1>
        </div>

        <div className="books-tab-bar">
          <button
            type="button"
            className={`books-tab ${activeTab === 'books' ? 'active' : ''}`}
            onClick={() => setActiveTab('books')}
          >
            📚 Books
          </button>
          <button
            type="button"
            className={`books-tab ${activeTab === 'manga' ? 'active' : ''}`}
            onClick={() => setActiveTab('manga')}
          >
            📖 Manga & Comics
          </button>
        </div>

        {activeTab === 'manga' && <MangaTab />}

        {activeTab === 'books' && (
          <div className="catalog-view">
            <div className="catalog-search-row">
              <div className="catalog-search-bar">
                <MagnifyingGlass size={18} weight="bold" className="catalog-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  className="catalog-search-input"
                  placeholder="Search books…"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  aria-label="Search books"
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
                aria-label="Sort books by"
                value={sortMode}
                options={SORT_OPTIONS}
                onChange={(event) => setSortMode(event.target.value)}
              />
            </div>

            <GenreScrollBar ariaLabel="Book genres">
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
            ) : books.length === 0 ? (
              <div className="empty-state">
                <p style={{ fontSize: '2rem', margin: 0 }}>📖</p>
                <p>No books match {searchTerm ? `"${searchTerm}"` : 'this genre'}.</p>
                <p className="empty-hint">Try a different {searchTerm ? 'search term' : 'genre'}.</p>
              </div>
            ) : (
              <>
                <div className="poster-grid">
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

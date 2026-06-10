import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MangaTab from '../components/MangaTab';
import ListSaveControls from '../components/ListSaveControls';
import RatingInput from '../components/RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from '../components/RatingArtifact';
import MobileBookDetail from '../components/MobileBookDetail';
import useIsMobile from '../hooks/useIsMobile';
import ThemedSelect from '../components/ThemedSelect';
import { api } from '../api';
import { SkeletonGrid } from '../components/SkeletonCard';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlist,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  fetchSupabaseBookById,
  fetchSupabaseBooksPage,
} from '../utils/supabaseMovieCatalog';
import { EMBED_SANDBOX } from '../utils/embedSecurity';
import {
  buildMediaGenreFacets,
  filterBooksCatalog,
  loadFallbackBooks,
} from '../catalogFallback';

const BOOKS_PAGE_SIZE = 24;

function getCoverUrl(book) {
  const rawUrl = book.cover_url || book.coverUrl || '';
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  if (rawUrl.startsWith('http://')) return rawUrl.replace(/^http:\/\//i, 'https://');
  return rawUrl;
}

const ARCHIVE_DOWNLOAD_EXTENSIONS = {
  pdf: ['.pdf'],
  epub: ['.epub'],
  txt: ['.txt', '.text'],
};

function BookCoverImage({ book, imageClassName, placeholderClassName }) {
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
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setCoverUrl('')}
    />
  );
}

function BookDetailsModal({
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
  const isMobile = useIsMobile();
  const [showReader, setShowReader] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState('');
  const [draftScores, setDraftScores] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const rawId = book?.source_key?.startsWith('internet-archive:')
    ? book.source_key.replace('internet-archive:', '')
    : null;
  const isOlRecord = rawId?.startsWith('ol-') || rawId?.startsWith('ol/') || rawId?.startsWith('ol ');
  const archiveId = rawId && !isOlRecord ? rawId : null;
  const itemUrl = book?.item_url || book?.itemUrl || null;
  const canRead = Boolean(book?.title); // Reader searches Gutenberg if no direct source

  useEffect(() => {
    if (userRating && typeof userRating === 'object') {
      setDraftScores(userRating);
    } else {
      setDraftScores({});
    }
  }, [userRating, book]);

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

  const cats = RATING_CATEGORIES.book;
  const canSave = cats.every((cat) => draftScores[cat.key] >= 1);
  const displayScore = computeNormalizedScore('book', draftScores);

  async function handleSave() {
    if (!allowActions || typeof onRate !== 'function' || !canSave || isSaving) return;

    setIsSaving(true);
    try {
      await onRate(book, draftScores);
    } finally {
      setIsSaving(false);
    }
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
            &times;
          </button>

          <div className="book-detail-cover-panel">
            <div className="book-detail-cover-frame">
              <BookCoverImage
                book={book}
                imageClassName="book-detail-cover-image"
                placeholderClassName="book-detail-cover-placeholder"
              />
            </div>
            <div className="artifact-panel">
              <RatingArtifact mediaType="book" scores={draftScores} size={220} />
              {displayScore !== null && (
                <p className="artifact-score">{displayScore}<span>/10</span></p>
              )}
            </div>
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
              <RatingInput
                mediaType="book"
                value={draftScores}
                onChange={allowActions ? setDraftScores : () => {}}
              />
              <div className="rating-section-actions">
                <button
                  type="button"
                  className={`btn-primary${allowActions && canSave ? '' : ' btn-disabled'}`}
                  onClick={handleSave}
                  disabled={!allowActions || !canSave || isSaving}
                >
                  {!allowActions ? 'Browse Only' : isSaving ? 'Saving...' : userRating ? 'Update Rating' : 'Save Rating'}
                </button>
                {allowActions && !canSave && (
                  <span className="rating-incomplete-hint">Rate all categories to save</span>
                )}
              </div>
            </div>

            <div className="book-detail-actions">
              {allowActions && (
                <button
                  type="button"
                  className={`btn-primary book-detail-library-btn${isInLibrary ? ' is-saved' : ''}`}
                  onClick={() => onAddToLibrary(book)}
                  disabled={isInLibrary || isAddingToLibrary}
                >
                  {isInLibrary ? 'In Your Library' : isAddingToLibrary ? 'Adding...' : 'Add to Library'}
                </button>
              )}
              {allowActions && (
                <ListSaveControls mediaType="book" mediaId={book.id} itemTitle={book.title} />
              )}
              {!allowActions && browseOnlyMessage && (
                <p className="book-detail-status">{browseOnlyMessage}</p>
              )}
              {detailMessage && <p className="book-detail-status">{detailMessage}</p>}
              {canRead && (
                <button
                  type="button"
                  className="btn-watch"
                  onClick={() => setShowReader(true)}
                >
                  Read Now
                </button>
              )}
              {archiveId && (
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
              )}
              {downloadError && (
                <p className="book-download-error">{downloadError}</p>
              )}
            </div>
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

    // Try Gutenberg URL in itemUrl first (fast path)
    if (itemUrl) {
      const gutMatch = itemUrl.match(/gutenberg\.org\/(?:ebooks\/|files\/)(\d+)/);
      if (gutMatch) {
        setEmbedUrl(`/api/books/gutenberg/read/${gutMatch[1]}`);
        setSource('gutenberg');
        setSearching(false);
        return;
      }
    }

    // Search Gutenberg by title + author
    const q = encodeURIComponent(`${book.title}${book.author ? ' ' + book.author : ''}`.trim());
    fetch(`/api/books/gutenberg/search?q=${q}`)
      .then(r => r.json())
      .then(data => {
        const htmlBook = (data.books || []).find(b => b.hasHtml);
        if (htmlBook) {
          setEmbedUrl(`/api/books/gutenberg/read/${htmlBook.id}`);
          setSource('gutenberg');
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setSearching(false));
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
            <button className="player-close" onClick={onClose} title="Close">✕</button>
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
              sandbox={EMBED_SANDBOX}
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
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [sortOrder, setSortOrder] = useState('title-asc');
  const [page, setPage] = useState(1);
  const [totalBooks, setTotalBooks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [facets, setFacets] = useState({ genres: [] });
  const [loading, setLoading] = useState(true);
  const [libraryIds, setLibraryIds] = useState({});
  const [userRatings, setUserRatings] = useState({});
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedBookBrowseOnly, setSelectedBookBrowseOnly] = useState(false);
  const [addingBookId, setAddingBookId] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [search]);

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

  useEffect(() => {
    let cancelled = false;

    async function fetchBooks() {
      setLoading(true);

      try {
        const data = await fetchSupabaseBooksPage({
          page,
          pageSize: BOOKS_PAGE_SIZE,
          search: debouncedSearch,
          genre,
          sortOrder,
        });

        if (!cancelled) {
          const nextItems = Array.isArray(data?.items) ? data.items : [];
          if (nextItems.length === 0 && page === 1 && !debouncedSearch && !genre) {
            throw new Error('Book catalog is empty');
          }

          setBooks((current) => {
            if (page === 1) {
              return nextItems;
            }

            const seenIds = new Set(current.map((book) => book.id));
            const appendedItems = nextItems.filter((book) => !seenIds.has(book.id));
            return [...current, ...appendedItems];
          });
          setTotalBooks(Number(data?.total) || 0);
          setTotalPages(Number(data?.totalPages) || 1);
          setFacets({
            genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
          });
          setUsingFallbackCatalog(false);
        }
      } catch {
        if (!cancelled) {
          try {
            const params = new URLSearchParams({
              page: String(page),
              page_size: String(BOOKS_PAGE_SIZE),
              sort: sortOrder,
            });

            if (debouncedSearch) params.set('search', debouncedSearch);
            if (genre) params.set('genre', genre);

            const data = await api.get(`/media/books?${params.toString()}`);
            const nextItems = Array.isArray(data?.items) ? data.items : [];
            if (nextItems.length === 0 && page === 1 && !debouncedSearch && !genre) {
              throw new Error('Book catalog is empty');
            }

            setBooks((current) => {
              if (page === 1) {
                return nextItems;
              }

              const seenIds = new Set(current.map((book) => book.id));
              const appendedItems = nextItems.filter((book) => !seenIds.has(book.id));
              return [...current, ...appendedItems];
            });
            setTotalBooks(Number(data?.total) || nextItems.length);
            setTotalPages(Number(data?.totalPages) || 1);
            setFacets({
              genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [],
            });
            setUsingFallbackCatalog(false);
          } catch {
            try {
              const fallbackItems = await loadFallbackBooks();
              const result = filterBooksCatalog(fallbackItems, {
                search: debouncedSearch,
                genre,
                sortOrder,
                page,
                pageSize: BOOKS_PAGE_SIZE,
              });

              setBooks((current) => {
                if (page === 1) {
                  return result.items;
                }

                const seenIds = new Set(current.map((book) => book.id));
                const appendedItems = result.items.filter((book) => !seenIds.has(book.id));
                return [...current, ...appendedItems];
              });
              setTotalBooks(result.total);
              setTotalPages(result.totalPages);
              setFacets({
                genres: buildMediaGenreFacets(fallbackItems),
              });
              setUsingFallbackCatalog(true);
            } catch {
              if (page === 1) {
                setBooks([]);
                setFacets({ genres: [] });
              }
              setTotalBooks(0);
              setTotalPages(1);
              setUsingFallbackCatalog(false);
            }
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchBooks();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, genre, sortOrder, page]);

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

    fetchSupabaseWatchlist({ mediaType: 'book' })
      .then((items) => {
        if (cancelled) return;
        const nextLibraryIds = {};
        items.forEach((item) => {
          nextLibraryIds[item.media_id] = true;
        });
        setLibraryIds(nextLibraryIds);
      })
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

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, genre, sortOrder]);

  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') {
      return undefined;
    }

    const node = loadMoreRef.current;
    if (!node || loading || page >= totalPages) {
      return undefined;
    }

    let queuedNextPage = false;
    const observer = new window.IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || queuedNextPage) {
          return;
        }

        queuedNextPage = true;
        setPage((current) => (current < totalPages ? current + 1 : current));
      },
      {
        rootMargin: '260px 0px',
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [loading, page, totalPages]);

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

  async function handleRate(book, categories, review = '') {
    try {
      await saveSupabaseRating({ mediaType: 'book', mediaId: book.id, categories, review, media: book });
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
      await addSupabaseWatchlistItem({
        mediaType: 'book',
        mediaId: book.id,
        status: 'plan_to_read',
        media: book,
      });

      setLibraryIds((current) => ({ ...current, [book.id]: true }));
      setDetailMessage('Added to your Library.');
    } catch (err) {
      if (/already in watchlist/i.test(err.message)) {
        setLibraryIds((current) => ({ ...current, [book.id]: true }));
        setDetailMessage('This book is already in your Library.');
      } else {
        setDetailMessage(err.message);
      }
    } finally {
      setAddingBookId(null);
    }
  }

  const hasActiveFilters = Boolean(search || genre || sortOrder !== 'title-asc');

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setGenre('');
    setSortOrder('title-asc');
    setPage(1);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header books-page-header">
          <div>
            <p className="page-kicker">Browse</p>
            <h1>{activeTab === 'manga' ? 'Manga & Comics' : 'Books'}</h1>
            <p className="page-subtitle books-page-subtitle">
              {activeTab === 'manga'
                ? 'Browse and read manga, manhwa, manhua, and comics in-site — powered by MangaDex.'
                : 'Search the shelf, open richer book details, and save future reads to your library or shared lists.'}
            </p>
          </div>
        </div>

        {/* Tab bar */}
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

        {/* Manga tab */}
        {activeTab === 'manga' && <MangaTab />}

        {/* Books tab */}
        {activeTab === 'books' && <><section className="surface-panel">
          <div className="surface-panel-header">
            <div>
              <h2>Filter the Shelf</h2>
              <p className="surface-panel-copy">
                Search by title or author, narrow by genre, and sort the shelf without leaving the page.
              </p>
              {usingFallbackCatalog && (
                <p className="surface-panel-copy">Showing the bundled book catalog snapshot.</p>
              )}
            </div>
            <p className="surface-panel-meta">
              {loading ? 'Loading books...' : `${totalBooks} book${totalBooks === 1 ? '' : 's'} found`}
            </p>
          </div>

          <div className="filter-bar">
            <input
              className="search-input"
              type="text"
              aria-label="Search books"
              placeholder="Search books..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ThemedSelect
              className="filter-input"
              aria-label="Genre"
              value={genre}
              options={[
                { value: '', label: 'All Genres' },
                ...facets.genres.map((option) => ({ value: option, label: option })),
              ]}
              onChange={(event) => setGenre(event.target.value)}
            />
            <ThemedSelect
              className="filter-input"
              aria-label="Sort by"
              value={sortOrder}
              options={[
                { value: 'title-asc', label: 'Title A-Z' },
                { value: 'year-desc', label: 'Newest First' },
                { value: 'year-asc', label: 'Oldest First' },
              ]}
              onChange={(event) => setSortOrder(event.target.value)}
            />
            {hasActiveFilters && (
              <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>

          {hasActiveFilters && !loading && (
            <p className="surface-panel-copy">Showing results for your active filters.</p>
          )}
        </section>

        <section className="surface-panel surface-panel-spacious books-results-panel">
          <div className="books-results-header">
            <p className="books-results-count">
              {loading ? 'Loading books...' : `${totalBooks} book${totalBooks === 1 ? '' : 's'} found`}
            </p>
            {hasActiveFilters && !loading && (
              <p className="books-results-summary">
                Showing results for your active filters.
              </p>
            )}
          </div>

          {loading ? (
            <SkeletonGrid count={18} />
          ) : books.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontSize: '2rem', margin: 0 }}>📖</p>
              <p>No books match those filters.</p>
              <p className="empty-hint">Try a different search or clear the filters.</p>
            </div>
          ) : (
            <>
              <div className="book-library-grid">
                {books.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    className="book-shelf-card"
                    onClick={() => openBookDetails(book, { browseOnly: usingFallbackCatalog })}
                    aria-label={`Open details for ${book.title}`}
                  >
                    <div className="book-shelf-cover-frame">
                      <BookCoverImage
                        book={book}
                        imageClassName="book-shelf-cover-image"
                        placeholderClassName="book-shelf-cover-placeholder"
                      />
                    </div>
                    <div className="book-shelf-copy">
                      <h3>{book.title}</h3>
                      <p>{book.author}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="books-infinite-footer">
                {loading && page > 1 && (
                  <p className="books-pagination-copy">Loading more books...</p>
                )}
                {!loading && page >= totalPages && (
                  <p className="books-pagination-copy">You have reached the end of the shelf.</p>
                )}
                {page < totalPages && <div ref={loadMoreRef} className="books-load-trigger" aria-hidden="true" />}
              </div>
            </>
          )}
        </section>
        </>}
      </main>

      {selectedBook && (
        <BookDetailsModal
          book={selectedBook}
          onClose={closeBookDetails}
          onAddToLibrary={handleAddToLibrary}
          isInLibrary={!!libraryIds[selectedBook?.id]}
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

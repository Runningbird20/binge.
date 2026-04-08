import { useEffect, useRef, useState } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

const BOOKS_PAGE_SIZE = 24;

function getCoverUrl(book) {
  return book.cover_url || book.coverUrl || '';
}

function BookDetailsModal({
  book,
  onClose,
  onAddToLibrary,
  isInLibrary,
  isAddingToLibrary,
  detailMessage,
}) {
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

  const coverUrl = getCoverUrl(book);

  return (
    <div className="book-detail-overlay" onClick={onClose}>
      <div
        className="book-detail-modal"
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
            {coverUrl ? (
              <img src={coverUrl} alt={book.title} className="book-detail-cover-image" />
            ) : (
              <div className="book-detail-cover-placeholder">
                <span>{book.title?.charAt(0)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="book-detail-content">
          <p className="book-detail-kicker">Book Details</p>
          <h2 id="book-detail-title">{book.title}</h2>
          <p className="book-detail-author">by {book.author}</p>

          <div className="book-detail-meta">
            {book.genre && (
              <span className="book-detail-meta-chip">{book.genre}</span>
            )}
            {book.year && (
              <span className="book-detail-meta-chip">{book.year}</span>
            )}
          </div>

          <p className="book-detail-description">{book.synopsis}</p>

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

          <div className="book-detail-actions">
            <button
              type="button"
              className={`btn-primary book-detail-library-btn${isInLibrary ? ' is-saved' : ''}`}
              onClick={() => onAddToLibrary(book)}
              disabled={isInLibrary || isAddingToLibrary}
            >
              {isInLibrary ? 'In Your Library' : isAddingToLibrary ? 'Adding...' : 'Add to Library'}
            </button>
            {detailMessage && <p className="book-detail-status">{detailMessage}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Books() {
  const [books, setBooks] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [sortOrder, setSortOrder] = useState('title-asc');
  const [page, setPage] = useState(1);
  const [totalBooks, setTotalBooks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [facets, setFacets] = useState({ genres: [], minYear: null, maxYear: null });
  const [loading, setLoading] = useState(true);
  const [libraryIds, setLibraryIds] = useState({});
  const [selectedBook, setSelectedBook] = useState(null);
  const [addingBookId, setAddingBookId] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
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
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(BOOKS_PAGE_SIZE),
          sort: sortOrder,
        });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (genre) params.set('genre', genre);
        if (releaseYear !== '') params.set('min_year', String(releaseYear));

        const data = await api.get(`/media/books?${params.toString()}`);
        if (!cancelled) {
          const nextItems = Array.isArray(data?.items) ? data.items : [];
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
            minYear: Number.isFinite(Number(data?.facets?.minYear))
              ? Number(data.facets.minYear)
              : null,
            maxYear: Number.isFinite(Number(data?.facets?.maxYear))
              ? Number(data.facets.maxYear)
              : null,
          });
        }
      } catch {
        if (!cancelled) {
          if (page === 1) {
            setBooks([]);
          }
          setTotalBooks(0);
          setTotalPages(1);
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
  }, [debouncedSearch, genre, releaseYear, sortOrder, page]);

  useEffect(() => {
    let cancelled = false;

    api.get('/watchlist?media_type=book')
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
    setPage(1);
  }, [debouncedSearch, genre, releaseYear, sortOrder]);

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

  function openBookDetails(book) {
    setSelectedBook(book);
    setDetailMessage('');
  }

  function closeBookDetails() {
    setSelectedBook(null);
    setDetailMessage('');
    setAddingBookId(null);
  }

  async function handleAddToLibrary(book) {
    setDetailMessage('');
    setAddingBookId(book.id);

    try {
      await api.post('/watchlist', {
        media_type: 'book',
        media_id: book.id,
        status: 'plan_to_read',
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

  const hasActiveFilters = Boolean(search || genre || releaseYear !== '' || sortOrder !== 'title-asc');
  const genreOptions = facets.genres;
  const minYear = facets.minYear;
  const maxYear = facets.maxYear;

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setGenre('');
    setReleaseYear('');
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
            <h1>Books</h1>
            <p className="books-page-subtitle">
              Explore the books loaded from your data folder and add favorites to your Library.
            </p>
          </div>
        </div>

        <div className="books-top-search">
          <label className="books-top-search-label">
            <span>Search the shelf</span>
            <input
              className="search-input books-top-search-input"
              type="text"
              placeholder="Search books or authors..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="books-shell">
          <aside className="books-filter-sidebar" aria-label="Book filters">
            <div className="books-filter-card">
              <div className="books-filter-card-header">
                <div>
                  <p className="books-filter-kicker">Filter Options</p>
                  <h2>Refine the shelf</h2>
                </div>
                {hasActiveFilters && (
                  <button type="button" className="btn-ghost" onClick={clearFilters}>
                    Clear all
                  </button>
                )}
              </div>

              <label className="books-filter-group" htmlFor="books-release-slider">
                <span>Release Date</span>
                <div className="books-slider-header">
                  <strong>
                    {releaseYear === '' || minYear == null
                      ? 'Any year'
                      : `${releaseYear} and newer`}
                  </strong>
                  {minYear != null && maxYear != null && (
                    <small>{minYear} to {maxYear}</small>
                  )}
                </div>
                {minYear != null && maxYear != null ? (
                  <input
                    id="books-release-slider"
                    className="books-year-slider"
                    type="range"
                    min={minYear}
                    max={maxYear}
                    step="1"
                    value={releaseYear === '' ? minYear : releaseYear}
                    onChange={(event) => setReleaseYear(Number(event.target.value))}
                  />
                ) : (
                  <p className="books-filter-empty">Release dates are not available for these books yet.</p>
                )}
                <p className="books-slider-caption">
                  Drag right to focus on newer releases in the shelf.
                </p>
              </label>

              <div className="books-filter-group">
                <span>Genre</span>
                <div className="books-filter-chip-list">
                  <button
                    type="button"
                    className={`books-filter-chip${genre ? '' : ' active'}`}
                    onClick={() => setGenre('')}
                    aria-pressed={!genre}
                  >
                    All Genres
                  </button>
                  {genreOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`books-filter-chip${genre === option ? ' active' : ''}`}
                      onClick={() => setGenre(option)}
                      aria-pressed={genre === option}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <label className="books-filter-group">
                <span>Sort By</span>
                <select
                  className="books-filter-select"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value)}
                >
                  <option value="title-asc">Title A-Z</option>
                  <option value="year-desc">Newest First</option>
                  <option value="year-asc">Oldest First</option>
                </select>
              </label>
            </div>
          </aside>

          <section className="books-results-panel">
            <div className="books-results-header">
              <p className="books-results-count">
                {loading ? 'Loading books...' : `${totalBooks} book${totalBooks === 1 ? '' : 's'} found`}
              </p>
              {hasActiveFilters && !loading && (
                <p className="books-results-summary">
                  Showing matches for your current filters.
                </p>
              )}
            </div>

            {loading ? (
              <div className="loading-state">Loading...</div>
            ) : books.length === 0 ? (
              <div className="empty-state">
                <p>No books found.</p>
                <p className="empty-hint">Try a different filter or clear the current ones to widen the shelf.</p>
              </div>
            ) : (
              <>
                <div className="book-library-grid">
                  {books.map((book) => {
                    const coverUrl = getCoverUrl(book);

                    return (
                      <button
                        key={book.id}
                        type="button"
                        className="book-shelf-card"
                        onClick={() => openBookDetails(book)}
                        aria-label={`Open details for ${book.title}`}
                      >
                        <div className="book-shelf-cover-frame">
                          {coverUrl ? (
                            <img src={coverUrl} alt={book.title} className="book-shelf-cover-image" />
                          ) : (
                            <div className="book-shelf-cover-placeholder">
                              <span>{book.title?.charAt(0)}</span>
                            </div>
                          )}
                        </div>
                        <div className="book-shelf-copy">
                          <h3>{book.title}</h3>
                          <p>{book.author}</p>
                        </div>
                      </button>
                    );
                  })}
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
        </div>
      </main>

      {selectedBook && (
        <BookDetailsModal
          book={selectedBook}
          onClose={closeBookDetails}
          onAddToLibrary={handleAddToLibrary}
          isInLibrary={!!libraryIds[selectedBook?.id]}
          isAddingToLibrary={addingBookId === selectedBook?.id}
          detailMessage={detailMessage}
        />
      )}

      {showScrollTop && (
        <button
          type="button"
          className="books-scroll-top"
          onClick={scrollToTop}
          aria-label="Back to top"
        >
          <span aria-hidden="true">↑</span>
        </button>
      )}
    </div>
  );
}

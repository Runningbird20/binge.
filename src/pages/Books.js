import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MediaRow from '../components/MediaRow';
import Navbar from '../components/Navbar';
import ListSaveControls from '../components/ListSaveControls';
import RatingInput from '../components/RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from '../components/RatingArtifact';
import { api } from '../api';
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

function BookCoverImage({ book, imageClassName, placeholderClassName }) {
  const [coverUrl, setCoverUrl] = useState(() => getCoverUrl(book));

  useEffect(() => { setCoverUrl(getCoverUrl(book)); }, [book]);

  if (!coverUrl) {
    return <div className={placeholderClassName}><span>{book.title?.charAt(0)}</span></div>;
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
  book, onClose, onAddToLibrary, isInLibrary, isAddingToLibrary,
  onRate, userRating, detailMessage, allowActions = true, browseOnlyMessage = '',
}) {
  const [showReader, setShowReader]   = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState('');
  const [draftScores, setDraftScores] = useState({});
  const [isSaving, setIsSaving]       = useState(false);

  const rawId     = book?.source_key?.startsWith('internet-archive:')
    ? book.source_key.replace('internet-archive:', '') : null;
  const isOlRecord = rawId?.startsWith('ol-') || rawId?.startsWith('ol/') || rawId?.startsWith('ol ');
  const archiveId  = rawId && !isOlRecord ? rawId : null;
  const itemUrl    = book?.item_url || book?.itemUrl || null;
  const canRead    = !!(archiveId || itemUrl);

  useEffect(() => {
    if (userRating && typeof userRating === 'object') setDraftScores(userRating);
    else setDraftScores({});
  }, [userRating, book]);

  useEffect(() => {
    if (!book) return undefined;
    function handleKeyDown(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleKeyDown); document.body.style.overflow = prev; };
  }, [book, onClose]);

  if (!book) return null;

  async function handleDownload(format) {
    if (!archiveId) return;
    setDownloading(format);
    setDownloadError('');
    try {
      const url = `/api/media/book-download?identifier=${encodeURIComponent(archiveId)}&format=${format}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Download failed'); }
      const disposition = res.headers.get('content-disposition') || '';
      const nameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = nameMatch ? nameMatch[1] : `${book.title.replace(/[^a-z0-9]/gi, '_')}.${format}`;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setDownloadError(err.message || 'Download failed. This book may not be available.');
    } finally { setDownloading(null); }
  }

  const cats = RATING_CATEGORIES.book;
  const canSave = cats.every((cat) => draftScores[cat.key] >= 1);
  const displayScore = computeNormalizedScore('book', draftScores);

  async function handleSave() {
    if (!allowActions || typeof onRate !== 'function' || !canSave || isSaving) return;
    setIsSaving(true);
    try { await onRate(book, draftScores); } finally { setIsSaving(false); }
  }

  return (
    <>
      <div className="book-detail-overlay" onClick={onClose}>
        <div
          className="book-detail-modal book-detail-modal-wide"
          role="dialog" aria-modal="true" aria-labelledby="book-detail-title"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="book-detail-close" onClick={onClose} aria-label="Close book details">&times;</button>

          <div className="book-detail-cover-panel">
            <div className="book-detail-cover-frame">
              <BookCoverImage book={book} imageClassName="book-detail-cover-image" placeholderClassName="book-detail-cover-placeholder" />
            </div>
            <div className="artifact-panel">
              <RatingArtifact mediaType="book" scores={draftScores} size={220} />
              {displayScore !== null && <p className="artifact-score">{displayScore}<span>/10</span></p>}
            </div>
          </div>

          <div className="book-detail-content">
            <p className="book-detail-kicker">Book Details</p>
            <h2 id="book-detail-title">{book.title}</h2>
            <p className="book-detail-author">by {book.author}</p>
            <div className="book-detail-meta">
              {book.genre && <span className="book-detail-meta-chip">{book.genre}</span>}
              {book.year  && <span className="book-detail-meta-chip">{book.year}</span>}
            </div>
            <p className="book-detail-description">{book.synopsis}</p>
            <div className="book-detail-summary">
              <div className="book-detail-summary-row"><span className="book-detail-summary-label">Author</span><span>{book.author}</span></div>
              <div className="book-detail-summary-row"><span className="book-detail-summary-label">Genre</span><span>{book.genre || 'General Fiction'}</span></div>
            </div>

            <div className="rating-section">
              <p className="rating-section-title">Your Rating</p>
              <RatingInput mediaType="book" value={draftScores} onChange={allowActions ? setDraftScores : () => {}} />
              <div className="rating-section-actions">
                <button
                  type="button"
                  className={`btn-primary${allowActions && canSave ? '' : ' btn-disabled'}`}
                  onClick={handleSave}
                  disabled={!allowActions || !canSave || isSaving}
                >
                  {!allowActions ? 'Browse Only' : isSaving ? 'Saving...' : userRating ? 'Update Rating' : 'Save Rating'}
                </button>
                {allowActions && !canSave && <span className="rating-incomplete-hint">Rate all categories to save</span>}
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
              {allowActions && <ListSaveControls mediaType="book" mediaId={book.id} itemTitle={book.title} />}
              {!allowActions && browseOnlyMessage && <p className="book-detail-status">{browseOnlyMessage}</p>}
              {detailMessage && <p className="book-detail-status">{detailMessage}</p>}
              {canRead && (
                <button type="button" className="btn-watch" onClick={() => setShowReader(true)}>📖 Read Now</button>
              )}
              {archiveId && (
                <div className="book-download-row">
                  <span className="book-download-label">Download:</span>
                  {['pdf', 'epub', 'txt'].map((fmt) => (
                    <button key={fmt} type="button" className="book-download-btn" onClick={() => handleDownload(fmt)} disabled={downloading !== null}>
                      {downloading === fmt ? '...' : 'Download'} {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
              {downloadError && <p className="book-download-error">{downloadError}</p>}
            </div>
          </div>
        </div>
      </div>

      {showReader && canRead && (
        <BookReader book={book} archiveId={archiveId} itemUrl={itemUrl} onClose={() => setShowReader(false)} />
      )}
    </>
  );
}

function BookReader({ book, archiveId, itemUrl, onClose }) {
  const iframeRef = useRef(null);
  const modalRef  = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) (iframeRef.current || modalRef.current)?.requestFullscreen();
    else document.exitFullscreen();
  }

  const embedUrl = archiveId ? `https://archive.org/embed/${archiveId}` : itemUrl || null;

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="player-header">
          <div className="player-title">
            <span>📚</span>
            <div>
              <strong>{book.title}</strong>
              {book.author && <span className="player-year">by {book.author}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="player-close" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? '↙' : '↗'}
            </button>
            <button className="player-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>
        <div className="player-frame-wrap">
          <iframe ref={iframeRef} src={embedUrl || ''} className="player-frame" allowFullScreen allow="fullscreen" title={`Read ${book.title}`} style={{ minHeight: '600px' }} />
        </div>
        <p className="player-note">Powered by Internet Archive. Some books may require borrowing.</p>
      </div>
    </div>
  );
}

function CuratedBooksView({ onBookClick, onSeeAll }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/media/books/curated')
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="curated-loading"><div className="curated-loading-shimmer" /></div>;

  return (
    <div className="curated-view">
      {rows.map((row, i) => (
        <div key={row.id} style={{ animationDelay: `${i * 0.06}s` }} className="curated-row-appear">
          <MediaRow
            row={{ ...row, items: row.items.map(b => ({ ...b, poster_url: b.cover_url })) }}
            mediaType="book"
            onItemClick={onBookClick}
            onSeeAll={onSeeAll}
            userRatings={{}}
          />
        </div>
      ))}
    </div>
  );
}

export default function Books() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));

  const [view, setView]           = useState('curated');
  const [books, setBooks]         = useState([]);
  const [search, setSearch]       = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genre, setGenre]         = useState('');
  const [sortOrder, setSortOrder] = useState('title-asc');
  const [page, setPage]           = useState(1);
  const [totalBooks, setTotalBooks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [facets, setFacets]       = useState({ genres: [] });
  const [loading, setLoading]     = useState(true);
  const [libraryIds, setLibraryIds] = useState({});
  const [userRatings, setUserRatings] = useState({});
  const [selectedBook, setSelectedBook] = useState(null);
  const [addingBookId, setAddingBookId] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    function handleScroll() { setShowScrollTop(window.scrollY > 360); }
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchBooks() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), page_size: String(BOOKS_PAGE_SIZE), sort: sortOrder });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (genre) params.set('genre', genre);
        const data = await api.get(`/media/books?${params.toString()}`);
        if (!cancelled) {
          const nextItems = Array.isArray(data?.items) ? data.items : [];
          if (nextItems.length === 0 && page === 1) throw new Error('empty');
          setBooks(cur => page === 1 ? nextItems : [...cur, ...nextItems.filter(b => !cur.find(c => c.id === b.id))]);
          setTotalBooks(Number(data?.total) || 0);
          setTotalPages(Number(data?.totalPages) || 1);
          setFacets({ genres: Array.isArray(data?.facets?.genres) ? data.facets.genres : [] });
          setUsingFallbackCatalog(false);
          if (openId && page === 1) {
            const match = nextItems.find(b => b.id === openId);
            if (match) { setSelectedBook(match); setDetailMessage(''); }
          }
        }
      } catch {
        if (!cancelled) {
          try {
            const fallbackItems = await loadFallbackBooks();
            const result = filterBooksCatalog(fallbackItems, { search: debouncedSearch, genre, sortOrder, page, pageSize: BOOKS_PAGE_SIZE });
            setBooks(cur => page === 1 ? result.items : [...cur, ...result.items.filter(b => !cur.find(c => c.id === b.id))]);
            setTotalBooks(result.total); setTotalPages(result.totalPages);
            setFacets({ genres: buildMediaGenreFacets(fallbackItems) });
            setUsingFallbackCatalog(true);
            if (openId && page === 1) { const m = fallbackItems.find(b => b.id === openId); if (m) { setSelectedBook(m); setDetailMessage(''); } }
          } catch {
            if (page === 1) setBooks([]);
            setTotalBooks(0); setTotalPages(1); setUsingFallbackCatalog(false);
          }
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    fetchBooks();
    return () => { cancelled = true; };
  }, [debouncedSearch, genre, sortOrder, page, openId]);

  useEffect(() => {
    let cancelled = false;
    api.get('/watchlist?media_type=book')
      .then(items => { if (cancelled) return; const ids = {}; items.forEach(i => { ids[i.media_id] = true; }); setLibraryIds(ids); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    api.get('/ratings/my?media_type=book')
      .then(ratings => { const next = {}; ratings.forEach(r => { next[r.media_id] = r; }); setUserRatings(next); })
      .catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [debouncedSearch, genre, sortOrder]);

  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') return undefined;
    const node = loadMoreRef.current;
    if (!node || loading || page >= totalPages) return undefined;
    let queued = false;
    const observer = new window.IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || queued) return;
      queued = true;
      setPage(cur => cur < totalPages ? cur + 1 : cur);
    }, { rootMargin: '260px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, page, totalPages]);

  function openBookDetails(book) { setSelectedBook(book); setDetailMessage(''); }
  function closeBookDetails()   { setSelectedBook(null); setDetailMessage(''); setAddingBookId(null); }

  async function handleRate(book, categories) {
    try {
      await api.post('/ratings', { media_type: 'book', media_id: book.id, categories });
      setUserRatings(cur => ({ ...cur, [book.id]: { ...categories, media_id: book.id } }));
      setDetailMessage('Rating saved!');
    } catch (err) { setDetailMessage(err.message); }
  }

  async function handleAddToLibrary(book) {
    setDetailMessage(''); setAddingBookId(book.id);
    try {
      await api.post('/watchlist', { media_type: 'book', media_id: book.id, status: 'plan_to_read' });
      setLibraryIds(cur => ({ ...cur, [book.id]: true }));
      setDetailMessage('Added to your Library.');
    } catch (err) {
      if (/already in watchlist/i.test(err.message)) { setLibraryIds(cur => ({ ...cur, [book.id]: true })); setDetailMessage('Already in your Library.'); }
      else setDetailMessage(err.message);
    } finally { setAddingBookId(null); }
  }

  const hasActiveFilters = Boolean(search || genre || sortOrder !== 'title-asc');

  function clearFilters() { setSearch(''); setDebouncedSearch(''); setGenre(''); setSortOrder('title-asc'); setPage(1); }
  function scrollToTop()  { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">

        {/* Header with toggle */}
        <div className="curated-page-header">
          <h1 className="curated-page-title">Books</h1>
          <div className="curated-view-toggle">
            <button className={`curated-toggle-btn ${view === 'curated' ? 'active' : ''}`} onClick={() => setView('curated')} type="button">✦ Discover</button>
            <button className={`curated-toggle-btn ${view === 'browse' ? 'active' : ''}`} onClick={() => setView('browse')} type="button">☰ Browse All</button>
          </div>
        </div>

        {/* Curated view */}
        {view === 'curated' && (
          <CuratedBooksView
            onBookClick={openBookDetails}
            onSeeAll={(row) => {
              const url = row.seeAll || '';
              const params = new URLSearchParams(url.split('?')[1] || '');
              setView('browse');
            }}
          />
        )}

        {/* Browse view */}
        {view === 'browse' && (
          <>
            <section className="surface-panel">
              <div className="surface-panel-header">
                <div>
                  <h2>Filter the Shelf</h2>
                  <p className="surface-panel-copy">Search by title or author, narrow by genre, and sort the shelf.</p>
                  {usingFallbackCatalog && <p className="surface-panel-copy">Showing the bundled book catalog snapshot.</p>}
                </div>
                <p className="surface-panel-meta">{loading ? 'Loading books...' : `${totalBooks.toLocaleString()} book${totalBooks === 1 ? '' : 's'}`}</p>
              </div>
              <div className="filter-bar">
                <input className="search-input" type="text" aria-label="Search books" placeholder="Search books..." value={search} onChange={e => setSearch(e.target.value)} />
                <select className="filter-input" aria-label="Genre" value={genre} onChange={e => setGenre(e.target.value)}>
                  <option value="">All Genres</option>
                  {facets.genres.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select className="filter-input" aria-label="Sort by" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                  <option value="title-asc">Title A-Z</option>
                  <option value="year-desc">Newest First</option>
                  <option value="year-asc">Oldest First</option>
                </select>
                {hasActiveFilters && <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>Clear</button>}
              </div>
            </section>

            <section className="surface-panel surface-panel-spacious books-results-panel">
              {loading ? (
                <div className="loading-state">Loading...</div>
              ) : books.length === 0 ? (
                <div className="empty-state"><p>No books found.</p><p className="empty-hint">Try a different search or clear the filters.</p></div>
              ) : (
                <>
                  <div className="book-library-grid">
                    {books.map(book => (
                      <button key={book.id} type="button" className="book-shelf-card" onClick={() => openBookDetails(book)} aria-label={`Open details for ${book.title}`}>
                        <div className="book-shelf-cover-frame">
                          <BookCoverImage book={book} imageClassName="book-shelf-cover-image" placeholderClassName="book-shelf-cover-placeholder" />
                        </div>
                        <div className="book-shelf-copy"><h3>{book.title}</h3><p>{book.author}</p></div>
                      </button>
                    ))}
                  </div>
                  <div className="books-infinite-footer">
                    {loading && page > 1 && <p className="books-pagination-copy">Loading more books...</p>}
                    {!loading && page >= totalPages && <p className="books-pagination-copy">You have reached the end of the shelf.</p>}
                    {page < totalPages && <div ref={loadMoreRef} className="books-load-trigger" aria-hidden="true" />}
                  </div>
                </>
              )}
            </section>
          </>
        )}
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
          allowActions={!usingFallbackCatalog}
          browseOnlyMessage="Fallback catalog mode is browse-only."
        />
      )}

      {showScrollTop && (
        <button type="button" className="books-scroll-top" onClick={scrollToTop} aria-label="Back to top">
          <span aria-hidden="true">↑</span>
        </button>
      )}
    </div>
  );
}

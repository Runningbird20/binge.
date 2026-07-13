import { useEffect, useState } from 'react';
import StarRating from './StarRating';
import { computeStarRating, buildUniformCategories } from './RatingArtifact';

const ARCHIVE_DOWNLOAD_EXTENSIONS = {
  pdf:  ['.pdf'],
  epub: ['.epub'],
  txt:  ['.txt', '.text'],
};

export default function MobileBookDetail({
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
  onReadNow,
}) {
  const [draftStars, setDraftStars]   = useState(0);
  const [isSaving, setIsSaving]       = useState(false);
  const [tab, setTab]                 = useState('info');
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    setDraftStars(computeStarRating('book', userRating) || 0);
  }, [userRating, book]);

  useEffect(() => {
    if (!book) return undefined;
    function handleKeyDown(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [book, onClose]);

  if (!book) return null;

  const rawId   = book?.source_key?.startsWith('internet-archive:')
    ? book.source_key.replace('internet-archive:', '')
    : null;
  const isOl    = rawId?.startsWith('ol-') || rawId?.startsWith('ol/') || rawId?.startsWith('ol ');
  const archiveId = rawId && !isOl ? rawId : null;
  const canRead   = Boolean(book?.title);

  const imageUrl   = book.cover_url || book.cover || book.image_url || '';
  const avgRating  = book.avg_rating ? Number(book.avg_rating).toFixed(1) : null;

  async function handleStarChange(nextValue) {
    if (!allowActions || typeof onRate !== 'function' || isSaving) return;
    setDraftStars(nextValue);
    setIsSaving(true);
    try { await onRate(book, buildUniformCategories('book', nextValue)); }
    finally { setIsSaving(false); }
  }

  async function handleDownload(format) {
    if (!archiveId) return;
    setDownloading(format);
    setDownloadError('');
    try {
      const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(archiveId)}`);
      if (!res.ok) throw new Error('Unable to look up download files.');
      const meta = await res.json();
      const exts = ARCHIVE_DOWNLOAD_EXTENSIONS[format] || [];
      const file = (meta.files || []).find((f) => {
        const n = String(f?.name || '').toLowerCase();
        return exts.some((e) => n.endsWith(e));
      });
      if (!file?.name) throw new Error(`No ${format.toUpperCase()} available for this title.`);
      const a = document.createElement('a');
      a.href = `https://archive.org/download/${encodeURIComponent(archiveId)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
      a.download = file.name;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setDownloadError(err.message || 'Download failed.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="mob-detail-overlay" role="dialog" aria-modal="true" aria-label={book.title}>

      {/* Hero */}
      <div className="mob-detail-hero">
        {imageUrl
          ? <img src={imageUrl} alt={book.title} className="mob-detail-hero-img" referrerPolicy="no-referrer" />
          : (
            <div className="mob-detail-hero-placeholder">
              <span>{book.title?.charAt(0)}</span>
            </div>
          )
        }
        <div className="mob-detail-hero-grad" />
        <button type="button" className="mob-detail-back" onClick={onClose} aria-label="Go back">
          ← Back
        </button>
      </div>

      {/* Scrollable content */}
      <div className="mob-detail-scroll">

        {/* Title area */}
        <div className="mob-detail-head">
          <h1 className="mob-detail-title">{book.title}</h1>
          {book.author && <p className="mob-detail-subtitle">by {book.author}</p>}
          <div className="mob-detail-chips">
            {book.year  && <span className="mob-detail-chip">{book.year}</span>}
            {book.genre && <span className="mob-detail-chip">{book.genre}</span>}
          </div>
          <div className="mob-detail-scores">
            {avgRating && (
              <span className="mob-detail-community">★ {avgRating}/10
                {book.rating_count && <span className="mob-detail-count"> ({book.rating_count})</span>}
              </span>
            )}
            {draftStars > 0 && (
              <StarRating value={draftStars} readOnly size="sm" />
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="mob-detail-tabs">
          <button
            type="button"
            className={`mob-detail-tab${tab === 'info' ? ' mob-detail-tab--active' : ''}`}
            onClick={() => setTab('info')}
          >
            Info
          </button>
          <button
            type="button"
            className={`mob-detail-tab${tab === 'rate' ? ' mob-detail-tab--active' : ''}`}
            onClick={() => setTab('rate')}
          >
            Rate
          </button>
        </div>

        {/* Info tab */}
        {tab === 'info' && (
          <div className="mob-detail-tab-content">
            {book.synopsis && <p className="mob-detail-overview">{book.synopsis}</p>}

            <div className="mob-detail-facts">
              {book.author && (
                <div className="mob-detail-fact">
                  <span className="mob-detail-fact-label">Author</span>
                  <span>{book.author}</span>
                </div>
              )}
              {book.genre && (
                <div className="mob-detail-fact">
                  <span className="mob-detail-fact-label">Genre</span>
                  <span>{book.genre}</span>
                </div>
              )}
              {book.year && (
                <div className="mob-detail-fact">
                  <span className="mob-detail-fact-label">Published</span>
                  <span>{book.year}</span>
                </div>
              )}
            </div>

            {archiveId && (
              <div className="mob-book-download-row">
                <p className="mob-book-download-label">Download</p>
                <div className="mob-book-download-btns">
                  {['pdf', 'epub', 'txt'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="mob-book-download-btn"
                      onClick={() => handleDownload(fmt)}
                      disabled={downloading !== null}
                    >
                      {downloading === fmt ? '…' : fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
                {downloadError && <p className="mob-book-download-error">{downloadError}</p>}
              </div>
            )}

            {!allowActions && browseOnlyMessage && (
              <p className="mob-detail-notice">{browseOnlyMessage}</p>
            )}
            {detailMessage && <p className="mob-detail-notice">{detailMessage}</p>}
          </div>
        )}

        {/* Rate tab */}
        {tab === 'rate' && (
          <div className="mob-detail-tab-content">
            <div className="mob-detail-star-row">
              <StarRating
                value={draftStars}
                onChange={allowActions ? handleStarChange : undefined}
                readOnly={!allowActions}
                size="lg"
              />
            </div>
            {isSaving && <p className="mob-detail-rate-hint">Saving…</p>}
            {!allowActions && (
              <p className="mob-detail-rate-hint">Browse only — sign in to rate.</p>
            )}
          </div>
        )}

        <div className="mob-detail-bar-spacer" />
      </div>

      {/* Sticky bottom bar */}
      <div className="mob-detail-bar">
        {allowActions && (
          <button
            type="button"
            className="mob-detail-bar-btn mob-detail-bar-btn--secondary"
            onClick={() => onAddToLibrary(book)}
            disabled={isInLibrary || isAddingToLibrary}
          >
            {isInLibrary ? '✓ Library' : isAddingToLibrary ? 'Adding…' : '+ Library'}
          </button>
        )}
        {canRead && (
          <button
            type="button"
            className="mob-detail-bar-btn mob-detail-bar-btn--watch"
            onClick={onReadNow}
          >
            📖 Read Now
          </button>
        )}
      </div>
    </div>
  );
}

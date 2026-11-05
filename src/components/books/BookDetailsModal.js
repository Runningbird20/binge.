import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, DownloadSimple, Plus, X } from '@phosphor-icons/react';
import RateReviewPanel from '../RateReviewPanel';
import useSwipeDismiss from '../../hooks/useSwipeDismiss';
import useDeviceType from '../../hooks/useDeviceType';
import BookReader from '../BookReader';
import { findReadableEdition, isFreeToRead } from '../../utils/bookAccess';
import { posterSrc } from '../../utils/imageQuality';
import { getCoverUrl, BookCoverImage } from './BookCover';
import { Adaptations } from './Adaptations';
import { fetchBooksByAuthor, fetchSimilarBooks, BookShelfSection } from './BookShelfSection';

const ARCHIVE_DOWNLOAD_EXTENSIONS = {
  pdf: ['.pdf'],
  epub: ['.epub'],
  txt: ['.txt', '.text'],
};

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
}) {
  const [showReader, setShowReader] = useState(false);
  const bookOverlayRef = useRef(null);
  const bookSheetRef = useRef(null);
  const { isMobile: isPhone } = useDeviceType();
  useSwipeDismiss({ enabled: isPhone && Boolean(book) && !showReader, scrollRef: bookOverlayRef, sheetRef: bookSheetRef, onDismiss: onClose });
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  const rawId = book?.source_key?.startsWith('internet-archive:')
    ? book.source_key.replace('internet-archive:', '')
    : null;
  const isOlRecord = rawId?.startsWith('ol-') || rawId?.startsWith('ol/') || rawId?.startsWith('ol ');
  const archiveId = rawId && !isOlRecord ? rawId : null;
  // How (and whether) this book can be read, shown before anyone clicks.
  const [access, setAccess] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    if (book) findReadableEdition(book).then((result) => { if (!cancelled) setAccess(result); }).catch(() => {});
    return () => { cancelled = true; };
  }, [book]);

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

  async function handleRatingSave(categories) {
    if (typeof onRate !== 'function') return;
    await onRate(book, categories);
  }

  const cover = posterSrc(getCoverUrl(book));
  const genres = String(book.genre || '').split(',').map((genre) => genre.trim()).filter(Boolean);
  const synopsis = book.synopsis && book.synopsis !== 'No description available yet.' ? book.synopsis : '';

  return (
    <>
      <div className="td-overlay" onClick={onClose} ref={bookOverlayRef}>
        <div
          ref={bookSheetRef}
          className="td-modal td-modal--book"
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-detail-title"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="td-close td-round-btn" onClick={onClose} aria-label="Close book details">
            <X size={20} weight="bold" />
          </button>

          <header className="td-book-hero">
            {cover && <img className="td-book-hero-bg" src={cover} alt="" aria-hidden="true" referrerPolicy="no-referrer" />}
            <div className="td-book-hero-scrim" aria-hidden="true" />
            <div className="td-book-cover">
              <BookCoverImage book={book} imageClassName="" placeholderClassName="st-card-placeholder" priority />
            </div>
            <div className="td-book-head">
              <h2 id="book-detail-title" className="td-title">{book.title}</h2>
              {book.author && <p className="td-book-author">by {book.author}</p>}
              {access && (
                <p className={`td-availability td-availability--${isFreeToRead(access) ? 'free' : access.kind}`}>
                  {isFreeToRead(access) ? `Free to read · ${access.label}`
                    : access.kind === 'preview' ? 'Preview available · Google Books'
                    : access.kind === 'borrow' ? 'Free to borrow · Internet Archive'
                    : 'Not free to read online'}
                </p>
              )}
              <div className="td-meta">
                {book.year && <span>{book.year}</span>}
                {genres.slice(0, 3).map((genre) => <span key={genre} className="td-cert">{genre}</span>)}
              </div>
              <div className="td-actions">
                <button
                  type="button"
                  className={`st-btn ${access && !access.embedUrl && access.kind !== 'borrow' ? 'st-btn--secondary' : 'st-btn--primary'} td-play`}
                  onClick={() => setShowReader(true)}
                >
                  <BookOpen size={20} weight="fill" />
                  {!access ? 'Read'
                    : access.kind === 'preview' ? (access.full ? 'Read free' : 'Read preview')
                    : access.embedUrl ? 'Read free'
                    : access.kind === 'borrow' ? 'Borrow free'
                    : 'Find at your library'}
                </button>
                {allowActions && (
                  <button
                    type="button"
                    className={`st-btn ${isInLibrary ? 'st-btn--ghost' : 'st-btn--secondary'}`}
                    onClick={() => onAddToLibrary(book)}
                    disabled={isInLibrary || isAddingToLibrary}
                  >
                    {isInLibrary ? <Check size={18} weight="bold" /> : <Plus size={18} weight="bold" />}
                    {isInLibrary ? 'In Your Library' : isAddingToLibrary ? 'Adding...' : 'Add to Library'}
                  </button>
                )}
              </div>
            </div>
          </header>

          <div className="td-body">
            <div className="td-main">
              {synopsis ? <p className="td-overview">{synopsis}</p> : <p className="td-muted">No synopsis yet.</p>}
              {archiveId && (
                <div className="td-downloads">
                  <span className="td-muted">Download</span>
                  {['pdf', 'epub', 'txt'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="st-btn st-btn--ghost"
                      onClick={() => handleDownload(fmt)}
                      disabled={downloading !== null}
                    >
                      <DownloadSimple size={16} weight="bold" /> {downloading === fmt ? '…' : fmt.toUpperCase()}
                    </button>
                  ))}
                  {downloadError && <p className="book-download-error">{downloadError}</p>}
                </div>
              )}
            </div>
            {/* The facts, then your rating right under them (as on movies). */}
            <div className="td-aside">
              <dl className="td-facts">
                {book.author && (<><dt>Author</dt><dd>{book.author}</dd></>)}
                <dt>Genre</dt><dd>{genres.join(', ') || 'General Fiction'}</dd>
                {book.year && (<><dt>Published</dt><dd>{book.year}</dd></>)}
              </dl>
              <section className="td-section td-rate td-rate--aside" aria-label="Your rating">
                <div className="td-section-head"><h3>Your Rating &amp; Review</h3></div>
                <RateReviewPanel
                  mediaType="book"
                  value={userRating}
                  onSave={handleRatingSave}
                  allowActions={allowActions}
                  size="lg"
                />
                {detailMessage && <p className="td-status-msg" role="status">{detailMessage}</p>}
              </section>
            </div>
          </div>

          {book.author && <BookShelfSection title={`More by ${book.author}`} load={() => fetchBooksByAuthor(book)} />}
          <BookShelfSection title="Readers Also Enjoyed" load={() => fetchSimilarBooks(book)} />

          <Adaptations book={book} />

        </div>
      </div>

      {showReader && <BookReader book={book} onClose={() => setShowReader(false)} />}
    </>
  );
}

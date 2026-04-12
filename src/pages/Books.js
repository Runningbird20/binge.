import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ListSaveControls from '../components/ListSaveControls';
import RatingInput from '../components/RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from '../components/RatingArtifact';
import { api } from '../api';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlist,
  saveSupabaseRating,
} from '../utils/supabaseData';
import { hasLegacyBackendSession } from '../utils/legacyBackend';
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
  const canRead = Boolean(archiveId || itemUrl);

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
      const url = `/api/media/book-download?identifier=${encodeURIComponent(archiveId)}&format=${format}`;
      const token = window.localStorage.getItem('token');
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Download failed');
      }

      const disposition = res.headers.get('content-disposition') || '';
      const nameMatch = disposition.match(/filename=\"?([^\"]+)\"?/);
      const filename = nameMatch ? nameMatch[1] : `${book.title.replace(/[^a-z0-9]/gi, '_')}.${format}`;

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setDownloadError(err.message || 'Download failed. This book may not be available.');
    } finally {
      setDownloading(null);
    }
  }

  const cats = RATING_CATEGORIES.book;
  const canSave = cats.every((cat) => draftScores[cat.key] >= 1);
  const displayScore = computeNormalizedScore('book', draftScores);
  const canUseLegacyBackend = hasLegacyBackendSession();

  async function handleSave() {
    if (!allowActions || typeof onRate !== 'function' || !canSave || isSaving) return;

    setIsSaving(true);
    try {
      await onRate(book, draftScores);
    } finally {
      setIsSaving(false);
    }
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
              {allowActions && canUseLegacyBackend && (
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
  const modalRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

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

  const embedUrl = archiveId
    ? `https://archive.org/embed/${archiveId}`
    : itemUrl || null;

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
            <button
              className="player-close"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '<' : '>'}
            </button>
            <button className="player-close" onClick={onClose} title="Close">X</button>
          </div>
        </div>
        <div className="player-frame-wrap">
          <iframe
            ref={iframeRef}
            src={embedUrl || ''}
            className="player-frame"
            allowFullScreen
            allow="fullscreen"
            title={`Read ${book.title}`}
            style={{ minHeight: '600px' }}
          />
        </div>
        <p className="player-note">
          Powered by Internet Archive. Some books may require borrowing.
        </p>
      </div>
    </div>
  );
}

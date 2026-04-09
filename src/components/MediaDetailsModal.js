import { useEffect, useState } from 'react';
import EmbedPlayer from './EmbedPlayer';
import ListSaveControls from './ListSaveControls';
import RatingInput from './RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from './RatingArtifact';

function getImageUrl(item) {
  return item.poster_url || item.cover_url || item.image_url || '';
}

function getCreatorLabel(item) {
  if (item.director) return 'Director';
  if (item.creator) return 'Creator';
  if (item.author) return 'Author';
  return 'Created by';
}

function getRuntimeLabel(item) {
  if (item.seasons != null) return 'Seasons';
  if (item.runtime != null) return 'Runtime';
  return 'Details';
}

function allCategoriesFilled(mediaType, scores) {
  const cats = RATING_CATEGORIES[mediaType] || [];
  return cats.every((cat) => scores[cat.key] >= 1);
}

export default function MediaDetailsModal({
  item,
  mediaType,
  onClose,
  onRate,
  onWatchlist,
  userRating,
  isAddingWatchlist,
  detailMessage,
  allowActions = true,
  browseOnlyMessage = '',
}) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [draftScores, setDraftScores] = useState({});
  const [draftReview, setDraftReview] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (userRating && typeof userRating === 'object') {
      setDraftScores(userRating);
      setDraftReview(userRating.review || '');
    } else {
      setDraftScores({});
      setDraftReview('');
    }
  }, [userRating, item]);

  useEffect(() => {
    if (!item) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [item, onClose]);

  if (!item) return null;

  const imageUrl = getImageUrl(item);
  const subtitle = item.director || item.creator || item.author || item.studio || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const typeLabel = mediaType === 'movie' ? 'Movie Details' : mediaType === 'tv_show' ? 'TV Show Details' : 'Book Details';
  const canSave = allCategoriesFilled(mediaType, draftScores);
  const displayScore = computeNormalizedScore(mediaType, draftScores);
  const canWatch = mediaType === 'movie' || mediaType === 'tv_show';

  async function handleSave() {
    if (!allowActions || typeof onRate !== 'function' || !canSave || isSaving) return;
    setIsSaving(true);
    try {
      await onRate(item, draftScores, draftReview);
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
          aria-labelledby="media-detail-title"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="book-detail-close"
            onClick={onClose}
            aria-label="Close details"
          >
            &times;
          </button>

          <div className="book-detail-cover-panel">
            <div className="book-detail-cover-frame">
              {imageUrl ? (
                <img src={imageUrl} alt={item.title} className="book-detail-cover-image" />
              ) : (
                <div className="book-detail-cover-placeholder">
                  <span>{item.title?.charAt(0)}</span>
                </div>
              )}
            </div>

            <div className="artifact-panel">
              <RatingArtifact mediaType={mediaType} scores={draftScores} size={220} />
              {displayScore !== null && (
                <p className="artifact-score">{displayScore}<span>/10</span></p>
              )}
            </div>
          </div>

          <div className="book-detail-content">
            <p className="book-detail-kicker">{typeLabel}</p>
            <h2 id="media-detail-title">{item.title}</h2>
            {subtitle && <p className="book-detail-author">{subtitle}</p>}

            <div className="book-detail-meta">
              {item.genre && <span className="book-detail-meta-chip">{item.genre}</span>}
              {item.year && <span className="book-detail-meta-chip">{item.year}</span>}
              {item.runtime && <span className="book-detail-meta-chip">{item.runtime} min</span>}
              {item.seasons != null && (
                <span className="book-detail-meta-chip">{item.seasons} season{item.seasons === 1 ? '' : 's'}</span>
              )}
            </div>

            {(item.overview || item.synopsis) && (
              <p className="book-detail-description">{item.overview || item.synopsis}</p>
            )}

            <div className="book-detail-summary">
              <div className="book-detail-summary-row">
                <span className="book-detail-summary-label">{getCreatorLabel(item)}</span>
                <span>{subtitle || 'Unknown'}</span>
              </div>
              {item.genre && (
                <div className="book-detail-summary-row">
                  <span className="book-detail-summary-label">Genre</span>
                  <span>{item.genre}</span>
                </div>
              )}
              {(item.seasons != null || item.runtime != null) && (
                <div className="book-detail-summary-row">
                  <span className="book-detail-summary-label">{getRuntimeLabel(item)}</span>
                  <span>
                    {item.seasons != null
                      ? `${item.seasons} season${item.seasons === 1 ? '' : 's'}`
                      : `${item.runtime} min`}
                  </span>
                </div>
              )}
              {avgRating && (
                <div className="book-detail-summary-row">
                  <span className="book-detail-summary-label">Community Score</span>
                  <span>{avgRating} / 10 ({item.rating_count} rating{item.rating_count === 1 ? '' : 's'})</span>
                </div>
              )}
            </div>

            <div className="rating-section">
              <p className="rating-section-title">Your Rating</p>
              <RatingInput
                mediaType={mediaType}
                value={draftScores}
                onChange={allowActions ? setDraftScores : () => {}}
              />
              <textarea
                className="review-textarea"
                placeholder="Write a review (optional)..."
                value={draftReview}
                onChange={(event) => setDraftReview(event.target.value)}
                rows={3}
                maxLength={2000}
                disabled={!allowActions}
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
              {onWatchlist && (
                <button
                  type="button"
                  className="btn-primary book-detail-library-btn"
                  onClick={() => onWatchlist(item)}
                  disabled={!allowActions || isAddingWatchlist}
                >
                  {isAddingWatchlist ? 'Saving...' : 'Add to Watchlist'}
                </button>
              )}
              {allowActions && (
                <ListSaveControls mediaType={mediaType} mediaId={item.id} itemTitle={item.title} />
              )}
              {!allowActions && browseOnlyMessage && (
                <p className="book-detail-status">{browseOnlyMessage}</p>
              )}
              {detailMessage && <p className="book-detail-status">{detailMessage}</p>}
              {canWatch && (
                <button
                  type="button"
                  className="btn-watch"
                  onClick={() => setShowPlayer(true)}
                >
                  {'\u25B6'} Watch Now
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPlayer && canWatch && (
        <EmbedPlayer
          item={item}
          mediaType={mediaType}
          onClose={() => setShowPlayer(false)}
        />
      )}
    </>
  );
}

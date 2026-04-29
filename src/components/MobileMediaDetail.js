import { useEffect, useState } from 'react';
import EmbedPlayer from './EmbedPlayer';
import ListSaveControls from './ListSaveControls';
import RatingInput from './RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from './RatingArtifact';

function getImageUrl(item) {
  const raw = item.poster_url || item.cover_url || item.image_url || '';
  if (!raw) return '';
  try {
    if (raw.includes('plex.tv')) {
      const inner = new URL(raw).searchParams.get('url');
      if (inner) return inner;
    }
  } catch { /* fall through */ }
  return raw;
}

function getCreatorLabel(item) {
  if (item.director) return 'Director';
  if (item.creator) return 'Creator';
  if (item.author) return 'Author';
  return 'Created by';
}

function allCategoriesFilled(mediaType, scores) {
  const cats = RATING_CATEGORIES[mediaType] || [];
  return cats.every((cat) => scores[cat.key] >= 1);
}

export default function MobileMediaDetail({
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
    function handleKeyDown(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [item, onClose]);

  if (!item) return null;

  const imageUrl = getImageUrl(item);
  const subtitle = item.director || item.creator || item.author || item.studio || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const canWatch = mediaType === 'movie' || mediaType === 'tv_show';
  const canSave = allCategoriesFilled(mediaType, draftScores);
  const displayScore = computeNormalizedScore(mediaType, draftScores);
  const hasUserRating = userRating && typeof userRating === 'object' && Object.keys(userRating).length > 0;

  const runtimeLine = item.seasons != null
    ? `${item.seasons} season${item.seasons === 1 ? '' : 's'}`
    : item.runtime != null ? `${item.runtime} min` : null;

  async function handleSave() {
    if (!allowActions || typeof onRate !== 'function' || !canSave || isSaving) return;
    setIsSaving(true);
    try { await onRate(item, draftScores, draftReview); }
    finally { setIsSaving(false); }
  }

  return (
    <>
      <div className="mob-detail-overlay" role="dialog" aria-modal="true" aria-label={item.title}>

        {/* ── Hero ── */}
        <div className="mob-detail-hero">
          {imageUrl
            ? <img src={imageUrl} alt={item.title} className="mob-detail-hero-img" referrerPolicy="no-referrer" />
            : <div className="mob-detail-hero-placeholder"><span>{item.title?.charAt(0)}</span></div>
          }
          <div className="mob-detail-hero-grad" />
          <button type="button" className="mob-detail-back" onClick={onClose} aria-label="Go back">
            ‹
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="mob-detail-scroll">

          {/* Title + meta */}
          <div className="mob-detail-head">
            <h1 className="mob-detail-title">{item.title}</h1>
            {subtitle && <p className="mob-detail-subtitle">{subtitle}</p>}

            <div className="mob-detail-chips">
              {item.year && <span className="mob-detail-chip">{item.year}</span>}
              {item.genre && item.genre.split(',').slice(0, 2).map(g => (
                <span key={g} className="mob-detail-chip">{g.trim()}</span>
              ))}
              {runtimeLine && <span className="mob-detail-chip">{runtimeLine}</span>}
            </div>

            {avgRating && (
              <div className="mob-detail-community-row">
                <span className="mob-detail-star">★</span>
                <span className="mob-detail-avg">{avgRating}</span>
                <span className="mob-detail-avg-label">/10</span>
                {item.rating_count > 0 && (
                  <span className="mob-detail-count">({item.rating_count} ratings)</span>
                )}
                {hasUserRating && displayScore !== null && (
                  <span className="mob-detail-your-pill">You: {displayScore}</span>
                )}
              </div>
            )}
          </div>

          {/* ── Primary action buttons ── */}
          <div className="mob-detail-actions">
            {canWatch && (
              <button
                type="button"
                className="mob-detail-action-watch"
                onClick={() => setShowPlayer(true)}
              >
                ▶ Watch Now
              </button>
            )}
            {onWatchlist && (
              <button
                type="button"
                className="mob-detail-action-library"
                onClick={() => onWatchlist(item)}
                disabled={!allowActions || isAddingWatchlist}
              >
                {isAddingWatchlist ? '…' : '+ Library'}
              </button>
            )}
          </div>

          {/* ── Synopsis ── */}
          {(item.overview || item.synopsis) && (
            <p className="mob-detail-overview">{item.overview || item.synopsis}</p>
          )}

          {/* ── Facts ── */}
          <div className="mob-detail-facts">
            {subtitle && (
              <div className="mob-detail-fact">
                <span className="mob-detail-fact-label">{getCreatorLabel(item)}</span>
                <span className="mob-detail-fact-value">{subtitle}</span>
              </div>
            )}
            {item.genre && (
              <div className="mob-detail-fact">
                <span className="mob-detail-fact-label">Genre</span>
                <span className="mob-detail-fact-value">{item.genre}</span>
              </div>
            )}
            {runtimeLine && (
              <div className="mob-detail-fact">
                <span className="mob-detail-fact-label">{item.seasons != null ? 'Seasons' : 'Runtime'}</span>
                <span className="mob-detail-fact-value">{runtimeLine}</span>
              </div>
            )}
            {item.age_rating && (
              <div className="mob-detail-fact">
                <span className="mob-detail-fact-label">Rating</span>
                <span className="mob-detail-fact-value">{item.age_rating}</span>
              </div>
            )}
          </div>

          {/* ── Save to list ── */}
          {allowActions && (
            <div className="mob-detail-list-section">
              <ListSaveControls mediaType={mediaType} mediaId={item.id} itemTitle={item.title} />
            </div>
          )}

          {/* ── Notices ── */}
          {!allowActions && browseOnlyMessage && (
            <p className="mob-detail-notice">{browseOnlyMessage}</p>
          )}
          {detailMessage && <p className="mob-detail-notice">{detailMessage}</p>}

          {/* ── Rate this section ── */}
          <div className="mob-detail-rate-section">
            <h2 className="mob-detail-rate-heading">
              {hasUserRating ? 'Your Rating' : 'Rate This'}
            </h2>

            {/* Spider chart + score badge side by side */}
            <div className="mob-detail-artifact-row">
              <RatingArtifact mediaType={mediaType} scores={draftScores} size={110} />
              {displayScore !== null && (
                <div className="mob-detail-artifact-score">
                  <span className="mob-detail-artifact-num">{displayScore}</span>
                  <span className="mob-detail-artifact-denom">/10</span>
                </div>
              )}
            </div>

            <RatingInput
              mediaType={mediaType}
              value={draftScores}
              onChange={allowActions ? setDraftScores : () => {}}
            />

            <textarea
              className="mob-detail-review-textarea"
              placeholder="Write a review (optional)…"
              value={draftReview}
              onChange={(e) => setDraftReview(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={!allowActions}
            />

            <button
              type="button"
              className={`mob-detail-save-btn${allowActions && canSave ? '' : ' btn-disabled'}`}
              onClick={handleSave}
              disabled={!allowActions || !canSave || isSaving}
            >
              {!allowActions
                ? 'Browse Only'
                : isSaving ? 'Saving…'
                : hasUserRating ? 'Update Rating'
                : 'Save Rating'}
            </button>

            {allowActions && !canSave && (
              <p className="mob-detail-rate-hint">Rate all categories to save</p>
            )}
          </div>

          {/* Bottom safe-area spacer */}
          <div className="mob-detail-bottom-spacer" />
        </div>
      </div>

      {showPlayer && canWatch && (
        <EmbedPlayer item={item} mediaType={mediaType} onClose={() => setShowPlayer(false)} />
      )}
    </>
  );
}

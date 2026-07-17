import { useEffect, useState } from 'react';
import EmbedPlayer from './EmbedPlayer';
import RateReviewPanel from './RateReviewPanel';
import WatchlistStatusControl from './WatchlistStatusControl';
import useDeviceType from '../hooks/useDeviceType';
import MobileMediaDetail from './MobileMediaDetail';
import { computeProgressBadge } from '../utils/continueWatching';

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

function getRuntimeLabel(item) {
  if (item.seasons != null) return 'Seasons';
  if (item.runtime != null) return 'Runtime';
  return 'Details';
}

export default function MediaDetailsModal({
  item,
  mediaType,
  onClose,
  onRate,
  onWatchlist,
  watchlistEntry,
  onStatusChange,
  userRating,
  isAddingWatchlist,
  detailMessage,
  allowActions = true,
  browseOnlyMessage = '',
  autoPlay = false,
  initialSeason,
  initialEpisode,
}) {
  const { isMobile } = useDeviceType();
  const [showPlayer, setShowPlayer] = useState(Boolean(autoPlay));
  const progressBadge = computeProgressBadge({ ...watchlistEntry, media_type: mediaType });
  const resumeSeason = initialSeason ?? watchlistEntry?.current_season ?? undefined;
  const resumeEpisode = initialEpisode ?? watchlistEntry?.current_episode ?? undefined;

  useEffect(() => {
    setShowPlayer(Boolean(autoPlay));
  }, [autoPlay, item?.id]);

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

  if (isMobile) {
    return (
      <MobileMediaDetail
        item={item}
        mediaType={mediaType}
        onClose={onClose}
        onRate={onRate}
        onWatchlist={onWatchlist}
        watchlistEntry={watchlistEntry}
        onStatusChange={onStatusChange}
        userRating={userRating}
        isAddingWatchlist={isAddingWatchlist}
        detailMessage={detailMessage}
        allowActions={allowActions}
        browseOnlyMessage={browseOnlyMessage}
        autoPlay={autoPlay}
        initialSeason={initialSeason}
        initialEpisode={initialEpisode}
      />
    );
  }

  const imageUrl = getImageUrl(item);
  const subtitle = item.director || item.creator || item.author || item.studio || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const typeLabel = mediaType === 'movie' ? 'Movie Details' : mediaType === 'tv_show' ? 'TV Show Details' : 'Book Details';
  const canWatch = mediaType === 'movie' || mediaType === 'tv_show';

  async function handleRatingSave(categories, review) {
    if (typeof onRate !== 'function') return;
    await onRate(item, categories, review);
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
                <img src={imageUrl} alt={item.title} className="book-detail-cover-image" referrerPolicy="no-referrer" />
              ) : (
                <div className="book-detail-cover-placeholder">
                  <span>{item.title?.charAt(0)}</span>
                </div>
              )}
            </div>

            {canWatch && (
              <button
                type="button"
                className="btn-watch book-detail-watch-now"
                onClick={() => setShowPlayer(true)}
              >
                {'\u25B6'} {progressBadge ? `Resume ${progressBadge}` : 'Watch Now'}
              </button>
            )}
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
              <RateReviewPanel
                mediaType={mediaType}
                value={userRating}
                onSave={handleRatingSave}
                allowActions={allowActions}
                size="lg"
                actions={onWatchlist && (
                  watchlistEntry?.status ? (
                    <WatchlistStatusControl
                      className="book-detail-status-control"
                      mediaType={mediaType}
                      status={watchlistEntry.status}
                      adding={isAddingWatchlist}
                      onAdd={() => onWatchlist(item)}
                      onChange={(nextStatus) => onStatusChange?.(item, watchlistEntry, nextStatus)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="btn-primary book-detail-library-btn"
                      onClick={() => onWatchlist(item)}
                      disabled={!allowActions || isAddingWatchlist}
                    >
                      {isAddingWatchlist ? 'Saving...' : 'Add to Library'}
                    </button>
                  )
                )}
              />
              {!allowActions && browseOnlyMessage && (
                <p className="book-detail-status">{browseOnlyMessage}</p>
              )}
              {detailMessage && <p className="book-detail-status">{detailMessage}</p>}
            </div>
          </div>
        </div>
      </div>

      {showPlayer && canWatch && (
        <EmbedPlayer
          item={item}
          mediaType={mediaType}
          onClose={() => setShowPlayer(false)}
          initialSeason={resumeSeason}
          initialEpisode={resumeEpisode}
        />
      )}
    </>
  );
}

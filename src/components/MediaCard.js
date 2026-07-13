import RatingArtifact, { computeNormalizedScore } from './RatingArtifact';
import { useToast } from '../contexts/ToastContext';
import useIsMobile from '../hooks/useIsMobile';
import MobileMediaCard from './MobileMediaCard';

function resolvePosterUrl(url) {
  if (!url) return null;

  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) {
        try {
          return decodeURIComponent(inner);
        } catch {
          return inner;
        }
      }
    }
  } catch {
    return url;
  }

  return url;
}

async function shareItem(item) {
  const text = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const url = window.location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'binge.', text: `Check out ${text} on binge!`, url });
      return 'shared';
    } catch {
      return null;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} — ${url}`);
    return 'copied';
  } catch {
    return null;
  }
}

export default function MediaCard({
  item,
  mediaType,
  userRating,
  onWatchlist,
  onOpenDetails,
  showDescription = true,
}) {
  const isMobile = useIsMobile();
  const toast = useToast();

  if (isMobile) {
    return (
      <MobileMediaCard
        item={item}
        mediaType={mediaType}
        userRating={userRating}
        onWatchlist={onWatchlist}
        onOpenDetails={onOpenDetails}
      />
    );
  }
  const imageUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.image_url);
  const subtitle = item.director || item.creator || item.author || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const description = showDescription ? (item.synopsis || item.overview || '') : '';
  const userScore = computeNormalizedScore(mediaType, userRating);
  const rtScore = mediaType === 'movie' && Number.isFinite(Number(item.rotten_tomatoes_score))
    ? Number(item.rotten_tomatoes_score)
    : null;

  return (
    <div
      className={`media-card-full${onOpenDetails ? ' media-card-clickable' : ''}`}
      onClick={() => onOpenDetails?.(item)}
      role={onOpenDetails ? 'button' : undefined}
      tabIndex={onOpenDetails ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onOpenDetails) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails(item);
        }
      }}
    >
      <div className="media-card-poster">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="media-card-placeholder-img">
            <span>{item.title?.charAt(0)}</span>
          </div>
        )}
        {userRating && (
          <div className="media-card-artifact-badge">
            <RatingArtifact mediaType={mediaType} scores={userRating} size={90} />
          </div>
        )}
      </div>

      <div className="media-card-body">
        <h3 className="media-card-title">{item.title}</h3>

        <div className="media-card-meta">
          {item.year && <span>{item.year}</span>}
          {subtitle && <span>{subtitle}</span>}
          {item.genre && <span className="media-card-genre">{item.genre}</span>}
        </div>

        <div className="media-card-scores">
          {userScore !== null && (
            <span className="media-card-user-score">Your score: {userScore}/10</span>
          )}
          {avgRating && (
            <span className="media-card-avg">
              Community: {avgRating}/10
              <span className="rating-count"> ({item.rating_count})</span>
            </span>
          )}
          {rtScore !== null && (
            <span className="media-card-rt">RT: {rtScore}%</span>
          )}
        </div>

        {description && (
          <p className="media-card-synopsis">{description}</p>
        )}

        <div className="media-card-actions">
          <button
            className="btn-ghost btn-sm"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetails?.(item);
            }}
          >
            {userRating ? 'Edit Rating' : 'Rate'}
          </button>
          {onWatchlist && (
            <button
              className="btn-ghost btn-sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onWatchlist(item);
              }}
            >
              Save
            </button>
          )}
          <button
            className="btn-share"
            type="button"
            title="Share"
            onClick={async (e) => {
              e.stopPropagation();
              const result = await shareItem(item);
              if (result === 'copied') toast('Link copied to clipboard', 'info');
            }}
          >
            ↗
          </button>
        </div>
      </div>
    </div>
  );
}

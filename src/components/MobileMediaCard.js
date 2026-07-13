import StarRating from './StarRating';
import { computeStarRating } from './RatingArtifact';
import { useToast } from '../contexts/ToastContext';

function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch { /* fall through */ }
  return url;
}

async function shareItem(item) {
  const text = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const url = window.location.href;
  if (navigator.share) {
    try { await navigator.share({ title: 'binge.', text: `Check out ${text} on binge!`, url }); return 'shared'; }
    catch { return null; }
  }
  try { await navigator.clipboard.writeText(`${text} — ${url}`); return 'copied'; }
  catch { return null; }
}

export default function MobileMediaCard({
  item,
  mediaType,
  userRating,
  onWatchlist,
  onOpenDetails,
}) {
  const toast = useToast();
  const imageUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.image_url);
  const subtitle = item.director || item.creator || item.author || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const userStars = computeStarRating(mediaType, userRating);
  const canWatch = mediaType === 'movie' || mediaType === 'tv_show';

  return (
    <div
      className="mob-card"
      onClick={() => onOpenDetails?.(item)}
      role={onOpenDetails ? 'button' : undefined}
      tabIndex={onOpenDetails ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onOpenDetails) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails(item); }
      }}
    >
      {/* Thumbnail */}
      <div className="mob-card-thumb">
        {imageUrl ? (
          <img src={imageUrl} alt={item.title} referrerPolicy="no-referrer" loading="lazy" decoding="async" />
        ) : (
          <div className="mob-card-thumb-placeholder">
            <span>{item.title?.charAt(0)}</span>
          </div>
        )}
        {userStars !== null && (
          <div className="mob-card-badge">★ {userStars}</div>
        )}
      </div>

      {/* Body */}
      <div className="mob-card-body">
        <h3 className="mob-card-title">{item.title}</h3>

        <div className="mob-card-meta">
          {item.year && <span>{item.year}</span>}
          {item.genre && <span className="mob-card-genre">{item.genre}</span>}
          {subtitle && <span className="mob-card-creator">{subtitle}</span>}
        </div>

        <div className="mob-card-scores">
          {userStars !== null && (
            <span className="mob-card-user-score">
              You: <StarRating value={userStars} readOnly size="sm" />
            </span>
          )}
          {avgRating && (
            <span className="mob-card-avg-score">★ {avgRating}</span>
          )}
        </div>

        {/* Actions */}
        <div className="mob-card-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="mob-card-action-btn"
            onClick={() => onOpenDetails?.(item)}
          >
            {userRating ? 'Edit Rating' : 'Rate'}
          </button>
          {onWatchlist && (
            <button
              type="button"
              className="mob-card-action-btn"
              onClick={() => onWatchlist(item)}
            >
              + Library
            </button>
          )}
          {canWatch && (
            <button
              type="button"
              className="mob-card-action-btn mob-card-action-btn--watch"
              onClick={() => onOpenDetails?.(item)}
            >
              ▶ Watch
            </button>
          )}
          <button
            type="button"
            className="mob-card-action-btn mob-card-action-btn--icon"
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

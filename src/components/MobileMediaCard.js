import { computeNormalizedScore } from './RatingArtifact';

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

export default function MobileMediaCard({
  item,
  mediaType,
  userRating,
  onOpenDetails,
}) {
  const imageUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.image_url);
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const userScore = computeNormalizedScore(mediaType, userRating);

  return (
    <div
      className="mob-poster-card"
      onClick={() => onOpenDetails?.(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails?.(item); }
      }}
      aria-label={`${item.title}${item.year ? ` (${item.year})` : ''}`}
    >
      <div className="mob-poster-img-wrap">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="mob-poster-placeholder">
            <span>{item.title?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}

        {/* Gradient overlay at bottom */}
        <div className="mob-poster-grad" />

        {/* Rating badges */}
        {avgRating && (
          <span className="mob-poster-rating">★ {avgRating}</span>
        )}
        {userScore !== null && (
          <span className="mob-poster-user-badge">{userScore}</span>
        )}
      </div>

      <div className="mob-poster-info">
        <span className="mob-poster-title">{item.title}</span>
        {item.year && <span className="mob-poster-year">{item.year}</span>}
      </div>
    </div>
  );
}

import RatingArtifact, { computeNormalizedScore } from './RatingArtifact';

export default function MediaCard({
  item,
  mediaType,
  userRating,
  onWatchlist,
  onOpenDetails,
}) {
  const imageUrl   = item.poster_url || item.cover_url || item.image_url;
  const subtitle   = item.director || item.creator || item.author || '';
  const avgRating  = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const description = item.synopsis || item.overview || '';
  const userScore  = computeNormalizedScore(mediaType, userRating);

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
          <img src={imageUrl} alt={item.title} />
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
          {item.year    && <span>{item.year}</span>}
          {subtitle     && <span>{subtitle}</span>}
          {item.genre   && <span className="media-card-genre">{item.genre}</span>}
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
        </div>
      </div>
    </div>
  );
}

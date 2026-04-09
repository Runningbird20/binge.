import StarRating from './StarRating';

export default function MediaCard({ item, mediaType, userRating, onRate, onWatchlist, onOpenDetails }) {
  const imageUrl = item.poster_url || item.cover_url || item.image_url;
  const subtitle = item.director || item.creator || item.author || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const description = item.synopsis || item.overview || '';

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
      </div>
      <div className="media-card-body">
        <h3 className="media-card-title">{item.title}</h3>
        <div className="media-card-meta">
          {item.year && <span>{item.year}</span>}
          {subtitle && <span>{subtitle}</span>}
          {item.genre && <span className="media-card-genre">{item.genre}</span>}
        </div>
        {avgRating && (
          <div className="media-card-avg">
            <span className="star-gold">★</span> {avgRating}
            <span className="rating-count"> ({item.rating_count})</span>
          </div>
        )}
        {description && (
          <p className="media-card-synopsis">{description}</p>
        )}
        <div className="media-card-actions">
          <StarRating value={userRating} onChange={(r) => onRate && onRate(item, r)} />
          {onWatchlist && (
            <button
              className="btn-ghost btn-sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onWatchlist(item);
              }}
            >
              + Watchlist
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

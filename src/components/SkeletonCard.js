export function SkeletonCard() {
  return (
    <div className="media-card-full skeleton-card" aria-hidden="true">
      <div className="media-card-poster skeleton-block" />
      <div className="media-card-body">
        <div className="skeleton-line skeleton-block" style={{ width: '85%', height: '0.85rem' }} />
        <div className="skeleton-line skeleton-block" style={{ width: '55%', height: '0.7rem', marginTop: '0.4rem' }} />
        <div className="skeleton-line skeleton-block" style={{ width: '40%', height: '0.65rem', marginTop: '0.3rem' }} />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 18 }) {
  return (
    <div className="media-grid" aria-busy="true" aria-label="Loading…">
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

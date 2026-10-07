// Shared with Home.js's StreamHero — same backdrop/scrim/poster treatment,
// just featuring the top catalog pick instead of a continue-watching item.
// Gives the Movies/TV Netflix-rows landing view a visual anchor instead of
// dropping straight from a plain title into rows.
function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) {
        try { return decodeURIComponent(inner); } catch { return inner; }
      }
    }
  } catch {
    return url;
  }
  return url;
}

export default function CatalogHero({ kicker, item, onViewDetails, onBrowseAll, browseAllLabel = 'Browse all' }) {
  if (!item) return null;

  const poster = resolvePosterUrl(item.poster_url || item.cover_url);
  const genre = item.genre ? item.genre.split(',')[0].trim() : '';

  return (
    <section className="stream-hero">
      {poster && (
        <div
          className="stream-hero-backdrop"
          style={{ backgroundImage: `url(${poster})` }}
          aria-hidden="true"
        />
      )}
      <div className="stream-hero-scrim" aria-hidden="true" />
      <div className="stream-hero-content">
        <p className="stream-hero-kicker">{kicker}</p>
        <h1 className="stream-hero-title">{item.title}</h1>
        <div className="stream-hero-meta">
          {genre && <span className="stream-hero-chip">{genre}</span>}
          {item.year && <span>{item.year}</span>}
          {item.vote_average > 0 && (
            <>
              <span className="stream-hero-dot">•</span>
              <span>★ {Number(item.vote_average).toFixed(1)}</span>
            </>
          )}
        </div>
        <div className="stream-hero-actions">
          <button type="button" className="btn-primary" onClick={() => onViewDetails(item)}>
            View Details
          </button>
          <button type="button" className="btn-secondary" onClick={onBrowseAll}>
            {browseAllLabel}
          </button>
        </div>
      </div>
      {poster && <img src={poster} alt="" className="stream-hero-poster" aria-hidden="true" />}
    </section>
  );
}

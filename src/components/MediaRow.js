import { useRef, useState, useEffect, useCallback } from 'react';

function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) { try { return decodeURIComponent(inner); } catch { return inner; } }
    }
  } catch { /* fall through */ }
  return url;
}

function PosterCard({ item, onClick }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError]   = useState(false);
  const posterUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.posterUrl || item.coverUrl);
  const title = item.title || item.name || '';
  const year  = item.year ? String(item.year).slice(0, 4) : '';

  return (
    <button className="mr-card" onClick={() => onClick(item)} title={title} type="button">
      <div className="mr-poster">
        {posterUrl && !imgError ? (
          <>
            {!imgLoaded && <div className="mr-skeleton" />}
            <img
              src={posterUrl}
              alt={title}
              referrerPolicy="no-referrer"
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              style={{ opacity: imgLoaded ? 1 : 0 }}
            />
          </>
        ) : (
          <div className="mr-placeholder">
            <span>{title.charAt(0)}</span>
          </div>
        )}
        <div className="mr-overlay">
          <div className="mr-play">▶</div>
        </div>
        <div className="mr-shine" />
      </div>
      <div className="mr-info">
        <p className="mr-title">{title}</p>
        {year && <p className="mr-year">{year}</p>}
      </div>
    </button>
  );
}

export default function MediaRow({ row, mediaType, onItemClick, onSeeAll }) {
  const scrollRef = useRef(null);
  const [canLeft,  setCanLeft]  = useState(false);
  const [canRight, setCanRight] = useState(true);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [row.items, checkScroll]);

  function scroll(dir) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.78, behavior: 'smooth' });
  }

  if (!row.items || row.items.length === 0) return null;

  return (
    <section className="mr-section">
      <div className="mr-header">
        <h2 className="mr-heading">{row.title}</h2>
        {(row.seeAll || onSeeAll) && (
          <button
            className="mr-see-all"
            onClick={() => onSeeAll ? onSeeAll(row) : null}
            type="button"
          >
            See all <span className="mr-see-all-arrow">→</span>
          </button>
        )}
      </div>

      <div className="mr-track-wrap">
        <button
          className={`mr-arrow mr-arrow-left ${canLeft ? 'visible' : ''}`}
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
          type="button"
        >‹</button>

        <div className="mr-track" ref={scrollRef}>
          {row.items.map((item, i) => (
            <div key={item.id} className="mr-card-wrap" style={{ animationDelay: `${i * 0.03}s` }}>
              <PosterCard item={item} mediaType={mediaType} onClick={onItemClick} />
            </div>
          ))}
        </div>

        <button
          className={`mr-arrow mr-arrow-right ${canRight ? 'visible' : ''}`}
          onClick={() => scroll(1)}
          aria-label="Scroll right"
          type="button"
        >›</button>

        {/* Fade edges */}
        {canLeft  && <div className="mr-fade mr-fade-left"  />}
        {canRight && <div className="mr-fade mr-fade-right" />}
      </div>
    </section>
  );
}

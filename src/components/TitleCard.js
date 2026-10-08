import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Play } from '@phosphor-icons/react';
import { formatReleaseDay } from '../utils/releaseWindow';
import { languageName } from '../utils/tmdb';
import { posterSrc, posterSrcSet } from '../utils/imageQuality';
import HoverPreview from './HoverPreview';
import { canAutoplayPreviews } from '../utils/trailers';

const PREVIEW_DELAY_MS = 900;
// Only one floating preview at a time across every row.
let closeOpenPreview = null;

export function titleUrl(item, { play = false } = {}) {
  const id = item.media_id ?? item.id;
  const base = item.media_type === 'tv_show' ? `/tv-show/${id}` : item.media_type === 'book' ? `/book/${id}` : `/movie/${id}`;
  return play ? `${base}?play=1` : base;
}

function primaryGenre(item) {
  return String(item.genre || '').split(',')[0].trim();
}

// Poster card used by every browse row. Links into the existing details
// overlay (background-location routing) so opening a title never loses the
// row you were browsing. `rank` renders the Top-10 numeral variant.
export default function TitleCard({ item, priority = false, rank = null, showMatch = true, to = null, playNow = false }) {
  const location = useLocation();
  const [imgError, setImgError] = useState(false);
  const rawPoster = item.poster_url || item.cover_url || item.image_url || item.posterUrl;
  const poster = posterSrc(rawPoster);
  const posterSet = posterSrcSet(rawPoster);
  const year = item.year || (item.release_date ? String(item.release_date).slice(0, 4) : '');
  const genre = primaryGenre(item);
  const language = item.original_language && item.original_language !== 'en' ? languageName(item.original_language) : '';
  const comingSoon = Boolean(item._comingSoon);

  // Hover preview (desktop pointers only).
  const cardRef = useRef(null);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);
  const [previewRect, setPreviewRect] = useState(null);
  const previewable = item.media_type === 'movie' || item.media_type === 'tv_show';

  function closePreview() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    setPreviewRect(null);
  }
  function scheduleOpen() {
    if (!previewable || !canAutoplayPreviews()) return;
    clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => {
      const rect = cardRef.current?.querySelector('.st-card-poster')?.getBoundingClientRect();
      if (!rect) return;
      if (closeOpenPreview && closeOpenPreview !== closePreview) closeOpenPreview();
      closeOpenPreview = closePreview;
      setPreviewRect(rect);
    }, PREVIEW_DELAY_MS);
  }
  function scheduleClose() {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setPreviewRect(null), 160);
  }
  useEffect(() => {
    if (!previewRect) return undefined;
    const onScroll = () => closePreview();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [previewRect]);
  useEffect(() => () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); }, []);

  return (
    <>
    <Link
      ref={cardRef}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      to={to || titleUrl(item)}
      state={{ backgroundLocation: location }}
      className={`st-card${rank ? ' st-card--ranked' : ''}`}
      title={item._reason || item.title}
      aria-label={`${playNow ? 'Play ' : ''}${item.title}${year ? ` (${year})` : ''}${item._subtitle && playNow ? `, ${item._subtitle}` : ''}${comingSoon ? ', coming soon' : ''}`}
    >
      {rank && <span className="st-card-rank" aria-hidden="true">{rank}</span>}
      <div className="st-card-poster">
        {poster && !imgError ? (
          <img
            src={poster}
            srcSet={posterSet}
            sizes="(max-width: 768px) 34vw, 200px"
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="st-card-placeholder"><span>{item.title?.charAt(0)}</span></div>
        )}
        {item._badge && <span className="st-badge st-badge--new">{item._badge}</span>}
        {comingSoon ? (
          <span className="st-badge st-badge--soon">Coming {formatReleaseDay(item) || 'Soon'}</span>
        ) : item._progressLabel ? (
          <span className="st-badge">{item._progressLabel}</span>
        ) : null}
        {playNow && <span className="st-card-playnow" aria-hidden="true"><Play size={22} weight="fill" /></span>}
        <div className="st-card-hover" aria-hidden="true">
          {!comingSoon && <span className="st-card-play"><Play size={18} weight="fill" /></span>}
          <div className="st-card-hover-meta">
            {showMatch && item._match && <span className="st-match">{item._match}% match</span>}
            {year && <span>{year}</span>}
            {genre && <span>{genre}</span>}
            {language && <span>{language}</span>}
          </div>
          {item._reason && <p className="st-card-reason">{item._reason}</p>}
        </div>
        {item._progress != null && (
          <div className="st-card-progress" aria-hidden="true"><span style={{ width: `${Math.round(item._progress * 100)}%` }} /></div>
        )}
      </div>
      <p className="st-card-title">{item.title}</p>
      {item._subtitle ? <p className="st-card-sub">{item._subtitle}</p> : item.author && <p className="st-card-sub">{item.author}</p>}
    </Link>
    {previewRect && (
      <HoverPreview
        item={item}
        anchorRect={previewRect}
        playTo={to ? to : titleUrl(item, { play: true })}
        infoTo={titleUrl(item)}
        linkState={{ backgroundLocation: location }}
        onEnter={() => clearTimeout(closeTimer.current)}
        onLeave={scheduleClose}
      />
    )}
    </>
  );
}

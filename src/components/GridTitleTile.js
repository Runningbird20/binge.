import { useState } from 'react';
import { Play } from '@phosphor-icons/react';
import WatchlistStatusControl from './WatchlistStatusControl';
import { posterSrc, posterSrcSet } from '../utils/imageQuality';
import { isComingSoon, formatReleaseDay } from '../utils/releaseWindow';
import { languageName } from '../utils/tmdb';

// "Browse all" grid tile: the same card language as the browse rows
// (TitleCard), as a button that opens the page's details modal, plus the
// quick My List control in the corner.
export default function GridTitleTile({
  item,
  mediaType,
  onClick,
  watchlistEntry,
  addingWatchlist,
  onAddWatchlist,
  onStatusChange,
  priority = false,
  subtitle = null,
  badge = null,
}) {
  const [imgError, setImgError] = useState(false);
  const raw = item.poster_url || item.cover_url || item.image_url;
  const comingSoon = isComingSoon(item);
  const year = item.year || String(item.release_date || '').slice(0, 4);
  const genre = String(item.genre || '').split(',')[0].trim();
  const language = item.original_language && item.original_language !== 'en' ? languageName(item.original_language) : '';
  const score = Number(item.vote_average) || 0;

  return (
    <div className="st-grid-cell">
      <button
        type="button"
        className="st-card st-card--button"
        onClick={() => onClick(item)}
        aria-label={`Open details for ${item.title}${year ? ` (${year})` : ''}`}
      >
        <div className="st-card-poster">
          {raw && !imgError ? (
            <img
              src={posterSrc(raw)}
              srcSet={posterSrcSet(raw)}
              sizes="(max-width: 768px) 46vw, 210px"
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
          {comingSoon && <span className="st-badge st-badge--soon">Coming {formatReleaseDay(item) || 'Soon'}</span>}
          {!comingSoon && badge && <span className="st-badge st-badge--free">{badge}</span>}
          <div className="st-card-hover" aria-hidden="true">
            {!comingSoon && mediaType !== 'book' && <span className="st-card-play"><Play size={18} weight="fill" /></span>}
            <div className="st-card-hover-meta">
              {score > 0 && <span className="td-score">★ {score.toFixed(1)}</span>}
              {year && <span>{year}</span>}
              {genre && <span>{genre}</span>}
              {language && <span>{language}</span>}
            </div>
          </div>
        </div>
        <p className="st-card-title">{item.title}</p>
        <p className="st-card-sub">{subtitle ?? [year, genre].filter(Boolean).join(' · ')}</p>
      </button>

      {onAddWatchlist && (
        <div className="st-grid-status" onClick={(event) => event.stopPropagation()}>
          <WatchlistStatusControl
            mediaType={mediaType}
            status={watchlistEntry?.status}
            adding={addingWatchlist}
            onAdd={() => onAddWatchlist(item)}
            onChange={(nextStatus) => onStatusChange(item, watchlistEntry, nextStatus)}
          />
        </div>
      )}
    </div>
  );
}

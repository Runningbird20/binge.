import { useState } from 'react';

const ORIGIN_LABELS = { ko: 'Manhwa', zh: 'Manhua', 'zh-hk': 'Manhua', ja: 'Manga', en: 'Comic' };

export function MangaRowCard({ manga, onOpen, rank = null, priority = false }) {
  const [imgError, setImgError] = useState(false);
  const origin = ORIGIN_LABELS[manga.originalLanguage];
  const progress = manga._progressLabel;
  return (
    <button
      type="button"
      className={`st-card st-card--button${rank ? ' st-card--ranked' : ''}`}
      onClick={() => onOpen(manga)}
      aria-label={`${manga.title}${origin ? `, ${origin}` : ''}`}
    >
      {rank && <span className="st-card-rank" aria-hidden="true">{rank}</span>}
      <div className="st-card-poster">
        {manga.cover && !imgError ? (
          <img src={manga.cover} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setImgError(true)} />
        ) : (
          <div className="st-card-placeholder"><span>{manga.title?.charAt(0)}</span></div>
        )}
        {progress ? <span className="st-badge">{progress}</span> : origin && <span className="st-badge st-badge--origin">{origin}</span>}
        <div className="st-card-hover" aria-hidden="true">
          <div className="st-card-hover-meta">
            {manga.status && <span style={{ textTransform: 'capitalize' }}>{manga.status}</span>}
            {manga.latestChapter && <span>Ch. {manga.latestChapter}</span>}
            {(manga.tags || []).slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          {manga.description && <p className="st-card-reason">{manga.description}</p>}
        </div>
      </div>
      <p className="st-card-title">{manga.title}</p>
      {manga.author && <p className="st-card-sub">{manga.author}</p>}
    </button>
  );
}

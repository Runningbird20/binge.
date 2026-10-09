import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Info, Play, SpeakerHigh, SpeakerSlash, Star } from '@phosphor-icons/react';
import { getTrailerKey, setTrailerMuted, trailerEmbedUrl, whenTrailerPlaying } from '../utils/trailers';
import { backdropSrc, posterSrc } from '../utils/imageQuality';
import { languageName } from '../utils/tmdb';

// Netflix-style expanded preview that floats over a hovered card: muted
// trailer (when TMDB has one), key facts, Play / More Info. Rendered in a
// portal so the rows' horizontal clipping doesn't cut it off.
export default function HoverPreview({ item, anchorRect, playTo, infoTo, linkState, onEnter, onLeave }) {
  const [trailerKey, setTrailerKey] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const frameRef = useRef(null);
  const stopWaitingRef = useRef(null);

  useEffect(() => () => stopWaitingRef.current?.(), []);

  useEffect(() => {
    let cancelled = false;
    getTrailerKey(item).then((key) => { if (!cancelled) setTrailerKey(key); }).catch(() => {});
    return () => { cancelled = true; };
  }, [item]);

  const width = Math.min(Math.max(anchorRect.width * 1.6, 320), 420);
  const left = Math.min(Math.max(8, anchorRect.left + anchorRect.width / 2 - width / 2), window.innerWidth - width - 8);
  const top = Math.max(8, anchorRect.top - 24);
  const year = item.year || String(item.release_date || '').slice(0, 4);
  const genres = String(item.genre || '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 3);
  const language = item.original_language && item.original_language !== 'en' ? languageName(item.original_language) : '';
  const art = backdropSrc(item.backdrop_url, 'w780') || posterSrc(item.poster_url || item.cover_url);

  return createPortal(
    <div
      className="st-preview"
      style={{ left, top, width }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role="dialog"
      aria-label={`${item.title} preview`}
    >
      <div className="st-preview-media">
        {art && <img src={art} alt="" className={`st-preview-art${videoReady ? ' hidden' : ''}`} referrerPolicy="no-referrer" />}
        {trailerKey && (
          <iframe
            ref={frameRef}
            className={`st-preview-video${videoReady ? ' ready' : ''}`}
            src={trailerEmbedUrl(trailerKey, { start: 4 })}
            title={`${item.title} trailer`}
            allow="autoplay; encrypted-media"
            onLoad={() => {
              stopWaitingRef.current?.();
              stopWaitingRef.current = whenTrailerPlaying(frameRef.current, () => setVideoReady(true));
            }}
            tabIndex={-1}
          />
        )}
        {trailerKey && videoReady && (
          <button
            type="button"
            className="st-preview-mute"
            onClick={() => { setTrailerMuted(frameRef.current, !muted); setMuted(!muted); }}
            aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
          >
            {muted ? <SpeakerSlash size={16} weight="bold" /> : <SpeakerHigh size={16} weight="bold" />}
          </button>
        )}
      </div>
      <div className="st-preview-body">
        <div className="st-preview-actions">
          {!item._comingSoon && (
            <Link to={playTo} state={linkState} className="st-preview-play" aria-label={`Play ${item.title}`}>
              <Play size={18} weight="fill" />
            </Link>
          )}
          <Link to={infoTo} state={linkState} className="st-preview-icon" aria-label={`More info about ${item.title}`}>
            <Info size={18} weight="bold" />
          </Link>
        </div>
        <p className="st-preview-title">{item.title}</p>
        <div className="st-preview-meta">
          {item._match && <span className="st-match">{item._match}% match</span>}
          {year && <span>{year}</span>}
          {Number(item.vote_average) > 0 && <span><Star size={12} weight="fill" aria-hidden="true" /> {Number(item.vote_average).toFixed(1)}</span>}
          {language && <span className="st-chip">{language}</span>}
        </div>
        {genres.length > 0 && <p className="st-preview-genres">{genres.join(' · ')}</p>}
        {item._reason && <p className="st-preview-reason">{item._reason}</p>}
      </div>
    </div>,
    document.body
  );
}

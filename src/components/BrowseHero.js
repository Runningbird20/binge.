import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CaretLeft, CaretRight, Info, Play, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { titleUrl } from './TitleCard';
import ErrorBoundary from './ErrorBoundary';
import { languageName } from '../utils/tmdb';
import { backdropSrc, backdropSrcSet, posterSrc } from '../utils/imageQuality';
import { canAutoplayPreviews, getTrailerKey, setTrailerMuted, trailerEmbedUrl, whenTrailerPlaying } from '../utils/trailers';

const TRAILER_DELAY_MS = 2500;

const ROTATE_MS = 9000;

// "Atomic Habits: An Easy & Proven Way to…" / "Dune (Dune, #1)" -> the
// main title; the full title is still on the details page.
function displayTitle(title) {
  const text = String(title || '');
  if (text.length <= 34) return text;
  const main = text.split(/\s*[:(]\s*/)[0];
  return main.length >= 3 ? main : text;
}

function backdropOf(item) {
  return item.backdrop_url || item.poster_url || item.cover_url || item.image_url || null;
}

// Netflix-style spotlight: a full-bleed backdrop for the top few titles,
// rotating on a timer that pauses while hovered or focused, with explicit
// ‹ › buttons and dots so it's fully mouse- and keyboard-operable.
function BrowseHeroInner({ items = [], kicker, emptyTitle = 'What will you binge tonight?', playLabel = 'Play' }) {
  const location = useLocation();
  const slides = items.filter((item) => backdropOf(item)).slice(0, 6);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  // Billboard trailer: after a beat on a slide, fade the muted trailer in
  // over the backdrop and hold the carousel while it plays.
  const [trailer, setTrailer] = useState(null); // { key, slideKey, ready }
  const [trailerMuted, setTrailerMutedState] = useState(true);
  const trailerRef = useRef(null);
  const stopWaitingRef = useRef(null);

  useEffect(() => () => stopWaitingRef.current?.(), []);
  const activeSlide = slides[Math.min(index, Math.max(0, slides.length - 1))];
  const activeKey = activeSlide ? `${activeSlide.media_type}:${activeSlide.id}` : '';
  useEffect(() => {
    setTrailer(null);
    setTrailerMutedState(true);
    if (!activeSlide || !canAutoplayPreviews()) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      getTrailerKey(activeSlide).then((key) => {
        if (!cancelled && key) setTrailer({ key, slideKey: activeKey, ready: false });
      }).catch(() => {});
    }, TRAILER_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);
  const trailerPlaying = Boolean(trailer?.ready && trailer.slideKey === activeKey);

  useEffect(() => {
    if (paused || trailerPlaying || slides.length < 2) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, trailerPlaying, slides.length]);

  if (!slides.length) {
    return (
      <section className="st-hero st-hero--empty" aria-label="Featured titles">
        <div className="st-hero-scrim" aria-hidden="true" />
        <div className="st-hero-content">
          {kicker && <p className="st-hero-kicker">{kicker}</p>}
          <h1 className="st-hero-title">{emptyTitle}</h1>
        </div>
      </section>
    );
  }

  const item = slides[Math.min(index, slides.length - 1)];
  const year = item.year || (item.release_date ? String(item.release_date).slice(0, 4) : '');
  const genres = String(item.genre || '').split(',').map((genre) => genre.trim()).filter(Boolean).slice(0, 2);
  const language = item.original_language && item.original_language !== 'en' ? languageName(item.original_language) : '';
  const rawOverview = item.overview || item.synopsis || '';
  const overview = rawOverview === 'No description available yet.' ? '' : rawOverview;
  const go = (step) => setIndex((current) => (current + step + slides.length) % slides.length);

  return (
    <section
      className="st-hero"
      aria-roledescription="carousel"
      aria-label="Featured titles"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {slides.map((slide, slideIndex) => (
        <img
          key={`${slide.media_type}:${slide.id}`}
          className={`st-hero-backdrop${slideIndex === index ? ' active' : ''}${slide.backdrop_url ? '' : ' st-hero-backdrop--poster'}`}
          src={slide.backdrop_url ? backdropSrc(slide.backdrop_url, 'w1280') : posterSrc(backdropOf(slide))}
          srcSet={slide.backdrop_url ? backdropSrcSet(slide.backdrop_url) : undefined}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          loading={slideIndex === 0 ? 'eager' : 'lazy'}
          fetchPriority={slideIndex === 0 ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
        />
      ))}
      {trailer && trailer.slideKey === activeKey && (
        <div className={`st-hero-trailer${trailer.ready ? ' ready' : ''}`} aria-hidden="true">
          <iframe
            ref={trailerRef}
            src={trailerEmbedUrl(trailer.key, { start: 6 })}
            title={`${activeSlide?.title || 'Featured'} trailer`}
            tabIndex={-1}
            allow="autoplay; encrypted-media"
            onLoad={() => {
              stopWaitingRef.current?.();
              stopWaitingRef.current = whenTrailerPlaying(trailerRef.current, () => setTrailer((current) => (current ? { ...current, ready: true } : current)));
            }}
          />
        </div>
      )}
      <div className="st-hero-scrim" aria-hidden="true" />

      {!item.backdrop_url && backdropOf(item) && (
        <img className="st-hero-poster-card" src={posterSrc(backdropOf(item))} alt="" aria-hidden="true" referrerPolicy="no-referrer" />
      )}

      <div className="st-hero-content" aria-live="polite">
        {kicker && <p className="st-hero-kicker">{kicker}</p>}
        <h1 className="st-hero-title" title={item.title}>{displayTitle(item.title)}</h1>
        <div className="st-hero-meta">
          {item._match && <span className="st-match">{item._match}% match</span>}
          {year && <span>{year}</span>}
          {genres.map((genre) => <span key={genre} className="st-chip">{genre}</span>)}
          {language && <span className="st-chip">{language}</span>}
        </div>
        {item.author && <p className="st-hero-byline">by {item.author}</p>}
        {item._reason && <p className="st-hero-reason">{item._reason}</p>}
        {overview && <p className="st-hero-overview">{overview}</p>}
        <div className="st-hero-actions">
          {item._onOpen ? (
            // Items that open in-page (e.g. manga) instead of a route.
            <>
              <button type="button" className="st-btn st-btn--primary" onClick={() => item._onOpen(item)}>
                <Play size={18} weight="fill" /> {item._playLabel || playLabel}
              </button>
              <button type="button" className="st-btn st-btn--secondary" onClick={() => item._onOpen(item)}>
                <Info size={18} weight="bold" /> More Info
              </button>
            </>
          ) : (
            <>
              {item._comingSoon ? (
                <span className="st-badge st-badge--soon st-badge--lg">Coming soon</span>
              ) : (
                <Link className="st-btn st-btn--primary" to={item._playUrl || titleUrl(item, { play: true })} state={{ backgroundLocation: location }}>
                  <Play size={18} weight="fill" /> {item._playLabel || playLabel}
                </Link>
              )}
              <Link className="st-btn st-btn--secondary" to={titleUrl(item)} state={{ backgroundLocation: location }}>
                <Info size={18} weight="bold" /> More Info
              </Link>
            </>
          )}
        </div>
      </div>

      {trailerPlaying && (
        <button
          type="button"
          className="st-hero-mute"
          onClick={() => { setTrailerMuted(trailerRef.current, !trailerMuted); setTrailerMutedState(!trailerMuted); }}
          aria-label={trailerMuted ? 'Unmute trailer' : 'Mute trailer'}
        >
          {trailerMuted ? <SpeakerSlash size={18} weight="bold" /> : <SpeakerHigh size={18} weight="bold" />}
        </button>
      )}
      {slides.length > 1 && (
        <>
          <button type="button" className="st-hero-nav st-hero-nav--left" onClick={() => go(-1)} aria-label="Previous featured title">
            <CaretLeft size={26} weight="bold" />
          </button>
          <button type="button" className="st-hero-nav st-hero-nav--right" onClick={() => go(1)} aria-label="Next featured title">
            <CaretRight size={26} weight="bold" />
          </button>
          <div className="st-hero-dots" role="tablist" aria-label="Choose featured title">
            {slides.map((slide, slideIndex) => (
              <button
                key={`${slide.media_type}:${slide.id}`}
                type="button"
                role="tab"
                aria-selected={slideIndex === index}
                aria-label={slide.title}
                className={`st-hero-dot${slideIndex === index ? ' active' : ''}`}
                onClick={() => setIndex(slideIndex)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// A broken billboard (bad art data, a TMDB hiccup) just disappears; the
// rows below still render.
export default function BrowseHero(props) {
  return (
    <ErrorBoundary resetKey={props.items} fallback={null}>
      <BrowseHeroInner {...props} />
    </ErrorBoundary>
  );
}

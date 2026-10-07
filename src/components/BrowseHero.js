import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CaretLeft, CaretRight, Info, Play } from '@phosphor-icons/react';
import { titleUrl } from './TitleCard';
import { languageName } from '../utils/tmdb';

const ROTATE_MS = 9000;

function backdropOf(item) {
  return item.backdrop_url || item.poster_url || item.cover_url || item.image_url || null;
}

// Netflix-style spotlight: a full-bleed backdrop for the top few titles,
// rotating on a timer that pauses while hovered or focused, with explicit
// ‹ › buttons and dots so it's fully mouse- and keyboard-operable.
export default function BrowseHero({ items = [], kicker, emptyTitle = 'What will you binge tonight?' }) {
  const location = useLocation();
  const slides = items.filter((item) => backdropOf(item)).slice(0, 6);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (paused || slides.length < 2) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, slides.length]);

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
          className={`st-hero-backdrop${slideIndex === index ? ' active' : ''}`}
          src={backdropOf(slide)}
          alt=""
          aria-hidden="true"
          loading={slideIndex === 0 ? 'eager' : 'lazy'}
          fetchPriority={slideIndex === 0 ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
        />
      ))}
      <div className="st-hero-scrim" aria-hidden="true" />

      <div className="st-hero-content" aria-live="polite">
        {kicker && <p className="st-hero-kicker">{kicker}</p>}
        <h1 className="st-hero-title">{item.title}</h1>
        <div className="st-hero-meta">
          {item._match && <span className="st-match">{item._match}% match</span>}
          {year && <span>{year}</span>}
          {genres.map((genre) => <span key={genre} className="st-chip">{genre}</span>)}
          {language && <span className="st-chip">{language}</span>}
        </div>
        {item._reason && <p className="st-hero-reason">{item._reason}</p>}
        {item.overview && item.overview !== 'No description available yet.' && (
          <p className="st-hero-overview">{item.overview}</p>
        )}
        <div className="st-hero-actions">
          {item._comingSoon ? (
            <span className="st-badge st-badge--soon st-badge--lg">Coming soon</span>
          ) : (
            <Link className="st-btn st-btn--primary" to={item._playUrl || titleUrl(item, { play: true })} state={{ backgroundLocation: location }}>
              <Play size={18} weight="fill" /> {item._playLabel || 'Play'}
            </Link>
          )}
          <Link className="st-btn st-btn--secondary" to={titleUrl(item)} state={{ backgroundLocation: location }}>
            <Info size={18} weight="bold" /> More Info
          </Link>
        </div>
      </div>

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

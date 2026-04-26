import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { loadFallbackMovies, loadFallbackTvShows } from '../catalogFallback';
import { useAuth } from '../contexts/AuthContext';
import { getDefaultRouteForUserType } from '../utils/userAccess';

const CAROUSEL_MIN_YEAR = 2015;
const CAROUSEL_MAX_YEAR = 2024;
const MAX_CAROUSEL_ITEMS = 40;

function resolvePosterUrl(url) {
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function buildCarouselCatalog(items, mediaType) {
  return items
    .map((item) => ({
      id: `${mediaType}-${item.source_key || item.sourceKey || item.id || item.title}`,
      title: item.title,
      year: Number(item.year),
      poster_url: item.poster_url,
      media_type: mediaType,
    }))
    .filter((item) => (
      item.title
      && Number.isFinite(item.year)
      && item.year >= CAROUSEL_MIN_YEAR
      && item.year <= CAROUSEL_MAX_YEAR
      && resolvePosterUrl(item.poster_url)
    ));
}

function dedupeCarouselItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.media_type}:${item.title}:${item.year}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortCarouselItems(items) {
  return [...items].sort((left, right) => {
    if (left.year !== right.year) {
      return right.year - left.year;
    }

    return left.title.localeCompare(right.title);
  });
}

function limitCarouselItems(items) {
  return items.slice(0, MAX_CAROUSEL_ITEMS);
}

function preloadCarouselPosters(items) {
  if (typeof window === 'undefined' || typeof window.Image !== 'function') {
    return Promise.resolve();
  }

  return Promise.allSettled(
    items.map((item) => new Promise((resolve) => {
      const posterUrl = resolvePosterUrl(item.poster_url);
      if (!posterUrl) {
        resolve();
        return;
      }

      const image = new window.Image();
      image.decoding = 'async';
      image.loading = 'eager';
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = posterUrl;

      if (image.complete) {
        resolve();
      }
    }))
  ).then(() => undefined);
}

function HeroPosterCard({ movie }) {
  const [imageFailed, setImageFailed] = useState(false);
  const posterUrl = !imageFailed ? resolvePosterUrl(movie.poster_url) : null;

  return (
    <div className="media-card">
      {posterUrl ? (
        <img
          className="media-card-poster-image"
          src={posterUrl}
          alt={`${movie.title} poster`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="media-card-placeholder" aria-hidden="true">
          <span>{movie.title?.charAt(0) || 'B'}</span>
        </div>
      )}
      <div className="hero-media-caption">
        <span className="hero-media-title">{movie.title}</span>
        {movie.year ? <span className="hero-media-year">{movie.year}</span> : null}
      </div>
    </div>
  );
}

function LandingMovieCarousel({ items }) {
  const scrollingItems = [...items, ...items];

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="landing-carousel-section" aria-label="Featured poster carousel">
      <div className="landing-carousel-viewport">
        <div className="landing-carousel-track">
          {scrollingItems.map((movie, index) => (
            <div
              key={`carousel-${movie.id}-${index}`}
              className="landing-carousel-item"
              aria-hidden={index >= items.length ? 'true' : undefined}
            >
              <HeroPosterCard movie={movie} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const { isAuthenticated, authLoading, user } = useAuth();
  const [carouselItems, setCarouselItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCarouselItems() {
      try {
        const [moviesResult, tvShowsResult] = await Promise.allSettled([
          loadFallbackMovies(),
          loadFallbackTvShows(),
        ]);

        const movies = moviesResult.status === 'fulfilled' ? moviesResult.value : [];
        const tvShows = tvShowsResult.status === 'fulfilled' ? tvShowsResult.value : [];

        const nextItems = limitCarouselItems(
          sortCarouselItems(
            dedupeCarouselItems([
              ...buildCarouselCatalog(movies, 'movie'),
              ...buildCarouselCatalog(tvShows, 'tv_show'),
            ])
          )
        );

        if (!cancelled) {
          setCarouselItems(nextItems);
        }

        preloadCarouselPosters(nextItems).catch(() => {});
      } catch {
        if (!cancelled) {
          setCarouselItems([]);
        }
      }
    }

    loadCarouselItems();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!authLoading && isAuthenticated) {
    return <Navigate to={getDefaultRouteForUserType(user)} replace />;
  }

  return (
    <div className="App">
      <nav className="nav">
        <div className="nav-logo">binge.</div>
        <div className="nav-links">
          <Link to="/login">Log in</Link>
          <Link to="/signup" className="btn-primary">Sign Up</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <h1>Track everything you watch and read.</h1>
          <p className="hero-subtitle">
            Rate, review, and discover movies, TV shows, and books. See what your friends are into.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn-primary btn-medium">Get Started - It&apos;s Free</Link>
          </div>
          {authLoading && <p className="hero-subtitle">Restoring your session...</p>}
        </div>
      </section>

      <LandingMovieCarousel items={carouselItems} />

      <section className="features" id="features">
        <h2>Everything in one place</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-icon">★</div>
              <h3>Rate & Review</h3>
            </div>
            <p>Give star ratings and write reviews for movies, TV shows, and books all in one place.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-icon">◎</div>
              <h3>Track Your Progress</h3>
            </div>
            <p>Keep a watchlist, mark what you&apos;ve seen, and track books you&apos;re currently reading.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-icon">♦</div>
              <h3>Discover New Titles</h3>
            </div>
            <p>Get recommendations based on your taste and see what&apos;s trending in the community.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-header">
              <div className="feature-icon">◈</div>
              <h3>Follow Friends</h3>
            </div>
            <p>See your friends&apos; ratings and reviews. Find out what they loved - and what to skip.</p>
          </div>
        </div>
          <h3>Join thousands of people who never lose track of what they want to watch or read next.</h3>
          <div className="cta-buttons">
            <Link to="/signup" className="btn-primary btn-large">Create Free Account</Link>
            <Link to="/login" className="btn-secondary btn-large">Log In</Link>
          </div>
      </section>
    </div>
  );
}

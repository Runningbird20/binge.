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

      <LandingMovieCarousel items={carouselItems} />
    </div>
  );
}

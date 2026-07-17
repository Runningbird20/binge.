import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FilmSlate, MonitorPlay, BookOpen, MagnifyingGlass } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import { SkeletonGrid } from '../components/SkeletonCard';
import { api } from '../api';

const MEDIA_ICONS = { movie: FilmSlate, tv: MonitorPlay, book: BookOpen };

function MediaTypeIcon({ type, size = 16 }) {
  const Icon = MEDIA_ICONS[type];
  if (!Icon) return null;
  return <Icon size={size} weight="bold" aria-hidden="true" />;
}

function resultUrl(type, id) {
  if (type === 'movie') return `/movie/${id}`;
  if (type === 'tv') return `/tv-show/${id}`;
  return `/book/${id}`;
}

function ResultTile({ type, item }) {
  const location = useLocation();
  const poster = item.poster_url || item.cover_url;

  return (
    <Link
      to={resultUrl(type, item.id)}
      state={{ backgroundLocation: location }}
      className="poster-tile"
      title={item.title}
    >
      <div className="poster-tile-frame">
        {poster ? (
          <img src={poster} alt={item.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <div className="poster-tile-placeholder">
            <MediaTypeIcon type={type} size={28} />
          </div>
        )}
      </div>
      <p className="poster-tile-title">{item.title}</p>
      {(item.year || item.author) && (
        <p className="poster-tile-year">{type === 'book' ? (item.author || item.year) : item.year}</p>
      )}
    </Link>
  );
}

function ResultRow({ heading, items, loading }) {
  if (!loading && !items.length) return null;
  return (
    <section className="home-section">
      <div className="section-header">
        <h2>{heading}</h2>
      </div>
      {loading ? (
        <SkeletonGrid count={6} />
      ) : (
        <div className="poster-grid">
          {items.map((item) => (
            <ResultTile key={item.id} type={item._type} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

const TYPE_LABELS = { movie: 'Movies', tv: 'TV Shows', book: 'Books' };
const tagType = (list, type) => (list || []).map((item) => ({ ...item, _type: type }));

export default function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';

  // Primary (title match) and related (theme/synopsis match) are fetched as
  // two fully independent requests — related scans the overview/synopsis
  // text columns, which has no supporting index and can take several
  // seconds on this catalog size. Keeping them decoupled means the primary
  // results render immediately instead of waiting on the slow one.
  const [primaryState, setPrimaryState] = useState('idle');
  const [primary, setPrimary] = useState(null);
  const [relatedState, setRelatedState] = useState('idle');
  const [related, setRelated] = useState(null);

  useEffect(() => {
    if (!query.trim()) {
      setPrimary(null);
      setPrimaryState('idle');
      setRelated(null);
      setRelatedState('idle');
      return undefined;
    }

    let cancelled = false;

    setPrimaryState('loading');
    api.get(`/search?q=${encodeURIComponent(query)}&types=movies,tv,books`)
      .then((data) => {
        if (cancelled) return;
        setPrimary(data);
        setPrimaryState('done');
      })
      .catch(() => { if (!cancelled) setPrimaryState('error'); });

    setRelatedState('loading');
    api.get(`/search-related?q=${encodeURIComponent(query)}&types=movies,tv,books`)
      .then((data) => {
        if (cancelled) return;
        setRelated(data);
        setRelatedState('done');
      })
      .catch(() => { if (!cancelled) setRelatedState('error'); });

    return () => { cancelled = true; };
  }, [query]);

  const primaryMovies = tagType(primary?.movies, 'movie');
  const primaryTv = tagType(primary?.tv, 'tv');
  const primaryBooks = tagType(primary?.books, 'book');

  // Related rows exclude anything already shown in the matching primary row.
  const primaryMovieIds = new Set(primaryMovies.map((r) => r.id));
  const primaryTvIds = new Set(primaryTv.map((r) => r.id));
  const primaryBookIds = new Set(primaryBooks.map((r) => r.id));
  const relatedMovies = tagType(related?.moviesRelated, 'movie').filter((r) => !primaryMovieIds.has(r.id));
  const relatedTv = tagType(related?.tvRelated, 'tv').filter((r) => !primaryTvIds.has(r.id));
  const relatedBooks = tagType(related?.booksRelated, 'book').filter((r) => !primaryBookIds.has(r.id));

  const primaryTotal = primaryMovies.length + primaryTv.length + primaryBooks.length;
  const relatedTotal = relatedMovies.length + relatedTv.length + relatedBooks.length;
  const nothingFound = primaryState === 'done' && relatedState === 'done' && primaryTotal === 0 && relatedTotal === 0;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">
        <div className="catalog-header">
          <h1 className="catalog-title">
            {query ? `Results for "${query}"` : 'Search'}
          </h1>
        </div>

        {primaryState === 'loading' && <SkeletonGrid count={12} />}

        {primaryState === 'error' && (
          <div className="empty-state">
            <p>Something went wrong running that search.</p>
          </div>
        )}

        {nothingFound && (
          <div className="empty-state">
            <MagnifyingGlass size={28} weight="bold" aria-hidden="true" />
            <p>No results for "{query}".</p>
            <p className="empty-hint">Try a different search term.</p>
          </div>
        )}

        {primaryState === 'done' && (
          <div className="home-sections">
            <ResultRow heading={TYPE_LABELS.movie} items={primaryMovies} />
            <ResultRow heading={TYPE_LABELS.tv} items={primaryTv} />
            <ResultRow heading={TYPE_LABELS.book} items={primaryBooks} />

            {(relatedState === 'loading' || relatedMovies.length > 0) && (
              <ResultRow heading={`More movies like "${query}"`} items={relatedMovies} loading={relatedState === 'loading'} />
            )}
            {(relatedState === 'loading' || relatedTv.length > 0) && (
              <ResultRow heading={`More TV shows like "${query}"`} items={relatedTv} loading={relatedState === 'loading'} />
            )}
            {(relatedState === 'loading' || relatedBooks.length > 0) && (
              <ResultRow heading={`More books like "${query}"`} items={relatedBooks} loading={relatedState === 'loading'} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

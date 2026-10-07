import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FilmSlate, MonitorPlay, BookOpen, MagnifyingGlass } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import { SkeletonGrid } from '../components/SkeletonCard';
import { api } from '../api';
import TitleRow from '../components/TitleRow';
import TitleCard from '../components/TitleCard';
import { fetchTmdbRecommendations, tmdbIdFromItem } from '../utils/tmdb';
import { resolveTmdbItems } from '../utils/catalogLookup';

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

  // The single best video match drives a "More like X" row — searching
  // for a show you like should also answer "what else is like this?".
  const topMatch = [...primaryMovies, ...primaryTv]
    .filter((item) => tmdbIdFromItem(item))
    .sort((a, b) => (Number(b.relevance) || 0) - (Number(a.relevance) || 0))[0] || null;
  const topMatchType = topMatch?._type === 'tv' ? 'tv_show' : 'movie';
  const topMatchTmdbId = topMatch ? tmdbIdFromItem(topMatch) : null;
  const loadMoreLike = useCallback(async () => {
    if (!topMatchTmdbId) return [];
    const list = await fetchTmdbRecommendations(topMatchType, topMatchTmdbId);
    return resolveTmdbItems(list || [], topMatchType);
  }, [topMatchType, topMatchTmdbId]);

  // One best-first grid (movies + series by relevance), Netflix-style;
  // books get their own row below.
  const topResults = [...primaryMovies, ...primaryTv]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (Number(b.item.relevance) || 0) - (Number(a.item.relevance) || 0) || a.index - b.index)
    .map(({ item }) => ({ ...item, media_type: item._type === 'tv' ? 'tv_show' : 'movie' }));

  const primaryTotal = primaryMovies.length + primaryTv.length + primaryBooks.length;
  const relatedTotal = relatedMovies.length + relatedTv.length + relatedBooks.length;
  const nothingFound = primaryState === 'done' && relatedState === 'done' && primaryTotal === 0 && relatedTotal === 0;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <header className="st-page-head">
          <div>
            <p className="st-page-kicker">Search</p>
            <h1 className="st-page-title">{query ? `“${query}”` : 'Search'}</h1>
          </div>
        </header>

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
            {topResults.length > 0 && (
              <section className="st-search-section" aria-label="Top results">
                <h2 className="st-row-title">Top results</h2>
                <div className="st-grid">
                  {topResults.map((item, index) => (
                    <div className="st-grid-cell" key={`${item.media_type}:${item.id}`}>
                      <TitleCard item={item} priority={index < 6} showMatch={false} />
                      <p className="st-card-sub">{[item.year, item.media_type === 'tv_show' ? 'Series' : 'Movie'].filter(Boolean).join(' · ')}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {primaryBooks.length > 0 && (
              <TitleRow title={TYPE_LABELS.book} items={primaryBooks.map((book) => ({ ...book, media_type: 'book' }))} />
            )}

            {topMatch && (
              <TitleRow
                key={`${topMatchType}:${topMatchTmdbId}`}
                title={`More like ${topMatch.title}`}
                subtitle="Titles people who watched it went on to watch"
                load={loadMoreLike}
                minItems={3}
              />
            )}

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

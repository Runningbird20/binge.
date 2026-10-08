import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ClockCounterClockwise, FilmSlate, Info, MonitorPlay, BookOpen, MagnifyingGlass, Play, Trophy, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import { SkeletonGrid } from '../components/SkeletonCard';
import { api } from '../api';
import TitleRow from '../components/TitleRow';
import TitleCard from '../components/TitleCard';
import { fetchTmdbRecommendations, tmdbIdFromItem } from '../utils/tmdb';
import { resolveTmdbItems } from '../utils/catalogLookup';
import { titleUrl } from '../components/TitleCard';
import { backdropSrc, posterSrc } from '../utils/imageQuality';
import {
  addRecentSearch, clearRecentSearches, getRecentSearches, groupResults, isGameLive, removeRecentSearch, searchGames, searchPerson,
} from '../utils/searchExtras';

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
const KIND = { movie: 'Movie', tv_show: 'Series', book: 'Book' };

// The single best match, shown big with Play / Details.
function TopResult({ item }) {
  const location = useLocation();
  const art = item.media_type === 'book' ? null : backdropSrc(item.backdrop_url, 'w1280');
  const poster = posterSrc(item.poster_url || item.cover_url);
  return (
    <section className="sr-top" aria-label="Top result">
      <div className="sr-top-art" aria-hidden="true">
        {art ? <img src={art} alt="" referrerPolicy="no-referrer" /> : poster && <img src={poster} alt="" className="sr-top-blur" referrerPolicy="no-referrer" />}
      </div>
      <div className="sr-top-body">
        {poster && <img className="sr-top-poster" src={poster} alt="" referrerPolicy="no-referrer" />}
        <div className="sr-top-text">
          <p className="st-page-kicker">Top result · {KIND[item.media_type]}</p>
          <h2>{item.title}</h2>
          <p className="sr-top-meta">{[item.year, item.media_type === 'book' ? item.author : String(item.genre || '').split(',')[0]].filter(Boolean).join(' · ')}</p>
          <div className="sr-top-actions">
            {item.media_type !== 'book' && (
              <Link to={titleUrl(item, { play: true })} state={{ backgroundLocation: location }} className="st-btn st-btn--primary"><Play size={18} weight="fill" /> Play</Link>
            )}
            <Link to={titleUrl(item)} state={{ backgroundLocation: location }} className="st-btn st-btn--secondary"><Info size={18} weight="bold" /> Details</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function GameTile({ game }) {
  const live = isGameLive(game);
  return (
    <Link to={`/sports?game=${encodeURIComponent(game.id)}`} className="sr-game">
      <span className="sr-game-icon"><Trophy size={20} weight="bold" /></span>
      <span className="sr-game-text">
        <span className="sr-game-name">{game.name}</span>
        <span className="sr-game-meta">
          {live ? <><span className="st-live-dot" aria-hidden="true" /> Live</> : `Starts ${new Date(game.startsAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
          {game.league ? ` · ${game.league}` : ''}
        </span>
      </span>
    </Link>
  );
}

function ResultGrid({ title, items }) {
  if (!items.length) return null;
  return (
    <section className="st-search-section" aria-label={title}>
      <h2 className="st-row-title">{title}</h2>
      <div className="st-grid">
        {items.map((item, index) => (
          <div className="st-grid-cell" key={`${item.media_type}:${item.id}`}>
            <TitleCard item={item} priority={index < 6} showMatch={false} />
          </div>
        ))}
      </div>
    </section>
  );
}

// Search box at the top of the page (the phone's way in, via the bottom nav).
function SearchBox({ query }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(query);
  const [recent, setRecent] = useState(() => getRecentSearches());
  const inputRef = useRef(null);

  useEffect(() => { setValue(query); }, [query]);
  useEffect(() => {
    if (!query || searchParams.get('focus') === '1') inputRef.current?.focus();
  }, [query, searchParams]);

  function submit(term) {
    const clean = term.trim();
    if (clean.length < 2) return;
    addRecentSearch(clean);
    setRecent(getRecentSearches());
    navigate(`/search?q=${encodeURIComponent(clean)}`);
    inputRef.current?.blur();
  }

  return (
    <div className="sr-box">
      <form role="search" onSubmit={(event) => { event.preventDefault(); submit(value); }}>
        <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          className="st-search-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Titles, actors, directors, teams…"
          aria-label="Search"
        />
        {value && <button type="button" className="sr-box-clear" onClick={() => { setValue(''); inputRef.current?.focus(); }} aria-label="Clear search"><X size={16} weight="bold" /></button>}
      </form>
      {!query && recent.length > 0 && (
        <div className="sr-recent">
          <div className="sr-recent-head">
            <span>Recent searches</span>
            <button type="button" onClick={() => { clearRecentSearches(); setRecent([]); }}>Clear</button>
          </div>
          <ul>
            {recent.map((term) => (
              <li key={term}>
                <button type="button" className="sr-recent-term" onClick={() => submit(term)}><ClockCounterClockwise size={15} weight="bold" /> {term}</button>
                <button type="button" className="sr-recent-remove" onClick={() => { removeRecentSearch(term); setRecent(getRecentSearches()); }} aria-label={`Remove ${term}`}><X size={12} weight="bold" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
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
  const [games, setGames] = useState([]);
  const [person, setPerson] = useState(null);

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

    setGames([]);
    setPerson(null);
    searchGames(query).then((list) => { if (!cancelled) setGames(list); }).catch(() => {});
    searchPerson(query).then((match) => { if (!cancelled) setPerson(match); }).catch(() => {});
    addRecentSearch(query);

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

  const grouped = groupResults(primary);

  const primaryTotal = primaryMovies.length + primaryTv.length + primaryBooks.length;
  const relatedTotal = relatedMovies.length + relatedTv.length + relatedBooks.length;
  const nothingFound = primaryState === 'done' && relatedState === 'done' && primaryTotal === 0 && relatedTotal === 0 && !games.length && !person?.items?.length;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content sr-page">
        <header className="st-page-head">
          <div>
            <p className="st-page-kicker">Search</p>
            <h1 className="st-page-title">{query ? `“${query}”` : 'Search'}</h1>
          </div>
        </header>
        <SearchBox query={query} />

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
            {grouped.top && !(person && person.items.length >= 3) && <TopResult item={grouped.top} />}
            {person && person.items.length > 0 && (
              <section className="st-search-section sr-person" aria-label={`Titles with ${person.person.name}`}>
                <div className="sr-person-head">
                  {person.person.photo && <img src={person.person.photo} alt="" referrerPolicy="no-referrer" />}
                  <div>
                    <p className="st-page-kicker">{person.person.department}</p>
                    <h2 className="st-row-title">{person.person.department === 'Director' ? `Directed by ${person.person.name}` : `Starring ${person.person.name}`}</h2>
                  </div>
                </div>
                <TitleRow title={`${person.person.name} on binge.`} items={person.items} />
              </section>
            )}
            {grouped.top && person && person.items.length >= 3 && <TopResult item={grouped.top} />}
            <ResultGrid title="Movies" items={grouped.movies} />
            <ResultGrid title="Series" items={grouped.series} />
            {grouped.books.length > 0 && <TitleRow title={TYPE_LABELS.book} items={grouped.books} />}
            {games.length > 0 && (
              <section className="st-search-section" aria-label="Live games">
                <h2 className="st-row-title">Live games</h2>
                <div className="sr-games">{games.map((game) => <GameTile key={game.id} game={game} />)}</div>
              </section>
            )}

            {topMatch && !person?.items?.length && (
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

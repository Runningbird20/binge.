import LoadingBar from '../components/LoadingBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ClockCounterClockwise, MagnifyingGlass, Sparkle, Trophy, X } from '@phosphor-icons/react';
import { askBinge } from '../utils/aiSearch';
import Navbar from '../components/Navbar';
import { api } from '../api';
import TitleRow from '../components/TitleRow';
import GenreScrollBar from '../components/GenreScrollBar';
import { filterItems, filterOptions, hasFilters, readFilters } from '../utils/searchFilters';
import TitleCard from '../components/TitleCard';
import { fetchTmdbRecommendations, tmdbIdFromItem } from '../utils/tmdb';
import { resolveTmdbItems } from '../utils/catalogLookup';
import { maturityRestriction } from '../utils/kidsMode';
import { useAuth } from '../contexts/AuthContext';
import {
  addRecentSearch, clearRecentSearches, getRecentSearches, groupResults, isGameLive, removeRecentSearch, searchGames, searchPerson,
} from '../utils/searchExtras';

// "Ask binge." picks for a natural-language request, with reasons.
// filters: the page's chips (applied to the picks too); onItems hears every
// pick (before filtering) so the chips can offer their languages and decades.
function AiPicks({ query, auto, filters, onItems }) {
  const [state, setState] = useState(auto ? 'loading' : 'idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const shown = filterItems(result?.items, filters);
  // The latest callback, without re-asking the AI when it changes.
  const onItemsRef = useRef(onItems);
  onItemsRef.current = onItems;

  useEffect(() => {
    setResult(null);
    setError('');
    setState(auto ? 'loading' : 'idle');
  }, [query, auto]);

  useEffect(() => {
    if (state !== 'loading') return undefined;
    let cancelled = false;
    askBinge(query)
      .then((next) => { if (!cancelled) { setResult(next); setState('done'); onItemsRef.current?.(next.items || []); } })
      .catch((err) => { if (!cancelled) { setError(err.message || 'The AI search didn’t respond.'); setState('error'); onItemsRef.current?.([]); } });
    return () => { cancelled = true; };
  }, [state, query]);

  if (state === 'idle') {
    return (
      <button type="button" className="sr-ask" onClick={() => setState('loading')}>
        <Sparkle size={16} weight="fill" /> Ask binge. for picks like “{query}”
      </button>
    );
  }
  return (
    <section className="sr-ai" aria-label="Ask binge. picks" aria-busy={state === 'loading'}>
      <div className="sr-ai-head">
        <Sparkle size={18} weight="fill" aria-hidden="true" />
        <div>
          <h2 className="st-row-title">binge. picks</h2>
          <p className="st-row-subtitle">{state === 'loading' ? 'Thinking about what fits…' : result?.summary || `For “${query}”`}</p>
        </div>
      </div>
      {state === 'error' && (
        <div className="sr-ai-error-row">
          <p className="sr-ai-error">{error}</p>
          <button type="button" className="sr-ask" onClick={() => setState('loading')}>Try again</button>
        </div>
      )}
      {state === 'done' && result.items.length === 0 && <p className="sr-ai-error">Nothing in the binge. catalog fit that — try wording it differently.</p>}
      {state === 'done' && result.items.length > 0 && shown.length === 0 && <p className="sr-ai-error">None of these picks match your filters.</p>}
      {(state === 'loading' || shown.length > 0) && (
        <TitleRow title="binge. picks" loading={state === 'loading'} items={state === 'done' ? shown : undefined} />
      )}
    </section>
  );
}

const MEDIA_TYPE = { movie: 'movie', tv: 'tv_show', book: 'book' };

// "More … like X" rows: a normal horizontal row, with a row-shaped skeleton
// while loading (a stacked grid skeleton made the page jump on phones).
function ResultRow({ heading, items, loading }) {
  if (!loading && !items.length) return null;
  return (
    <TitleRow
      title={heading}
      loading={loading}
      items={loading ? undefined : items.map((item) => ({ ...item, media_type: MEDIA_TYPE[item._type] || item._type }))}
    />
  );
}

function GridSkeleton() {
  return <LoadingBar label="Loading results…" />;
}

const TYPE_LABELS = { movie: 'Movies', tv: 'TV Shows', book: 'Books' };
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

// One chip bar (the genre chips' bar): an "any" chip, then each value.
// Choosing the chosen chip again clears it.
function FilterBar({ name, label, anyLabel, options, value, onChange }) {
  if (!options.length) return null;
  return (
    <GenreScrollBar ariaLabel={label}>
      <button type="button" className={`genre-chip${!value ? ' active' : ''}`} aria-pressed={!value} onClick={() => onChange(name, '')}>
        {anyLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`genre-chip${value === option.value ? ' active' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(name, value === option.value ? '' : option.value)}
        >
          {option.label}
        </button>
      ))}
    </GenreScrollBar>
  );
}

// Type, decade and language. Only on this page (not the header's dropdown,
// not the Movies / Series pages).
function SearchFilters({ options, filters, onChange }) {
  if (!options.type.length && !options.decade.length && !options.lang.length) return null;
  return (
    <div className="sr-filters">
      <FilterBar name="type" label="Filter by type" anyLabel="All types" options={options.type} value={filters.type} onChange={onChange} />
      <FilterBar name="decade" label="Filter by decade" anyLabel="Any decade" options={options.decade} value={filters.decade} onChange={onChange} />
      <FilterBar name="lang" label="Filter by language" anyLabel="Any language" options={options.lang} value={filters.lang} onChange={onChange} />
    </div>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const kidsSafe = maturityRestriction(useAuth()?.activeProfile);
  const query = searchParams.get('q') || '';
  const filterKey = ['type', 'decade', 'lang'].map((key) => searchParams.get(key) || '').join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => readFilters(searchParams), [filterKey]);
  const setFilter = useCallback((key, value) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const clearFilters = () => ['type', 'decade', 'lang'].forEach((key) => setFilter(key, ''));
  // Ask binge.'s picks (every one, before the filters): null while it thinks.
  const [aiItems, setAiItems] = useState(null);
  useEffect(() => { setAiItems(null); }, [query]);

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
  const allRelatedMovies = tagType(related?.moviesRelated, 'movie').filter((r) => !primaryMovieIds.has(r.id));
  const allRelatedTv = tagType(related?.tvRelated, 'tv').filter((r) => !primaryTvIds.has(r.id));
  const allRelatedBooks = tagType(related?.booksRelated, 'book').filter((r) => !primaryBookIds.has(r.id));
  const relatedMovies = filterItems(allRelatedMovies, filters);
  const relatedTv = filterItems(allRelatedTv, filters);
  const relatedBooks = filterItems(allRelatedBooks, filters);
  const personItems = filterItems(person?.items, filters);
  const filtering = hasFilters(filters);

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
    return filterItems(await resolveTmdbItems(list || [], topMatchType, { kidsSafe }), filters);
  }, [topMatchType, topMatchTmdbId, filters, kidsSafe]);

  // The grids come from the filtered title matches, the best match first in
  // its own section (the page has no separate "top result" card).
  const best = groupResults({
    movies: filterItems(primaryMovies, filters),
    tv: filterItems(primaryTv, filters),
    books: filterItems(primaryBooks, filters),
  });
  const leadWithBest = (list, mediaType) => (best.top?.media_type === mediaType ? [best.top, ...list] : list);
  const grouped = {
    movies: leadWithBest(best.movies, 'movie'),
    series: leadWithBest(best.series, 'tv_show'),
    books: leadWithBest(best.books, 'book'),
  };

  // The chips offer what's in the results (every section, before filtering).
  const options = filterOptions([
    ...primaryMovies, ...primaryTv, ...primaryBooks,
    ...allRelatedMovies, ...allRelatedTv, ...allRelatedBooks,
    ...(person?.items || []), ...(aiItems || []),
  ], filters);

  const primaryTotal = primaryMovies.length + primaryTv.length + primaryBooks.length;
  const relatedTotal = allRelatedMovies.length + allRelatedTv.length + allRelatedBooks.length;
  const nothingFound = primaryState === 'done' && relatedState === 'done' && primaryTotal === 0 && relatedTotal === 0 && !games.length && !person?.items?.length;
  // Filters set and, once everything has arrived, nothing left to show.
  const shownCount = grouped.movies.length + grouped.series.length + grouped.books.length
    + personItems.length + relatedMovies.length + relatedTv.length + relatedBooks.length + filterItems(aiItems, filters).length;
  const filteredAway = filtering && !nothingFound && primaryState === 'done' && relatedState !== 'loading' && aiItems !== null && shownCount === 0;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content sr-page">
        <header className="st-page-head">
          <div>
            <h1 className="st-page-title">{query ? `“${query}”` : 'Search'}</h1>
          </div>
        </header>
        <SearchBox query={query} />
        <SearchFilters options={options} filters={filters} onChange={setFilter} />
        {/* Every search goes through Ask binge. (it puts exact title matches first,
            and understands requests like "new Malayalam movies"); the plain
            title results below show instantly while it thinks. */}
        {query.trim().length >= 2 && <AiPicks key={query} query={query} auto filters={filters} onItems={setAiItems} />}

        {filteredAway && (
          <div className="empty-state">
            <p>Nothing matches these filters.</p>
            <button type="button" className="st-btn st-btn--ghost" onClick={clearFilters}>Clear filters</button>
          </div>
        )}

        {primaryState === 'loading' && <GridSkeleton />}

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
            {person && personItems.length > 0 && (
              <section className="st-search-section sr-person" aria-label={`Titles with ${person.person.name}`}>
                <Link to={`/person/${person.person.id}`} className="sr-person-head">
                  {person.person.photo && <img src={person.person.photo} alt="" referrerPolicy="no-referrer" />}
                  <div>
                    <h2 className="st-row-title">{person.person.department === 'Director' ? `Directed by ${person.person.name}` : `Starring ${person.person.name}`}</h2>
                    <p className="sr-person-more">See all of {person.person.name}’s work <ArrowRight size={14} weight="bold" aria-hidden="true" /></p>
                  </div>
                </Link>
                <TitleRow title={`${person.person.name} on binge.`} items={personItems} />
              </section>
            )}
            <ResultGrid title="Movies" items={grouped.movies} />
            <ResultGrid title="Series" items={grouped.series} />
            {grouped.books.length > 0 && <TitleRow title={TYPE_LABELS.book} items={grouped.books} />}
            {games.length > 0 && !filtering && (
              <section className="st-search-section" aria-label="Live games">
                <h2 className="st-row-title">Live games</h2>
                <div className="sr-games">{games.map((game) => <GameTile key={game.id} game={game} />)}</div>
              </section>
            )}

            {topMatch && !personItems.length && (
              <TitleRow
                key={`${topMatchType}:${topMatchTmdbId}:${filterKey}`}
                title={`More like ${topMatch.title}`}
                subtitle="Titles people who watched it went on to watch"
                load={loadMoreLike}
                minItems={3}
                hideWatched
              />
            )}

            {((relatedState === 'loading' && filters.type !== 'tv_show' && filters.type !== 'book') || relatedMovies.length > 0) && (
              <ResultRow heading={`More movies like "${query}"`} items={relatedMovies} loading={relatedState === 'loading'} />
            )}
            {((relatedState === 'loading' && filters.type !== 'movie' && filters.type !== 'book') || relatedTv.length > 0) && (
              <ResultRow heading={`More TV shows like "${query}"`} items={relatedTv} loading={relatedState === 'loading'} />
            )}
            {((relatedState === 'loading' && (!filters.type || filters.type === 'book')) || relatedBooks.length > 0) && (
              <ResultRow heading={`More books like "${query}"`} items={relatedBooks} loading={relatedState === 'loading'} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

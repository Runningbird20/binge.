import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ClockCounterClockwise, MagnifyingGlass, Trophy, User, X } from '@phosphor-icons/react';
import { api } from '../api';
import {
  addRecentSearch, clearRecentSearches, getRecentSearches, groupResults, removeRecentSearch, searchGames, searchPerson,
} from '../utils/searchExtras';
import { posterSrc } from '../utils/imageQuality';

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const TYPE_LABEL = { movie: 'Movie', tv_show: 'Series', book: 'Book' };

function itemUrl(item) {
  if (item.media_type === 'book') return `/book/${item.id}`;
  return item.media_type === 'tv_show' ? `/tv-show/${item.id}` : `/movie/${item.id}`;
}

function itemSub(item) {
  return [TYPE_LABEL[item.media_type], item.media_type === 'book' ? item.author : item.year].filter(Boolean).join(' · ');
}

// Navbar search: recent searches when empty; grouped results while typing
// (Top result → Movies → Series → Books → Live games, plus a person match).
export default function GlobalSearch() {
  const [query, setQuery]       = useState('');
  const [expanded, setExpanded] = useState(false);
  const [results, setResults]   = useState(null);
  const [games, setGames]       = useState([]);
  const [person, setPerson]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [recent, setRecent]     = useState(() => getRecentSearches());
  const inputRef = useRef(null);
  const wrapRef  = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const debounced = useDebounce(query, 280);

  function open() {
    setExpanded(true);
    setRecent(getRecentSearches());
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function close() {
    setExpanded(false);
    setQuery('');
    setResults(null);
    setGames([]);
    setPerson(null);
  }

  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 2) {
      setResults(null);
      setGames([]);
      setPerson(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`/search?q=${encodeURIComponent(term)}&types=movies,tv,books`)
      .then((data) => { if (!cancelled) setResults(data); })
      .catch(() => { if (!cancelled) setResults(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    searchGames(term).then((list) => { if (!cancelled) setGames(list); }).catch(() => {});
    searchPerson(term).then((match) => { if (!cancelled) setPerson(match); }).catch(() => {});
    return () => { cancelled = true; };
  }, [debounced]);

  useEffect(() => {
    if (!expanded) return undefined;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  const grouped = groupResults(results);
  const sections = [
    grouped.top && { key: 'top', label: 'Top result', items: [grouped.top] },
    grouped.movies.length && { key: 'movies', label: 'Movies', items: grouped.movies.slice(0, 3) },
    grouped.series.length && { key: 'series', label: 'Series', items: grouped.series.slice(0, 3) },
    grouped.books.length && { key: 'books', label: 'Books', items: grouped.books.slice(0, 2) },
  ].filter(Boolean);
  const hasAny = sections.length || games.length || person;

  function go(url, overlay = true) {
    addRecentSearch(query);
    navigate(url, overlay ? { state: { backgroundLocation: location } } : undefined);
    close();
  }

  function searchFor(term) {
    addRecentSearch(term);
    navigate(`/search?q=${encodeURIComponent(term)}`);
    close();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { inputRef.current?.blur(); close(); return; }
    if (e.key === 'Enter' && query.trim().length >= 2) searchFor(query.trim());
  }

  const showDropdown = expanded && (query.trim().length >= 2 || (query.trim().length === 0 && recent.length > 0));

  return (
    <div className="global-search-wrap" ref={wrapRef}>
      <div
        className={`global-search-bar${expanded ? ' is-expanded' : ''}`}
        onClick={() => !expanded && open()}
      >
        <span className="global-search-bar-icon">
          <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="global-search-bar-input"
          placeholder="Titles, people, teams…"
          aria-label="Search titles, people and games (press / )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={open}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {loading && <span className="global-search-bar-loading" />}
      </div>

      {showDropdown && (
        <div className="global-search-dropdown">
          {query.trim().length === 0 && (
            <div className="global-search-dropdown-section">
              <p className="global-search-dropdown-label gs-recent-head">
                Recent searches
                <button type="button" onClick={() => { clearRecentSearches(); setRecent([]); }}>Clear</button>
              </p>
              {recent.map((term) => (
                <div key={term} className="gs-recent">
                  <button type="button" className="global-search-dropdown-item" onClick={() => searchFor(term)}>
                    <span className="global-search-dropdown-item-icon"><ClockCounterClockwise size={16} weight="bold" /></span>
                    <span className="global-search-dropdown-item-title">{term}</span>
                  </button>
                  <button type="button" className="gs-recent-remove" aria-label={`Remove ${term} from recent searches`} onClick={() => { removeRecentSearch(term); setRecent(getRecentSearches()); }}>
                    <X size={12} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && (
            <>
              {loading && !results && <div className="global-search-dropdown-hint">Searching…</div>}
              {results && !hasAny && !loading && <div className="global-search-dropdown-hint">No results for "{query}"</div>}

              {sections.map((section) => (
                <div key={section.key} className={`global-search-dropdown-section${section.key === 'top' ? ' gs-top' : ''}`}>
                  <p className="global-search-dropdown-label">{section.label}</p>
                  {section.items.map((item) => (
                    <button key={`${item.media_type}-${item.id}`} type="button" className="global-search-dropdown-item" onClick={() => go(itemUrl(item))}>
                      {item.poster_url || item.cover_url ? (
                        <img src={posterSrc(item.poster_url || item.cover_url)} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="global-search-dropdown-item-icon">{item.title?.charAt(0)}</span>
                      )}
                      <span className="global-search-dropdown-item-text">
                        <span className="global-search-dropdown-item-title">{item.title}</span>
                        <span className="global-search-dropdown-item-sub">{itemSub(item)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}

              {games.length > 0 && (
                <div className="global-search-dropdown-section">
                  <p className="global-search-dropdown-label">Live games</p>
                  {games.slice(0, 3).map((game) => (
                    <button key={game.id} type="button" className="global-search-dropdown-item" onClick={() => go(`/sports?game=${encodeURIComponent(game.id)}`, false)}>
                      <span className="global-search-dropdown-item-icon"><Trophy size={16} weight="bold" /></span>
                      <span className="global-search-dropdown-item-text">
                        <span className="global-search-dropdown-item-title">{game.name}</span>
                        <span className="global-search-dropdown-item-sub">{game.league}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {person && person.items.length > 0 && (
                <div className="global-search-dropdown-section">
                  <p className="global-search-dropdown-label">People</p>
                  <button type="button" className="global-search-dropdown-item" onClick={() => searchFor(person.person.name)}>
                    {person.person.photo
                      ? <img src={person.person.photo} alt="" className="gs-person-photo" referrerPolicy="no-referrer" />
                      : <span className="global-search-dropdown-item-icon"><User size={16} weight="bold" /></span>}
                    <span className="global-search-dropdown-item-text">
                      <span className="global-search-dropdown-item-title">{person.person.name}</span>
                      <span className="global-search-dropdown-item-sub">{person.person.department} · {person.items.length} titles on binge.</span>
                    </span>
                  </button>
                </div>
              )}

              {hasAny && (
                <button type="button" className="gs-all" onClick={() => searchFor(query.trim())}>
                  See all results for “{query.trim()}”
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { api } from '../api';

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const TYPE_ORDER = ['movie', 'tv', 'book', 'person'];
const TYPE_ICONS = { movie: '🎬', tv: '📺', book: '📖', person: '👤' };
const TYPE_LABELS = { movie: 'Movies', tv: 'TV Shows', book: 'Books', person: 'People' };

export default function GlobalSearch() {
  const [query, setQuery]       = useState('');
  const [expanded, setExpanded] = useState(false);
  const [results, setResults]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const inputRef = useRef(null);
  const wrapRef  = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const debounced = useDebounce(query, 280);

  function open() {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function close() {
    setExpanded(false);
    setQuery('');
    setResults(null);
  }

  // Fetch as the user types
  useEffect(() => {
    if (!debounced.trim() || debounced.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`/search?q=${encodeURIComponent(debounced)}`)
      .then((data) => { if (!cancelled) setResults(data); })
      .catch(() => { if (!cancelled) setResults(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  // Close on outside click (mousedown, not blur, so clicking a result works)
  useEffect(() => {
    if (!expanded) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  const flat = results ? [
    ...results.movies.map((r) => ({ ...r, _type: 'movie', _label: r.title, _sub: r.year ? String(r.year) : 'Movie', _poster: r.poster_url, _url: `/movie/${r.id}`, _overlay: true })),
    ...results.tv.map((r) => ({ ...r, _type: 'tv', _label: r.title, _sub: r.year ? String(r.year) : 'TV Show', _poster: r.poster_url, _url: `/tv-show/${r.id}`, _overlay: true })),
    ...results.books.map((r) => ({ ...r, _type: 'book', _label: r.title, _sub: r.author || 'Book', _poster: r.cover_url, _url: `/book/${r.id}`, _overlay: true })),
    ...(results.people || []).map((r) => ({ ...r, _type: 'person', _label: r.username, _sub: r.bio || 'User', _poster: r.avatar_url, _url: `/profile/${r.username}`, _overlay: false })),
  ] : [];

  function handleSelect(item) {
    navigate(item._url, item._overlay ? { state: { backgroundLocation: location } } : undefined);
    close();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { inputRef.current?.blur(); close(); return; }
    if (e.key === 'Enter' && flat[0]) handleSelect(flat[0]);
  }

  const showDropdown = expanded && query.trim().length >= 2;

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
          placeholder="Search..."
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
          {loading && !results && (
            <div className="global-search-dropdown-hint">Searching…</div>
          )}
          {results && flat.length === 0 && !loading && (
            <div className="global-search-dropdown-hint">No results for "{query}"</div>
          )}
          {flat.length > 0 && TYPE_ORDER.map((type) => {
            const items = flat.filter((r) => r._type === type);
            if (!items.length) return null;
            return (
              <div key={type} className="global-search-dropdown-section">
                <p className="global-search-dropdown-label">{TYPE_LABELS[type]}</p>
                {items.map((item) => (
                  <button
                    key={`${type}-${item.id}`}
                    type="button"
                    className="global-search-dropdown-item"
                    onClick={() => handleSelect(item)}
                  >
                    {item._poster ? (
                      <img src={item._poster} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="global-search-dropdown-item-icon">{TYPE_ICONS[type]}</span>
                    )}
                    <span className="global-search-dropdown-item-text">
                      <span className="global-search-dropdown-item-title">{item._label}</span>
                      <span className="global-search-dropdown-item-sub">{item._sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function GlobalSearch() {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef  = useRef(null);
  const navigate  = useNavigate();
  const debounced = useDebounce(query, 280);

  // Keyboard shortcuts: Cmd+K / Ctrl+K, or bare S key when no input is focused
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
        if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }
      if (e.key === 'Escape') { setOpen(false); setQuery(''); return; }
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && document.activeElement?.contentEditable !== 'true') {
          e.preventDefault();
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  // Search
  useEffect(() => {
    if (!debounced.trim() || debounced.length < 2) { setResults(null); return; }
    setLoading(true);
    api.get(`/search?q=${encodeURIComponent(debounced)}`)
      .then(setResults)
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [debounced]);

  // Flatten results — movies/tv/books get URLs that open the item on their page
  const flat = results ? [
    ...results.movies.map(r => ({
      ...r, _type: 'movie',
      _label: r.title,
      _sub: `Movie · ${r.year || ''}`,
      _url: `/movies?open=${r.id}`,
    })),
    ...results.tv.map(r => ({
      ...r, _type: 'tv',
      _label: r.title,
      _sub: `TV Show · ${r.year || ''}`,
      _url: `/tv-shows?open=${r.id}`,
    })),
    ...results.books.map(r => ({
      ...r, _type: 'book',
      _label: r.title,
      _sub: `Book · ${r.author || ''}`,
      _url: `/books?open=${r.id}`,
    })),
    ...results.forums.map(r => ({
      ...r, _type: 'forum',
      _label: r.name,
      _sub: `Community · ${(r.member_count||0).toLocaleString()} members`,
      _url: `/forum/${r.slug}`,
    })),
    ...results.posts.map(r => ({
      ...r, _type: 'post',
      _label: r.title,
      _sub: `Post in ${r.forums?.name}`,
      _url: `/forum/${r.forums?.slug}/post/${r.id}`,
    })),
    ...(results.people || []).map(r => ({
      ...r, _type: 'person',
      _label: r.username,
      _sub: r.bio || 'User',
      _url: `/profile/${r.username}`,
    })),
  ] : [];

  function close() {
    setOpen(false);
    setQuery('');
    setResults(null);
  }

  function handleSelect(item) {
    navigate(item._url);
    close();
  }

  function handleKeyDown(e) {
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && flat[selected]) handleSelect(flat[selected]);
  }

  useEffect(() => { setSelected(0); }, [results]);

  const TYPE_ICONS = { movie: '🎬', tv: '📺', book: '📖', forum: '💬', post: '📝', person: '👤' };

  return (
    <>
      {/* Trigger — shown in the search bar area below navbar */}
      <button
        className="global-search-trigger"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        type="button"
        title="Search (⌘K)"
      >
        <span className="global-search-icon">🔍</span>
        <span className="global-search-placeholder">Search movies, shows, books, communities…</span>
        <kbd className="global-search-kbd">⌘K</kbd>
      </button>

      {open && (
        <div className="global-search-overlay" onClick={close}>
          <div className="global-search-modal" onClick={e => e.stopPropagation()}>
            <div className="global-search-input-wrap">
              <span className="global-search-input-icon">🔍</span>
              <input
                ref={inputRef}
                className="global-search-input"
                placeholder="Search movies, shows, books, communities, people..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
              />
              {loading && <span className="global-search-loading" />}
              {query && (
                <button className="global-search-clear" onClick={() => setQuery('')} type="button">✕</button>
              )}
            </div>

            {!query && (
              <div className="global-search-hint">
                <p>Search across movies, TV shows, books, communities, posts, and users</p>
                <div className="global-search-shortcuts">
                  <span><kbd>↑↓</kbd> navigate</span>
                  <span><kbd>↵</kbd> open</span>
                  <span><kbd>Esc</kbd> close</span>
                </div>
              </div>
            )}

            {results && flat.length === 0 && !loading && (
              <div className="global-search-empty">No results for "{query}"</div>
            )}

            {flat.length > 0 && (
              <div className="global-search-results">
                {['movie', 'tv', 'book', 'forum', 'post', 'person'].map(type => {
                  const items = flat.filter(r => r._type === type);
                  if (!items.length) return null;
                  const sectionLabels = {
                    movie: '🎬 Movies', tv: '📺 TV Shows', book: '📖 Books',
                    forum: '💬 Communities', post: '📝 Posts', person: '👤 People',
                  };
                  return (
                    <div key={type} className="global-search-section">
                      <p className="global-search-section-label">{sectionLabels[type]}</p>
                      {items.map(item => {
                        const idx   = flat.indexOf(item);
                        const poster = item.poster_url || item.cover_url;
                        return (
                          <button
                            key={`${type}-${item.id}`}
                            className={`global-search-item ${idx === selected ? 'selected' : ''}`}
                            onClick={() => handleSelect(item)}
                            onMouseEnter={() => setSelected(idx)}
                            type="button"
                          >
                            {poster ? (
                              <img src={poster} alt="" className="global-search-poster" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="global-search-item-icon">{TYPE_ICONS[type]}</span>
                            )}
                            <div className="global-search-item-text">
                              <span className="global-search-item-label">{item._label}</span>
                              <span className="global-search-item-sub">{item._sub}</span>
                            </div>
                            <span className="global-search-item-arrow">→</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

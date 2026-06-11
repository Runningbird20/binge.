import { useState, useEffect, useRef, useCallback } from 'react';
import {
  searchGutenberg,
  getGutenbergReaderUrl,
  searchArchive,
  annasArchiveUrl,
} from '../utils/gutenbergApi';

// ─── BookReader (iframe overlay) ─────────────────────────────
function BookReader({ book, onClose }) {
  const [frameBlocked, setFrameBlocked] = useState(false);
  const wrapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) wrapRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }

  const src = book.source === 'gutenberg'
    ? getGutenbergReaderUrl(book.id)
    : book.embedUrl;

  return (
    <div className="manga-reader-overlay">
      <div className="manga-reader-header">
        <button className="manga-reader-close" onClick={onClose} title="Close">✕</button>
        <div className="manga-reader-title">
          <span className="manga-reader-manga-name">{book.title}</span>
          {book.authors && (
            <span className="manga-reader-chapter-name">{book.authors}</span>
          )}
        </div>
        <div className="manga-reader-controls">
          <button className="manga-reader-nav" onClick={toggleFullscreen} title="Fullscreen">
            {isFullscreen ? '↙' : '↗'}
          </button>
          <a
            className="manga-reader-nav"
            href={annasArchiveUrl(book.title, book.authors)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
            title="Find on Anna's Archive"
          >
            Anna's Archive ↗
          </a>
        </div>
      </div>

      <div className="manga-reader-body vertical" ref={wrapRef}>
        {frameBlocked ? (
          <div className="manga-reader-loading" style={{ gap: '1rem' }}>
            <p style={{ fontSize: '2rem', margin: 0 }}>🚫</p>
            <p style={{ color: '#888' }}>This source blocked embedding.</p>
            <a
              className="btn-watch"
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              Open Book in New Tab →
            </a>
          </div>
        ) : (
          <iframe
            key={src}
            src={src}
            className="comix-frame"
            style={{ height: '100%' }}
            title={book.title}
            allowFullScreen
            allow="fullscreen"
            referrerPolicy="no-referrer-when-downgrade"
            onError={() => setFrameBlocked(true)}
          />
        )}
      </div>

      {!frameBlocked && (
        <div className="manga-reader-footer">
          <a
            href={annasArchiveUrl(book.title, book.authors)}
            target="_blank"
            rel="noopener noreferrer"
            className="manga-reader-nav"
            style={{ textDecoration: 'none' }}
          >
            Find on Anna's Archive ↗
          </a>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="manga-reader-nav"
            style={{ textDecoration: 'none' }}
          >
            ⧉ Open in New Tab
          </a>
        </div>
      )}
    </div>
  );
}

// ─── BookCard ─────────────────────────────────────────────────
function BookCard({ book, onRead }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <button type="button" className="manga-card" onClick={() => onRead(book)}>
      <div className="manga-card-cover">
        {book.cover && !imgErr ? (
          <img
            src={book.cover}
            alt={book.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="manga-card-placeholder">
            <span>{book.title?.charAt(0) || '?'}</span>
          </div>
        )}
        <span className="manga-card-status lib-source-badge">
          {book.source === 'gutenberg' ? 'Gutenberg' : 'Archive'}
        </span>
      </div>
      <div className="manga-card-copy">
        <p className="manga-card-title">{book.title}</p>
        {book.authors && (
          <p className="manga-card-author">{book.authors}</p>
        )}
      </div>
    </button>
  );
}

// ─── LibraryTab ───────────────────────────────────────────────
export default function LibraryTab() {
  const [source, setSource]         = useState('gutenberg');
  const [query, setQuery]           = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [reader, setReader]         = useState(null);
  const abortRef = useRef(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Search
  useEffect(() => {
    if (!debouncedQ) { setResults([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');

    const search = source === 'gutenberg'
      ? searchGutenberg(debouncedQ, 1, ctrl.signal).then(d =>
          (d.books || []).map(b => ({ ...b, source: 'gutenberg' }))
        )
      : searchArchive(debouncedQ, ctrl.signal).then(items =>
          items.map(b => ({ ...b, source: 'archive' }))
        );

    search
      .then(setResults)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [debouncedQ, source]);

  const openReader = useCallback(book => setReader(book), []);

  if (reader) {
    return <BookReader book={reader} onClose={() => setReader(null)} />;
  }

  return (
    <>
      <section className="surface-panel">
        <div className="surface-panel-header">
          <div>
            <h2>Free Library</h2>
            <p className="surface-panel-copy">
              Read public-domain books in-site via Project Gutenberg and Internet Archive.
              For anything else, jump to Anna's Archive.
            </p>
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search books, authors…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select
            className="filter-input"
            value={source}
            onChange={e => { setSource(e.target.value); setResults([]); }}
            aria-label="Source"
          >
            <option value="gutenberg">Project Gutenberg</option>
            <option value="archive">Internet Archive</option>
          </select>
        </div>
      </section>

      <section className="surface-panel surface-panel-spacious">
        {error && <div className="manga-error-banner">⚠️ {error}</div>}

        {!debouncedQ && !loading && (
          <div className="empty-state">
            <p style={{ fontSize: '2rem', margin: 0 }}>📖</p>
            <p>Search for any book above.</p>
            <p className="empty-hint">
              Try "Pride and Prejudice", "Sherlock Holmes", or "The Art of War".
            </p>
            <a
              className="lib-annas-link"
              href="https://annas-archive.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              Looking for something newer? Try Anna's Archive ↗
            </a>
          </div>
        )}

        {loading && (
          <div className="manga-skeleton-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="manga-skeleton-card">
                <div className="manga-skeleton-cover" />
                <div className="manga-skeleton-line" />
                <div className="manga-skeleton-line short" />
              </div>
            ))}
          </div>
        )}

        {!loading && debouncedQ && results.length === 0 && !error && (
          <div className="empty-state">
            <p style={{ fontSize: '2rem', margin: 0 }}>🔍</p>
            <p>No results for "{debouncedQ}" on {source === 'gutenberg' ? 'Project Gutenberg' : 'Internet Archive'}.</p>
            <a
              className="lib-annas-link"
              href={annasArchiveUrl(debouncedQ, '')}
              target="_blank"
              rel="noopener noreferrer"
            >
              Search Anna's Archive for "{debouncedQ}" ↗
            </a>
          </div>
        )}

        {!loading && results.length > 0 && (
          <>
            <div className="manga-grid">
              {results.map((book, i) => (
                <BookCard
                  key={book.id || i}
                  book={book}
                  onRead={openReader}
                />
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <a
                className="lib-annas-link"
                href={annasArchiveUrl(debouncedQ, '')}
                target="_blank"
                rel="noopener noreferrer"
              >
                Can't find it? Try Anna's Archive ↗
              </a>
            </div>
          </>
        )}
      </section>
    </>
  );
}

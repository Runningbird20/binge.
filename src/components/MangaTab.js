import { useState, useEffect, useRef, useCallback } from 'react';
import { getSources, searchComics, getChapters } from '../utils/comickSourceApi';

// ─── MangaReader (iframe) ──────────────────────────────────────
function MangaReader({ chapter, comic, onClose, onPrev, onNext, hasPrev, hasNext }) {
  const [frameBlocked, setFrameBlocked] = useState(false);
  const wrapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft'  && hasPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) wrapRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }

  const chapterLabel = chapter.number
    ? `Chapter ${chapter.number}${chapter.title ? ' — ' + chapter.title : ''}`
    : chapter.title || 'Chapter';

  return (
    <div className="manga-reader-overlay">
      <div className="manga-reader-header">
        <button className="manga-reader-close" onClick={onClose} title="Close">✕</button>
        <div className="manga-reader-title">
          <span className="manga-reader-manga-name">{comic.title}</span>
          <span className="manga-reader-chapter-name">{chapterLabel}</span>
        </div>
        <div className="manga-reader-controls">
          <button className="manga-reader-nav" onClick={onPrev} disabled={!hasPrev}>‹ Prev</button>
          <button className="manga-reader-nav" onClick={toggleFullscreen} title="Fullscreen">
            {isFullscreen ? '↙' : '↗'}
          </button>
          <button className="manga-reader-nav" onClick={onNext} disabled={!hasNext}>Next ›</button>
        </div>
      </div>

      <div className="manga-reader-body vertical" ref={wrapRef}>
        {frameBlocked ? (
          <div className="manga-reader-loading" style={{ gap: '1rem' }}>
            <p style={{ fontSize: '2rem', margin: 0 }}>🚫</p>
            <p style={{ color: '#888' }}>This site blocked embedding.</p>
            <a className="btn-watch" href={chapter.url} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}>
              Open Chapter in New Tab →
            </a>
          </div>
        ) : (
          <iframe
            key={chapter.url}
            src={chapter.url}
            className="comix-frame"
            style={{ height: '100%' }}
            title={chapterLabel}
            allowFullScreen
            allow="fullscreen"
            referrerPolicy="no-referrer-when-downgrade"
            onError={() => setFrameBlocked(true)}
          />
        )}
      </div>

      {!frameBlocked && (
        <div className="manga-reader-footer">
          <button onClick={onPrev} disabled={!hasPrev} className="manga-reader-nav">‹ Prev Chapter</button>
          <a href={chapter.url} target="_blank" rel="noopener noreferrer"
            className="manga-reader-nav" style={{ textDecoration: 'none' }}>
            ⧉ Open in New Tab
          </a>
          <button onClick={onNext} disabled={!hasNext} className="manga-reader-nav">Next Chapter ›</button>
        </div>
      )}
    </div>
  );
}

// ─── ChapterModal ─────────────────────────────────────────────
function ChapterModal({ comic, source, onClose, onRead }) {
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showAll, setShowAll]   = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getChapters({ url: comic.url, source }, ctrl.signal)
      .then(chs => setChapters(chs))
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [comic.url, source]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const displayed = showAll ? chapters : chapters.slice(0, 15);

  return (
    <div className="manga-detail-overlay" onClick={onClose}>
      <div className="manga-detail-modal" onClick={e => e.stopPropagation()}>
        <button className="manga-detail-close" onClick={onClose}>✕</button>

        <div className="manga-detail-top">
          {comic.coverImage && (
            <div className="manga-detail-cover">
              <img src={comic.coverImage} alt={comic.title} referrerPolicy="no-referrer"
                onError={e => { e.target.style.display = 'none'; }} />
            </div>
          )}
          <div className="manga-detail-info">
            <h2 className="manga-detail-title">{comic.title}</h2>
            {comic.latestChapter && (
              <p className="manga-detail-author">Latest: Ch. {comic.latestChapter}</p>
            )}
            {comic.rating && (
              <p className="manga-detail-year">⭐ {Number(comic.rating).toFixed(1)}</p>
            )}
            {chapters.length > 0 && (
              <button className="btn-watch manga-read-first-btn"
                onClick={() => onRead(chapters[0], chapters)}>
                Read Chapter {chapters[0]?.number || '1'}
              </button>
            )}
          </div>
        </div>

        <div className="manga-chapter-list">
          <h3 className="manga-chapter-list-title">
            Chapters
            {!loading && <span className="manga-chapter-count">{chapters.length}</span>}
          </h3>

          {loading && <p className="manga-chapter-loading">Loading chapters…</p>}
          {error   && <p className="manga-chapter-error">⚠️ {error}</p>}
          {!loading && chapters.length === 0 && !error && (
            <p className="manga-chapter-empty">No chapters found for this title.</p>
          )}

          <div className="manga-chapter-grid">
            {displayed.map(ch => (
              <button key={ch.id || ch.url} type="button"
                className="manga-chapter-btn" onClick={() => onRead(ch, chapters)}>
                <span className="manga-chapter-num">
                  {ch.number ? `Ch. ${ch.number}` : 'Read'}
                </span>
                {ch.title && <span className="manga-chapter-name">{ch.title}</span>}
                {ch.group?.name && <span className="manga-chapter-pages">{ch.group.name}</span>}
              </button>
            ))}
          </div>

          {chapters.length > 15 && (
            <button className="btn-ghost btn-sm manga-show-all-btn"
              onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show less' : `Show all ${chapters.length} chapters`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ComicCard ────────────────────────────────────────────────
function ComicCard({ comic, onClick }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <button type="button" className="manga-card" onClick={() => onClick(comic)}>
      <div className="manga-card-cover">
        {comic.coverImage && !imgErr ? (
          <img src={comic.coverImage} alt={comic.title} loading="lazy" decoding="async"
            referrerPolicy="no-referrer" onError={() => setImgErr(true)} />
        ) : (
          <div className="manga-card-placeholder">
            <span>{comic.title?.charAt(0) || '?'}</span>
          </div>
        )}
        {comic.latestChapter && (
          <span className="manga-card-status">Ch. {comic.latestChapter}</span>
        )}
      </div>
      <div className="manga-card-copy">
        <p className="manga-card-title">{comic.title}</p>
        {comic.rating && (
          <p className="manga-card-author">⭐ {Number(comic.rating).toFixed(1)}</p>
        )}
      </div>
    </button>
  );
}

// ─── MangaTab (main export) ───────────────────────────────────
export default function MangaTab() {
  const [sources, setSources]       = useState([]);
  const [source, setSource]         = useState('');
  const [query, setQuery]           = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [selected, setSelected]     = useState(null);
  const [reader, setReader]         = useState(null);   // { comic, chapters, index }
  const abortRef = useRef(null);

  // Load sources once — prefer a curated subset so the dropdown isn't 69 items
  const CURATED = ['mangakatana','weebcentral','asurascan','flamecomics','webtoon','mangapark','bato','mangaread','likemanga'];
  useEffect(() => {
    const ctrl = new AbortController();
    getSources(ctrl.signal)
      .then(list => {
        const curated = list.filter(s => CURATED.includes(s.id));
        const shown   = curated.length ? curated : list.slice(0, 12);
        setSources(shown);
        const preferred = shown.find(s => s.id === 'mangakatana') || shown[0];
        if (preferred) setSource(preferred.id);
      })
      .catch(() => {});
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Search
  useEffect(() => {
    if (!debouncedQ || !source) { setResults([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');

    searchComics({ query: debouncedQ, source }, ctrl.signal)
      .then(setResults)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [debouncedQ, source]);

  const openReader = useCallback((comic, chapters, index) => {
    setReader({ comic, chapters, index });
    setSelected(null);
  }, []);

  if (reader) {
    return (
      <MangaReader
        comic={reader.comic}
        chapter={reader.chapters[reader.index]}
        chapters={reader.chapters}
        hasPrev={reader.index > 0}
        hasNext={reader.index < reader.chapters.length - 1}
        onPrev={() => setReader(r => ({ ...r, index: r.index - 1 }))}
        onNext={() => setReader(r => ({ ...r, index: r.index + 1 }))}
        onClose={() => setReader(null)}
      />
    );
  }

  return (
    <>
      <section className="surface-panel">
        <div className="surface-panel-header">
          <div>
            <h2>Manga, Manhwa &amp; Comics</h2>
            <p className="surface-panel-copy">
              Search across 65+ scanlation sites — read chapters in-site or open in a new tab.
            </p>
          </div>
          {sources.length > 0 && (
            <p className="surface-panel-meta">{sources.length} sources</p>
          )}
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search manga, manhwa, comics…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {sources.length > 0 && (
            <select
              className="filter-input"
              value={source}
              onChange={e => setSource(e.target.value)}
              aria-label="Source"
            >
              {sources.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      </section>

      <section className="surface-panel surface-panel-spacious">
        {error && (
          <div className="manga-error-banner">⚠️ {error}</div>
        )}

        {!debouncedQ && !loading && (
          <div className="empty-state">
            <p style={{ fontSize: '2rem', margin: 0 }}>📖</p>
            <p>Search for a manga, manhwa, or comic above.</p>
            <p className="empty-hint">Try "Solo Leveling", "One Piece", or "Batman".</p>
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
            <p>No results for "{debouncedQ}".</p>
            <p className="empty-hint">Try a different title or switch the source.</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="manga-grid">
            {results.map((comic, i) => (
              <ComicCard key={comic.id || comic.url || i} comic={comic}
                onClick={setSelected} />
            ))}
          </div>
        )}
      </section>

      {selected && (
        <ChapterModal
          comic={selected}
          source={source}
          onClose={() => setSelected(null)}
          onRead={(ch, allChapters) => {
            const idx = allChapters.findIndex(c => (c.id || c.url) === (ch.id || ch.url));
            openReader(selected, allChapters, Math.max(0, idx));
          }}
        />
      )}
    </>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchManga, getPopular, getMangaChapters, getChapterPages } from '../utils/mangadexApi';

// ─── MangaReader (image-based, vertical scroll) ───────────────
function MangaReader({ comic, chapters, index, onClose, onPrev, onNext }) {
  const chapter  = chapters[index];
  const hasPrev  = index > 0;
  const hasNext  = index < chapters.length - 1;

  const [pages, setPages]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [dataSaver, setDataSaver] = useState(false);
  const topRef = useRef(null);

  useEffect(() => {
    if (!chapter) return;
    setLoading(true);
    setError('');
    setPages([]);
    const ctrl = new AbortController();
    getChapterPages(chapter.id, ctrl.signal)
      .then(({ pages: p, dataSaverPages: dp }) => {
        setPages(dataSaver ? dp : p);
        topRef.current?.scrollTo({ top: 0 });
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [chapter, dataSaver]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape')    onClose();
      if (e.key === 'ArrowLeft'  && hasPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const chapterLabel = chapter?.number
    ? `Chapter ${chapter.number}${chapter.title ? ' — ' + chapter.title : ''}`
    : chapter?.title || 'Chapter';

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
          <button
            className={`manga-reader-nav${dataSaver ? ' manga-reader-nav--active' : ''}`}
            onClick={() => setDataSaver(v => !v)}
            title="Toggle data saver (lower quality)"
          >
            {dataSaver ? 'HQ' : 'LQ'}
          </button>
          <button className="manga-reader-nav" onClick={onNext} disabled={!hasNext}>Next ›</button>
        </div>
      </div>

      <div className="manga-reader-body vertical" ref={topRef}>
        {loading && (
          <div className="manga-reader-loading">
            <div className="manga-reader-spinner" />
            <p>Loading pages…</p>
          </div>
        )}
        {error && (
          <div className="manga-reader-loading">
            <p style={{ fontSize: '2rem', margin: 0 }}>⚠️</p>
            <p style={{ color: '#f87171' }}>{error}</p>
          </div>
        )}
        {!loading && !error && pages.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`Page ${i + 1}`}
            className="manga-page-img"
            loading={i < 3 ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ))}
      </div>

      <div className="manga-reader-footer">
        <button onClick={onPrev} disabled={!hasPrev} className="manga-reader-nav">‹ Prev Chapter</button>
        <span className="manga-reader-page-count">{pages.length} pages</span>
        <button onClick={onNext} disabled={!hasNext} className="manga-reader-nav">Next Chapter ›</button>
      </div>
    </div>
  );
}

// ─── ChapterModal ─────────────────────────────────────────────
function ChapterModal({ comic, onClose, onRead }) {
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showAll, setShowAll]   = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getMangaChapters(comic.id, ctrl.signal)
      .then(setChapters)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [comic.id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const displayed = showAll ? chapters : chapters.slice(0, 20);

  return (
    <div className="manga-detail-overlay" onClick={onClose}>
      <div className="manga-detail-modal" onClick={e => e.stopPropagation()}>
        <button className="manga-detail-close" onClick={onClose}>✕</button>

        <div className="manga-detail-top">
          {comic.cover && (
            <div className="manga-detail-cover">
              <img src={comic.cover} alt={comic.title} referrerPolicy="no-referrer"
                onError={e => { e.target.style.display = 'none'; }} />
            </div>
          )}
          <div className="manga-detail-info">
            <h2 className="manga-detail-title">{comic.title}</h2>
            {comic.author && <p className="manga-detail-author">{comic.author}</p>}
            {comic.status && <p className="manga-detail-year" style={{ textTransform: 'capitalize' }}>{comic.status}</p>}
            {comic.latestChapter && (
              <p className="manga-detail-year">Latest: Ch. {comic.latestChapter}</p>
            )}
            {comic.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                {comic.tags.map(tag => (
                  <span key={tag} className="manga-tag">{tag}</span>
                ))}
              </div>
            )}
            {chapters.length > 0 && (
              <button className="btn-watch manga-read-first-btn"
                onClick={() => onRead(chapters[0], chapters)}>
                Read Chapter {chapters[0]?.number || '1'}
              </button>
            )}
          </div>
        </div>

        {comic.description && (
          <p className="manga-detail-desc">{comic.description}</p>
        )}

        <div className="manga-chapter-list">
          <h3 className="manga-chapter-list-title">
            Chapters
            {!loading && <span className="manga-chapter-count">{chapters.length}</span>}
          </h3>

          {loading && <p className="manga-chapter-loading">Loading chapters…</p>}
          {error   && <p className="manga-chapter-error">⚠️ {error}</p>}
          {!loading && chapters.length === 0 && !error && (
            <p className="manga-chapter-empty">No English chapters found.</p>
          )}

          <div className="manga-chapter-grid">
            {displayed.map(ch => (
              <button key={ch.id} type="button"
                className="manga-chapter-btn" onClick={() => onRead(ch, chapters)}>
                <span className="manga-chapter-num">
                  {ch.number ? `Ch. ${ch.number}` : 'Oneshot'}
                </span>
                {ch.title && <span className="manga-chapter-name">{ch.title}</span>}
                {ch.group  && <span className="manga-chapter-pages">{ch.group}</span>}
              </button>
            ))}
          </div>

          {chapters.length > 20 && (
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

// ─── MangaCard ────────────────────────────────────────────────
function MangaCard({ manga, onClick }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <button type="button" className="manga-card" onClick={() => onClick(manga)}>
      <div className="manga-card-cover">
        {manga.cover && !imgErr ? (
          <img src={manga.cover} alt={manga.title} loading="lazy" decoding="async"
            referrerPolicy="no-referrer" onError={() => setImgErr(true)} />
        ) : (
          <div className="manga-card-placeholder">
            <span>{manga.title?.charAt(0) || '?'}</span>
          </div>
        )}
        {manga.latestChapter && (
          <span className="manga-card-status">Ch. {manga.latestChapter}</span>
        )}
      </div>
      <div className="manga-card-copy">
        <p className="manga-card-title">{manga.title}</p>
        {manga.author && <p className="manga-card-author">{manga.author}</p>}
      </div>
    </button>
  );
}

// ─── MangaTab (main export) ───────────────────────────────────
export default function MangaTab() {
  const [query, setQuery]         = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults]     = useState([]);
  const [popular, setPopular]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [popularLoading, setPopularLoading] = useState(true);
  const [error, setError]         = useState('');
  const [selected, setSelected]   = useState(null);
  const [reader, setReader]       = useState(null);  // { comic, chapters, index }
  const abortRef = useRef(null);

  // Load popular on mount
  useEffect(() => {
    const ctrl = new AbortController();
    getPopular(ctrl.signal)
      .then(setPopular)
      .catch(() => {})
      .finally(() => setPopularLoading(false));
    return () => ctrl.abort();
  }, []);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Search
  useEffect(() => {
    if (!debouncedQ) { setResults([]); setError(''); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');

    searchManga(debouncedQ, ctrl.signal)
      .then(setResults)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [debouncedQ]);

  const openReader = useCallback((ch, chapters) => {
    const idx = chapters.findIndex(c => c.id === ch.id);
    setReader({ comic: selected, chapters, index: Math.max(0, idx) });
    setSelected(null);
  }, [selected]);

  if (reader) {
    return (
      <MangaReader
        comic={reader.comic}
        chapters={reader.chapters}
        index={reader.index}
        onPrev={() => setReader(r => ({ ...r, index: r.index - 1 }))}
        onNext={() => setReader(r => ({ ...r, index: r.index + 1 }))}
        onClose={() => setReader(null)}
      />
    );
  }

  const displayList  = debouncedQ ? results : popular;
  const isSearching  = Boolean(debouncedQ);
  const showSkeleton = isSearching ? loading : popularLoading;

  return (
    <>
      <section className="surface-panel">
        <div className="surface-panel-header">
          <div>
            <h2>Manga, Manhwa &amp; Comics</h2>
            <p className="surface-panel-copy">
              Powered by MangaDex — search or browse popular titles, then read chapters right here.
            </p>
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search manga, manhwa, comics…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </section>

      <section className="surface-panel surface-panel-spacious">
        {error && <div className="manga-error-banner">⚠️ {error}</div>}

        {showSkeleton && (
          <div className="manga-skeleton-grid">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="manga-skeleton-card">
                <div className="manga-skeleton-cover" />
                <div className="manga-skeleton-line" />
                <div className="manga-skeleton-line short" />
              </div>
            ))}
          </div>
        )}

        {!showSkeleton && isSearching && results.length === 0 && !error && (
          <div className="empty-state">
            <p style={{ fontSize: '2rem', margin: 0 }}>🔍</p>
            <p>No results for "{debouncedQ}".</p>
            <p className="empty-hint">Try a different title.</p>
          </div>
        )}

        {!showSkeleton && displayList.length > 0 && (
          <>
            {!isSearching && (
              <h3 className="manga-section-heading">Popular Right Now</h3>
            )}
            <div className="manga-grid">
              {displayList.map((manga, i) => (
                <MangaCard key={manga.id || i} manga={manga} onClick={setSelected} />
              ))}
            </div>
          </>
        )}
      </section>

      {selected && (
        <ChapterModal
          comic={selected}
          onClose={() => setSelected(null)}
          onRead={openReader}
        />
      )}
    </>
  );
}

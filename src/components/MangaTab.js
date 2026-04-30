import { useState, useEffect, useRef, useCallback } from 'react';
import {
  searchManga,
  getMangaChapters,
  getChapterPages,
  getMangaCover,
  getMangaTitle,
  getMangaDescription,
  getMangaAuthor,
  getMangaFormat,
  FORMAT_LABELS,
} from '../utils/mangadexApi';

// ─── MangaCard ────────────────────────────────────────────────
function MangaCard({ manga, onClick }) {
  const cover  = getMangaCover(manga.id, manga.relationships);
  const title  = getMangaTitle(manga);
  const author = getMangaAuthor(manga);
  const format = getMangaFormat(manga);
  const [imgErr, setImgErr] = useState(false);

  return (
    <button type="button" className="manga-card" onClick={() => onClick(manga)}>
      <div className="manga-card-cover">
        {cover && !imgErr ? (
          <img src={cover} alt={title} loading="lazy" decoding="async"
            referrerPolicy="no-referrer" onError={() => setImgErr(true)} />
        ) : (
          <div className="manga-card-placeholder">
            <span>{title.charAt(0)}</span>
          </div>
        )}
        <span className="manga-card-badge">{FORMAT_LABELS[format]}</span>
        {manga.attributes?.status === 'ongoing' && (
          <span className="manga-card-status">Ongoing</span>
        )}
      </div>
      <div className="manga-card-copy">
        <p className="manga-card-title">{title}</p>
        {author && <p className="manga-card-author">{author}</p>}
      </div>
    </button>
  );
}

// ─── MangaReader ──────────────────────────────────────────────
function MangaReader({ manga, chapter, chapters, onClose, onChapterChange }) {
  const [pages, setPages]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const containerRef = useRef(null);
  const pageRefs     = useRef([]);
  const abortRef     = useRef(null);
  const isVertical   = ['manhwa', 'manhua'].includes(getMangaFormat(manga));

  const chapterTitle = chapter?.attributes?.chapter
    ? `Chapter ${chapter.attributes.chapter}${chapter.attributes.title ? ' — ' + chapter.attributes.title : ''}`
    : 'Oneshot';

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    setPages([]);
    setCurrentPage(0);

    getChapterPages(chapter.id, ctrl.signal)
      .then(setPages)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [chapter.id]);

  // Track current page in vertical scroll mode
  useEffect(() => {
    if (!isVertical || !pages.length) return;
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const idx = Number(e.target.dataset.page);
          if (!isNaN(idx)) setCurrentPage(idx);
        }
      }
    }, { threshold: 0.5 });
    pageRefs.current.forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  }, [pages, isVertical]);

  function prevChapter() {
    const idx = chapters.findIndex(c => c.id === chapter.id);
    if (idx > 0) onChapterChange(chapters[idx - 1]);
  }
  function nextChapter() {
    const idx = chapters.findIndex(c => c.id === chapter.id);
    if (idx < chapters.length - 1) onChapterChange(chapters[idx + 1]);
  }
  function prevPage() { setCurrentPage(p => Math.max(0, p - 1)); }
  function nextPage() { setCurrentPage(p => Math.min(pages.length - 1, p + 1)); }

  const chapterIdx = chapters.findIndex(c => c.id === chapter.id);

  // Keyboard nav
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (!isVertical) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage();
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevPage();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="manga-reader-overlay">
      <div className="manga-reader-header">
        <button className="manga-reader-close" onClick={onClose} title="Close">✕</button>
        <div className="manga-reader-title">
          <span className="manga-reader-manga-name">{getMangaTitle(manga)}</span>
          <span className="manga-reader-chapter-name">{chapterTitle}</span>
        </div>
        <div className="manga-reader-controls">
          <button className="manga-reader-nav" onClick={prevChapter} disabled={chapterIdx <= 0}>‹ Prev</button>
          <span className="manga-reader-progress">
            {loading ? '…' : `${currentPage + 1} / ${pages.length}`}
          </span>
          <button className="manga-reader-nav" onClick={nextChapter} disabled={chapterIdx >= chapters.length - 1}>Next ›</button>
        </div>
      </div>

      <div className={`manga-reader-body ${isVertical ? 'vertical' : 'paged'}`} ref={containerRef}>
        {loading && (
          <div className="manga-reader-loading">
            <div className="manga-reader-spinner" />
            <p>Loading pages…</p>
          </div>
        )}
        {error && <div className="manga-reader-error">⚠️ {error}</div>}

        {!loading && !error && isVertical && (
          <div className="manga-reader-scroll">
            {pages.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Page ${i + 1}`}
                className="manga-reader-page-img"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                data-page={i}
                ref={el => { pageRefs.current[i] = el; }}
              />
            ))}
          </div>
        )}

        {!loading && !error && !isVertical && pages.length > 0 && (
          <div className="manga-reader-paged">
            <button className="manga-reader-page-btn left" onClick={prevPage} disabled={currentPage === 0}>‹</button>
            <img
              key={currentPage}
              src={pages[currentPage]}
              alt={`Page ${currentPage + 1}`}
              className="manga-reader-page-img-paged"
              referrerPolicy="no-referrer"
            />
            <button className="manga-reader-page-btn right" onClick={nextPage} disabled={currentPage >= pages.length - 1}>›</button>
          </div>
        )}
      </div>

      {!isVertical && pages.length > 0 && (
        <div className="manga-reader-footer">
          <button onClick={prevPage} disabled={currentPage === 0} className="manga-reader-nav">‹ Prev Page</button>
          <span>{currentPage + 1} / {pages.length}</span>
          <button onClick={nextPage} disabled={currentPage >= pages.length - 1} className="manga-reader-nav">Next Page ›</button>
        </div>
      )}
    </div>
  );
}

// ─── MangaDetailModal ─────────────────────────────────────────
function MangaDetailModal({ manga, onClose }) {
  const [chapters, setChapters]     = useState([]);
  const [chapLoading, setChapLoading] = useState(true);
  const [chapError, setChapError]   = useState('');
  const [activeReader, setActiveReader] = useState(null);
  const [showAllChapters, setShowAllChapters] = useState(false);

  const cover   = getMangaCover(manga.id, manga.relationships);
  const title   = getMangaTitle(manga);
  const desc    = getMangaDescription(manga);
  const author  = getMangaAuthor(manga);
  const format  = getMangaFormat(manga);
  const status  = manga.attributes?.status;
  const year    = manga.attributes?.year;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getMangaChapters(manga.id, ctrl.signal)
      .then(setChapters)
      .catch(e => { if (e.name !== 'AbortError') setChapError(e.message); })
      .finally(() => setChapLoading(false));
    return () => ctrl.abort();
  }, [manga.id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !activeReader) onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, activeReader]);

  const displayChapters = showAllChapters ? chapters : chapters.slice(0, 12);

  if (activeReader) {
    return (
      <MangaReader
        manga={manga}
        chapter={activeReader}
        chapters={chapters}
        onClose={() => setActiveReader(null)}
        onChapterChange={setActiveReader}
      />
    );
  }

  return (
    <div className="manga-detail-overlay" onClick={onClose}>
      <div className="manga-detail-modal" onClick={e => e.stopPropagation()}>
        <button className="manga-detail-close" onClick={onClose}>✕</button>

        <div className="manga-detail-top">
          <div className="manga-detail-cover">
            {cover && !imgErr ? (
              <img src={cover} alt={title} referrerPolicy="no-referrer" onError={() => setImgErr(true)} />
            ) : (
              <div className="manga-detail-cover-placeholder"><span>{title.charAt(0)}</span></div>
            )}
          </div>

          <div className="manga-detail-info">
            <div className="manga-detail-badges">
              <span className="manga-format-badge">{FORMAT_LABELS[format]}</span>
              {status && <span className={`manga-status-badge ${status}`}>{status}</span>}
            </div>
            <h2 className="manga-detail-title">{title}</h2>
            {author && <p className="manga-detail-author">by {author}</p>}
            {year   && <p className="manga-detail-year">{year}</p>}
            {desc && <p className="manga-detail-desc">{desc.slice(0, 400)}{desc.length > 400 ? '…' : ''}</p>}

            {chapters.length > 0 && (
              <button className="btn-watch manga-read-first-btn" onClick={() => setActiveReader(chapters[0])}>
                Read Chapter 1
              </button>
            )}
          </div>
        </div>

        <div className="manga-chapter-list">
          <h3 className="manga-chapter-list-title">
            Chapters <span className="manga-chapter-count">{chapters.length}</span>
          </h3>

          {chapLoading && <p className="manga-chapter-loading">Loading chapters…</p>}
          {chapError  && <p className="manga-chapter-error">⚠️ {chapError}</p>}

          {!chapLoading && chapters.length === 0 && !chapError && (
            <p className="manga-chapter-empty">No English chapters available yet.</p>
          )}

          <div className="manga-chapter-grid">
            {displayChapters.map(ch => {
              const num   = ch.attributes?.chapter ?? '?';
              const name  = ch.attributes?.title;
              const pages = ch.attributes?.pages;
              return (
                <button
                  key={ch.id}
                  type="button"
                  className="manga-chapter-btn"
                  onClick={() => setActiveReader(ch)}
                >
                  <span className="manga-chapter-num">Ch. {num}</span>
                  {name && <span className="manga-chapter-name">{name}</span>}
                  {pages && <span className="manga-chapter-pages">{pages}p</span>}
                </button>
              );
            })}
          </div>

          {chapters.length > 12 && (
            <button className="btn-ghost btn-sm manga-show-all-btn"
              onClick={() => setShowAllChapters(v => !v)}>
              {showAllChapters ? 'Show less' : `Show all ${chapters.length} chapters`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MangaTab (main export) ───────────────────────────────────
const FORMATS = ['all', 'manga', 'manhwa', 'manhua', 'comics'];
const PAGE_SIZE = 24;

export default function MangaTab() {
  const [query, setQuery]         = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [format, setFormat]       = useState('all');
  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [selected, setSelected]   = useState(null);
  const abortRef = useRef(null);
  const loadMoreRef = useRef(null);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Reset page on filter change
  useEffect(() => { setPage(1); setItems([]); }, [debouncedQ, format]);

  // Fetch
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');

    searchManga({ query: debouncedQ, format, page, pageSize: PAGE_SIZE, signal: ctrl.signal })
      .then(json => {
        const next = json.data || [];
        setItems(prev => page === 1 ? next : [...prev, ...next]);
        setTotal(json.total || 0);
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [debouncedQ, format, page]);

  // Infinite scroll
  const onObserve = useCallback(entries => {
    if (entries[0]?.isIntersecting && !loading && page < totalPages) {
      setPage(p => p + 1);
    }
  }, [loading, page, totalPages]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(onObserve, { rootMargin: '300px' });
    obs.observe(node);
    return () => obs.disconnect();
  }, [onObserve]);

  return (
    <>
      {/* Filters */}
      <section className="surface-panel">
        <div className="surface-panel-header">
          <div>
            <h2>Browse Manga & Comics</h2>
            <p className="surface-panel-copy">
              Powered by MangaDex — thousands of manga, manhwa, manhua, and comics with in-site reading.
            </p>
          </div>
          <p className="surface-panel-meta">
            {loading && page === 1 ? 'Loading…' : `${total.toLocaleString()} titles`}
          </p>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search titles…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="manga-format-tabs">
            {FORMATS.map(f => (
              <button
                key={f}
                type="button"
                className={`manga-format-tab ${format === f ? 'active' : ''}`}
                onClick={() => setFormat(f)}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="surface-panel surface-panel-spacious">
        {error && <div className="manga-error-banner">⚠️ {error} — MangaDex may be temporarily unavailable.</div>}

        {loading && page === 1 ? (
          <div className="manga-skeleton-grid">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="manga-skeleton-card">
                <div className="manga-skeleton-cover" />
                <div className="manga-skeleton-line" />
                <div className="manga-skeleton-line short" />
              </div>
            ))}
          </div>
        ) : items.length === 0 && !loading ? (
          <div className="empty-state">
            <p style={{ fontSize: '2rem', margin: 0 }}>📖</p>
            <p>No titles found.</p>
            <p className="empty-hint">Try a different search or format filter.</p>
          </div>
        ) : (
          <>
            <div className="manga-grid">
              {items.map(m => (
                <MangaCard key={m.id} manga={m} onClick={setSelected} />
              ))}
            </div>

            {loading && page > 1 && (
              <p className="books-pagination-copy" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                Loading more…
              </p>
            )}
            {!loading && page >= totalPages && items.length > 0 && (
              <p className="books-pagination-copy" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                All {total.toLocaleString()} titles loaded.
              </p>
            )}
            {page < totalPages && <div ref={loadMoreRef} style={{ height: 1 }} />}
          </>
        )}
      </section>

      {selected && (
        <MangaDetailModal manga={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

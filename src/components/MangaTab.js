import { useState, useEffect, useRef, useCallback } from 'react';
import { SOURCES, searchBySource, popularBySource, chaptersBySource, pagesBySource } from '../utils/mangaSources';
import RatingInput from './RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from './RatingArtifact';
import BottomSheet from './BottomSheet';
import useDeviceType from '../hooks/useDeviceType';

// ─── Manga localStorage storage ───────────────────────────────
const LS_LIST    = 'manga_reading_list';
const LS_RATINGS = 'manga_ratings';

function getLS(key)     { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function setLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

export function getMangaListItem(id)        { return getLS(LS_LIST)[id]    || null; }
export function getMangaRating(id)          { return getLS(LS_RATINGS)[id] || null; }

function upsertMangaListItem(manga, status) {
  const list = getLS(LS_LIST);
  list[manga.id] = { id: manga.id, title: manga.title, cover: manga.cover, status, savedAt: Date.now() };
  setLS(LS_LIST, list);
  return list[manga.id];
}
function removeMangaListItem(id) { const l = getLS(LS_LIST); delete l[id]; setLS(LS_LIST, l); }
function saveMangaRating(id, scores) { const r = getLS(LS_RATINGS); r[id] = scores; setLS(LS_RATINGS, r); return scores; }

const MANGA_STATUSES = [
  { value: 'plan_to_read',  label: 'Plan to Read' },
  { value: 'reading',       label: 'Currently Reading' },
  { value: 'completed',     label: 'Completed' },
  { value: 'on_hold',       label: 'On Hold' },
  { value: 'dropped',       label: 'Dropped' },
];

// ─── MangaReader ──────────────────────────────────────────────
function MangaReader({ comic, chapters, index, source, onClose, onPrev, onNext }) {
  const chapter = chapters[index];
  const hasPrev = index > 0;
  const hasNext = index < chapters.length - 1;

  const [pages, setPages]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [dataSaver, setDataSaver] = useState(false);
  const topRef = useRef(null);

  const isExternal = Boolean(chapter?.externalUrl);

  useEffect(() => {
    if (!chapter) return;
    setLoading(true);
    setError('');
    setPages([]);
    if (isExternal) { setLoading(false); return; }
    const ctrl = new AbortController();
    pagesBySource(source, chapter.id, ctrl.signal)
      .then(({ pages: p, dataSaverPages: dp }) => {
        setPages(dataSaver ? dp : p);
        topRef.current?.scrollTo({ top: 0 });
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [chapter, dataSaver, isExternal, source]);

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

  let hostname = '';
  if (isExternal) {
    try { hostname = new URL(chapter.externalUrl).hostname.replace('www.', ''); } catch {}
  }

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
          {!isExternal && (
            <button
              className={`manga-reader-nav${dataSaver ? ' manga-reader-nav--active' : ''}`}
              onClick={() => setDataSaver(v => !v)}
            >
              {dataSaver ? 'HQ' : 'LQ'}
            </button>
          )}
          <button className="manga-reader-nav" onClick={onNext} disabled={!hasNext}>Next ›</button>
        </div>
      </div>

      {/* External chapter: full-height iframe embed */}
      {isExternal ? (
        <div className="manga-reader-external">
          <div className="manga-external-banner">
            <span>Hosted by <strong>{hostname}</strong></span>
            <a href={chapter.externalUrl} target="_blank" rel="noopener noreferrer"
              className="manga-external-newtab">
              Open in new tab ↗
            </a>
          </div>
          {/* sandbox intentionally omitted — the embedded reader detects sandbox attributes and stops working if one is present */}
          <iframe
            src={chapter.externalUrl}
            className="manga-external-iframe"
            allow="fullscreen; autoplay"
            allowFullScreen
            title={chapterLabel}
          />
        </div>
      ) : (
        /* MangaDex-hosted pages */
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
          {!loading && !error && pages.length === 0 && (
            <div className="manga-reader-loading">
              <p style={{ fontSize: '2rem', margin: 0 }}>📭</p>
              <p style={{ color: '#888' }}>No pages available for this chapter.</p>
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
      )}

      <div className="manga-reader-footer">
        <button onClick={onPrev} disabled={!hasPrev} className="manga-reader-nav">‹ Prev Chapter</button>
        <span className="manga-reader-page-count">{pages.length > 0 ? `${pages.length} pages` : ''}</span>
        <button onClick={onNext} disabled={!hasNext} className="manga-reader-nav">Next Chapter ›</button>
      </div>
    </div>
  );
}

// ─── ChapterModal (full book-style detail view) ───────────────
function ChapterModal({ comic, source, onClose, onRead }) {
  const { isMobile } = useDeviceType();
  const [chapters, setChapters]     = useState([]);
  const [chapLoading, setChapLoading] = useState(true);
  const [chapError, setChapError]   = useState('');
  const [showAll, setShowAll]       = useState(false);
  const [tab, setTab]               = useState('info');

  // Library state
  const [saved, setSaved]           = useState(() => getMangaListItem(comic.id));
  const [listOpen, setListOpen]     = useState(false);
  const listRef                     = useRef(null);

  // Rating state
  const [draftScores, setDraftScores] = useState(() => getMangaRating(comic.id) || {});
  const [isSaving, setIsSaving]     = useState(false);
  const [ratingMsg, setRatingMsg]   = useState('');

  const cats = RATING_CATEGORIES.manga;
  const canSave = cats.every(cat => draftScores[cat.key] >= 1);
  const displayScore = computeNormalizedScore('manga', draftScores);

  useEffect(() => {
    const ctrl = new AbortController();
    chaptersBySource(source, comic.id, ctrl.signal)
      .then(setChapters)
      .catch(e => { if (e.name !== 'AbortError') setChapError(e.message); })
      .finally(() => setChapLoading(false));
    return () => ctrl.abort();
  }, [source, comic.id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Close library dropdown on outside click
  useEffect(() => {
    function onOut(e) { if (listRef.current && !listRef.current.contains(e.target)) setListOpen(false); }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  function selectStatus(status) {
    const item = upsertMangaListItem(comic, status);
    setSaved(item);
    setListOpen(false);
  }
  function removeFromLibrary() { removeMangaListItem(comic.id); setSaved(null); setListOpen(false); }

  function handleSaveRating() {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    saveMangaRating(comic.id, draftScores);
    setRatingMsg('Rating saved!');
    setIsSaving(false);
    setTimeout(() => setRatingMsg(''), 2500);
  }

  const displayed = showAll ? chapters : chapters.slice(0, 20);

  const libraryLabel = saved
    ? `✓ ${MANGA_STATUSES.find(s => s.value === saved.status)?.label || 'In Library'}`
    : '+ Library';

  if (isMobile) {
    return (
      <div className="mob-detail-overlay" role="dialog" aria-modal="true" aria-label={comic.title}>
        <div className="mob-detail-hero">
          {comic.cover ? (
            <img src={comic.cover} alt={comic.title} className="mob-detail-hero-img" referrerPolicy="no-referrer"
              onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            <div className="mob-detail-hero-placeholder"><span>{comic.title?.charAt(0) || '?'}</span></div>
          )}
          <div className="mob-detail-hero-grad" />
          <button type="button" className="mob-detail-back" onClick={onClose} aria-label="Go back">← Back</button>
        </div>

        <div className="mob-detail-scroll">
          <div className="mob-detail-head">
            <h1 className="mob-detail-title">{comic.title}</h1>
            {comic.author && <p className="mob-detail-subtitle">{comic.author}</p>}
            <div className="mob-detail-chips">
              {comic.status && <span className="mob-detail-chip" style={{ textTransform: 'capitalize' }}>{comic.status}</span>}
              {comic.year && <span className="mob-detail-chip">{comic.year}</span>}
              {comic.contentRating && comic.contentRating !== 'safe' &&
                <span className="mob-detail-chip">{comic.contentRating}</span>}
            </div>
            {displayScore !== null && (
              <div className="mob-detail-scores">
                <span className="mob-detail-community">★ {displayScore}/10</span>
              </div>
            )}
          </div>

          <div className="mob-detail-tabs">
            <button type="button" className={`mob-detail-tab${tab === 'info' ? ' mob-detail-tab--active' : ''}`} onClick={() => setTab('info')}>
              Info
            </button>
            <button type="button" className={`mob-detail-tab${tab === 'rate' ? ' mob-detail-tab--active' : ''}`} onClick={() => setTab('rate')}>
              Rate
            </button>
          </div>

          {tab === 'info' && (
            <div className="mob-detail-tab-content">
              {comic.description && <p className="mob-detail-overview">{comic.description}</p>}
              <div className="manga-chapter-list">
                <h3 className="manga-chapter-list-title">
                  Chapters
                  {!chapLoading && <span className="manga-chapter-count">{chapters.length}</span>}
                </h3>
                {chapLoading && <p className="manga-chapter-loading">Loading chapters…</p>}
                {chapError && <p className="manga-chapter-error">⚠️ {chapError}</p>}
                {!chapLoading && chapters.length === 0 && !chapError && (
                  <p className="manga-chapter-empty">No English chapters found.</p>
                )}
                <div className="manga-chapter-grid">
                  {displayed.map(ch => (
                    <button key={ch.id} type="button" className="manga-chapter-btn" onClick={() => onRead(ch, chapters)}>
                      <span className="manga-chapter-num">{ch.number ? `Ch. ${ch.number}` : 'Oneshot'}</span>
                      {ch.title && <span className="manga-chapter-name">{ch.title}</span>}
                      {ch.externalUrl
                        ? <span className="manga-chapter-pages">↗ External</span>
                        : ch.group && <span className="manga-chapter-pages">{ch.group}</span>}
                    </button>
                  ))}
                </div>
                {chapters.length > 20 && (
                  <button className="btn-ghost btn-sm manga-show-all-btn" onClick={() => setShowAll(v => !v)}>
                    {showAll ? 'Show less' : `Show all ${chapters.length} chapters`}
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'rate' && (
            <div className="mob-detail-tab-content">
              <RatingInput mediaType="manga" value={draftScores} onChange={setDraftScores} />
              <div className="manga-detail-rating-actions" style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className={`btn-primary${canSave ? '' : ' btn-disabled'}`}
                  onClick={handleSaveRating}
                  disabled={!canSave || isSaving}
                >
                  {isSaving ? 'Saving…' : getMangaRating(comic.id) ? 'Update Rating' : 'Save Rating'}
                </button>
                {!canSave && <span className="rating-incomplete-hint">Rate all categories to save</span>}
                {ratingMsg && <span className="rating-incomplete-hint" style={{ color: '#5db88a' }}>{ratingMsg}</span>}
              </div>
            </div>
          )}

          <div className="mob-detail-bar-spacer" />
        </div>

        <div className="mob-detail-bar">
          <button type="button" className="mob-detail-bar-btn mob-detail-bar-btn--secondary" onClick={() => setListOpen(true)}>
            {libraryLabel}
          </button>
          {chapters.length > 0 && (
            <button type="button" className="mob-detail-bar-btn mob-detail-bar-btn--watch" onClick={() => onRead(chapters[0], chapters)}>
              ▶ Read Ch. {chapters[0]?.number || '1'}
            </button>
          )}
        </div>

        <BottomSheet open={listOpen} onClose={() => setListOpen(false)} title="Library status">
          {MANGA_STATUSES.map(s => (
            <button
              key={s.value}
              type="button"
              className={`bsheet-option${saved?.status === s.value ? ' active' : ''}`}
              onClick={() => selectStatus(s.value)}
            >
              <span>{s.label}</span>
              {saved?.status === s.value && <span className="bsheet-option-check">✓</span>}
            </button>
          ))}
          {saved && (
            <button type="button" className="bsheet-option" onClick={removeFromLibrary}>
              <span style={{ color: '#f87171' }}>Remove from Library</span>
            </button>
          )}
        </BottomSheet>
      </div>
    );
  }

  return (
    <div className="manga-detail-overlay" onClick={onClose}>
      <div className="manga-detail-modal manga-detail-modal--wide" onClick={e => e.stopPropagation()}>
        <button className="manga-detail-close" onClick={onClose}>✕</button>

        {/* ── Top section: cover + info ── */}
        <div className="manga-detail-top">
          {comic.cover && (
            <div className="manga-detail-cover">
              <img src={comic.cover} alt={comic.title} referrerPolicy="no-referrer"
                onError={e => { e.target.style.display = 'none'; }} />
              {/* Rating artifact below cover */}
              <div className="manga-detail-artifact">
                <RatingArtifact mediaType="manga" scores={draftScores} size={160} />
                {displayScore !== null && (
                  <p className="manga-detail-score">{displayScore}<span>/10</span></p>
                )}
              </div>
            </div>
          )}

          <div className="manga-detail-info">
            <h2 className="manga-detail-title">{comic.title}</h2>
            {comic.author && <p className="manga-detail-author">{comic.author}</p>}
            <div className="manga-detail-chips">
              {comic.status && <span className="manga-tag" style={{ textTransform: 'capitalize' }}>{comic.status}</span>}
              {comic.year   && <span className="manga-tag">{comic.year}</span>}
              {comic.contentRating && comic.contentRating !== 'safe' &&
                <span className="manga-tag">{comic.contentRating}</span>}
            </div>
            {comic.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.4rem' }}>
                {comic.tags.map(tag => <span key={tag} className="manga-tag">{tag}</span>)}
              </div>
            )}

            {/* ── Rating input ── */}
            <div className="manga-detail-rating-section">
              <p className="manga-detail-section-label">Your Rating</p>
              <RatingInput mediaType="manga" value={draftScores} onChange={setDraftScores} />
              <div className="manga-detail-rating-actions">
                <button
                  type="button"
                  className={`btn-primary${canSave ? '' : ' btn-disabled'}`}
                  onClick={handleSaveRating}
                  disabled={!canSave || isSaving}
                >
                  {isSaving ? 'Saving…' : getMangaRating(comic.id) ? 'Update Rating' : 'Save Rating'}
                </button>
                {!canSave && <span className="rating-incomplete-hint">Rate all categories to save</span>}
                {ratingMsg && <span className="rating-incomplete-hint" style={{ color: '#5db88a' }}>{ratingMsg}</span>}
              </div>
            </div>

            {/* ── Library + Read buttons ── */}
            <div className="manga-detail-actions">
              {/* Library button with dropdown */}
              <div style={{ position: 'relative' }} ref={listRef}>
                <button
                  className={`btn-primary book-detail-library-btn${saved ? ' is-saved' : ''}`}
                  onClick={() => setListOpen(v => !v)}
                >
                  {saved
                    ? `✓ ${MANGA_STATUSES.find(s => s.value === saved.status)?.label || 'In Library'}`
                    : '+ Add to Library'}
                </button>
                {listOpen && (
                  <div className="manga-list-dropdown">
                    {MANGA_STATUSES.map(s => (
                      <button key={s.value}
                        className={`manga-list-dropdown-item${saved?.status === s.value ? ' active' : ''}`}
                        onClick={() => selectStatus(s.value)}>
                        {s.label}
                      </button>
                    ))}
                    {saved && (
                      <button className="manga-list-dropdown-item manga-list-dropdown-remove"
                        onClick={removeFromLibrary}>
                        Remove from Library
                      </button>
                    )}
                  </div>
                )}
              </div>

              {chapters.length > 0 && (
                <button className="btn-watch"
                  onClick={() => onRead(chapters[0], chapters)}>
                  Read Chapter {chapters[0]?.number || '1'}
                </button>
              )}
              {chapLoading && <span style={{ color: '#666', fontSize: '0.82rem' }}>Loading chapters…</span>}
            </div>
          </div>
        </div>

        {/* ── Description ── */}
        {comic.description && <p className="manga-detail-desc">{comic.description}</p>}

        {/* ── Chapter list ── */}
        <div className="manga-chapter-list">
          <h3 className="manga-chapter-list-title">
            Chapters
            {!chapLoading && <span className="manga-chapter-count">{chapters.length}</span>}
          </h3>
          {chapLoading && <p className="manga-chapter-loading">Loading chapters…</p>}
          {chapError   && <p className="manga-chapter-error">⚠️ {chapError}</p>}
          {!chapLoading && chapters.length === 0 && !chapError && (
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
                {ch.externalUrl
                  ? <span className="manga-chapter-pages">↗ External</span>
                  : ch.group && <span className="manga-chapter-pages">{ch.group}</span>
                }
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

// ─── MangaTab ─────────────────────────────────────────────────
export default function MangaTab() {
  const [query, setQuery]           = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults]       = useState([]);
  const [popular, setPopular]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [popularLoading, setPopularLoading] = useState(true);
  const [error, setError]           = useState('');
  const source = SOURCES[0].key;
  const [selected, setSelected]     = useState(null);
  const [reader, setReader]         = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    popularBySource(source, ctrl.signal)
      .then(setPopular)
      .catch(() => {})
      .finally(() => setPopularLoading(false));
    return () => ctrl.abort();
  }, [source]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQ) { setResults([]); setError(''); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    searchBySource(source, debouncedQ, ctrl.signal)
      .then(setResults)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debouncedQ, source]);

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
        source={source}
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
            {!isSearching && <h3 className="manga-section-heading">Popular Right Now</h3>}
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
          source={source}
          onClose={() => setSelected(null)}
          onRead={openReader}
        />
      )}
    </>
  );
}

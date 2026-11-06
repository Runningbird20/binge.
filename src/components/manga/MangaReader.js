import LoadingBar from '../LoadingBar';
import { useState, useEffect, useRef } from 'react';
import { BookOpen, WarningCircle, X } from '@phosphor-icons/react';
import { providerFor } from '../../utils/mangaProviders';

// ─── MangaReader ──────────────────────────────────────────────
export function MangaReader({ comic, chapters, index, onClose, onPrev, onNext }) {
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
    providerFor(comic).getPages(chapter, ctrl.signal)
      .then(({ pages: p, dataSaverPages: dp }) => {
        const list = dataSaver && dp?.length ? dp : p;
        if (!list?.length) throw new Error('This chapter has no pages available. Try another chapter.');
        setPages(list);
        topRef.current?.scrollTo({ top: 0 });
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [chapter, dataSaver, isExternal, comic]);

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
        <button className="manga-reader-close" onClick={onClose} title="Close"><X size={16} weight="bold" /></button>
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
        <div className="manga-reader-external st-official">
          <div className="br-state br-state--card">
            <BookOpen size={40} weight="duotone" />
            <h2>Read this chapter on {hostname || 'the official site'}</h2>
            <p>
              {comic.title} is officially licensed, so this chapter is published by {hostname || 'the publisher'} rather than
              hosted on MangaDex. Official platforms don’t allow embedding, so it opens in a new tab.
            </p>
            <div className="br-actions">
              <a className="st-btn st-btn--primary" href={chapter.externalUrl} target="_blank" rel="noopener noreferrer">
                Open on {hostname || 'official site'}
              </a>
              {hasNext && <button type="button" className="st-btn st-btn--ghost" onClick={onNext}>Next chapter</button>}
            </div>
          </div>
        </div>
      ) : (
        /* MangaDex-hosted pages */
        <div className="manga-reader-body vertical" ref={topRef}>
          {loading && (
            <div className="manga-reader-loading">
              <LoadingBar compact label="Loading manga…" />
              <p>Loading pages…</p>
            </div>
          )}
          {error && (
            <div className="manga-reader-loading">
              <WarningCircle size={36} weight="fill" color="#f87171" aria-hidden="true" />
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

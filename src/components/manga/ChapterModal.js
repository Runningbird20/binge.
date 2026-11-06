import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Star, WarningCircle, X } from '@phosphor-icons/react';
import { providerFor } from '../../utils/mangaProviders';
import RatingInput from '../RatingInput';
import RatingArtifact, { RATING_CATEGORIES, computeNormalizedScore } from '../RatingArtifact';
import BottomSheet from '../BottomSheet';
import useDeviceType from '../../hooks/useDeviceType';
import {
  getMangaListItem,
  getMangaRating,
  upsertMangaListItem,
  removeMangaListItem,
  saveMangaRating,
  MANGA_STATUSES,
} from '../../utils/mangaLibrary';
import { WhereToRead, ExternalRead } from './WhereToRead';

// ─── ChapterModal (full book-style detail view) ───────────────
export function ChapterModal({ comic, onClose, onRead }) {
  const provider = providerFor(comic);
  const external = provider.reading === 'external';
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
    if (external) { setChapLoading(false); return undefined; }
    const ctrl = new AbortController();
    provider.getChapters(comic, ctrl.signal)
      .then((list) => setChapters(Array.isArray(list) ? list : []))
      .catch(e => { if (e.name !== 'AbortError') setChapError(e.message || 'Couldn’t load chapters.'); })
      .finally(() => setChapLoading(false));
    return () => ctrl.abort();
  }, [provider, external, comic]);

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
          <button type="button" className="mob-detail-back" onClick={onClose} aria-label="Go back"><ArrowLeft size={16} weight="bold" aria-hidden="true" /> Back</button>
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
                <span className="mob-detail-community"><Star size={12} weight="fill" aria-hidden="true" /> {displayScore}/10</span>
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
              <WhereToRead comic={comic} />
              {external ? <ExternalRead comic={comic} provider={provider} /> : (
              <div className="manga-chapter-list">
                <h3 className="manga-chapter-list-title">
                  Chapters
                  {!chapLoading && <span className="manga-chapter-count">{chapters.length}</span>}
                </h3>
                {chapLoading && <p className="manga-chapter-loading">Loading chapters…</p>}
                {chapError && <p className="manga-chapter-error"><WarningCircle size={16} weight="fill" aria-hidden="true" /> {chapError}</p>}
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
              )}
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
              <Play size={14} weight="fill" aria-hidden="true" /> Read Ch. {chapters[0]?.number || '1'}
            </button>
          )}
          {external && provider.readLinks(comic)[0] && (
            <a className="mob-detail-bar-btn mob-detail-bar-btn--watch" href={provider.readLinks(comic)[0].url} target="_blank" rel="noopener noreferrer">
              <Play size={14} weight="fill" aria-hidden="true" /> Read on {provider.readLinks(comic)[0].site}
            </a>
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
        <button className="manga-detail-close" onClick={onClose}><X size={16} weight="bold" /></button>

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
        <WhereToRead comic={comic} />

        {/* ── Chapter list ── */}
        {external ? <ExternalRead comic={comic} provider={provider} /> : (
        <div className="manga-chapter-list">
          <h3 className="manga-chapter-list-title">
            Chapters
            {!chapLoading && <span className="manga-chapter-count">{chapters.length}</span>}
          </h3>
          {chapLoading && <p className="manga-chapter-loading">Loading chapters…</p>}
          {chapError   && <p className="manga-chapter-error"><WarningCircle size={16} weight="fill" aria-hidden="true" /> {chapError}</p>}
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
        )}
      </div>
    </div>
  );
}

// ─── MangaCard ────────────────────────────────────────────────

// ─── Landing rows ─────────────────────────────────────────────

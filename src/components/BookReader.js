import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsIn, ArrowsOut, BookOpen, Books, Minus, Plus, X } from '@phosphor-icons/react';
import { findReadableEdition } from '../utils/bookAccess';

const THEMES = {
  light: { label: 'Light', bg: '#fbfaf7', fg: '#1d1d1f' },
  sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#3b2f22' },
  dark: { label: 'Dark', bg: '#14161c', fg: '#e6e2d9' },
};
const PREFS_KEY = 'binge:reader-prefs';
const PROGRESS_KEY = 'binge:reader-progress';

function readJson(key, fallback) {
  try { return { ...fallback, ...JSON.parse(window.localStorage.getItem(key) || '{}') }; } catch { return fallback; }
}

function writeJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

const SOURCE_NOTES = {
  standard: 'Standard Ebooks — a carefully typeset public-domain edition.',
  gutenberg: 'Project Gutenberg — free public-domain edition.',
  archive: 'Internet Archive — public-domain scan.',
  preview: 'Google Books — the pages the publisher makes available.',
};

// Full-screen reader for a catalog book. Finds the best legal edition
// (utils/bookAccess.js) and, for the proxied text editions (Standard Ebooks,
// Gutenberg — same-origin), applies the reader's own type size and theme
// and remembers how far you got.
export default function BookReader({ book, onClose }) {
  const [access, setAccess] = useState(null);
  const [prefs, setPrefs] = useState(() => readJson(PREFS_KEY, { size: 1.15, theme: 'sepia' }));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const frameRef = useRef(null);
  const shellRef = useRef(null);
  const progressKey = `${book.id || book.title}`;

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    findReadableEdition(book)
      .then((result) => { if (!cancelled) setAccess(result); })
      .catch(() => { if (!cancelled) setAccess({ kind: 'none', links: {} }); });
    return () => { cancelled = true; };
  }, [book]);

  useEffect(() => {
    function onKey(event) { if (event.key === 'Escape' && !document.fullscreenElement) onClose(); }
    function onFs() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Apply type size + theme inside the same-origin reading frame.
  const applyPrefs = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    let style = doc.getElementById('binge-reader-theme');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'binge-reader-theme';
      doc.head.appendChild(style);
    }
    const theme = THEMES[prefs.theme] || THEMES.sepia;
    style.textContent = `html, body { background: ${theme.bg} !important; color: ${theme.fg} !important; }
      body { font-size: ${prefs.size}rem !important; }
      body * { color: inherit !important; background-color: transparent !important; border-color: currentColor; }
      img { background: #fff !important; }`;
  }, [prefs]);

  useEffect(() => {
    writeJson(PREFS_KEY, prefs);
    applyPrefs();
  }, [prefs, applyPrefs]);

  function onFrameLoad() {
    setFrameReady(true);
    if (!access?.sameOrigin) return;
    applyPrefs();
    const win = frameRef.current?.contentWindow;
    const doc = frameRef.current?.contentDocument;
    if (!win || !doc) return;
    // Resume where you left off (stored as a fraction of the book).
    const saved = readJson(PROGRESS_KEY, {})[progressKey];
    if (saved > 0.002) {
      setTimeout(() => {
        win.scrollTo(0, saved * (doc.documentElement.scrollHeight - win.innerHeight));
      }, 150);
    }
    let timer = null;
    win.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const max = doc.documentElement.scrollHeight - win.innerHeight;
        if (max <= 0) return;
        const all = readJson(PROGRESS_KEY, {});
        all[progressKey] = Math.min(1, win.scrollY / max);
        writeJson(PROGRESS_KEY, all);
      }, 400);
    }, { passive: true });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else shellRef.current?.requestFullscreen?.().catch(() => {});
  }

  const canStyle = Boolean(access?.sameOrigin);
  const theme = THEMES[prefs.theme] || THEMES.sepia;

  return (
    <div className="br-shell" ref={shellRef} role="dialog" aria-modal="true" aria-label={`Reading ${book.title}`}>
      <header className="br-bar">
        <div className="br-title">
          <strong>{book.title}</strong>
          {book.author && <span>{book.author}</span>}
        </div>
        <div className="br-tools">
          {canStyle && (
            <>
              <div className="br-group" role="group" aria-label="Text size">
                <button type="button" onClick={() => setPrefs((p) => ({ ...p, size: Math.max(0.85, +(p.size - 0.1).toFixed(2)) }))} aria-label="Smaller text"><Minus size={16} weight="bold" /></button>
                <span className="br-size" aria-hidden="true">Aa</span>
                <button type="button" onClick={() => setPrefs((p) => ({ ...p, size: Math.min(1.8, +(p.size + 0.1).toFixed(2)) }))} aria-label="Larger text"><Plus size={16} weight="bold" /></button>
              </div>
              <div className="br-group" role="radiogroup" aria-label="Page color">
                {Object.entries(THEMES).map(([key, value]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={prefs.theme === key}
                    aria-label={value.label}
                    title={value.label}
                    className={`br-swatch${prefs.theme === key ? ' active' : ''}`}
                    style={{ background: value.bg, color: value.fg }}
                    onClick={() => setPrefs((p) => ({ ...p, theme: key }))}
                  >
                    A
                  </button>
                ))}
              </div>
            </>
          )}
          {access?.embedUrl && (
            <button type="button" className="br-icon" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? <ArrowsIn size={18} weight="bold" /> : <ArrowsOut size={18} weight="bold" />}
            </button>
          )}
          <button type="button" className="br-icon" onClick={onClose} aria-label="Close reader"><X size={18} weight="bold" /></button>
        </div>
      </header>

      <div className="br-body" style={canStyle ? { background: theme.bg } : undefined}>
        {!access && (
          <div className="br-state">
            <span className="br-spinner" aria-hidden="true" />
            <p>Finding the best free edition of <em>{book.title}</em>…</p>
          </div>
        )}

        {access?.embedUrl && (
          <>
            {!frameReady && (
              <div className="br-state br-state--overlay">
                <span className="br-spinner" aria-hidden="true" />
                <p>Opening {access.label}…</p>
              </div>
            )}
            <iframe
              ref={frameRef}
              key={access.embedUrl}
              src={access.embedUrl}
              title={`${book.title} — ${access.label}`}
              className="br-frame"
              onLoad={onFrameLoad}
              allowFullScreen
            />
          </>
        )}

        {access && !access.embedUrl && (
          <div className="br-state br-state--card">
            {access.kind === 'borrow' ? <BookOpen size={40} weight="duotone" /> : <Books size={40} weight="duotone" />}
            <h2>{access.kind === 'borrow' ? 'Free to borrow' : 'Not free to read online'}</h2>
            <p>
              {access.kind === 'borrow'
                ? 'The Internet Archive lends a digital copy of this book for free. You’ll need a free archive.org account.'
                : `${book.title} is still under copyright, and the publisher doesn’t offer a free preview. Your library very likely has it — often as an ebook you can borrow on your phone.`}
            </p>
            <div className="br-actions">
              {access.kind === 'borrow' && (
                <a className="st-btn st-btn--primary" href={access.externalUrl} target="_blank" rel="noopener noreferrer">Borrow on Open Library</a>
              )}
              <a className={`st-btn ${access.kind === 'borrow' ? 'st-btn--ghost' : 'st-btn--primary'}`} href={access.links?.library} target="_blank" rel="noopener noreferrer">Find an ebook at your library</a>
              <a className="st-btn st-btn--ghost" href={access.links?.worldcat} target="_blank" rel="noopener noreferrer">Nearby libraries (WorldCat)</a>
            </div>
          </div>
        )}
      </div>

      {access?.embedUrl && SOURCE_NOTES[access.kind] && (
        <footer className="br-note">{access.kind === 'preview' && access.full ? 'Google Books — full book, free to read.' : SOURCE_NOTES[access.kind]}</footer>
      )}
    </div>
  );
}

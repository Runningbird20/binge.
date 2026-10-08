import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from '@phosphor-icons/react';

// Keyboard-first browsing, mounted once in App:
//   arrows  move between titles (spatially — across rows, grids and modals)
//   Enter   opens the focused title (it's a link/button already)
//   /       jumps to search      ?  shows this list      Esc  closes things
const NAV_SELECTOR = '.st-card, .st-game, .poster-tile, .td-more-card, .td-adapt, .st-hero-cta';
const OPEN_EVENT = 'binge:shortcuts';

export function openShortcutsHelp() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function isTyping(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

function visible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

// Topmost open dialog, so arrows stay inside a details sheet while it's up.
function scopeRoot() {
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(visible);
  return dialogs[dialogs.length - 1] || document;
}

const DIRS = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  ArrowUp: { x: 0, y: -1 },
};

// Nearest candidate in the pressed direction: distance along the direction,
// plus a heavier penalty for drifting sideways (so Right stays in the row
// and Down lands on the card below, not a far-off one).
export function pickNext(fromRect, candidates, dir) {
  const fx = fromRect.left + fromRect.width / 2;
  const fy = fromRect.top + fromRect.height / 2;
  let best = null;
  candidates.forEach(({ el, rect }) => {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const along = (cx - fx) * dir.x + (cy - fy) * dir.y;
    if (along <= 4) return;
    const across = Math.abs(dir.x ? cy - fy : cx - fx);
    if (dir.x && across > fromRect.height * 0.6) return; // left/right: same row only
    const score = along + across * 3;
    if (!best || score < best.score) best = { el, score };
  });
  return best?.el || null;
}

function moveFocus(key) {
  const root = scopeRoot();
  const all = [...root.querySelectorAll(NAV_SELECTOR)].filter(visible);
  if (!all.length) return false;
  const active = document.activeElement?.closest?.(NAV_SELECTOR);
  let target = null;
  if (!active || !root.contains(active)) {
    // Start from the first title on screen.
    target = all.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight && rect.left >= 0 && rect.left < window.innerWidth;
    }) || all[0];
  } else {
    const candidates = all.filter((el) => el !== active).map((el) => ({ el, rect: el.getBoundingClientRect() }));
    target = pickNext(active.getBoundingClientRect(), candidates, DIRS[key]);
  }
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

const GROUPS = [
  {
    title: 'Browsing',
    keys: [
      [['←', '→', '↑', '↓'], 'Move between titles'],
      [['Enter'], 'Open the selected title'],
      [['/'], 'Search'],
      [['Esc'], 'Close a sheet or the player'],
      [['?'], 'Show these shortcuts'],
    ],
  },
  {
    title: 'Player',
    keys: [
      [['F'], 'Fullscreen'],
      [['←', '→'], 'Previous / next episode'],
      [['Esc'], 'Close the player'],
    ],
  },
];

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (open) {
        if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); setOpen(false); }
        return;
      }
      if (event.key === '?') { event.preventDefault(); setOpen(true); return; }
      if (event.key === '/') {
        event.preventDefault();
        const input = [...document.querySelectorAll('.global-search-bar-input, .st-search-input')].find(visible);
        if (input) input.focus();
        else navigate('/search');
        return;
      }
      if (DIRS[event.key] && !document.querySelector('[data-embed-player]')) {
        if (moveFocus(event.key)) event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, navigate]);

  if (!open) return null;
  return (
    <div className="kb-overlay" onClick={() => setOpen(false)}>
      <div className="kb-panel" role="dialog" aria-modal="true" aria-labelledby="kb-title" onClick={(event) => event.stopPropagation()}>
        <div className="kb-head">
          <h2 id="kb-title">Keyboard shortcuts</h2>
          <button type="button" className="td-round-btn" onClick={() => setOpen(false)} aria-label="Close shortcuts" autoFocus>
            <X size={18} weight="bold" />
          </button>
        </div>
        <div className="kb-groups">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.keys.map(([keys, label]) => (
                  <div key={label} className="kb-row">
                    <dt>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

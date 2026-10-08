import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isTvMode } from '../utils/tvMode';
import { X } from '@phosphor-icons/react';

// Keyboard-first browsing, mounted once in App:
//   arrows  move between titles (spatially — across rows, grids and modals)
//   Enter   opens the focused title (it's a link/button already)
//   /       jumps to search      ?  shows this list      Esc  closes things
const NAV_SELECTOR = '.st-card, .st-game, .poster-tile, .td-more-card, .td-adapt, .st-hero-cta';
// TV remotes have no mouse, so every control must be reachable by d-pad:
// links, buttons, fields, and the video itself (iframe — the player then
// takes the remote's keys until Back).
const TV_SELECTOR = 'a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])';
// Hover-only menus (the profile drawer) and decorative frames can't be used
// with a remote; the avatar itself links to the Profile page instead.
const TV_SKIP = '.st-row-arrow, .hs-arrow, .st-hero-nav, .profile-hover-drawer, [aria-hidden="true"]';

function navSelector() {
  return isTvMode() ? TV_SELECTOR : NAV_SELECTOR;
}
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

// Topmost open layer (player, sheet, dialog), so arrows stay inside it.
function scopeRoot() {
  const player = document.querySelector('[data-embed-player]');
  if (player && isTvMode()) return player;
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], .bsheet-panel')].filter(visible);
  return dialogs[dialogs.length - 1] || document;
}

function candidatesIn(root) {
  return [...root.querySelectorAll(navSelector())]
    .filter((el) => visible(el) && !(isTvMode() && (
      el.closest(TV_SKIP)
      // The only frame worth focusing is the video player itself.
      || (el.tagName === 'IFRAME' && (!el.closest('[data-embed-player]') || el.tabIndex < 0))
    )));
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
  const all = candidatesIn(root);
  if (!all.length) return false;
  const active = document.activeElement?.closest?.(navSelector());
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
  // On a TV keep the focused item near the middle of the screen.
  target.scrollIntoView({ block: isTvMode() && DIRS[key]?.y ? 'center' : 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

// The remote's Back button (the TV app calls this; returns whether binge.
// handled it — false means "leave the app"). Steps out of the video, then
// closes the top layer, then goes back a page.
export function handleTvBack(pathname = window.location.pathname) {
  const active = document.activeElement;
  if (active?.tagName === 'IFRAME') {
    active.blur();
    const player = document.querySelector('[data-embed-player]');
    (player?.querySelector('[aria-label^="Close"], button') || document.body).focus?.();
    return true;
  }
  if (document.querySelector('[data-embed-player], [role="dialog"][aria-modal="true"], .bsheet-overlay, .kb-overlay')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }
  if (pathname !== '/home' && pathname !== '/' && window.history.length > 1) {
    window.history.back();
    return true;
  }
  return false;
}

function focusFirst() {
  const main = document.querySelector('main') || document;
  const first = candidatesIn(main).find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.top < window.innerHeight;
  });
  first?.focus({ preventScroll: true });
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
  const location = useLocation();
  const tv = isTvMode();

  // TV: Back button bridge for the TV app, and something is always focused
  // after a page change (a remote can't click "into" a page).
  useEffect(() => {
    if (!tv) return undefined;
    window.bingeTvBack = () => handleTvBack();
    return () => { delete window.bingeTvBack; };
  }, [tv]);
  useEffect(() => {
    if (!tv) return undefined;
    const timer = setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) focusFirst();
    }, 900);
    return () => clearTimeout(timer);
  }, [tv, location.pathname, location.search]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      // On TV, up/down leave a text field (left/right still move the caret).
      if (isTyping(event.target) && !(tv && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))) return;
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
      if (DIRS[event.key] && (tv || !document.querySelector('[data-embed-player]'))) {
        if (moveFocus(event.key)) event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, navigate, tv]);

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

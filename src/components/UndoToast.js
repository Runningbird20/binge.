// "Removed · Undo": removing a title from My List, Continue Watching or
// History takes it off the page at once, but the delete only happens when
// the popup (bottom right, 10 seconds, with a bar running down) runs out or
// is dismissed. Undo puts it back as if nothing happened.
//
// The countdown is a JS timer, not a CSS animation: the reduced-motion rule
// in streaming.css shortens every animation to 0.01ms, which would delete at
// once. It pauses while the popup is hovered or focused. Leaving the page
// (tab hidden or closed) carries out every pending removal right away, so
// none is lost.
import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { ArrowCounterClockwise, X } from '@phosphor-icons/react';

const TOASTER_ID = 'undo';
const DEFAULT_DURATION = 10000;
const pending = new Map(); // toast id -> { key, commit }
let sequence = 0;

// Whether a removal with this key is still waiting (pages filter such
// items out when they reload within the 10 seconds).
export function isRemovalPending(key) {
  for (const entry of pending.values()) if (entry.key === key) return true;
  return false;
}

// Carries out every waiting removal now.
export function flushPendingRemovals() {
  [...pending.values()].forEach((entry) => entry.commit());
}

// Shows the popup and returns { undo, commit }. The caller has already
// taken the item off the page. onCommit does the real delete (it may return
// a promise; if that fails, onUndo puts the item back and a notice says
// why); onUndo restores the page.
export function removeWithUndo({ key = '', message, onUndo, onCommit, duration = DEFAULT_DURATION }) {
  sequence += 1;
  const id = `undo-${sequence}`;
  let settled = false;
  const finish = () => {
    if (settled) return false;
    settled = true;
    pending.delete(id);
    toast.dismiss(id);
    return true;
  };
  const commit = () => {
    if (!finish()) return;
    Promise.resolve()
      .then(() => onCommit?.())
      .catch((error) => {
        onUndo?.();
        toast(error?.message || 'Couldn’t remove that.', { description: 'It’s back where it was.' });
      });
  };
  const undo = () => {
    if (finish()) onUndo?.();
  };
  pending.set(id, { key, commit });
  toast.custom(() => <UndoToastView message={message} duration={duration} onUndo={undo} onExpire={commit} />, {
    id,
    toasterId: TOASTER_ID,
    duration: Infinity, // the view keeps its own time
    onDismiss: commit, // swiped away: the removal stands
  });
  return { undo, commit };
}

function UndoToastView({ message, duration, onUndo, onExpire }) {
  const barRef = useRef(null);
  const pausedRef = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    let remaining = duration;
    let last = performance.now();
    let frame = 0;
    const tick = (now) => {
      if (!pausedRef.current) remaining -= now - last;
      last = now;
      if (barRef.current) barRef.current.style.transform = `scaleX(${Math.max(0, remaining / duration)})`;
      if (remaining <= 0) { expireRef.current(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration]);

  const pause = () => { pausedRef.current = true; };
  const resume = (event) => {
    // Still hovered or focused inside: stay paused.
    const root = event.currentTarget;
    if (root.matches(':hover') || root.contains(document.activeElement)) return;
    pausedRef.current = false;
  };

  return (
    <div className="undo-toast" role="status" onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) resume(event); }}>
      <p className="undo-toast-text">{message}</p>
      <button type="button" className="undo-toast-undo" onClick={onUndo}>
        <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
        Undo
      </button>
      <button type="button" className="undo-toast-close" onClick={onExpire} aria-label="Dismiss">
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
      <span className="undo-toast-bar" ref={barRef} aria-hidden="true" />
    </div>
  );
}

// Mounted once (App.js): the bottom-right stack for these popups, and the
// "leaving the page" flush.
export function UndoToaster() {
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushPendingRemovals(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushPendingRemovals);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushPendingRemovals);
    };
  }, []);
  return <Toaster id={TOASTER_ID} position="bottom-right" offset={24} mobileOffset={{ bottom: 84 }} visibleToasts={3} />;
}

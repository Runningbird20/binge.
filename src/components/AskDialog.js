import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// A one-question dialog (the .ask-* card in streaming.css): portaled to the
// body, above the title popup, and keyboard-safe. Focus starts on
// initialFocusRef (else the first button), Tab stays inside, and focus goes
// back where it was afterwards. Escape and a click outside call onDismiss;
// Escape doesn't reach whatever is underneath (the title popup would close).
export default function AskDialog({ labelledBy, describedBy, onDismiss, initialFocusRef, children }) {
  const cardRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const before = document.activeElement;
    const controls = () => [...(cardRef.current?.querySelectorAll('button:not([disabled])') || [])];
    (initialFocusRef?.current || controls()[0])?.focus();
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = controls();
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!cardRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before?.isConnected) before.focus?.();
    };
  }, [initialFocusRef]);

  return createPortal(
    <div className="ask-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) dismissRef.current(); }}>
      <div className="ask-card" role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} ref={cardRef}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

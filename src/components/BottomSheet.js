import { useEffect, useRef } from 'react';
import useSwipeDismiss from '../hooks/useSwipeDismiss';

// Slide-up picker for phones. Drag the handle (or the sheet, when it's
// scrolled to the top) down to close; tap outside or Esc also close.
export default function BottomSheet({ open, onClose, title, children }) {
  const panelRef = useRef(null);
  useSwipeDismiss({ enabled: open, scrollRef: panelRef, sheetRef: panelRef, onDismiss: onClose });

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="bsheet-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="bsheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bsheet-handle" />
        {title && <p className="bsheet-title">{title}</p>}
        <div className="bsheet-body">{children}</div>
      </div>
    </div>
  );
}

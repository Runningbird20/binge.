import { useEffect } from 'react';

const DISMISS_PX = 110;
const FLICK_PX_PER_MS = 0.6;

// Drag a sheet down to close it, like a native bottom sheet. Only engages
// when the scroll container is already at the top, so normal scrolling is
// untouched. Touch only (mice and trackpads never fire touch events).
//   scrollRef — the element that scrolls (often the overlay)
//   sheetRef  — the element that moves with the finger
export default function useSwipeDismiss({ enabled = true, scrollRef, sheetRef, onDismiss }) {
  useEffect(() => {
    const scroller = scrollRef.current;
    const sheet = sheetRef.current;
    if (!enabled || !scroller || !sheet) return undefined;

    let startY = null;
    let startAt = 0;
    let dy = 0;
    let dragging = false;

    function reset(animate) {
      sheet.style.transition = animate ? 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)' : '';
      sheet.style.transform = '';
      dragging = false;
      startY = null;
      dy = 0;
    }

    function onStart(event) {
      if (event.touches.length !== 1 || scroller.scrollTop > 0) return;
      // Leave horizontal scrollers (rows, chips) and form controls alone.
      if (event.target.closest('input, textarea, select, [data-no-swipe]')) return;
      startY = event.touches[0].clientY;
      startAt = Date.now();
      dy = 0;
    }

    function onMove(event) {
      if (startY == null) return;
      dy = event.touches[0].clientY - startY;
      if (!dragging && (dy < 6 || scroller.scrollTop > 0)) {
        if (dy < 0) startY = null; // scrolling up: let it scroll
        return;
      }
      dragging = true;
      event.preventDefault(); // stop the rubber-band bounce while dragging
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }

    function onEnd() {
      if (!dragging) { startY = null; return; }
      const velocity = dy / Math.max(1, Date.now() - startAt);
      if (dy > DISMISS_PX || velocity > FLICK_PX_PER_MS) {
        sheet.style.transition = 'transform 0.2s ease-in';
        sheet.style.transform = 'translateY(100vh)';
        setTimeout(onDismiss, 180);
        dragging = false;
        startY = null;
      } else {
        reset(true);
      }
    }

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', () => reset(true));
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      reset(false);
    };
  }, [enabled, scrollRef, sheetRef, onDismiss]);
}

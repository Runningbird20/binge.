import { useCallback, useEffect, useRef, useState } from 'react';

// Shared horizontal-row scroll tracking + scroll-by-arrow behavior, used by
// any poster/card row (Home's Continue Watching / For You rows, MediaRow,
// Sports rails) so edge-fade visibility and arrow-click scrolling stay
// consistent everywhere instead of being reimplemented per row.
export default function useRowScroll(items) {
  const ref = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });

    // Not every environment has ResizeObserver (e.g. jsdom in tests) — the
    // scroll listener + the mount/items-change check above still cover the
    // cases that matter, this just adds live resize tracking.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkScroll) : null;
    ro?.observe(el);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro?.disconnect();
    };
  }, [items, checkScroll]);

  const scrollBy = useCallback((dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.78, behavior: 'smooth' });
  }, []);

  return { ref, canLeft, canRight, scrollBy };
}

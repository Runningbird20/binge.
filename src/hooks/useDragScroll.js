import { useEffect, useRef, useState, useCallback } from 'react';

// Enables mouse-wheel and click-drag horizontal scrolling on a container that
// only supports native touch/trackpad scroll by default (overflow-x: auto).
// Also tracks whether either edge has more content to scroll to, so callers
// can show/hide/disable scroll affordance buttons.
export default function useDragScroll() {
  const ref = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    updateEdges();

    const handleWheel = (event) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };

    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;

    const suppressClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handlePointerDown = (event) => {
      if (event.pointerType === 'touch') return;
      isDown = true;
      dragged = false;
      startX = event.clientX;
      startScroll = el.scrollLeft;
    };
    const handlePointerMove = (event) => {
      if (!isDown) return;
      const delta = event.clientX - startX;
      if (Math.abs(delta) > 3) {
        dragged = true;
        el.classList.add('genre-bar-dragging');
      }
      el.scrollLeft = startScroll - delta;
    };
    const endDrag = () => {
      if (!isDown) return;
      isDown = false;
      el.classList.remove('genre-bar-dragging');
      if (dragged) {
        el.addEventListener('click', suppressClick, { capture: true, once: true });
      }
    };
    const handleScroll = () => updateEdges();

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointerleave', endDrag);
    el.addEventListener('scroll', handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(el);
    const mutationObserver = new MutationObserver(updateEdges);
    mutationObserver.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointerleave', endDrag);
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('click', suppressClick, { capture: true });
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateEdges]);

  const scrollBy = useCallback((amount) => {
    ref.current?.scrollBy({ left: amount, behavior: 'smooth' });
  }, []);

  return { ref, canScrollLeft, canScrollRight, scrollBy };
}

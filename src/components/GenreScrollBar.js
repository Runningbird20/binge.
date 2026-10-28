import { motion, useReducedMotion } from 'framer-motion';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import useDragScroll from '../hooks/useDragScroll';

// Shared horizontal scroll behavior for the genre/category chip bars used on
// Movies, TVShows, Books, and Sports: adds mouse-wheel and click-drag
// scrolling plus hover-revealed arrow buttons, since the bar previously only
// supported native touch/trackpad scroll (no affordance for a mouse-only
// desktop user).
export default function GenreScrollBar({ ariaLabel, children, collapsed = false }) {
  const reduceMotion = useReducedMotion();
  const { ref, canScrollLeft, canScrollRight, scrollBy } = useDragScroll();

  return (
    <motion.div
      className="genre-bar-outer"
      initial={false}
      animate={{ height: collapsed ? 0 : 'auto', opacity: collapsed ? 0 : 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'hidden', pointerEvents: collapsed ? 'none' : undefined }}
      inert={collapsed ? true : undefined}
      aria-hidden={collapsed || undefined}
    >
      <button
        type="button"
        className="genre-scroll-btn genre-scroll-btn-left"
        onClick={() => scrollBy(-240)}
        disabled={!canScrollLeft}
        aria-label="Scroll left"
        tabIndex={-1}
      >
        <CaretLeft size={14} weight="bold" />
      </button>
      <div className={`genre-bar-wrap${canScrollLeft ? ' fade-left' : ''}${canScrollRight ? ' fade-right' : ''}`}>
        <div className="genre-bar" role="group" aria-label={ariaLabel} ref={ref}>
          {children}
        </div>
      </div>
      <button
        type="button"
        className="genre-scroll-btn genre-scroll-btn-right"
        onClick={() => scrollBy(240)}
        disabled={!canScrollRight}
        aria-label="Scroll right"
        tabIndex={-1}
      >
        <CaretRight size={14} weight="bold" />
      </button>
    </motion.div>
  );
}

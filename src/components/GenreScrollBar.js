import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import useDragScroll from '../hooks/useDragScroll';

// Shared horizontal scroll behavior for the genre/category chip bars used on
// Movies, TVShows, Books, and Sports: adds mouse-wheel and click-drag
// scrolling plus hover-revealed arrow buttons, since the bar previously only
// supported native touch/trackpad scroll (no affordance for a mouse-only
// desktop user).
//
// `collapsed` folds the bar away (while a search is typed). CSS can't
// transition to height: auto, so the outer box is a one-row grid whose row
// goes from 1fr to 0fr, and the inner box (no padding, min-height 0) shrinks
// with it (.genre-bar-outer in App.css).
export default function GenreScrollBar({ ariaLabel, children, collapsed = false }) {
  const { ref, canScrollLeft, canScrollRight, scrollBy } = useDragScroll();

  return (
    <div
      className={`genre-bar-outer${collapsed ? ' is-collapsed' : ''}`}
      inert={collapsed ? true : undefined}
      aria-hidden={collapsed || undefined}
    >
      <div className="genre-bar-fold">
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
      </div>
    </div>
  );
}

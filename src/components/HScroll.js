import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import useRowScroll from '../hooks/useRowScroll';

// Any horizontal scroller with real ‹ › buttons (the mouse-only rule —
// nothing may depend on a trackpad or swipe). `as` sets the scrolling
// element (e.g. 'ol'); `scrollRef` receives it too.
export default function HScroll({ as: Tag = 'div', className = '', label, children, deps, scrollRef }) {
  const { ref, canLeft, canRight, scrollBy } = useRowScroll(deps);
  const setRef = (node) => {
    ref.current = node;
    if (scrollRef) scrollRef.current = node;
  };
  return (
    <div className="hs">
      <button type="button" className="hs-arrow hs-arrow--left" onClick={() => scrollBy(-1)} disabled={!canLeft} aria-label={`Scroll ${label} left`}>
        <CaretLeft size={20} weight="bold" />
      </button>
      <Tag className={className} ref={setRef}>{children}</Tag>
      <button type="button" className="hs-arrow hs-arrow--right" onClick={() => scrollBy(1)} disabled={!canRight} aria-label={`Scroll ${label} right`}>
        <CaretRight size={20} weight="bold" />
      </button>
    </div>
  );
}

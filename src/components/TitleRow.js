import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import useRowScroll from '../hooks/useRowScroll';
import TitleCard from './TitleCard';
import ErrorBoundary from './ErrorBoundary';

// One horizontally scrolling row. Built to be usable with any input:
//   - mouse: always-visible ‹ › buttons whenever there's more to scroll
//     (not hover-only, not swipe-only)
//   - keyboard: the buttons are focusable, and arrow keys move between
//     cards (components/KeyboardShortcuts.js), scrolling the row as needed
//   - touch/trackpad: native horizontal scroll still works
//
// Pass either `items` directly or a `load()` that resolves to items; a
// loader only runs once the row is near the viewport, so a page with 20
// rows doesn't fire 20 requests up front.
function TitleRowInner({
  title,
  subtitle,
  items: providedItems,
  load,
  ranked = false,
  eager = false,
  renderItem,
  action,
  minItems = 1,
  loading = false,
  className = '',
}) {
  const [items, setItems] = useState(providedItems || null);
  const [state, setState] = useState(providedItems ? 'done' : 'idle');
  const sectionRef = useRef(null);
  const { ref: trackRef, canLeft, canRight, scrollBy } = useRowScroll(items);

  useEffect(() => {
    if (providedItems) {
      setItems(providedItems);
      setState('done');
    }
  }, [providedItems]);

  useEffect(() => {
    if (providedItems || !load || state !== 'idle') return undefined;
    const node = sectionRef.current;

    function start() {
      setState('loading');
      load()
        .then((result) => {
          setItems(Array.isArray(result) ? result : []);
          setState('done');
        })
        .catch(() => setState('error'));
    }

    if (eager || typeof window.IntersectionObserver !== 'function' || !node) {
      start();
      return undefined;
    }

    const observer = new window.IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        observer.disconnect();
        start();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [providedItems, load, state, eager]);

  if (state === 'error') return <RowProblem title={title} onRetry={() => setState('idle')} />;
  const showSkeleton = loading || state !== 'done' || !items;
  if (!showSkeleton && items.length < minItems) return null;

  return (
    <section className={`st-row${ranked ? ' st-row--ranked' : ''} ${className}`} ref={sectionRef} aria-label={title}>
      <div className="st-row-header">
        <div>
          <h2 className="st-row-title">{title}</h2>
          {subtitle && <p className="st-row-subtitle">{subtitle}</p>}
        </div>
        {action}
      </div>

      <div className="st-row-body">
        <button
          type="button"
          className="st-row-arrow st-row-arrow--left"
          onClick={() => scrollBy(-1)}
          disabled={!canLeft}
          aria-label={`Scroll ${title} left`}
        >
          <CaretLeft size={22} weight="bold" />
        </button>

        <div className="st-row-track" ref={trackRef}>
          {showSkeleton
            ? Array.from({ length: 8 }, (_, index) => (
              // Same box as a loaded card (art + title line), so nothing jumps.
              <div key={index} className="st-row-cell st-skel" aria-hidden="true">
                <div className="st-skel-art skeleton-block" />
                <div className="st-skel-line skeleton-block" />
              </div>
            ))
            : items.map((item, index) => (
              <div className="st-row-cell" key={`${item.media_type || ''}:${item.id}:${index}`}>
                {renderItem
                  ? renderItem(item, index)
                  : <TitleCard item={item} priority={eager && index < 6} rank={ranked ? index + 1 : null} />}
              </div>
            ))}
        </div>

        <button
          type="button"
          className="st-row-arrow st-row-arrow--right"
          onClick={() => scrollBy(1)}
          disabled={!canRight}
          aria-label={`Scroll ${title} right`}
        >
          <CaretRight size={22} weight="bold" />
        </button>
      </div>
    </section>
  );
}

// A row whose data failed to load (or that crashed rendering) says so in
// place, with Retry, instead of taking the page down or silently vanishing.
function RowProblem({ title, onRetry }) {
  return (
    <section className="st-row st-row--problem" aria-label={title}>
      <div className="st-row-header"><h2 className="st-row-title">{title}</h2></div>
      <div className="st-row-problem">
        <span>Couldn’t load this row.</span>
        {onRetry && <button type="button" className="st-btn st-btn--ghost" onClick={onRetry}>Retry</button>}
      </div>
    </section>
  );
}

export default function TitleRow(props) {
  return (
    <ErrorBoundary resetKey={props.items} fallback={({ retry }) => <RowProblem title={props.title} onRetry={retry} />}>
      <TitleRowInner {...props} />
    </ErrorBoundary>
  );
}

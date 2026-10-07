import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import useRowScroll from '../hooks/useRowScroll';
import TitleCard from './TitleCard';

// One horizontally scrolling row. Built to be usable with any input:
//   - mouse: always-visible ‹ › buttons whenever there's more to scroll
//     (not hover-only, not swipe-only)
//   - keyboard: the buttons are focusable, and Left/Right on a focused
//     card scrolls the row
//   - touch/trackpad: native horizontal scroll still works
//
// Pass either `items` directly or a `load()` that resolves to items; a
// loader only runs once the row is near the viewport, so a page with 20
// rows doesn't fire 20 requests up front.
export default function TitleRow({
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
        .catch(() => {
          setItems([]);
          setState('done');
        });
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

  function onKeyDown(event) {
    if (event.key === 'ArrowRight') { event.preventDefault(); scrollBy(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); scrollBy(-1); }
  }

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

        <div className="st-row-track" ref={trackRef} onKeyDown={onKeyDown}>
          {showSkeleton
            ? Array.from({ length: 8 }, (_, index) => <div key={index} className="st-card-skeleton skeleton-block" />)
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

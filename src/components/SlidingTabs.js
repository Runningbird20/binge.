import { useLayoutEffect, useRef, useState } from 'react';

// The white pill slides to the selected tab with a CSS transition
// (.sliding-tabs-pill in streaming.css). It appears in place on first render,
// since a transition only runs when a value changes.
export default function SlidingTabs({ as: Tag = 'div', children, className = '', ...props }) {
  const containerRef = useRef(null);
  const [pill, setPill] = useState(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    function measure() {
      const selected = container.querySelector('.st-tab.active');
      if (!selected) {
        setPill(null);
        return;
      }
      const bounds = container.getBoundingClientRect();
      const target = selected.getBoundingClientRect();
      const next = {
        x: target.left - bounds.left + container.scrollLeft - container.clientLeft,
        y: target.top - bounds.top + container.scrollTop - container.clientTop,
        width: target.width,
        height: target.height,
      };
      setPill(current => current && Object.keys(next).every(key => current[key] === next[key]) ? current : next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll('.st-tab').forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [children]);

  return (
    <Tag {...props} ref={containerRef} className={`${className} sliding-tabs`}>
      {pill && <span
        className="sliding-tabs-pill"
        aria-hidden="true"
        style={{
          transform: `translate(${pill.x}px, ${pill.y}px)`,
          width: pill.width,
          height: pill.height,
        }}
      />}
      {children}
    </Tag>
  );
}

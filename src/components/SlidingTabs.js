import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export default function SlidingTabs({ as: Tag = 'div', children, className = '', ...props }) {
  const containerRef = useRef(null);
  const [pill, setPill] = useState(null);
  const reduceMotion = useReducedMotion();

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
      {pill && <motion.span
        className="sliding-tabs-pill"
        aria-hidden="true"
        initial={false}
        animate={pill}
        transition={{ duration: reduceMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
      />}
      {children}
    </Tag>
  );
}

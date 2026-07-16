import { useEffect, useRef, useState } from 'react';

const THRESHOLD = 68;
const MAX_PULL = 110;
const RESISTANCE = 0.5;

// Touch-only by nature (touchstart/touchmove never fire from a mouse), so
// this is inert on desktop without needing a device check. Only engages
// when the page itself is scrolled to the very top, so it never fights a
// normal scroll gesture partway down the page.
export default function PullToRefresh({ onRefresh, children, disabled = false }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(null);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return undefined;

    function handleTouchStart(event) {
      if (window.scrollY > 0 || refreshingRef.current) return;
      startYRef.current = event.touches[0].clientY;
      pullingRef.current = true;
    }

    function handleTouchMove(event) {
      if (!pullingRef.current || startYRef.current == null) return;
      if (window.scrollY > 0) {
        pullingRef.current = false;
        setPullDistance(0);
        return;
      }
      const delta = event.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        setPullDistance(0);
        return;
      }
      setPullDistance(Math.min(delta * RESISTANCE, MAX_PULL));
    }

    function handleTouchEnd() {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      startYRef.current = null;

      setPullDistance((current) => {
        if (current >= THRESHOLD && !refreshingRef.current) {
          refreshingRef.current = true;
          setRefreshing(true);
          Promise.resolve()
            .then(() => onRefreshRef.current?.())
            .catch(() => {})
            .finally(() => {
              refreshingRef.current = false;
              setRefreshing(false);
              setPullDistance(0);
            });
          return THRESHOLD;
        }
        return 0;
      });
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [disabled]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <>
      <div
        className={`ptr-indicator${refreshing ? ' ptr-indicator--active' : ''}`}
        style={{ height: pullDistance }}
        aria-hidden="true"
      >
        <div
          className={`ptr-spinner${refreshing ? ' ptr-spinner--spin' : ''}`}
          style={!refreshing ? { transform: `rotate(${progress * 300}deg)`, opacity: progress } : undefined}
        />
      </div>
      {children}
    </>
  );
}

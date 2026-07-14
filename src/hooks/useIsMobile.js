import { useEffect, useState } from 'react';

const QUERY = '(max-width: 768px)';

// window.matchMedia is missing in some environments (jsdom in tests) —
// treat that as "not mobile" instead of crashing whoever calls the hook.
function supportsMatchMedia() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export default function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => supportsMatchMedia() && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    if (!supportsMatchMedia()) return undefined;
    const mq = window.matchMedia(QUERY);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return mobile;
}

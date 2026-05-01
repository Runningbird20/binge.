import { useState, useEffect } from 'react';

function getState() {
  const w = window.innerWidth;
  return {
    isMobile:   w <= 768,
    isTablet:   w > 768 && w <= 1024,
    isDesktop:  w > 1024,
    isPortrait: window.innerHeight >= window.innerWidth,
    isLandscape: window.innerWidth > window.innerHeight,
    width: w,
  };
}

export default function useDeviceType() {
  const [state, setState] = useState(getState);

  useEffect(() => {
    const handler = () => setState(getState());
    window.addEventListener('resize', handler, { passive: true });
    window.addEventListener('orientationchange', handler, { passive: true });
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);

  return state;
}

import { useState, useEffect } from 'react';

function getState() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Use the short side so isMobile stays true when a phone rotates to landscape
  const short = Math.min(w, h);
  return {
    isMobile:    short <= 768,
    isTablet:    short > 768 && short <= 1024,
    isDesktop:   short > 1024,
    isPortrait:  h >= w,
    isLandscape: w > h,
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

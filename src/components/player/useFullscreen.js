import { useEffect, useState } from 'react';
import { haptic } from '../../utils/haptics';

// Fullscreen and orientation. Android can go fullscreen + lock to landscape
// (the lock only works while fullscreen). iPhones allow neither for a web
// page, so there the player follows the phone's own rotation and we just
// say so (rotateHint).
export default function useFullscreen({ isMobile, modalRef, frameWrapRef }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationLocked, setRotationLocked] = useState(false);
  const [rotateHint, setRotateHint] = useState(false);
  const canLockRotation = typeof window !== 'undefined' && Boolean(window.screen?.orientation?.lock) && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  useEffect(() => {
    if (!rotateHint) return undefined;
    const timer = setTimeout(() => setRotateHint(false), 3500);
    return () => clearTimeout(timer);
  }, [rotateHint]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement) setRotationLocked(false);
    }

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  async function enterLandscape() {
    const element = modalRef.current;
    try {
      if (!document.fullscreenElement) await element?.requestFullscreen?.({ navigationUI: 'hide' });
      await window.screen.orientation?.lock?.('landscape');
      setRotationLocked(true);
    } catch {
      if (!document.fullscreenElement) setRotateHint(true);
    }
  }

  async function toggleRotationLock() {
    haptic();
    try {
      if (rotationLocked) {
        window.screen.orientation?.unlock?.();
        setRotationLocked(false);
      } else {
        await window.screen.orientation?.lock?.(window.screen.orientation.type);
        setRotationLocked(true);
      }
    } catch { /* not supported */ }
  }

  function toggleFullscreen() {
    if (isMobile) {
      if (document.fullscreenElement) {
        window.screen.orientation?.unlock?.();
        setRotationLocked(false);
        document.exitFullscreen().catch(() => {});
      } else {
        enterLandscape();
      }
      return;
    }
    if (!document.fullscreenElement) {
      // Fullscreen the frame wrapper (iframe + our overlay), not the raw
      // iframe — requestFullscreen() only renders the target element's own
      // subtree, so fullscreening the iframe directly would make our
      // sibling overlay/toggle button impossible to show at all.
      const element = frameWrapRef.current || modalRef.current;
      element?.requestFullscreen()
        // Tablets: a 16:9 video wants landscape.
        .then(() => window.screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {
          modalRef.current?.requestFullscreen();
        });
      return;
    }
    document.exitFullscreen();
  }

  return { isFullscreen, rotationLocked, rotateHint, canLockRotation, toggleFullscreen, toggleRotationLock };
}

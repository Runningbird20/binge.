import { useCallback, useEffect, useRef, useState } from 'react';

// Floating controls overlay (desktop only) — auto-hides a few seconds after
// the cursor enters the video area, matching Netflix/YouTube-style players.
// A cross-origin iframe swallows mousemove events once the cursor is over
// its content, so we can only reliably react to entering/leaving the frame
// itself, not continuous movement within it — leaving and re-entering the
// frame is what brings the overlay back once it's auto-hidden. Shown again
// for each new title or episode.
export default function useControlsAutoHide(itemId, season, episode) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef(null);

  const scheduleHideControls = useCallback(() => {
    clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    revealControls();
    return () => clearTimeout(hideControlsTimerRef.current);
  }, [itemId, season, episode, revealControls]);

  // The cursor is on the controls themselves: don't hide them.
  const holdControls = () => clearTimeout(hideControlsTimerRef.current);
  const hideControls = () => { clearTimeout(hideControlsTimerRef.current); setControlsVisible(false); };

  return { controlsVisible, revealControls, holdControls, hideControls };
}

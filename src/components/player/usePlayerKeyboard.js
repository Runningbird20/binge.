import { useEffect, useRef } from 'react';
import { isTvMode } from '../../utils/tvMode';

// Escape closes the episode popover, then the player; F toggles fullscreen;
// ← / → step through episodes (not on a TV, where the arrows move between
// the player's controls). Refs avoid stale closures without re-binding on
// every render. Also closes the popover on a click outside it.
export default function usePlayerKeyboard({
  isTV, onClose, season, episode, setSeason, setEpisode, totalSeasons, seasonEpisodeCounts,
  epPopoverOpen, setEpPopoverOpen, epSelectorRef, toggleFullscreen,
}) {
  const kbSeason = useRef(season);
  const kbEpisode = useRef(episode);
  const kbTotalSeasons = useRef(totalSeasons);
  const kbEpCounts = useRef(seasonEpisodeCounts);
  useEffect(() => { kbSeason.current = season; }, [season]);
  useEffect(() => { kbEpisode.current = episode; }, [episode]);
  useEffect(() => { kbTotalSeasons.current = totalSeasons; }, [totalSeasons]);
  useEffect(() => { kbEpCounts.current = seasonEpisodeCounts; }, [seasonEpisodeCounts]);

  const kbEpPopoverOpen = useRef(epPopoverOpen);
  useEffect(() => { kbEpPopoverOpen.current = epPopoverOpen; }, [epPopoverOpen]);

  // Close the season/episode popover on outside click, without letting that
  // click also register on whatever it landed on (e.g. re-toggling the
  // trigger button).
  useEffect(() => {
    if (!epPopoverOpen) return undefined;
    function onPointerDown(e) {
      if (epSelectorRef.current && !epSelectorRef.current.contains(e.target)) {
        setEpPopoverOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [epPopoverOpen, epSelectorRef, setEpPopoverOpen]);

  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (kbEpPopoverOpen.current) { setEpPopoverOpen(false); return; }
        onClose?.();
        return;
      }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); return; }
      // On a TV the arrows move between the player's controls instead.
      if (!isTV || isTvMode()) return;
      const s = kbSeason.current;
      const ep = kbEpisode.current;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const epCount = kbEpCounts.current[s] ?? null;
        if (epCount && ep < epCount) { setEpisode(ep + 1); }
        else if (s < kbTotalSeasons.current) { setSeason(s + 1); setEpisode(1); }
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (ep > 1) { setEpisode(ep - 1); }
        else if (s > 1) { setSeason(s - 1); setEpisode(1); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTV, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
}

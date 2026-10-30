import { useEffect, useMemo, useRef, useState } from 'react';
import { getSettings } from '../../utils/profileSettings';
import { useSeasonEpisodes } from '../../hooks/useTitleDetails';
import { haptic } from '../../utils/haptics';
import { markEpisodeWatched } from '../../utils/supabaseData';
import { reportCredits } from '../../utils/episodeMarkers';
import { UP_NEXT_COUNTDOWN, UP_NEXT_SECONDS, prefersLowBandwidth } from '../../utils/embedProviders';

// Up Next / binge mode. Near the end of an episode (last UP_NEXT_SECONDS,
// at the credits marker, or on 'ended'), show the next episode with a 10s
// countdown. Players' own auto-next is turned off in their URLs so this
// stays the one source of truth; the server you're on carries over to the
// next episode.
export default function useUpNext({
  isTV, item, tmdbId, season, episode, setSeason, setEpisode, totalSeasons,
  seasonEpisodeCounts, markers, playbackRef, watched, setWatched,
}) {
  const currentSeasonEpisodes = isTV ? seasonEpisodeCounts[season] : null;
  const nextEpisode = useMemo(() => {
    if (!isTV) return null;
    if (currentSeasonEpisodes && episode < currentSeasonEpisodes) return { season, episode: episode + 1 };
    if (season < totalSeasons) return { season: season + 1, episode: 1 };
    return null;
  }, [isTV, currentSeasonEpisodes, episode, season, totalSeasons]);
  const nextSeasonEpisodes = useSeasonEpisodes(isTV && nextEpisode ? tmdbId : null, nextEpisode?.season);
  const nextInfo = nextEpisode && nextSeasonEpisodes?.find((ep) => ep.number === nextEpisode.episode);
  const [upNext, setUpNext] = useState(null); // { secondsLeft }
  const upNextDismissedRef = useRef('');

  // Warm the next episode in the last 90s (or a minute before the credits):
  // its player page, scripts and stream lookup load in a hidden frame, so
  // the switch starts much faster. It must stay silent: see PreloadFrame.
  // Skipped with data saver on.
  const [preloadNext, setPreloadNext] = useState(false);
  useEffect(() => {
    setUpNext(null);
    setPreloadNext(false);
  }, [season, episode, item?.id]);
  useEffect(() => {
    if (!isTV || !nextEpisode || preloadNext || prefersLowBandwidth()) return undefined;
    const timer = setInterval(() => {
      const { time, duration } = playbackRef.current;
      const creditsSoon = markers.credits && time >= markers.credits.start - 60;
      if (duration > 0 && time > 0 && (duration - time <= 90 || creditsSoon)) setPreloadNext(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [isTV, nextEpisode, preloadNext, markers.credits, playbackRef]);

  useEffect(() => {
    if (!isTV || !nextEpisode) return undefined;
    const timer = setInterval(() => {
      const state = playbackRef.current;
      const key = `${season}:${episode}`;
      if (upNextDismissedRef.current === key) return;
      // At the credits when we know where they start, else the last 30s.
      const atCredits = markers.credits && state.time >= markers.credits.start && state.duration - state.time > 5;
      const nearEnd = atCredits || (state.duration > 0 && state.time > 0 && state.duration - state.time <= UP_NEXT_SECONDS);
      // With autoplay off in Settings the card waits for a tap (no countdown).
      if ((nearEnd || state.ended) && !upNext) setUpNext({ secondsLeft: getSettings().autoNext ? UP_NEXT_COUNTDOWN : null });
    }, 1000);
    return () => clearInterval(timer);
  }, [isTV, nextEpisode, season, episode, upNext, markers.credits, playbackRef]);

  useEffect(() => {
    if (!upNext || upNext.secondsLeft == null) return undefined;
    if (upNext.secondsLeft <= 0) { playNextEpisode(); return undefined; }
    const timer = setTimeout(() => setUpNext((current) => (current ? { secondsLeft: current.secondsLeft - 1 } : current)), 1000);
    return () => clearTimeout(timer);
    // Every tick re-renders, so playNextEpisode is always this render's (the current episode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNext]);

  function playNextEpisode() {
    if (!nextEpisode) return;
    haptic();
    // Moving on before the Up Next card showed up: the credits had started.
    const state = playbackRef.current;
    if (!upNext && item?.id) reportCredits({ mediaId: item.id, season, episode, start: state.time, duration: state.duration });
    if (item?.id && !watched.has(`${season}:${episode}`)) {
      markEpisodeWatched({ mediaId: item.id, season, episode })
        .then(() => setWatched((previous) => new Set([...previous, `${season}:${episode}`])))
        .catch(() => {});
    }
    setUpNext(null);
    upNextDismissedRef.current = '';
    setSeason(nextEpisode.season);
    setEpisode(nextEpisode.episode);
  }

  function dismissUpNext() {
    upNextDismissedRef.current = `${season}:${episode}`;
    setUpNext(null);
  }

  return { nextEpisode, nextInfo, upNext, preloadNext, playNextEpisode, dismissUpNext };
}

import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../utils/haptics';
import { fetchEpisodeMarkers, looksLikeIntroSkip, reportIntro } from '../../utils/episodeMarkers';
import { PAUSE_AWARE, RESUMABLE } from '../../utils/embedProviders';
import { getSettings } from '../../utils/profileSettings';
import { isAutoSkipOn, recordManualSkip, setAutoSkip, shouldOfferAutoSkip } from '../../utils/introSkips';

// Intro / credits markers (see utils/episodeMarkers): the Skip intro button,
// and learning an episode's intro from viewers who skip ahead early.
export default function useIntroMarkers({ isTV, item, season, episode, provider, playbackRef, iframeRef, pendingStartRef, setResumeNonce, bridge }) {
  const [markers, setMarkers] = useState({});
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  // "Hide" on the Skip intro button: gone for the rest of this episode.
  const [introHidden, setIntroHidden] = useState(false);
  // Our own skip target (so it isn't reported as a viewer's skip), where a
  // viewer's skip started, and its report timer.
  const ownSkipRef = useRef(0);
  const introFromRef = useRef(null);
  const introReportTimerRef = useRef(null);
  // Skipped automatically this episode (binge mode or this show's setting),
  // and the one-time offer to turn that on.
  const autoSkippedRef = useRef(false);
  const [offerAutoSkip, setOfferAutoSkip] = useState(false);

  useEffect(() => {
    setMarkers({});
    setShowSkipIntro(false);
    setIntroHidden(false);
    autoSkippedRef.current = false;
    if (!isTV || !item?.id) return undefined;
    let cancelled = false;
    fetchEpisodeMarkers(item, season, episode).then((found) => { if (!cancelled) setMarkers(found || {}); });
    return () => { cancelled = true; };
    // item is a new object for the same title on re-render; only its id matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTV, item?.id, season, episode]);

  // Skipping needs a server we can move: VidRift by message, the other
  // resumable servers by reloading at the new second.
  // In the phone apps the frame bridge reports and seeks on any server.
  const bridged = Boolean(bridge?.active);
  const canJump = provider === 'vidrift' || RESUMABLE.has(provider) || bridged;
  useEffect(() => {
    if (!markers.intro || !canJump || !(PAUSE_AWARE.has(provider) || bridged)) { setShowSkipIntro(false); return undefined; }
    const timer = setInterval(() => {
      const { time } = playbackRef.current;
      setShowSkipIntro(time > 0 && time >= markers.intro.start - 0.5 && time < markers.intro.end - 2);
    }, 500);
    return () => clearInterval(timer);
  }, [markers.intro, canJump, provider, playbackRef, bridged]);

  // Binge mode, or this show set to skip intros: done for you, once.
  useEffect(() => {
    if (!showSkipIntro || introHidden || autoSkippedRef.current || !item?.id) return;
    if (getSettings().bingeMode || isAutoSkipOn(item.id)) {
      autoSkippedRef.current = true;
      skipIntro({ automatic: true });
    }
    // skipIntro reads this render's markers; the effect runs when the button would show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSkipIntro, introHidden, item?.id]);

  function skipIntro({ automatic = false } = {}) {
    const target = markers.intro?.end;
    if (!target) return;
    if (!automatic && item?.id) {
      const skips = recordManualSkip(item.id, season, episode);
      if (shouldOfferAutoSkip(item.id, skips)) setOfferAutoSkip(true);
    }
    haptic();
    ownSkipRef.current = target;
    setShowSkipIntro(false);
    if (bridged) {
      bridge.seek(target);
    } else if (provider === 'vidrift' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'vidrift:resume', currentTime: target }, 'https://embed.vidrift.net');
    } else if (RESUMABLE.has(provider)) {
      pendingStartRef.current = Math.floor(target);
      setResumeNonce((n) => n + 1);
    }
  }

  // Called with each new playback time, before it's stored: a viewer
  // skipping ahead early in an episode is timing its intro (not when it's
  // our own "Skip intro" jump).
  function noteTime(state, reading) {
    if (isTV && item?.id && state.time > 0 && !ownSkipRef.current
        && looksLikeIntroSkip(state.time, reading.time, state.duration)) {
      const from = introFromRef.current ?? state.time;
      introFromRef.current = from;
      clearTimeout(introReportTimerRef.current);
      const landing = reading.time;
      const duration = state.duration;
      introReportTimerRef.current = setTimeout(() => {
        introFromRef.current = null;
        reportIntro({ mediaId: item.id, season, episode, start: from, end: landing, duration });
      }, 6000);
    }
    if (ownSkipRef.current && reading.time > (ownSkipRef.current - 3)) ownSkipRef.current = 0;
  }

  return {
    markers,
    showSkipIntro: showSkipIntro && !introHidden,
    hideSkipIntro: () => setIntroHidden(true),
    skipIntro: () => skipIntro(),
    noteTime,
    offerAutoSkip,
    acceptAutoSkip: () => { if (item?.id) setAutoSkip(item.id, true); setOfferAutoSkip(false); },
    declineAutoSkip: () => setOfferAutoSkip(false),
  };
}

import { useEffect, useRef, useState } from 'react';
import { getServerMemory, rankServers, rememberServer, submitStreamReport } from '../../utils/streamPreferences';
import { expectedRuntimeSeconds, isWrongLength } from '../../utils/runtimeCheck';
import { EVENT_PROVIDERS, FAILOVER_SECONDS, PAUSE_AWARE, RESUMABLE, STALL_SECONDS, STALL_SWITCH_SECONDS } from '../../utils/embedProviders';

// Moving off a server that isn't working: buffering (offered, then made
// automatically), a different video under this title's id, or no playback
// at all. A server the viewer picked by hand is never switched automatically.
export default function useFailover({
  item, mediaType, tmdbId, season, episode, externalId, playbackRef, pendingStartRef, servers,
}) {
  const {
    provider, setProvider, memoryType, availableIds, prefs, originalLanguage, reportSummary,
    setServerMemory, serverLockedRef, manualPickRef,
  } = servers;
  const playbackSeenRef = useRef(false);
  const triedRef = useRef(new Set());
  const [failoverNotice, setFailoverNotice] = useState(null);
  const [stall, setStall] = useState(null);

  // Buffering: a server that's supposed to be playing but whose time has
  // stopped moving. Offer a same-timestamp switch after STALL_SECONDS and
  // make it automatically after STALL_SWITCH_SECONDS (never for a server
  // the viewer picked by hand).
  useEffect(() => {
    if (!PAUSE_AWARE.has(provider)) return undefined;
    const timer = setInterval(() => {
      const state = playbackRef.current;
      if (!state.playing || !(state.time > 0)) return;
      const stuckFor = (Date.now() - state.lastAdvanceAt) / 1000;
      if (stuckFor < STALL_SECONDS) return;
      const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory: getServerMemory(memoryType, item?.id) });
      const next = ranking.find((server) => server.id !== provider && RESUMABLE.has(server.id))
        || ranking.find((server) => server.id !== provider);
      if (!next) return;
      setStall({ provider, next: next.id, at: state.time });
      if (stuckFor >= STALL_SWITCH_SECONDS && !manualPickRef.current) {
        rememberServer(memoryType, item?.id, { [`slow:${provider}`]: Date.now() });
        setServerMemory(getServerMemory(memoryType, item?.id));
        switchServer(next.id, { at: state.time, reason: 'buffering' });
      }
    }, 2000);
    return () => clearInterval(timer);
    // switchServer only uses refs, setters and provider; item?.id is listed so a slow
    // server is never remembered against the previous title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, availableIds, prefs, originalLanguage, reportSummary, item?.id, memoryType]);

  // Automatic failover. Servers can load fine and still not have a given
  // episode (their catalogs differ), which looks identical from outside —
  // except that the event-capable ones never report playback time moving.
  // If a server we picked automatically shows no playback within
  // FAILOVER_SECONDS, mark it dead for this title and move to the next
  // ranked server. A server the viewer chose by hand is never skipped.
  useEffect(() => {
    triedRef.current = new Set();
    setFailoverNotice(null);
  }, [item?.id, season, episode]);

  // The real runtime, for spotting a server that plays the wrong video.
  const expectedRuntimeRef = useRef(null);
  const [wrongVideo, setWrongVideo] = useState(null);
  useEffect(() => {
    expectedRuntimeRef.current = null;
    setWrongVideo(null);
    let cancelled = false;
    expectedRuntimeSeconds({ tmdbId, mediaType, season, episode })
      .then((seconds) => { if (!cancelled) expectedRuntimeRef.current = seconds; });
    return () => { cancelled = true; };
  }, [tmdbId, mediaType, season, episode]);

  useEffect(() => {
    if (!wrongVideo || wrongVideo !== provider || manualPickRef.current || !item?.id) return;
    setWrongVideo(null);
    triedRef.current.add(provider);
    submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: false }).catch(() => {});
    const memory = getServerMemory(memoryType, item.id);
    const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
    const next = ranking.find((server) => !triedRef.current.has(server.id) && server.id !== provider);
    if (!next) return;
    setServerMemory(memory);
    setFailoverNotice({ from: provider, to: next.id, reason: 'wrong' });
    setProvider(next.id);
    // Runs once per wrong-video report; the report re-renders first, so the ranking inputs read here are current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongVideo, provider]);

  useEffect(() => {
    playbackSeenRef.current = false;
    if (!item?.id || !externalId || manualPickRef.current || !EVENT_PROVIDERS.has(provider)) return undefined;
    const timer = setTimeout(() => {
      if (playbackSeenRef.current) return;
      triedRef.current.add(provider);
      submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: false }).catch(() => {});
      const memory = getServerMemory(memoryType, item.id);
      const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
      const next = ranking.find((server) => !triedRef.current.has(server.id) && server.id !== provider);
      if (!next) return;
      setServerMemory(memory);
      setFailoverNotice({ from: provider, to: next.id });
      setProvider(next.id);
    }, FAILOVER_SECONDS * 1000);
    return () => clearTimeout(timer);
    // A countdown per server/episode: restarting it whenever ranking inputs refresh would keep postponing failover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, season, episode, externalId, item?.id]);

  // Change server, carrying the current position across when possible.
  function switchServer(id, { at = null, reason = null, manual = false } = {}) {
    const position = at ?? (playbackRef.current.time > 5 ? playbackRef.current.time : null);
    if (position) pendingStartRef.current = Math.floor(position);
    if (manual) {
      serverLockedRef.current = true;
      manualPickRef.current = true;
    }
    setStall(null);
    setFailoverNotice(reason ? { from: provider, to: id, reason, at: position } : null);
    setProvider(id);
  }

  function selectServer(id) {
    switchServer(id, { manual: true });
  }

  // What the playback messages show (see usePlaybackMessages).
  function noteDuration(duration) {
    // A different video under this title's id (see utils/runtimeCheck).
    if (!manualPickRef.current && isWrongLength(duration, expectedRuntimeRef.current)) {
      setWrongVideo(provider);
    }
  }
  function noteAdvance() { setStall(null); }
  function markPlaybackSeen() { playbackSeenRef.current = true; }

  return {
    stall, failoverNotice, dismissFailover: () => setFailoverNotice(null),
    noteDuration, noteAdvance, markPlaybackSeen, switchServer, selectServer,
  };
}

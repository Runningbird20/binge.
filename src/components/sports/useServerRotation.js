import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expandStreamProviders, resolveProviderEmbedUrl } from '../../utils/sportsProviders';
import { rankFeeds, recordFeedFailed, recordFeedWorked } from '../../utils/sportsServerMemory';
import { hostOf, isHostReachable, reachabilityMap } from '../../utils/hostReachability';

// How long a server's iframe gets to fire `load` before we silently move to
// the next one. Only catches network-level failures — a cross-origin player
// that loads but shows a dead stream looks identical from outside, which is
// what the "Next server" button is for.
const LOAD_TIMEOUT_MS = 8_000;

// Staying this long on a server counts as "it worked" (see sportsServerMemory).
const WORKED_AFTER_MS = 60_000;

// Expanding Streamed sources waits at most this long before starting.
const EXPAND_TIMEOUT_MS = 3_500;

// Server rotation for one game: probes which provider hosts this network
// can reach, resolves the embed URL, and auto-advances past servers that
// fail to load. Shared by the single-game player and Multiview tiles.
export function useServerRotation(stream, status) {
  const [serverIndex, setServerIndex] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [embedUrl, setEmbedUrl] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(new Set());
  // Servers whose host this network blocks (see utils/hostReachability).
  const [blocked, setBlocked] = useState(new Set());
  // Every stream of every feed, best first; null while it's being worked out.
  const [list, setList] = useState(null);
  const loadedRef = useRef(false);
  const workedRef = useRef(false);
  const servers = useMemo(() => list || [], [list]);
  // Once a game has been live, a schedule refresh that briefly calls it
  // "upcoming" (a feed moved its start time) must not unload the stream:
  // that reload is what threw viewers out of full screen and restarted the
  // player muted (browsers mute players that start without a click).
  const wasLive = useRef({ id: null, live: false });
  if (wasLive.current.id !== stream.id) wasLive.current = { id: stream.id, live: false };
  if (status !== 'upcoming') wasLive.current.live = true;
  const upcoming = status === 'upcoming' && !wasLive.current.live;

  useEffect(() => {
    setServerIndex(0);
    setFailed(new Set());
    setBlocked(new Set());
    setRetryNonce(0);
    setList(null);
    let cancelled = false;
    (async () => {
      // Each Streamed source becomes all of its streams; don't wait on a
      // slow lookup for long (unexpanded sources still resolve on demand).
      const expanded = await Promise.race([
        expandStreamProviders(stream.providers).catch(() => stream.providers),
        new Promise((resolve) => { setTimeout(() => resolve(stream.providers), EXPAND_TIMEOUT_MS); }),
      ]);
      const ranked = rankFeeds(expanded, stream.id);
      // Probe the hosts we know and start on the first server this network
      // can actually reach.
      const reach = await reachabilityMap(ranked.map((provider) => hostOf(provider.embedUrl)));
      if (cancelled) return;
      const blockedNow = new Set(ranked
        .map((provider, index) => (provider.embedUrl && reach[hostOf(provider.embedUrl)] === false ? index : -1))
        .filter((index) => index >= 0));
      setBlocked(blockedNow);
      setList(ranked);
      const firstOk = ranked.findIndex((_, index) => !blockedNow.has(index));
      setServerIndex(Math.max(0, firstOk));
    })();
    return () => { cancelled = true; };
  // The schedule refreshes with new objects for the same game; only a new game resets its servers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  // Auto-advance past a server that failed, unless every server has.
  const advance = useCallback(() => {
    recordFeedFailed(servers[serverIndex], stream.id);
    setFailed((current) => {
      const next = new Set(current);
      next.add(serverIndex);
      return next;
    });
    setServerIndex((index) => {
      for (let step = 1; step <= servers.length; step += 1) {
        const candidate = (index + step) % servers.length;
        if (!failed.has(candidate) && !blocked.has(candidate) && candidate !== index) return candidate;
      }
      return index;
    });
  }, [serverIndex, servers, failed, blocked, stream.id]);

  useEffect(() => {
    const provider = servers[serverIndex];
    if (!provider || upcoming) { setEmbedUrl(null); setResolving(false); return undefined; }
    let cancelled = false;
    setResolving(true);
    setEmbedUrl(null);
    resolveProviderEmbedUrl(provider).then(async (url) => {
      if (cancelled) return;
      if (url && !(await isHostReachable(hostOf(url)))) {
        if (cancelled) return;
        setBlocked((current) => new Set(current).add(serverIndex));
        setResolving(false);
        advance();
        return;
      }
      setResolving(false);
      if (url) setEmbedUrl(url);
      else advance();
    });
    return () => { cancelled = true; };
    // servers is derived from list; advance() is recreated every render and only moves serverIndex.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, list, serverIndex, retryNonce, upcoming]);

  useEffect(() => {
    loadedRef.current = false;
    if (!embedUrl) return undefined;
    const timer = setTimeout(() => {
      if (!loadedRef.current) advance();
    }, LOAD_TIMEOUT_MS);
    // Still on this server a minute later: remember that it works.
    const provider = servers[serverIndex];
    const worked = setTimeout(() => {
      if (loadedRef.current) { workedRef.current = true; recordFeedWorked(provider, stream.id); }
    }, WORKED_AFTER_MS);
    workedRef.current = false;
    return () => { clearTimeout(timer); clearTimeout(worked); };
  // Per loaded embed; servers and stream.id belong to the same game as embedUrl.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedUrl, advance]);

  const preparing = list === null;
  const unavailable = new Set([...failed, ...blocked]);
  const allFailed = !preparing && unavailable.size >= servers.length;
  const allBlocked = !preparing && blocked.size >= servers.length;

  function chooseServer(index) {
    // Leaving a server within its first minute counts against it.
    if (index !== serverIndex && embedUrl && !workedRef.current) recordFeedFailed(servers[serverIndex], stream.id);
    setFailed((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
    if (index === serverIndex) setRetryNonce((n) => n + 1);
    else setServerIndex(index);
  }

  function nextServer() {
    if (servers.length > 1) chooseServer((serverIndex + 1) % servers.length);
    else setRetryNonce((n) => n + 1);
  }

  function retryAll() {
    setFailed(new Set());
    chooseServer(0);
  }

  return {
    servers, serverIndex, retryNonce, embedUrl, resolving: resolving || preparing, failed, blocked,
    allFailed, allBlocked, advance, chooseServer, nextServer, retryAll,
    onFrameLoad: () => { loadedRef.current = true; },
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reachabilityMap } from '../../utils/hostReachability';
import { fetchTmdbLanguageInfo } from '../../utils/tmdb';
import { fetchReportSummary, fetchProviderHealth, fetchDisabledServers, getPlaybackPrefs, getServerMemory, rankServers, savePlaybackPrefs, submitStreamReport, wantedAudio } from '../../utils/streamPreferences';
import { EVENT_PROVIDERS, PROVIDER_HOSTS, SERVER_CONFIRM_SECONDS, bestServerFor, providerIdsFor } from '../../utils/embedProviders';

// Which embed server plays (see utils/streamPreferences.js): ranked from the
// profile's audio/subtitle prefs, the title's original language, community
// reports, server health and what worked here before. The player follows the
// ranking until the viewer picks a server or one is confirmed working.
export default function useServerChoice({ item, mediaType, externalId, resetKey }) {
  const [prefs, setPrefs] = useState(() => getPlaybackPrefs());
  const [provider, setProvider] = useState(() => bestServerFor(item, mediaType, getPlaybackPrefs()));
  const memoryType = mediaType === 'tv_show' ? 'tv_show' : 'movie';
  const [originalLanguage, setOriginalLanguage] = useState(item?.original_language || null);
  const [reportSummary, setReportSummary] = useState([]);
  const [providerHealth, setProviderHealth] = useState({});
  const [serverMemory, setServerMemory] = useState(() => getServerMemory(memoryType, item?.id));
  // Once the viewer picks a server themselves, or one has played long
  // enough to count as working, late-arriving community reports must not
  // yank them onto a different server mid-episode.
  const serverLockedRef = useRef(false);
  const manualPickRef = useRef(false);

  useEffect(() => {
    serverLockedRef.current = false;
    manualPickRef.current = false;
    setProvider(bestServerFor(item, mediaType, getPlaybackPrefs()));
    setServerMemory(getServerMemory(mediaType === 'tv_show' ? 'tv_show' : 'movie', item?.id));
    setOriginalLanguage(item?.original_language || null);
    setReportSummary([]);
    // Reset only when another title/episode opens (resetKey covers item and mediaType).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Servers this network blocks (school/work firewalls) are dropped from
  // the ranking instead of being tried and failing.
  const [blockedIds, setBlockedIds] = useState(() => new Set());
  const [disabledIds, setDisabledIds] = useState(() => new Set());
  useEffect(() => { fetchDisabledServers().then(setDisabledIds); }, []);
  useEffect(() => {
    let cancelled = false;
    reachabilityMap(Object.values(PROVIDER_HOSTS)).then((reach) => {
      if (cancelled) return;
      setBlockedIds(new Set(Object.entries(PROVIDER_HOSTS).filter(([, host]) => reach[host] === false).map(([id]) => id)));
    });
    return () => { cancelled = true; };
  }, []);
  const availableIds = useMemo(() => {
    const ids = providerIdsFor(mediaType, externalId);
    // Off-limits: blocked on this network, or switched off by an admin.
    const reachable = ids.filter((id) => !blockedIds.has(id) && !disabledIds.has(id));
    return reachable.length ? reachable : ids;
  }, [mediaType, externalId, blockedIds, disabledIds]);
  const rankedServers = useMemo(
    () => rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory: serverMemory, health: providerHealth }),
    [availableIds, prefs, originalLanguage, reportSummary, serverMemory, providerHealth]
  );

  // Original language: from the catalog row, else TMDB.
  useEffect(() => {
    if (item?.original_language) return undefined;
    const tmdbLookupId = externalId?.kind === 'tmdb' ? externalId.value : null;
    if (!tmdbLookupId) return undefined;
    let cancelled = false;
    fetchTmdbLanguageInfo(mediaType, tmdbLookupId).then((info) => {
      if (!cancelled && info?.originalLanguage) setOriginalLanguage(info.originalLanguage);
    });
    return () => { cancelled = true; };
  }, [item?.original_language, externalId, mediaType]);

  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    fetchReportSummary(memoryType, item.id).then((rows) => { if (!cancelled) setReportSummary(rows); });
    fetchProviderHealth().then((health) => { if (!cancelled) setProviderHealth(health); });
    return () => { cancelled = true; };
  }, [item?.id, memoryType]);

  // Follow the ranking until the viewer commits to a server.
  useEffect(() => {
    if (serverLockedRef.current) return;
    const best = rankedServers[0]?.id;
    if (best && best !== provider) setProvider(best);
    // Follows the ranking only: reacting to provider would undo a server the viewer just picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedServers]);

  // Confirming a server works for this title. Servers that post
  // PLAYER_EVENT messages (VidLink, Videasy) are confirmed by real playback
  // (time actually advancing); for the rest, staying open for
  // SERVER_CONFIRM_SECONDS is the best available signal.
  const confirmedRef = useRef('');
  const confirmServer = useCallback(() => {
    const key = `${provider}|${item?.id}`;
    if (!item?.id || confirmedRef.current === key) return;
    confirmedRef.current = key;
    serverLockedRef.current = true;
    submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: true })
      .then(() => setServerMemory(getServerMemory(memoryType, item.id)))
      .catch(() => {});
  }, [provider, item?.id, memoryType]);

  useEffect(() => {
    if (!item?.id || !externalId || EVENT_PROVIDERS.has(provider)) return undefined;
    const timer = setTimeout(confirmServer, SERVER_CONFIRM_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [provider, item?.id, externalId, confirmServer]);

  // Optional, from the panel: "the audio on this server is X".
  async function reportServerAudio(language) {
    if (!item?.id || !language) return;
    await submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: true, audioLang: language }).catch(() => {});
    const memory = getServerMemory(memoryType, item.id);
    setServerMemory(memory);
    const want = wantedAudio(prefs, originalLanguage);
    if (want && language !== want) {
      const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
      serverLockedRef.current = false;
      setProvider(nextServerAfter(provider, ranking, language));
    }
  }

  function nextServerAfter(currentId, ranking, avoidAudio = null) {
    const candidates = ranking.filter((server) => server.id !== currentId);
    return (candidates.find((server) => !avoidAudio || server.audio !== avoidAudio) || candidates[0])?.id || currentId;
  }

  function changePrefs(patch) {
    const next = savePlaybackPrefs(patch);
    setPrefs(next);
    if (patch.audio) {
      // New audio language: let the ranking pick again, unless the current
      // server is already known to have it.
      const ranking = rankServers(availableIds, { prefs: next, originalLanguage, summary: reportSummary, memory: serverMemory });
      const current = ranking.find((server) => server.id === provider);
      const want = wantedAudio(next, originalLanguage);
      if (!(current?.audio && current.audio === want)) {
        serverLockedRef.current = false;
        if (ranking[0]?.id) setProvider(ranking[0].id);
      }
    }
  }

  async function reportBroken() {
    if (item?.id) await submitStreamReport({ mediaType: memoryType, mediaId: item.id, provider, works: false }).catch(() => {});
    const memory = getServerMemory(memoryType, item?.id);
    setServerMemory(memory);
    const ranking = rankServers(availableIds, { prefs, originalLanguage, summary: reportSummary, memory });
    serverLockedRef.current = true;
    setProvider(nextServerAfter(provider, ranking));
  }

  return {
    prefs, provider, setProvider, memoryType, originalLanguage, reportSummary, providerHealth,
    serverMemory, setServerMemory, serverLockedRef, manualPickRef, blockedIds, availableIds, rankedServers,
    confirmServer, reportServerAudio, changePrefs, reportBroken,
  };
}

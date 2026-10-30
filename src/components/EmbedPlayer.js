import { useEffect, useRef, useState } from 'react';
import useDeviceType from '../hooks/useDeviceType';
import { isTvMode } from '../utils/tvMode';
import { useMiniPlayer } from '../contexts/MiniPlayerContext';
import { getResumePosition, positionKey, savePosition } from '../utils/playbackPositions';
import { setCaptionCapableServers } from '../utils/streamPreferences';
import { PROVIDERS, RESUMABLE, SERVER_LABELS, buildUrl, normalizeStartAt, prefersLowBandwidth } from '../utils/embedProviders';
import useEmbedId from './player/useEmbedId';
import useServerChoice from './player/useServerChoice';
import useEpisodeGuide from './player/useEpisodeGuide';
import useWatchedEpisodes from './player/useWatchedEpisodes';
import useIntroMarkers from './player/useIntroMarkers';
import useUpNext from './player/useUpNext';
import usePositionSync from './player/usePositionSync';
import useFailover from './player/useFailover';
import usePlaybackMessages from './player/usePlaybackMessages';
import useFullscreen from './player/useFullscreen';
import usePlayerKeyboard from './player/usePlayerKeyboard';
import useControlsAutoHide from './player/useControlsAutoHide';
import UpNextCard from './player/UpNextCard';
import { FailoverBar, PreloadFrame, SkipIntroButton } from './player/PlayerOverlays';
import MobilePlayer from './player/MobilePlayer';
import DesktopPlayer from './player/DesktopPlayer';

setCaptionCapableServers(PROVIDERS.filter((entry) => entry.subtitles).map((entry) => entry.id));

// The full-screen player for a movie or episode. Embed servers are
// cross-origin iframes, so everything here works from the outside: which
// server to load (useServerChoice), what their playback messages say
// (usePlaybackMessages), when to move to another server (useFailover), and
// the extras around the video (episodes, Up Next, Skip intro, position sync).
// The layout is MobilePlayer on phones and DesktopPlayer elsewhere.
export default function EmbedPlayer({ item, mediaType, onClose, initialSeason, initialEpisode, initialPosition }) {
  const { isMobile, isLandscape } = useDeviceType();
  const { showMini, closeMini } = useMiniPlayer();
  const isTV = mediaType === 'tv_show';
  // Per-title state resets when the title (or the episode it opens on) changes.
  const resetKey = `${item?.id}|${item?.title}|${mediaType}|${initialSeason}|${initialEpisode}`;
  const [season, setSeason] = useState(() => normalizeStartAt(initialSeason));
  const [episode, setEpisode] = useState(() => normalizeStartAt(initialEpisode));
  const [epPopoverOpen, setEpPopoverOpen] = useState(false);
  useEffect(() => {
    setSeason(normalizeStartAt(initialSeason));
    setEpisode(normalizeStartAt(initialEpisode));
    setEpPopoverOpen(false);
    // Re-seed from the props only when another title/episode opens (resetKey); later prop echoes of our own state must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // What the embed last reported (see usePlaybackMessages).
  const playbackRef = useRef({ time: 0, duration: 0, playing: false, lastAdvanceAt: Date.now(), lastSavedAt: 0 });
  // Start position per load (provider + episode), frozen when the load
  // begins so saving progress every few seconds never changes the iframe
  // URL (which would reload the player). A pending start (resume, server
  // switch, Skip intro) applies to the next load; bumping resumeNonce reloads.
  const pendingStartRef = useRef(Number(initialPosition) > 0 ? Math.floor(Number(initialPosition)) : null);
  const [resumeNonce, setResumeNonce] = useState(0);
  const frozenStartRef = useRef({ key: '', value: null });
  const modalRef = useRef(null);
  const epSelectorRef = useRef(null);
  const frameWrapRef = useRef(null);
  const iframeRef = useRef(null);

  const { externalId, lookupState, lookupError } = useEmbedId(item, mediaType);
  const tmdbId = externalId?.kind === 'tmdb' ? externalId.value : null;
  const currentEpisodeKey = `${season}:${episode}`;
  const canTrackEpisodes = Boolean(item?.id);

  const serverChoice = useServerChoice({ item, mediaType, externalId, resetKey });
  const { provider, prefs } = serverChoice;
  const subtitleLang = prefs.subtitles && prefs.subtitles !== 'off' ? prefs.subtitles : null;

  const { seasonEpisodeCounts, totalSeasons, metadataWarning } = useEpisodeGuide({ item, isTV, tmdbId, season, resetKey });
  const { watched, setWatched, markingWatched, markWatched } = useWatchedEpisodes({ item, isTV, season, episode, resetKey });
  const intro = useIntroMarkers({ isTV, item, season, episode, provider, playbackRef, iframeRef, pendingStartRef, setResumeNonce });
  const upNext = useUpNext({
    isTV, item, tmdbId, season, episode, setSeason, setEpisode, totalSeasons,
    seasonEpisodeCounts, markers: intro.markers, playbackRef, watched, setWatched,
  });
  const { syncPosition } = usePositionSync({
    item, mediaType, isTV, season, episode, provider, externalId, subtitleLang,
    playbackRef, iframeRef, pendingStartRef, frozenStartRef, setResumeNonce,
  });
  const failover = useFailover({
    item, mediaType, tmdbId, season, episode, externalId, playbackRef, pendingStartRef, servers: serverChoice,
  });
  usePlaybackMessages({
    provider, item, mediaType, season, episode, iframeRef, playbackRef,
    confirmServer: serverChoice.confirmServer, failover, intro, syncPosition,
  });

  const fullscreen = useFullscreen({ isMobile, modalRef, frameWrapRef });
  // Only one video should ever be audible at once — opening this (full)
  // player always wins over whatever the mini-player widget was doing.
  useEffect(() => {
    closeMini();
    // Once on mount: opening the full player closes the mini-player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  usePlayerKeyboard({
    isTV, onClose, season, episode, setSeason, setEpisode, totalSeasons, seasonEpisodeCounts,
    epPopoverOpen, setEpPopoverOpen, epSelectorRef, toggleFullscreen: fullscreen.toggleFullscreen,
  });
  const controls = useControlsAutoHide(item?.id, season, episode);

  const loadKey = `${provider}|${item?.id}|${season}|${episode}|${resumeNonce}`;
  if (frozenStartRef.current.key !== loadKey) {
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    frozenStartRef.current = {
      key: loadKey,
      value: pending ?? (item?.id ? getResumePosition(positionKey(mediaType, item.id, season, episode)) : null),
    };
  }
  const startAt = frozenStartRef.current.value;
  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode, subtitleLang, { startAt, lowBandwidth: prefersLowBandwidth() });

  // TV remote: hand the remote to the video once it loads, so OK plays and
  // pauses; Back steps out to the player's controls (KeyboardShortcuts).
  useEffect(() => {
    if (!isTvMode() || !embedUrl) return undefined;
    const timer = setTimeout(() => iframeRef.current?.focus(), 1500);
    return () => clearTimeout(timer);
  }, [embedUrl]);

  // VidRift takes its start position (and quality hint) as messages.
  function handleFrameLoad() {
    if (provider !== 'vidrift') return;
    const frame = iframeRef.current;
    setTimeout(() => {
      if (!frame?.contentWindow) return;
      if (startAt > 0) frame.contentWindow.postMessage({ type: 'vidrift:resume', currentTime: startAt }, 'https://embed.vidrift.net');
      if (prefersLowBandwidth()) frame.contentWindow.postMessage({ type: 'vidrift:quality-preference', label: '720p' }, 'https://embed.vidrift.net');
    }, 1500);
  }

  // Hand off to the persistent global mini-player, then close this (full)
  // view the same way the close button would — the mini widget carries on
  // with its own copy of the embed, independent of this component now.
  function handleMinimize() {
    // Hand over the *current* second (not the one this load started at), and
    // save it, so the corner player and a later Expand both pick up here.
    const state = playbackRef.current;
    const key = item?.id ? positionKey(mediaType, item.id, season, episode) : null;
    if (key && state.time > 0) savePosition(key, state.time, state.duration);
    const at = state.time > 0 ? Math.floor(state.time) : startAt;
    const miniUrl = RESUMABLE.has(provider) && provider !== 'vidrift'
      ? buildUrl(provider, externalId, mediaType, season, episode, subtitleLang, { startAt: at, lowBandwidth: prefersLowBandwidth() })
      : embedUrl;
    const base = mediaType === 'tv_show' ? `/tv-show/${item.id}?play=1&season=${season}&episode=${episode}` : `/movie/${item.id}?play=1`;
    showMini({
      embedUrl: miniUrl,
      title: item.title,
      subtitle: isTV ? `S${season} E${episode}` : (item.year || ''),
      poster: item.poster_url || item.cover_url || item.image_url || null,
      href: base,
      positionKey: key,
      vidriftResume: provider === 'vidrift' && at > 0 ? at : null,
    });
    onClose?.();
  }

  const playbackOptionProps = {
    prefs,
    onPrefsChange: serverChoice.changePrefs,
    originalLanguage: serverChoice.originalLanguage,
    servers: serverChoice.rankedServers,
    currentServer: provider,
    serverLabels: SERVER_LABELS,
    onSelectServer: failover.selectServer,
    onReportBroken: serverChoice.reportBroken,
    onReportAudio: serverChoice.reportServerAudio,
    blockedCount: serverChoice.blockedIds.size,
    health: serverChoice.providerHealth,
  };
  // Silent preloads only where the server's autoplay can be switched off (see PreloadFrame).
  const silentPreload = Boolean(PROVIDERS.find((entry) => entry.id === provider)?.silentPreload);
  const preloadUrl = upNext.preloadNext && upNext.nextEpisode
    ? buildUrl(provider, externalId, mediaType, upNext.nextEpisode.season, upNext.nextEpisode.episode, subtitleLang, { noAutoplay: silentPreload })
    : null;
  const overlays = (
    <>
      {intro.showSkipIntro && <SkipIntroButton onSkip={intro.skipIntro} onHide={intro.hideSkipIntro} />}
      {upNext.upNext && upNext.nextEpisode && (
        <UpNextCard upNext={upNext.upNext} nextEpisode={upNext.nextEpisode} nextInfo={upNext.nextInfo} onPlay={upNext.playNextEpisode} onCancel={upNext.dismissUpNext} />
      )}
      {preloadUrl && <PreloadFrame url={preloadUrl} silent={silentPreload} />}
    </>
  );
  const failoverBar = (
    <FailoverBar
      stall={failover.stall}
      notice={failover.failoverNotice}
      isTV={isTV}
      onSwitch={failover.switchServer}
      onTryAgain={failover.selectServer}
      onDismiss={failover.dismissFailover}
    />
  );
  const episodes = {
    totalSeasons,
    watched,
    seasonEpisodeCounts,
    episodeCount: isTV ? (seasonEpisodeCounts[season] ?? undefined) : undefined,
    watchedInSeason: Array.from(watched).filter((key) => key.startsWith(`${season}:`)).length,
    onPickSeason: (value) => { setSeason(value); setEpisode(1); },
    onPickEpisode: setEpisode,
  };
  const layout = {
    item, isTV, season, episode, onClose, onMinimize: handleMinimize, modalRef,
    frame: { embedUrl, frameRef: iframeRef, title: `Watch ${item.title}`, onLoad: handleFrameLoad },
    frameKey: `${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}-${resumeNonce}`,
    overlays, failoverBar, lookupState, lookupError, episodes,
    watchedNow: watched.has(currentEpisodeKey),
    canTrackEpisodes,
    markingWatched,
    onMarkWatched: () => markWatched(season, episode),
    playbackOptionProps,
    fullscreen,
  };

  if (isMobile) {
    return (
      <MobilePlayer
        {...layout}
        isLandscape={isLandscape}
        servers={serverChoice.rankedServers}
        provider={provider}
        onSelectServer={failover.selectServer}
      />
    );
  }

  return (
    <DesktopPlayer
      {...layout}
      frameWrapRef={frameWrapRef}
      metadataWarning={metadataWarning}
      controls={controls}
      episodeSelector={{
        selectorRef: epSelectorRef,
        open: epPopoverOpen,
        onToggle: () => setEpPopoverOpen((open) => !open),
        onPickEpisode: (value) => { setEpisode(value); setEpPopoverOpen(false); },
      }}
    />
  );
}

import { useEffect, useRef, useState } from 'react';
import useDeviceType from '../hooks/useDeviceType';
import { isTvMode } from '../utils/tvMode';
import { getResumePosition, positionKey } from '../utils/playbackPositions';
import { setCaptionCapableServers } from '../utils/streamPreferences';
import { PROVIDERS, SERVER_LABELS, buildUrl, normalizeStartAt, prefersLowBandwidth } from '../utils/embedProviders';
import useEmbedId from './player/useEmbedId';
import useServerChoice from './player/useServerChoice';
import useEpisodeGuide from './player/useEpisodeGuide';
import useWatchedEpisodes from './player/useWatchedEpisodes';
import useIntroMarkers from './player/useIntroMarkers';
import useServerEpisode from './player/useServerEpisode';
import useUpNext from './player/useUpNext';
import usePositionSync from './player/usePositionSync';
import useFailover from './player/useFailover';
import usePlaybackMessages from './player/usePlaybackMessages';
import usePopupSandbox from './player/usePopupSandbox';
import useFullscreen from './player/useFullscreen';
import usePlayerKeyboard from './player/usePlayerKeyboard';
import useControlsAutoHide from './player/useControlsAutoHide';
import UpNextCard from './player/UpNextCard';
import { AutoSkipOffer, FailoverBar, PreloadFrame, SkipIntroButton } from './player/PlayerOverlays';
import useSleepTimer from './player/useSleepTimer';
import useAppBridge from './player/useAppBridge';
import MobilePlayer from './player/MobilePlayer';
import DesktopPlayer from './player/DesktopPlayer';

setCaptionCapableServers(PROVIDERS.filter((entry) => entry.subtitles).map((entry) => entry.id));

// The full-screen player for a movie or episode. Embed servers are
// cross-origin iframes, so everything here works from the outside: which
// server to load (useServerChoice), what their playback messages say
// (usePlaybackMessages), when to move to another server (useFailover), and
// the extras around the video (episodes, Up Next, Skip intro, position sync).
// The layout is MobilePlayer on phones and DesktopPlayer elsewhere.
//
// Two ways out: the X (onClose) closes the player entirely, and Escape or a
// TV remote's Back (onBack, onClose when not given) steps back one layer.
export default function EmbedPlayer({ item, mediaType, onClose, onBack = onClose, initialSeason, initialEpisode, initialPosition }) {
  const { isMobile, isLandscape } = useDeviceType();
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

  // Keep the address on the episode being watched. After Up Next (or picking
  // another episode) it still said the first one, with its ?t= near the end,
  // so a refresh or a shared link went back to the end of that episode.
  // replaceState: no history entry, and the router doesn't re-render.
  useEffect(() => {
    if (!isTV || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('episode') && !url.searchParams.has('play')) return;
    if (url.searchParams.get('season') === String(season) && url.searchParams.get('episode') === String(episode)) return;
    url.searchParams.set('season', String(season));
    url.searchParams.set('episode', String(episode));
    url.searchParams.delete('t');
    window.history.replaceState(window.history.state, '', url);
  }, [isTV, season, episode]);

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

  // An episode change made inside the server's own player (VidRift's Next
  // button, Episodes menu or own Up Next; see useServerEpisode). The player has
  // already switched, so the site follows without reloading it: the frame keeps
  // the URL it was loaded with, while season/episode (positions, watched marks,
  // Up Next, the address, the episode shown) move to the episode now playing.
  // Any reload of our own (another episode, another server, a resume) loads
  // season/episode as usual.
  const inPlayerRef = useRef(null); // { season, episode, frameSeason, frameEpisode, provider, nonce }
  const inPlayer = inPlayerRef.current;
  const followingPlayer = Boolean(inPlayer && inPlayer.season === season && inPlayer.episode === episode
    && inPlayer.provider === provider && inPlayer.nonce === resumeNonce);
  const frameSeason = followingPlayer ? inPlayer.frameSeason : season;
  const frameEpisode = followingPlayer ? inPlayer.frameEpisode : episode;
  function followPlayerEpisode(next) {
    inPlayerRef.current = { ...next, frameSeason, frameEpisode, provider, nonce: resumeNonce };
    setEpPopoverOpen(false);
    setSeason(next.season);
    setEpisode(next.episode);
  }
  const subtitleLang = prefs.subtitles && prefs.subtitles !== 'off' ? prefs.subtitles : null;

  const { seasonEpisodeCounts, totalSeasons, metadataWarning } = useEpisodeGuide({ item, isTV, tmdbId, season, resetKey });
  const { watched, setWatched, markingWatched, markWatched } = useWatchedEpisodes({ item, isTV, season, episode, resetKey });
  const loadKey = `${provider}|${item?.id}|${frameSeason}|${frameEpisode}|${resumeNonce}`;
  if (frozenStartRef.current.key !== loadKey) {
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    frozenStartRef.current = {
      key: loadKey,
      value: pending ?? (item?.id ? getResumePosition(positionKey(mediaType, item.id, frameSeason, frameEpisode)) : null),
    };
  }
  const startAt = frozenStartRef.current.value;
  // Phone apps only: the bridge in the server's frame (useAppBridge).
  const bridge = useAppBridge({
    iframeRef, provider, loadKey, item, mediaType, season, episode, subtitles: prefs.subtitles, startAt, playbackRef,
  });
  const intro = useIntroMarkers({ isTV, item, season, episode, provider, playbackRef, iframeRef, pendingStartRef, setResumeNonce, bridge });
  const sleep = useSleepTimer({ onClose, isTV });
  const upNext = useUpNext({
    isTV, item, tmdbId, season, episode, setSeason, setEpisode, totalSeasons,
    seasonEpisodeCounts, markers: intro.markers, playbackRef, watched, setWatched,
    stopAtEnd: sleep.stopAtEnd, onSleep: onClose,
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
    confirmServer: serverChoice.confirmServer, failover, intro, syncPosition, bridge,
  });
  useServerEpisode({ isTV, tmdbId, season, episode, iframeRef, onEpisode: followPlayerEpisode });
  // Pop-ups blocked by sandboxing the player, where the server allows it. One
  // check per load, so it goes by the episode the frame loaded.
  const popups = usePopupSandbox({ provider, itemId: item?.id, season: frameSeason, episode: frameEpisode, playbackRef });

  const fullscreen = useFullscreen({ isMobile, modalRef, frameWrapRef });
  usePlayerKeyboard({
    isTV, onClose: onBack, season, episode, setSeason, setEpisode, totalSeasons, seasonEpisodeCounts,
    epPopoverOpen, setEpPopoverOpen, epSelectorRef, toggleFullscreen: fullscreen.toggleFullscreen,
  });
  const controls = useControlsAutoHide(item?.id, season, episode);

  const embedUrl = buildUrl(provider, externalId, mediaType, frameSeason, frameEpisode, subtitleLang, { startAt, lowBandwidth: prefersLowBandwidth() });

  // TV remote: hand the remote to the video once it loads, so OK plays and
  // pauses; Back steps out to the player's controls (KeyboardShortcuts).
  useEffect(() => {
    if (!isTvMode() || !embedUrl) return undefined;
    const timer = setTimeout(() => iframeRef.current?.focus(), 1500);
    return () => clearTimeout(timer);
  }, [embedUrl]);

  // VidRift takes its start position (and quality hint) as messages. Not the
  // start position once it has switched episodes itself: that was for the
  // episode in its URL.
  function handleFrameLoad() {
    if (provider !== 'vidrift') return;
    const frame = iframeRef.current;
    const resumeAt = followingPlayer ? 0 : startAt;
    setTimeout(() => {
      if (!frame?.contentWindow) return;
      if (resumeAt > 0) frame.contentWindow.postMessage({ type: 'vidrift:resume', currentTime: resumeAt }, 'https://embed.vidrift.net');
      if (prefersLowBandwidth()) frame.contentWindow.postMessage({ type: 'vidrift:quality-preference', label: '720p' }, 'https://embed.vidrift.net');
    }, 1500);
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
    popupsBlockedNow: popups.sandboxed,
    sleep,
    appCaptions: bridge.captions,
  };
  // Silent preloads only where the server's autoplay can be switched off (see PreloadFrame).
  const silentPreload = Boolean(PROVIDERS.find((entry) => entry.id === provider)?.silentPreload);
  const preloadUrl = upNext.preloadNext && upNext.nextEpisode
    ? buildUrl(provider, externalId, mediaType, upNext.nextEpisode.season, upNext.nextEpisode.episode, subtitleLang, { noAutoplay: silentPreload })
    : null;
  const overlays = (
    <>
      {intro.showSkipIntro && <SkipIntroButton onSkip={intro.skipIntro} onHide={intro.hideSkipIntro} />}
      {intro.offerAutoSkip && <AutoSkipOffer onAccept={intro.acceptAutoSkip} onDecline={intro.declineAutoSkip} />}
      {upNext.upNext && upNext.nextEpisode && (
        <UpNextCard upNext={upNext.upNext} nextEpisode={upNext.nextEpisode} nextInfo={upNext.nextInfo} onPlay={upNext.playNextEpisode} onCancel={upNext.dismissUpNext} />
      )}
      {preloadUrl && <PreloadFrame url={preloadUrl} silent={silentPreload} sandbox={popups.sandbox} />}
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
    item, isTV, season, episode, onClose, modalRef,
    frame: { embedUrl, frameRef: iframeRef, title: `Watch ${item.title}`, onLoad: handleFrameLoad, sandbox: popups.sandbox },
    frameKey: `${provider}-${externalId?.kind}-${externalId?.value}-${frameSeason}-${frameEpisode}-${resumeNonce}-${popups.sandboxed ? 'sb' : 'open'}`,
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

import { useEffect, useRef, useState } from 'react';
import { MoonStars, SkipForward, X } from '@phosphor-icons/react';
import LoadingBar from '../LoadingBar';
import { formatClock } from '../../utils/playbackPositions';
import { RESUMABLE, SERVER_LABELS } from '../../utils/embedProviders';
import { readPlayback } from '../../utils/playbackMessages';
import { preloadIsPlaying } from '../../utils/preloadNext';

const label = (id) => SERVER_LABELS[id]?.label || id;

// The server's player, or, while there's no URL yet, a loading bar (finding a
// stream) or `emptyText`. Give it a `key` that changes per load (and when
// `sandbox` changes): a new key remounts the iframe. `sandbox` blocks the
// player's pop-ups (usePopupSandbox). `asleep` ({ reason, at, onResume }):
// the sleep timer stopped playback, so the player is gone until Resume.
export function EmbedFrame({ embedUrl, frameRef, title, onLoad, sandbox, className, emptyClassName, emptyText, loading, asleep }) {
  if (asleep) {
    return (
      <div className={`${emptyClassName} player-asleep`} role="status">
        <MoonStars size={30} weight="bold" aria-hidden="true" />
        <p>{asleep.reason === 'episode'
          ? 'The sleep timer stopped playback after the episode.'
          : `The sleep timer stopped playback${asleep.at > 0 ? ` at ${formatClock(asleep.at)}` : ''}.`}</p>
        <button type="button" className="st-btn st-btn--primary" onClick={asleep.onResume}>
          {asleep.advanced ? 'Play the next episode' : 'Resume'}
        </button>
      </div>
    );
  }
  return embedUrl ? (
    <iframe
      ref={frameRef}
      src={embedUrl}
      sandbox={sandbox}
      className={className}
      allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; web-share *"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
      title={title}
      onLoad={onLoad}
    />
  ) : (
    <div className={emptyClassName}>
      {loading ? <LoadingBar label="Finding a stream…" /> : <p>{emptyText}</p>}
    </div>
  );
}

export function SkipIntroButton({ onSkip, onHide }) {
  return (
    <div className="st-skip-intro-wrap">
      <button type="button" className="st-skip-intro" onClick={onSkip}>
        <SkipForward size={18} weight="fill" aria-hidden="true" /> Skip intro
      </button>
      <button type="button" className="st-skip-intro-hide" onClick={onHide} aria-label="Hide Skip intro">
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

// Hidden frame that warms the next episode's player (see useUpNext).
// The next episode, warming up hidden. It must never be heard (embed players
// are cross-origin, so the page can't mute them): a server whose autoplay
// can't be switched off only has its page prefetched; otherwise the frame
// loads with autoplay off and denied, and removes itself if it reports
// playback anyway (Safari ignores the autoplay permission).
export function PreloadFrame({ url, silent, sandbox }) {
  const frameRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setPlaying(false);
    if (!silent) return undefined;
    function onMessage(event) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      if (preloadIsPlaying(readPlayback(event.data))) setPlaying(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url, silent]);
  if (!silent) return <link rel="prefetch" href={url} as="document" />;
  if (playing) return null;
  return (
    <iframe ref={frameRef} className="st-preload-frame" src={url} title="Next episode (loading)" aria-hidden="true" tabIndex={-1}
      allow="autoplay 'none'" referrerPolicy="no-referrer-when-downgrade" sandbox={sandbox} />
  );
}

// How long a server-switch notice stays up. It's held while the pointer or
// focus is on it; the server can always be changed again from Servers.
export const NOTICE_SECONDS = 15;

// "Buffering on X… Switch to Y" while a server stalls, else the notice for
// an automatic server switch, with a way back. One quiet line under the video.
export function FailoverBar({ stall, notice, isTV, onSwitch, onTryAgain, onDismiss }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!notice || held) return undefined;
    const timer = setTimeout(onDismiss, NOTICE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [notice, held, onDismiss]);
  const hold = {
    onMouseEnter: () => setHeld(true),
    onMouseLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };

  if (stall && !notice) {
    return (
      <div className="st-failover st-failover--stall" role="status">
        <span className="st-stall-dot" aria-hidden="true" />
        <span>Buffering on {SERVER_LABELS[stall.provider]?.label || stall.provider}…</span>
        <button type="button" onClick={() => onSwitch(stall.next, { at: stall.at, reason: 'buffering' })}>
          Switch to {SERVER_LABELS[stall.next]?.label || stall.next}{RESUMABLE.has(stall.next) && stall.at ? ` at ${formatClock(stall.at)}` : ''}
        </button>
      </div>
    );
  }
  if (!notice) return null;
  return (
    <div className="st-failover" role="status" {...hold}>
      <span>
        {notice.reason === 'wrong'
          ? `${label(notice.from)} was playing a different video, so we switched to ${label(notice.to)}.`
          : notice.reason === 'buffering'
          ? `${label(notice.from)} kept buffering, so we switched to ${label(notice.to)}${notice.at ? ` at ${formatClock(notice.at)}` : ''}.`
          : `${label(notice.from)} couldn't play this ${isTV ? 'episode' : 'title'}, so we switched to ${label(notice.to)}.`}
      </span>
      <button type="button" onClick={() => onTryAgain(notice.from)}>Try {SERVER_LABELS[notice.from]?.label || 'it'} anyway</button>
      <button type="button" className="st-failover-dismiss" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

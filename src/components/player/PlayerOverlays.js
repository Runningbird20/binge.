import { useEffect, useRef, useState } from 'react';
import { SkipForward, X } from '@phosphor-icons/react';
import { formatClock } from '../../utils/playbackPositions';
import { RESUMABLE, SERVER_LABELS } from '../../utils/embedProviders';
import { readPlayback } from '../../utils/playbackMessages';
import { preloadIsPlaying } from '../../utils/preloadNext';

const label = (id) => SERVER_LABELS[id]?.label || id;

// The server's player, or a placeholder while there's no URL yet. Give it a
// `key` that changes per load: a new key remounts the iframe.
export function EmbedFrame({ embedUrl, frameRef, title, onLoad, className, emptyClassName, emptyText }) {
  return embedUrl ? (
    <iframe
      ref={frameRef}
      src={embedUrl}
      className={className}
      allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; web-share *"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
      title={title}
      onLoad={onLoad}
    />
  ) : (
    <div className={emptyClassName}>
      <p>{emptyText}</p>
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
export function PreloadFrame({ url, silent }) {
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
      allow="autoplay 'none'" referrerPolicy="no-referrer-when-downgrade" />
  );
}

// "Buffering on X… Switch to Y" while a server stalls, else the notice for
// an automatic server switch, with a way back.
export function FailoverBar({ stall, notice, isTV, onSwitch, onTryAgain, onDismiss }) {
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
    <div className="st-failover" role="status">
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

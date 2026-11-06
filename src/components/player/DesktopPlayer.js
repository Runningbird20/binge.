import { ArrowsIn, Check, Plus, X } from '@phosphor-icons/react';
import PlaybackOptions from '../PlaybackOptions';
import { EmbedFrame } from './PlayerOverlays';
import { EpisodeSelector } from './EpisodePickers';

// Desktop layout: a full-window black stage. Our bar (title, episode, Servers,
// close) sits above the video, never over it: the server's own
// controls live inside its iframe, along its top and bottom edges, so anything
// of ours on the video covers them. The video is as big as fits at 16:9, and
// notices get one quiet line under it. Only in our fullscreen (F) does the bar
// go over the video, shown while the pointer is on it.
export default function DesktopPlayer({
  item, isTV, season, episode, onClose, modalRef, frameWrapRef, frame, frameKey, overlays,
  failoverBar, lookupState, lookupError, metadataWarning, episodes, watchedNow, canTrackEpisodes,
  markingWatched, onMarkWatched, playbackOptionProps, fullscreen, controls, episodeSelector,
}) {
  const { isFullscreen, toggleFullscreen } = fullscreen;
  const bar = (
    <div className="player-bar">
      <div className="player-bar-title">
        <h2 className="player-bar-name">{item.title}</h2>
        {!isTV && item.year && <span className="player-bar-meta">{item.year}</span>}
        {isTV && <EpisodeSelector {...episodes} {...episodeSelector} season={season} episode={episode} />}
        {isTV && (
          <button
            className={`player-pill${watchedNow ? ' player-pill--on' : ''}`}
            onClick={onMarkWatched}
            disabled={!canTrackEpisodes || markingWatched}
            title={
              !canTrackEpisodes
                ? 'Watch tracking is unavailable for this item.'
                : watchedNow
                  ? 'Click to unmark as watched'
                  : 'Marks itself after 5 minutes of watching'
            }
            type="button"
          >
            {watchedNow
              ? <><Check size={16} weight="bold" aria-hidden="true" /> Watched</>
              : <><Plus size={16} weight="bold" aria-hidden="true" /> Mark as watched</>}
          </button>
        )}
      </div>
      <div className="player-bar-actions">
        <PlaybackOptions {...playbackOptionProps} />
        {isFullscreen && (
          <button className="player-close" onClick={toggleFullscreen} title="Exit fullscreen" aria-label="Exit fullscreen" type="button">
            <ArrowsIn size={18} weight="bold" />
          </button>
        )}
        <button className="player-close" onClick={onClose} title="Close" aria-label="Close player" type="button">
          <X size={18} weight="bold" />
        </button>
      </div>
    </div>
  );
  const problem = lookupState === 'error'
    ? (lookupError || `Couldn't find a stream ID for "${item.title}".`)
    : metadataWarning;

  return (
    <div className="player-stage" ref={modalRef} data-embed-player>
      {!isFullscreen && bar}
      <div className="player-screen">
        <div
          className="player-frame-wrap"
          ref={frameWrapRef}
          onMouseEnter={isFullscreen ? controls.revealControls : undefined}
          onMouseLeave={isFullscreen ? controls.hideControls : undefined}
        >
          <EmbedFrame
            key={frameKey}
            {...frame}
            className="player-frame"
            emptyClassName="player-no-url"
            loading={lookupState === 'loading'}
            emptyText="Stream unavailable right now."
          />
          {overlays}
          {isFullscreen && (
            <div
              className={`player-controls-overlay${controls.controlsVisible ? ' visible' : ''}`}
              onMouseEnter={controls.holdControls}
              onMouseLeave={controls.revealControls}
            >
              {bar}
            </div>
          )}
        </div>
      </div>
      <div className="player-notices">
        {problem && <p className="player-notice player-notice--warn">{problem}</p>}
        {failoverBar}
      </div>
    </div>
  );
}

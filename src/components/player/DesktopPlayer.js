import { ArrowsIn, CaretDown, Check, Plus, X } from '@phosphor-icons/react';
import PlaybackOptions from '../PlaybackOptions';
import { EmbedFrame } from './PlayerOverlays';
import { EpisodeSelector } from './EpisodePickers';

// Desktop layout: a modal with the title bar, lookup notices, the video and
// its auto-hiding controls (server/audio/subtitles and the episode picker).
export default function DesktopPlayer({
  item, isTV, season, episode, onClose, onMinimize, modalRef, frameWrapRef, frame, frameKey, overlays,
  failoverBar, lookupState, lookupError, metadataWarning, episodes, watchedNow, canTrackEpisodes,
  markingWatched, onMarkWatched, playbackOptionProps, fullscreen, controls, episodeSelector,
}) {
  return (
    <div className="player-overlay" onClick={onClose} data-embed-player>
      <div className="player-modal" ref={modalRef} onClick={(event) => event.stopPropagation()}>
        <div className="player-header">
          <div className="player-title">
            <div>
              <strong>{item.title}</strong>
              {isTV
                ? <span className="player-year">S{season} · E{episode}</span>
                : item.year && <span className="player-year">{item.year}</span>}
              {isTV && (
                <button
                  className={`player-mark-btn ${watchedNow ? 'player-mark-btn--watched' : ''}`}
                  onClick={onMarkWatched}
                  disabled={!canTrackEpisodes || markingWatched}
                  title={
                    !canTrackEpisodes
                      ? 'Watch tracking is unavailable for this item.'
                      : watchedNow
                        ? 'Click to unmark as watched'
                        : 'Click to manually mark as watched (auto-marks after 5 min)'
                  }
                  type="button"
                >
                  {watchedNow ? <><Check size={14} weight="bold" /> Watched</> : <><Plus size={14} weight="bold" /> Mark as watched</>}
                </button>
              )}
            </div>
          </div>
          <div className="player-header-btns">
            <button className="player-close" onClick={onMinimize} title="Minimize" aria-label="Minimize player" type="button">
              <CaretDown size={18} weight="bold" />
            </button>
            <button className="player-close" onClick={onClose} title="Close" aria-label="Close player" type="button">
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {lookupState === 'loading' && (
          <div className="player-lookup-bar">
            <span className="player-lookup-dot" /> Looking up a stream ID...
          </div>
        )}
        {lookupState === 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            {lookupError || `Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`}
          </div>
        )}
        {metadataWarning && lookupState !== 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            {metadataWarning}
          </div>
        )}
        <div
          className="player-frame-wrap"
          ref={frameWrapRef}
          onMouseEnter={controls.revealControls}
          onMouseLeave={controls.hideControls}
        >
          <EmbedFrame
            key={frameKey}
            {...frame}
            className="player-frame"
            emptyClassName="player-no-url"
            emptyText={lookupState === 'loading' ? 'Preparing stream...' : 'Stream unavailable right now.'}
          />

          {overlays}
          <div
            className={`player-controls-overlay ${controls.controlsVisible ? 'visible' : ''}`}
            onMouseEnter={controls.holdControls}
            onMouseLeave={controls.revealControls}
          >
            {fullscreen.isFullscreen && (
              <div className="player-overlay-fs-btns">
                <button
                  className="player-close"
                  onClick={fullscreen.toggleFullscreen}
                  title="Exit fullscreen"
                  aria-label="Exit fullscreen"
                  type="button"
                >
                  <ArrowsIn size={18} weight="bold" />
                </button>
                <button className="player-close" onClick={onClose} title="Close" aria-label="Close player" type="button">
                  <X size={18} weight="bold" />
                </button>
              </div>
            )}

            <div className="player-controls-top-row">
              <PlaybackOptions {...playbackOptionProps} />

              {isTV && (
                <EpisodeSelector
                  {...episodes}
                  {...episodeSelector}
                  season={season}
                  episode={episode}
                />
              )}
            </div>
          </div>
        </div>
        {failoverBar}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ArrowsOut, CaretDown, DeviceRotate, LockSimple, LockSimpleOpen, X } from '@phosphor-icons/react';
import { MobilePlaybackPickers } from '../PlaybackOptions';
import { SERVER_LABELS } from '../../utils/embedProviders';
import { EmbedFrame } from './PlayerOverlays';
import { MobileEpisodeRows } from './EpisodePickers';

// Phone layout: header, the video (which fills the screen in landscape, with
// corner buttons and a slide-up episode/server picker), then the season and
// episode chips and the server/audio/subtitle pickers below it.
export default function MobilePlayer({
  item, isTV, isLandscape, season, episode, onClose, onMinimize, modalRef, frame, frameKey, overlays,
  failoverBar, lookupState, lookupError, episodes, watchedNow, canTrackEpisodes, markingWatched,
  onMarkWatched, servers, provider, onSelectServer, playbackOptionProps, fullscreen,
}) {
  const [lsControlsOpen, setLsControlsOpen] = useState(false);
  useEffect(() => {
    if (!isLandscape) setLsControlsOpen(false);
  }, [isLandscape]);

  // Keep the current episode's chip in view.
  const epChipsRef = useRef(null);
  useEffect(() => {
    if (!epChipsRef.current) return;
    const active = epChipsRef.current.querySelector('.mp-chip.active');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [episode, season]);

  const { episodeCount, watchedInSeason } = episodes;
  const { rotateHint, canLockRotation, rotationLocked, toggleRotationLock, toggleFullscreen } = fullscreen;

  return (
    <div className={`mp-shell${isLandscape ? ' mp-shell--ls' : ''}`} data-embed-player>
      {/* Header — hidden in landscape via CSS */}
      <div className="mp-header">
        <div className="mp-title">
          <span className="mp-title-text">{item.title}</span>
          {isTV && <span className="mp-title-ep">S{season} E{episode}</span>}
        </div>
        <div className="mp-header-btns">
          <button className="mp-btn" onClick={onMinimize} type="button" title="Minimize" aria-label="Minimize player"><CaretDown size={16} weight="bold" /></button>
          <button className="mp-btn" onClick={toggleFullscreen} type="button" title="Full screen, landscape" aria-label="Full screen in landscape">
            <ArrowsOut size={16} weight="bold" />
          </button>
          <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close"><X size={16} weight="bold" /></button>
        </div>
      </div>

      {/* Video — expands to fill shell in landscape */}
      <div className="mp-video-wrap" ref={modalRef}>
        <EmbedFrame
          key={frameKey}
          {...frame}
          className="mp-iframe"
          emptyClassName="mp-no-url"
          emptyText={lookupState === 'loading' ? 'Preparing stream…' : 'Stream unavailable.'}
        />
        {overlays}
        {rotateHint && (
          <div className="mp-rotate-hint" role="status">
            <DeviceRotate size={22} weight="bold" aria-hidden="true" /> Turn your phone sideways for a bigger picture
          </div>
        )}
        {/* Landscape overlay — top-right corner buttons, hidden in portrait via CSS */}
        <div className="mp-ls-overlay">
          {canLockRotation && (
            <button
              className={`mp-btn${rotationLocked ? ' active' : ''}`}
              onClick={toggleRotationLock}
              type="button"
              title={rotationLocked ? 'Unlock rotation' : 'Lock rotation'}
              aria-label={rotationLocked ? 'Unlock rotation' : 'Lock rotation'}
              aria-pressed={rotationLocked}
            >
              {rotationLocked ? <LockSimple size={16} weight="bold" /> : <LockSimpleOpen size={16} weight="bold" />}
            </button>
          )}
          {isTV && (
            <button
              className="mp-btn"
              onClick={() => setLsControlsOpen(v => !v)}
              type="button"
              title="Episodes"
            >
              {lsControlsOpen ? '✕' : '⋮'}
            </button>
          )}
          {isTV && <span className="mp-ls-ep-badge">S{season} E{episode}</span>}
          <button className="mp-btn mp-btn-close" onClick={onClose} type="button" title="Close"><X size={16} weight="bold" /></button>
        </div>

        {/* Landscape episode/source picker — slides up from bottom of video area */}
        {isLandscape && lsControlsOpen && (
          <div className="mp-ls-controls">
            {isTV && (
              <MobileEpisodeRows
                {...episodes}
                season={season}
                episode={episode}
                episodeLabel={`Episode${episodeCount !== undefined ? ` · ${episodeCount} total` : ''}`}
                onPickEpisode={(ep) => { episodes.onPickEpisode(ep); setLsControlsOpen(false); }}
              />
            )}

            <div className="mp-row">
              <span className="mp-row-label">Server</span>
              <div className="mp-chips">
                {servers.map((server) => (
                  <button
                    key={server.id}
                    className={`mp-chip ${provider === server.id ? 'active' : ''}`}
                    onClick={() => onSelectServer(server.id)}
                    type="button"
                  >{SERVER_LABELS[server.id]?.label || server.id}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {failoverBar}

      {/* Controls */}
      <div className="mp-controls">
        {lookupState === 'loading' && (
          <div className="mp-status">Looking up stream ID…</div>
        )}
        {lookupState === 'error' && (
          <div className="mp-status mp-status--err">{lookupError || `Could not find stream for "${item.title}".`}</div>
        )}
        {isTV && (
          <>
            <MobileEpisodeRows
              {...episodes}
              season={season}
              episode={episode}
              chipsRef={epChipsRef}
              episodeLabel={`Episode${episodeCount !== undefined ? ` · ${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''}` : ''}`}
            />

            {/* Mark watched */}
            <div className="mp-mark-row">
              <button
                className={`mp-watch-btn ${watchedNow ? 'marked' : ''}`}
                onClick={onMarkWatched}
                disabled={!canTrackEpisodes || markingWatched}
                type="button"
              >
                {watchedNow ? '✓ Watched' : '+ Mark as watched'}
              </button>
            </div>
          </>
        )}

        <div className="mp-divider" />

        {/* Server, audio and subtitles — bottom sheets at thumb height. */}
        <MobilePlaybackPickers {...playbackOptionProps} />
      </div>
    </div>
  );
}

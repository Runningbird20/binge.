import { useEffect, useRef, useState } from 'react';
import { ArrowsOut, Check, DeviceRotate, ListNumbers, LockSimple, LockSimpleOpen, Plus, ShieldCheck, X } from '@phosphor-icons/react';
import { MobilePlaybackPickers } from '../PlaybackOptions';
import { SERVER_LABELS } from '../../utils/embedProviders';
import { popupsBlocked } from '../../utils/popupSandbox';
import { EmbedFrame } from './PlayerOverlays';
import { MobileEpisodeRows } from './EpisodePickers';

// Phone layout, on the same black stage as the desktop one: a slim header,
// the video at 16:9 (filling the screen in landscape, with corner buttons and
// a slide-up episode/server picker), one quiet line for notices, then the
// season and episode chips and the server/audio/subtitle pickers below it.
export default function MobilePlayer({
  item, isTV, isLandscape, season, episode, onClose, modalRef, frame, frameKey, overlays,
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
          <button className="mp-btn" onClick={toggleFullscreen} type="button" title="Full screen, landscape" aria-label="Full screen in landscape">
            <ArrowsOut size={16} weight="bold" />
          </button>
          <button className="mp-btn" onClick={onClose} type="button" title="Close" aria-label="Close player"><X size={16} weight="bold" /></button>
        </div>
      </div>

      {/* Video — expands to fill shell in landscape */}
      <div className="mp-video-wrap" ref={modalRef}>
        <EmbedFrame
          key={frameKey}
          {...frame}
          className="mp-iframe"
          emptyClassName="mp-no-url"
          loading={lookupState === 'loading'}
          emptyText="Stream unavailable right now."
        />
        {overlays}
        {rotateHint && (
          <div className="mp-rotate-hint" role="status">
            <DeviceRotate size={22} weight="bold" aria-hidden="true" /> Turn your phone sideways for a bigger picture
          </div>
        )}
        {/* Landscape: a column of buttons beside the video (hidden in portrait via CSS) */}
        <div className="mp-ls-overlay">
          <button className="mp-btn" onClick={onClose} type="button" title="Close" aria-label="Close player"><X size={16} weight="bold" /></button>
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
              className={`mp-btn${lsControlsOpen ? ' active' : ''}`}
              onClick={() => setLsControlsOpen(v => !v)}
              type="button"
              title="Episodes and servers"
              aria-label="Episodes and servers"
              aria-expanded={lsControlsOpen}
            >
              <ListNumbers size={16} weight="bold" aria-hidden="true" />
            </button>
          )}
          {isTV && <span className="mp-ls-ep-badge">S{season} E{episode}</span>}
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
                {servers.map((server) => {
                  const label = SERVER_LABELS[server.id]?.label || server.id;
                  const safe = provider === server.id ? playbackOptionProps.popupsBlockedNow : popupsBlocked(server.id);
                  return (
                    <button
                      key={server.id}
                      className={`mp-chip ${provider === server.id ? 'active' : ''}`}
                      onClick={() => onSelectServer(server.id)}
                      type="button"
                      aria-label={safe ? `${label}, no pop-ups` : undefined}
                    >{label}{safe && <ShieldCheck size={12} weight="fill" className="mp-chip-safe" aria-hidden="true" />}</button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mp-notices">
        {lookupState === 'error' && (
          <p className="player-notice player-notice--warn">{lookupError || `Couldn't find a stream ID for "${item.title}".`}</p>
        )}
        {failoverBar}
      </div>

      {/* Controls */}
      <div className="mp-controls">
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
                {watchedNow
                  ? <><Check size={16} weight="bold" aria-hidden="true" /> Watched</>
                  : <><Plus size={16} weight="bold" aria-hidden="true" /> Mark as watched</>}
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

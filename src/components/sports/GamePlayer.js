import { useContext, useRef } from 'react';
import { ArrowLeft, ArrowsOut, SkipForward, SquaresFour } from '@phosphor-icons/react';
import TitleRow from '../TitleRow';
import LiveScorePanel from '../LiveScorePanel';
import { providerLabel } from '../../utils/sportsProviders';
import { HideScores } from './HideScores';
import { CatIcon } from './CatIcon';
import { fmtTime, fmtDay, timeUntil, getStatus } from './gameInfo';
import { GameCard } from './GameCard';
import { useServerRotation } from './useServerRotation';

export function GamePlayer({ stream, nowMs, onBack, otherStreams, onSelect, onAddToMultiview }) {
  const frameRef = useRef(null);
  const hideScores = useContext(HideScores);
  const status = getStatus(stream, nowMs);
  const {
    servers, serverIndex, retryNonce, embedUrl, resolving, failed, blocked,
    allFailed, allBlocked, advance, chooseServer, nextServer, retryAll, onFrameLoad,
  } = useServerRotation(stream, status);


  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else frameRef.current?.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className="st-sp-player">
      <div className="st-sp-player-head">
        <button type="button" className="st-btn st-btn--ghost" onClick={onBack}>
          <ArrowLeft size={18} weight="bold" /> All games
        </button>
        <div className="st-sp-player-title">
          {status === 'live' && <span className="st-game-status st-game-status--live"><span className="st-live-dot" aria-hidden="true" />{stream.alwaysLive ? '24/7' : 'LIVE'}</span>}
          <h1>{stream.name}</h1>
          <span className="st-sp-player-league"><CatIcon category={stream.category} /> {stream.league}</span>
        </div>
      </div>

      <div className="st-sp-stage">
      <div className="st-sp-frame" ref={frameRef}>
        {embedUrl ? (
          <iframe
            key={`${stream.id}-${serverIndex}-${retryNonce}`}
            src={embedUrl}
            title={stream.name}
            allowFullScreen
            allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *"
            referrerPolicy="no-referrer-when-downgrade"
            scrolling="no"
            onLoad={onFrameLoad}
            onError={advance}
          />
        ) : (
          <div className="st-sp-frame-empty">
            <span className="st-game-art-icon"><CatIcon category={stream.category} size={44} /></span>
            {status === 'upcoming' ? (
              <>
                <p>Starts {fmtDay(stream.startsAt)} at {fmtTime(stream.startsAt)}{timeUntil(stream.startsAt) ? ` (${timeUntil(stream.startsAt)})` : ''}</p>
                <p className="st-muted">The stream appears here when the game goes live.</p>
              </>
            ) : resolving ? (
              <p>{servers[serverIndex] ? `Connecting to ${providerLabel(servers[serverIndex])}…` : 'Finding the best stream…'}</p>
            ) : allFailed ? (
              <>
                <p>{allBlocked
                  ? 'Every server for this game is blocked on the network you’re on (common on school or work Wi-Fi). It should play on a different network, like mobile data.'
                  : `None of the ${servers.length} servers responded.`}</p>
                <button type="button" className="st-btn st-btn--primary" onClick={retryAll}>Try again</button>
              </>
            ) : (
              <p>Loading stream…</p>
            )}
          </div>
        )}
      </div>

      <LiveScorePanel stream={stream} hideScores={hideScores} />
      </div>

      <div className="st-sp-controls">
        <button type="button" className="st-btn st-btn--ghost" onClick={nextServer} disabled={status === 'upcoming'}>
          <SkipForward size={18} weight="bold" /> {servers.length > 1 ? 'Not working? Next server' : 'Reload stream'}
        </button>
        <button type="button" className="st-btn st-btn--ghost" onClick={toggleFullscreen} disabled={!embedUrl}>
          <ArrowsOut size={18} weight="bold" /> Fullscreen
        </button>
        {onAddToMultiview && status !== 'upcoming' && (
          <button type="button" className="st-btn st-btn--ghost" onClick={() => onAddToMultiview(stream)}>
            <SquaresFour size={18} weight="bold" /> Watch with other games
          </button>
        )}
      </div>

      {servers.length > 0 && status !== 'upcoming' && (
        <div className="st-servers" role="group" aria-label="Servers">
          {servers.map((provider, index) => {
            const down = blocked.has(index) ? 'blocked on your network' : failed.has(index) ? 'not responding' : '';
            return (
              <button
                key={`${provider.id}-${provider.source || ''}-${index}`}
                type="button"
                className={`st-server${index === serverIndex ? ' active' : ''}${down ? ' down' : ''}`}
                aria-pressed={index === serverIndex}
                onClick={() => chooseServer(index)}
                title={down ? `${providerLabel(provider)}: ${down}` : providerLabel(provider)}
              >
                <span className="st-server-no">{index + 1}</span>
                {providerLabel(provider)}
                {down && <span className="sr-only">, {down}</span>}
              </button>
            );
          })}
        </div>
      )}

      {otherStreams.length > 0 && (
        <TitleRow
          className="st-row--wide"
          title="More live & upcoming"
          items={otherStreams}
          renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={onSelect} />}
        />
      )}
    </div>
  );
}

// ── Multiview ──────────────────────────────────────────────────────────

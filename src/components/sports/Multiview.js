import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowsOut, CaretUp, CornersOut, GridFour, X } from '@phosphor-icons/react';
import TitleRow from '../TitleRow';
import { providerLabel } from '../../utils/sportsProviders';
import { MULTIVIEW_MAX, getStatus } from './gameInfo';
import { CatIcon } from './CatIcon';
import { GameCard } from './GameCard';
import { useServerRotation } from './useServerRotation';

function MultiviewTile({ stream, nowMs, focused, order, autoplay, onFocus, onRemove }) {
  const status = getStatus(stream, nowMs);
  const {
    servers, serverIndex, retryNonce, embedUrl, resolving, blocked, failed,
    allFailed, allBlocked, advance, chooseServer, retryAll, onFrameLoad,
  } = useServerRotation(stream, status);
  // Only the first focused tile may autoplay with sound. The permission is
  // fixed when the iframe loads, so later focus changes just move the tile;
  // sound is switched inside each player (cross-origin — we can't mute it).
  const [allow] = useState(autoplay
    ? 'autoplay *; fullscreen *; picture-in-picture *; encrypted-media *'
    : 'fullscreen *; picture-in-picture *; encrypted-media *');
  const tileRef = useRef(null);
  // This game's servers, opened from the tile's Server button.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !pickerRef.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [pickerOpen]);

  return (
    <div className={`st-mv-tile${focused ? ' focused' : ''}`} style={{ order }} ref={tileRef}>
      <div className="st-mv-frame">
        {embedUrl ? (
          <iframe
            key={`${stream.id}-${serverIndex}-${retryNonce}`}
            src={embedUrl}
            title={stream.name}
            allowFullScreen
            allow={allow}
            referrerPolicy="no-referrer-when-downgrade"
            scrolling="no"
            onLoad={onFrameLoad}
            onError={advance}
          />
        ) : (
          <div className="st-sp-frame-empty">
            <span className="st-game-art-icon"><CatIcon category={stream.category} size={44} /></span>
            {resolving ? <p>Connecting…</p> : allFailed ? (
              <>
                <p>{allBlocked ? 'Blocked on this network.' : 'No server responded.'}</p>
                <button type="button" className="st-btn st-btn--ghost" onClick={retryAll}>Try again</button>
              </>
            ) : <p>Loading…</p>}
          </div>
        )}
      </div>
      <div className="st-mv-bar">
        <p className="st-mv-name" title={stream.name}>
          {status === 'live' && <span className="st-live-dot" aria-hidden="true" />}
          {stream.name}
        </p>
        <div className="st-mv-server" ref={pickerRef}>
          <button
            type="button"
            className="st-mv-server-btn"
            aria-expanded={pickerOpen}
            aria-label={`Server for ${stream.name}: ${servers[serverIndex] ? providerLabel(servers[serverIndex]) : 'none yet'}. Change server`}
            onClick={() => setPickerOpen((open) => !open)}
            disabled={!servers.length}
          >
            <span className="st-server-no">{servers.length ? serverIndex + 1 : '–'}</span>
            Server
            <CaretUp size={12} weight="bold" aria-hidden="true" />
          </button>
          {pickerOpen && (
            <div className="st-mv-server-list" role="group" aria-label={`Servers for ${stream.name}`}>
              {servers.map((provider, index) => {
                const down = blocked.has(index) ? 'blocked on your network' : failed.has(index) ? 'not responding' : '';
                return (
                  <button
                    key={`${provider.id}-${provider.source || ''}-${index}`}
                    type="button"
                    className={`st-server${index === serverIndex ? ' active' : ''}${down ? ' down' : ''}`}
                    aria-pressed={index === serverIndex}
                    onClick={() => { chooseServer(index); setPickerOpen(false); }}
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
        </div>
        {!focused && (
          <button type="button" className="st-mv-btn" onClick={onFocus} aria-label={`Make ${stream.name} the main game`} title="Make this the main game">
            <CornersOut size={16} weight="bold" />
          </button>
        )}
        <button type="button" className="st-mv-btn" onClick={() => tileRef.current?.requestFullscreen?.().catch(() => {})} aria-label={`Fullscreen ${stream.name}`} title="Fullscreen">
          <ArrowsOut size={16} weight="bold" />
        </button>
        <button type="button" className="st-mv-btn" onClick={onRemove} aria-label={`Remove ${stream.name} from Multiview`} title="Remove">
          <X size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

export function Multiview({ games, nowMs, onBack, onRemove, onAdd, addable }) {
  const [focusId, setFocusId] = useState(games[0]?.id);
  const [layout, setLayout] = useState('focus');
  const [firstId] = useState(games[0]?.id);
  const focused = games.some((game) => game.id === focusId) ? focusId : games[0]?.id;

  return (
    <div className="st-mv">
      <div className="st-sp-player-head">
        <button type="button" className="st-btn st-btn--ghost" onClick={onBack}>
          <ArrowLeft size={18} weight="bold" /> All games
        </button>
        <div className="st-sp-player-title">
          <h1>Multiview</h1>
          <span className="st-sp-player-league">{games.length} games</span>
        </div>
        <div className="st-mv-layouts" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked={layout === 'focus'} className={layout === 'focus' ? 'active' : ''} onClick={() => setLayout('focus')}>
            <CornersOut size={16} weight="bold" /> Focus
          </button>
          <button type="button" role="radio" aria-checked={layout === 'grid'} className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}>
            <GridFour size={16} weight="bold" /> Grid
          </button>
        </div>
      </div>

      <p className="st-mv-hint">
        Click <CornersOut size={13} weight="bold" aria-label="main game" /> to make a game the big one. Sound plays from the main game first; to switch,
        mute and unmute inside each player — browsers don’t let a site control another site’s player audio.
      </p>

      <div className={`st-mv-grid st-mv-grid--${layout} st-mv-grid--n${games.length}`}>
        {games.map((game, index) => (
          <MultiviewTile
            key={game.id}
            stream={game}
            nowMs={nowMs}
            focused={layout === 'focus' && game.id === focused}
            order={layout === 'focus' && game.id === focused ? -1 : index}
            autoplay={game.id === firstId}
            onFocus={() => { setFocusId(game.id); setLayout('focus'); }}
            onRemove={() => onRemove(game.id)}
          />
        ))}
      </div>

      {games.length < MULTIVIEW_MAX && addable.length > 0 && (
        <TitleRow
          className="st-row--wide"
          title="Add another game"
          items={addable}
          renderItem={(item) => (
            <GameCard stream={item} nowMs={nowMs} onSelect={() => onAdd(item.id)} />
          )}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

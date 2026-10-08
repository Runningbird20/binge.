// Persists across navigation (mounted once, inside the router, by
// MiniPlayerProvider) so a video keeps playing while the user browses.
//
// Desktop: a real picture-in-picture window — the video itself, 16:9 in a
// corner (drag the bar to move it to another corner), with Expand back to
// the full player and Close. Phones: a compact dock above the bottom nav
// that opens full screen.
//
// Either way it keeps saving the position from the server's playback
// messages, so Expand (or Continue Watching later) resumes at the right
// second instead of where the video was minimized.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsOutSimple, CaretDown, X } from '@phosphor-icons/react';
import useDeviceType from '../hooks/useDeviceType';
import { readPlayback } from '../utils/playbackMessages';
import { savePosition } from '../utils/playbackPositions';

const CORNER_KEY = 'binge:mini-corner';
const CORNERS = ['br', 'bl', 'tr', 'tl'];

function storedCorner() {
  try { return CORNERS.includes(window.localStorage.getItem(CORNER_KEY)) ? window.localStorage.getItem(CORNER_KEY) : 'br'; } catch { return 'br'; }
}

function useSavePositions(frameRef, nowPlaying) {
  useEffect(() => {
    const key = nowPlaying?.positionKey;
    if (!key) return undefined;
    let lastSaved = 0;
    let duration = 0;
    function onMessage(event) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const reading = readPlayback(event.data);
      if (!reading) return;
      if (reading.duration > 0) duration = reading.duration;
      if (reading.time > 0 && Date.now() - lastSaved > 5000) {
        lastSaved = Date.now();
        savePosition(key, reading.time, duration);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef, nowPlaying]);
}

function sendVidriftResume(frame, seconds) {
  if (!seconds || !frame) return;
  setTimeout(() => frame.contentWindow?.postMessage({ type: 'vidrift:resume', currentTime: seconds }, 'https://embed.vidrift.net'), 1500);
}

function DesktopMini({ nowPlaying, onClose }) {
  const navigate = useNavigate();
  const frameRef = useRef(null);
  const boxRef = useRef(null);
  const [corner, setCorner] = useState(storedCorner);
  const [drag, setDrag] = useState(null); // { x, y } offset while dragging
  useSavePositions(frameRef, nowPlaying);

  function expand() {
    if (nowPlaying.href) navigate(nowPlaying.href);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = boxRef.current.getBoundingClientRect();
    const start = { px: event.clientX, py: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    function move(e) { setDrag({ left: start.left + e.clientX - start.px, top: start.top + e.clientY - start.py }); }
    function up(e) {
      e.currentTarget.removeEventListener('pointermove', move);
      e.currentTarget.removeEventListener('pointerup', up);
      const midX = start.left + e.clientX - start.px + rect.width / 2;
      const midY = start.top + e.clientY - start.py + rect.height / 2;
      const next = `${midY < window.innerHeight / 2 ? 't' : 'b'}${midX < window.innerWidth / 2 ? 'l' : 'r'}`;
      setCorner(next);
      setDrag(null);
      try { window.localStorage.setItem(CORNER_KEY, next); } catch { /* private mode */ }
    }
    event.currentTarget.addEventListener('pointermove', move);
    event.currentTarget.addEventListener('pointerup', up);
  }

  return (
    <div
      ref={boxRef}
      className={`mini-pip mini-pip--${corner}${drag ? ' dragging' : ''}`}
      style={drag ? { left: drag.left, top: drag.top, right: 'auto', bottom: 'auto' } : undefined}
      role="region"
      aria-label={`Now playing: ${nowPlaying.title}`}
    >
      <div className="mini-pip-bar" onPointerDown={onPointerDown} title="Drag to move">
        <span className="mini-pip-title">
          <strong>{nowPlaying.title}</strong>
          {nowPlaying.subtitle && <span>{nowPlaying.subtitle}</span>}
        </span>
        <button type="button" className="mini-pip-btn" onClick={expand} aria-label="Expand to full player" title="Expand">
          <ArrowsOutSimple size={16} weight="bold" />
        </button>
        <button type="button" className="mini-pip-btn" onClick={onClose} aria-label="Close mini player" title="Close">
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="mini-pip-frame">
        {nowPlaying.embedUrl && (
          <iframe
            ref={frameRef}
            src={nowPlaying.embedUrl}
            allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            title={nowPlaying.title}
            onLoad={() => sendVidriftResume(frameRef.current, nowPlaying.vidriftResume)}
          />
        )}
      </div>
    </div>
  );
}

function MobileMini({ nowPlaying, minimized, onExpand, onMinimize, onClose }) {
  const frameRef = useRef(null);
  const { embedUrl, title, subtitle, poster } = nowPlaying;
  useSavePositions(frameRef, nowPlaying);

  if (minimized) {
    return (
      <button type="button" className="mini-player mini-player--dock" onClick={onExpand}>
        <span className="mini-player-frame">
          {embedUrl ? (
            <iframe
              ref={frameRef}
              src={embedUrl}
              className="mini-player-iframe"
              allow="autoplay *; encrypted-media *"
              referrerPolicy="no-referrer-when-downgrade"
              title={title}
              tabIndex={-1}
              onLoad={() => sendVidriftResume(frameRef.current, nowPlaying.vidriftResume)}
            />
          ) : poster ? (
            <img src={poster} alt="" className="mini-player-poster" referrerPolicy="no-referrer" />
          ) : null}
        </span>
        <span className="mini-player-info">
          <span className="mini-player-title">{title}</span>
          {subtitle && <span className="mini-player-subtitle">{subtitle}</span>}
        </span>
        <span
          className="mini-player-close"
          role="button"
          tabIndex={0}
          aria-label="Close mini player"
          onClick={(event) => { event.stopPropagation(); onClose(); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); onClose(); }
          }}
        >
          <X size={14} weight="bold" />
        </span>
      </button>
    );
  }

  return (
    <div className="mini-player mini-player--full">
      <div className="mini-player-full-header">
        <button type="button" className="mini-player-full-btn" onClick={onMinimize} aria-label="Minimize">
          <CaretDown size={18} weight="bold" />
        </button>
        <span className="mini-player-full-title">{title}</span>
        <button type="button" className="mini-player-full-btn" onClick={onClose} aria-label="Close">
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="mini-player-full-frame">
        {embedUrl && (
          <iframe
            ref={frameRef}
            src={embedUrl}
            className="mini-player-iframe"
            allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            title={title}
          />
        )}
      </div>
    </div>
  );
}

export default function MiniPlayerWidget(props) {
  const { isMobile } = useDeviceType();
  return isMobile ? <MobileMini {...props} /> : <DesktopMini nowPlaying={props.nowPlaying} onClose={props.onClose} />;
}

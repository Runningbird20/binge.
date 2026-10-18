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
//
// Where the browser has Document Picture-in-Picture (Chrome/Edge), Pop out
// moves the video into an always-on-top window that stays over other tabs
// and apps. Moving an iframe between documents reloads it, so it restarts at
// the last second the server reported (urlAt / vidrift:resume). Closing that
// window brings the video back to the corner the same way.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowSquareIn, ArrowsOutSimple, CaretDown, PictureInPicture, X } from '@phosphor-icons/react';
import useDeviceType from '../hooks/useDeviceType';
import { readPlayback } from '../utils/playbackMessages';
import { savePosition } from '../utils/playbackPositions';

const CORNER_KEY = 'binge:mini-corner';
const CORNERS = ['br', 'bl', 'tr', 'tl'];

function storedCorner() {
  try { return CORNERS.includes(window.localStorage.getItem(CORNER_KEY)) ? window.localStorage.getItem(CORNER_KEY) : 'br'; } catch { return 'br'; }
}

// `host` is the window the iframe lives in (the page, or the floating
// Picture-in-Picture window): the server posts its messages to that one.
function useSavePositions(frameRef, nowPlaying, host = window, timeRef = null) {
  useEffect(() => {
    const key = nowPlaying?.positionKey;
    if (!key && !timeRef) return undefined;
    let lastSaved = 0;
    let duration = 0;
    function onMessage(event) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const reading = readPlayback(event.data);
      if (!reading) return;
      if (reading.duration > 0) duration = reading.duration;
      if (reading.time > 0 && timeRef) timeRef.current = reading.time;
      if (key && reading.time > 0 && Date.now() - lastSaved > 5000) {
        lastSaved = Date.now();
        savePosition(key, reading.time, duration);
      }
    }
    host.addEventListener('message', onMessage);
    return () => host.removeEventListener('message', onMessage);
  }, [frameRef, nowPlaying, host, timeRef]);
}

const canPopOut = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

const PIP_STYLE = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}'
  + 'iframe{position:fixed;inset:0;width:100%;height:100%;border:0}';

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
  const [pipWindow, setPipWindow] = useState(null);
  // Reloading the iframe (popping out or back in) restarts it here.
  const [reload, setReload] = useState(null); // { nowPlaying, src, resumeAt }
  const timeRef = useRef(0);
  const nowPlayingRef = useRef(nowPlaying);
  nowPlayingRef.current = nowPlaying;
  useSavePositions(frameRef, nowPlaying, pipWindow || window, timeRef);

  useEffect(() => { timeRef.current = 0; }, [nowPlaying]);
  // Closing the mini player (or opening the full one) closes the window too.
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  const current = reload?.nowPlaying === nowPlaying ? reload : null;
  const src = current ? current.src : nowPlaying.embedUrl;
  const resumeAt = current ? current.resumeAt : nowPlaying.vidriftResume;

  function restartAtCurrentSecond() {
    const playing = nowPlayingRef.current;
    const at = timeRef.current;
    setReload({
      nowPlaying: playing,
      src: at > 0 && playing.urlAt ? playing.urlAt(at) : playing.embedUrl,
      resumeAt: playing.resumeByMessage ? (at > 0 ? Math.floor(at) : playing.vidriftResume) : null,
    });
  }

  async function popOut() {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 640, height: 360 });
      const style = win.document.createElement('style');
      style.textContent = PIP_STYLE;
      win.document.head.append(style);
      win.document.title = nowPlaying.title;
      win.addEventListener('pagehide', () => {
        restartAtCurrentSecond();
        setPipWindow(null);
      });
      restartAtCurrentSecond();
      setPipWindow(win);
    } catch {
      // Refused or unsupported: the corner player just carries on.
    }
  }

  function expand() {
    pipWindow?.close();
    if (nowPlaying.href) navigate(nowPlaying.href);
  }

  const frame = src ? (
    <iframe
      key={pipWindow ? 'pip' : 'corner'}
      ref={frameRef}
      src={src}
      allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
      title={nowPlaying.title}
      onLoad={() => sendVidriftResume(frameRef.current, resumeAt)}
    />
  ) : null;

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
      className={`mini-pip mini-pip--${corner}${drag ? ' dragging' : ''}${pipWindow ? ' mini-pip--popped' : ''}`}
      style={drag ? { left: drag.left, top: drag.top, right: 'auto', bottom: 'auto' } : undefined}
      role="region"
      aria-label={`Now playing: ${nowPlaying.title}`}
    >
      <div className="mini-pip-bar" onPointerDown={onPointerDown} title="Drag to move">
        <span className="mini-pip-title">
          <strong>{nowPlaying.title}</strong>
          {nowPlaying.subtitle && <span>{nowPlaying.subtitle}</span>}
        </span>
        {pipWindow ? (
          <button type="button" className="mini-pip-btn" onClick={() => pipWindow.close()} aria-label="Bring the video back to this tab" title="Bring back">
            <ArrowSquareIn size={16} weight="bold" />
          </button>
        ) : canPopOut() && (
          <button type="button" className="mini-pip-btn" onClick={popOut} aria-label="Pop out over other tabs and apps" title="Pop out">
            <PictureInPicture size={16} weight="bold" />
          </button>
        )}
        <button type="button" className="mini-pip-btn" onClick={expand} aria-label="Expand to full player" title="Expand">
          <ArrowsOutSimple size={16} weight="bold" />
        </button>
        <button type="button" className="mini-pip-btn" onClick={onClose} aria-label="Close mini player" title="Close">
          <X size={16} weight="bold" />
        </button>
      </div>
      {pipWindow ? (
        <>
          <p className="mini-pip-popped-note">Playing in a floating window</p>
          {createPortal(frame, pipWindow.document.body)}
        </>
      ) : (
        <div className="mini-pip-frame">{frame}</div>
      )}
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

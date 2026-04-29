import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

// Route the stream through our server proxy so CORS isn't an issue.
function proxyUrl(src) {
  if (!src) return src;
  return `/api/proxy?url=${encodeURIComponent(src)}`;
}

export default function HlsPlayer({ src, className, autoPlay = true }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | playing | error

  useEffect(() => {
    const video = videoRef.current;
    if (!src || !video) return;

    setStatus('loading');

    // Destroy any previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const proxied = proxyUrl(src);

    // Watchdog: if nothing happens within 12 s, show an error rather than
    // spinning forever. This fires before Vercel's 10 s function timeout
    // produces a silent 504 that hls.js might retry indefinitely.
    const watchdog = setTimeout(() => setStatus('error'), 12_000);
    const clearWatchdog = () => clearTimeout(watchdog);

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
        lowLatencyMode: true,
        // Limit retries so failures surface quickly instead of silently retrying
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 2,
      });
      hlsRef.current = hls;

      hls.loadSource(proxied);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        clearWatchdog();
        setStatus('playing');
        if (autoPlay) video.play().catch(() => {});
      });

      let reloadAttempts = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        clearWatchdog();
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && reloadAttempts < 3) {
          reloadAttempts++;
          // Reload the entire manifest — handles streams with expiring segment tokens
          const delay = reloadAttempts * 2000;
          setTimeout(() => {
            try { hls.stopLoad(); hls.loadSource(proxied); hls.startLoad(); } catch { /* destroyed */ }
          }, delay);
        } else {
          setStatus('error');
          hls.destroy();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS — iOS Safari / WKWebView
      video.src = proxied;

      // canplay fires earlier than loadedmetadata on some iOS streams
      const onReady = () => {
        clearWatchdog();
        setStatus('playing');
        if (autoPlay) video.play().catch(() => {});
      };
      video.addEventListener('canplay',       onReady, { once: true });
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', () => { clearWatchdog(); setStatus('error'); }, { once: true });
    } else {
      clearWatchdog();
      setStatus('error');
    }

    return () => {
      clearWatchdog();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, autoPlay]);

  return (
    <div className="hls-player-wrap">
      {status === 'error' && (
        <div className="hls-player-error">
          <span>⚠</span>
          <p>Stream unavailable.</p>
          <p className="hls-player-error-hint">The channel may be offline or geo-restricted. Try a different channel.</p>
        </div>
      )}
      {status === 'loading' && (
        <div className="hls-player-loading">
          <div className="hls-player-spinner" />
          <p>Connecting to stream…</p>
        </div>
      )}
      <video
        ref={videoRef}
        className={className || 'hls-player-video'}
        controls
        playsInline
        style={{ display: status === 'error' ? 'none' : 'block' }}
      />
    </div>
  );
}

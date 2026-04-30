import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

// Route the stream through our server proxy so CORS isn't an issue.
function proxyUrl(src) {
  if (!src) return src;
  return `/api/proxy?url=${encodeURIComponent(src)}`;
}

export default function HlsPlayer({ src, className = '', style = {} }) {
  const videoRef = useRef(null);
  const hlsRef   = useRef(null);
  const [status, setStatus] = useState('connecting'); // connecting | playing | error

  useEffect(() => {
    if (!src || !videoRef.current) return;

    const video   = videoRef.current;
    const proxied = proxyUrl(src);
    let reloadAttempts = 0;

    function clearWatchdog() {}

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;

      hls.loadSource(proxied);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('playing');
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        clearWatchdog();
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && reloadAttempts < 3) {
          reloadAttempts++;
          setTimeout(() => {
            try { hls.stopLoad(); hls.loadSource(proxied); hls.startLoad(); } catch { /* destroyed */ }
          }, reloadAttempts * 2000);
        } else {
          setStatus('error');
          hls.destroy();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = proxied;
      video.addEventListener('loadedmetadata', () => {
        setStatus('playing');
        video.play().catch(() => {});
      });
    } else {
      setStatus('error');
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [src]);

  if (status === 'error') {
    return (
      <div className={`hls-error ${className}`} style={style}>
        <p>Stream unavailable</p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      {status === 'connecting' && (
        <div className="hls-connecting">
          <div className="hls-spinner" />
          <span>Connecting to stream...</span>
        </div>
      )}
      <video
        ref={videoRef}
        className={className}
        controls
        autoPlay
        playsInline
        style={{ width: '100%', height: '100%', display: 'block', background: '#000' }}
      />
    </div>
  );
}

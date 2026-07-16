// Persists across navigation (mounted once, at the app root, by
// MiniPlayerProvider) so a video keeps playing in a small corner widget
// while the user browses elsewhere, instead of being lost the moment they
// navigate away from the title's detail page.
//
// Deliberately simpler than the full EmbedPlayer: no season/episode/source
// switching here — those live on the title's own detail page. This is a
// "keep watching while I browse" convenience, not a replacement for it.
export default function MiniPlayerWidget({ nowPlaying, minimized, onExpand, onMinimize, onClose }) {
  const { embedUrl, title, subtitle, poster } = nowPlaying;

  if (minimized) {
    return (
      <button type="button" className="mini-player mini-player--dock" onClick={onExpand}>
        <span className="mini-player-frame">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              className="mini-player-iframe"
              allow="autoplay; encrypted-media"
              referrerPolicy="no-referrer-when-downgrade"
              title={title}
              tabIndex={-1}
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
          ✕
        </span>
      </button>
    );
  }

  return (
    <div className="mini-player mini-player--full">
      <div className="mini-player-full-header">
        <button type="button" className="mini-player-full-btn" onClick={onMinimize} aria-label="Minimize">
          ⌄
        </button>
        <span className="mini-player-full-title">{title}</span>
        <button type="button" className="mini-player-full-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="mini-player-full-frame">
        {embedUrl && (
          <iframe
            src={embedUrl}
            className="mini-player-iframe"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            title={title}
          />
        )}
      </div>
    </div>
  );
}

import { Play } from '@phosphor-icons/react';
import { UP_NEXT_COUNTDOWN } from '../../utils/embedProviders';

// The "Up next" card near the end of an episode. secondsLeft counts down to
// autoplay; null means autoplay is off and it waits for a tap.
export default function UpNextCard({ upNext, nextEpisode, nextInfo, onPlay, onCancel }) {
  return (
    <div className="st-upnext" role="dialog" aria-label="Up next">
      {nextInfo?.still && <img src={nextInfo.still} alt="" className="st-upnext-still" />}
      <div className="st-upnext-body">
        <strong>{nextInfo?.title || `Episode ${nextEpisode.episode}`}</strong>
        <span className="st-upnext-meta">Next: season {nextEpisode.season}, episode {nextEpisode.episode}</span>
        <div className="st-upnext-actions">
          <button type="button" className="st-btn st-btn--primary" onClick={onPlay}>
            <Play size={16} weight="fill" /> {upNext.secondsLeft == null ? 'Play next episode' : `Play now${upNext.secondsLeft > 0 ? ` (${upNext.secondsLeft})` : ''}`}
          </button>
          <button type="button" className="st-btn st-btn--ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
      {upNext.secondsLeft != null && <span className="st-upnext-bar" style={{ animationDuration: `${UP_NEXT_COUNTDOWN}s` }} aria-hidden="true" />}
    </div>
  );
}

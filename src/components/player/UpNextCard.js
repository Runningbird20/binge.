import { Play } from '@phosphor-icons/react';
import { UP_NEXT_COUNTDOWN } from '../../utils/embedProviders';
import useProfileSetting from '../../hooks/useProfileSetting';

// The "Up next" card near the end of an episode. secondsLeft counts down to
// autoplay; null means autoplay is off and it waits for a tap. With
// Spoiler-free episodes on, the next episode's picture is blurred.
export default function UpNextCard({ upNext, nextEpisode, nextInfo, onPlay, onCancel }) {
  const spoilerFree = Boolean(useProfileSetting('spoilerFree'));
  return (
    <div className="st-upnext" role="dialog" aria-label="Up next">
      {nextInfo?.still && <img src={nextInfo.still} alt="" className={`st-upnext-still${spoilerFree ? ' st-upnext-still--hidden' : ''}`} />}
      <div className="st-upnext-body">
        {upNext.stillWatching && <strong className="st-upnext-ask">Still watching?</strong>}
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

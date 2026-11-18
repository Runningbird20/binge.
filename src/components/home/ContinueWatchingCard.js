import { Link, useLocation } from 'react-router-dom';
import { Info, X } from '@phosphor-icons/react';
import TitleCard from '../TitleCard';
import { computeProgressBadge, computeResumeProgress, detailsUrl, formatTimeLeft, resumeUrl } from '../../utils/continueWatching';
import { asTitle } from './asTitle';

// A Continue Watching card: plays from the saved position and server, with
// (i) for the title popup and X to remove it (with Undo, handled by Home).
export default function ContinueWatchingCard({ item, onRemove, priority, note }) {
  const location = useLocation();
  const episodeLabel = computeProgressBadge(item);
  const resume = computeResumeProgress(item);
  const subtitle = [item.media_type === 'tv_show' ? episodeLabel : null, resume ? formatTimeLeft(resume.secondsLeft) : null]
    .filter(Boolean).join(' · ');
  // The card itself plays straight from the saved position and server;
  // details live behind the (i) button.
  return (
    <div className="st-cw-cell">
      <TitleCard
        item={{
          ...asTitle(item),
          _progress: resume ? Math.max(0.03, resume.fraction) : null,
          _subtitle: subtitle || episodeLabel,
          _note: note,
          _match: null,
        }}
        to={resumeUrl(item)}
        priority={priority}
        showMatch={false}
        playNow
      />
      <Link
        to={detailsUrl(item)}
        state={{ backgroundLocation: location }}
        className="st-cw-info"
        title="Episodes & info"
        aria-label={`Details for ${item.title}`}
      >
        <Info size={15} weight="bold" />
      </Link>
      <button
        type="button"
        className="st-cw-remove"
        title="Remove from Continue Watching"
        aria-label={`Remove ${item.title} from Continue Watching`}
        onClick={(event) => { event.preventDefault(); onRemove(item.id); }}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

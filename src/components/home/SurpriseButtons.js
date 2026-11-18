import { useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilmSlate, MonitorPlay } from '@phosphor-icons/react';
import { titleUrl } from '../TitleCard';
import { pickSurprise, surpriseKey, surprisePool } from '../../utils/surprise';
import { useWatchedKeys } from '../../utils/watchedTitles';
import { haptic } from '../../utils/haptics';

// "Surprise me with a movie" / "… a series": opens one of your picks of that
// type, above Continue Watching, in the title popup's Trailer-button style.
// personal === null means the picks are still loading.
const SURPRISES = [
  { mediaType: 'movie', label: 'Surprise me with a movie', Icon: FilmSlate },
  { mediaType: 'tv_show', label: 'Surprise me with a series', Icon: MonitorPlay },
];

export default function SurpriseButtons({ personal, fallback }) {
  const navigate = useNavigate();
  const location = useLocation();
  const recent = useRef([]);
  const watched = useWatchedKeys();
  const pools = useMemo(
    () => Object.fromEntries(SURPRISES.map(({ mediaType }) => [mediaType, watched ? surprisePool(personal, fallback, { mediaType, exclude: watched }) : []])),
    [personal, fallback, watched],
  );
  // Loaded and nothing to offer of a type: that button goes.
  const shown = SURPRISES.filter(({ mediaType }) => !personal || !watched || pools[mediaType].length > 0);
  if (!shown.length) return null;

  function surprise(mediaType) {
    const item = pickSurprise(pools[mediaType], recent.current);
    if (!item) return;
    recent.current = [surpriseKey(item), ...recent.current].slice(0, 6);
    haptic();
    navigate(titleUrl(item), { state: { backgroundLocation: location } });
  }

  return (
    <div className="st-surprise">
      {shown.map(({ mediaType, label, Icon }) => (
        <button
          key={mediaType}
          type="button"
          className="st-btn td-resume-control td-play--compact"
          onClick={() => surprise(mediaType)}
          disabled={!pools[mediaType].length}
        >
          <Icon size={18} weight="bold" aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}

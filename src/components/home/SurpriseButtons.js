import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilmSlate, MonitorPlay } from '@phosphor-icons/react';
import { titleUrl } from '../TitleCard';
import WatchingWith from './WatchingWith';
import { pickSurprise, surpriseKey, surprisePool } from '../../utils/surprise';
import { buildGroupPicks } from '../../utils/personalization';
import { maturityLabel, maturityRestriction, strictestProfile, strictestRestriction } from '../../utils/kidsMode';
import { useWatchedKeys } from '../../utils/watchedTitles';
import { useAuth } from '../../contexts/AuthContext';
import { haptic } from '../../utils/haptics';

// "Surprise me with a movie" / "… a series": opens one of your picks of that
// type, above Continue Watching, in the title popup's Trailer-button style.
// personal === null means the picks are still loading. When the account has
// other profiles, it first asks "Just you?" (WatchingWith): with others
// chosen, the surprise is something you'd all like that none of you has seen,
// rated for the youngest of you (the strictest maturity level in the group).
const SURPRISES = [
  { mediaType: 'movie', label: 'Surprise me with a movie', Icon: FilmSlate },
  { mediaType: 'tv_show', label: 'Surprise me with a series', Icon: MonitorPlay },
];

const NOUN = { movie: 'movie', tv_show: 'series' };

export default function SurpriseButtons({ personal, fallback }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profiles = [], activeProfile = null } = useAuth() || {};
  const recent = useRef([]);
  const request = useRef(0);
  const watched = useWatchedKeys();
  const [asking, setAsking] = useState(null); // the media type being asked about
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const others = (profiles || []).filter((profile) => profile.id !== activeProfile?.id);
  const group = [activeProfile, ...others.filter((profile) => chosen.includes(profile.id))].filter(Boolean);
  // Said in the question when someone chosen has a stricter rating than yours.
  const youngest = strictestProfile(group);
  const keepsTo = youngest && maturityRestriction(youngest) !== maturityRestriction(activeProfile)
    ? { name: youngest.name, label: maturityLabel(maturityRestriction(youngest)) }
    : null;

  const pools = useMemo(
    () => Object.fromEntries(SURPRISES.map(({ mediaType }) => [mediaType, watched ? surprisePool(personal, fallback, { mediaType, exclude: watched }) : []])),
    [personal, fallback, watched],
  );
  // Loaded and nothing to offer of a type: that button goes.
  const shown = SURPRISES.filter(({ mediaType }) => !personal || !watched || pools[mediaType].length > 0);
  if (!shown.length) return null;

  function open(item) {
    recent.current = [surpriseKey(item), ...recent.current].slice(0, 6);
    haptic();
    navigate(titleUrl(item), { state: { backgroundLocation: location } });
  }

  function surprise(mediaType) {
    const item = pickSurprise(pools[mediaType], recent.current);
    if (item) open(item);
  }

  function ask(mediaType) {
    if (!others.length) { surprise(mediaType); return; }
    setProblem('');
    setAsking(mediaType);
  }

  function dismiss() {
    request.current += 1; // a group still loading is dropped
    setBusy(false);
    setAsking(null);
  }

  function justMe() {
    const mediaType = asking;
    dismiss();
    surprise(mediaType);
  }

  // A profile's history read: its id, and whether it also owns the rows saved
  // without a profile (the default profile, or an account's only one).
  const scopeOf = (profile) => ({ id: profile.id, ownsLegacy: Boolean(profile.is_default) || profiles.length === 1 });

  async function together() {
    const mediaType = asking;
    const token = request.current + 1;
    request.current = token;
    setBusy(true);
    setProblem('');
    try {
      const kidsSafe = strictestRestriction(group);
      const { picks, exclude } = await buildGroupPicks({ profiles: group.map(scopeOf), mediaType, kidsSafe });
      if (token !== request.current) return;
      // When none of them has a history yet, Home's trending titles stand
      // in, but only if they were filtered for a level this group allows.
      const pool = surprisePool({ topPicks: picks }, kidsSafe === maturityRestriction(activeProfile) ? fallback : [], { mediaType, exclude });
      const item = pickSurprise(pool, recent.current);
      if (!item) {
        setProblem(`We couldn’t find a ${NOUN[mediaType]} none of you has seen. Try with fewer people.`);
        return;
      }
      setAsking(null);
      open(item);
    } catch {
      if (token === request.current) setProblem('That didn’t work. Try again.');
    } finally {
      if (token === request.current) setBusy(false);
    }
  }

  return (
    <div className="st-surprise">
      {shown.map(({ mediaType, label, Icon }) => (
        <button
          key={mediaType}
          type="button"
          className="st-btn td-resume-control td-play--compact"
          onClick={() => ask(mediaType)}
          disabled={!pools[mediaType].length}
        >
          <Icon size={18} weight="bold" aria-hidden="true" /> {label}
        </button>
      ))}
      {asking && (
        <WatchingWith
          mediaType={asking}
          others={others}
          chosen={chosen}
          onChosenChange={setChosen}
          onJustMe={justMe}
          onTogether={together}
          busy={busy}
          problem={problem}
          keepsTo={keepsTo}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}

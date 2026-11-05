import { useContext, useRef, useState } from 'react';
import { Check, Play, SquaresFour } from '@phosphor-icons/react';
import { expandStreamProviders } from '../../utils/sportsProviders';
import { hostOf, reachabilityMap } from '../../utils/hostReachability';
import { MULTIVIEW_MAX, teamsInNameOrder, timeUntil, getStatus, statusLabel, scoreWords } from './gameInfo';
import { HideScores } from './HideScores';
import { CatIcon } from './CatIcon';

// Warms a game while the pointer rests on its card: expands its servers
// (cached) and probes their hosts, so opening it starts the stream at once.
const warmed = new Set();

function warmGame(stream) {
  if (warmed.has(stream.id)) return;
  warmed.add(stream.id);
  expandStreamProviders(stream.providers)
    .then((list) => {
      const hosts = [...new Set(list.map((provider) => hostOf(provider.embedUrl)).filter(Boolean))];
      hosts.slice(0, 3).forEach((host) => {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = `https://${host}`;
        document.head.appendChild(link);
      });
      return reachabilityMap(hosts);
    })
    .catch(() => warmed.delete(stream.id));
}

// Team-logo art for games without a provider thumbnail, tinted with the
// teams' colors when PPV provides them.
export function GameArt({ stream }) {
  const [posterFailed, setPosterFailed] = useState(false);
  const colors = stream.colors?.length >= 2 ? stream.colors : ['#26304a', '#121620'];

  // Crisp team logos beat the providers' low-res thumbnails whenever we
  // have both teams' logos.
  const hasLogos = Boolean(stream.logos?.home && stream.logos?.away);
  if (!hasLogos && stream.poster && !posterFailed) {
    return (
      <img
        className="st-game-img"
        src={stream.poster}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setPosterFailed(true)}
      />
    );
  }

  return (
    <div className="st-game-art" style={{ background: `linear-gradient(120deg, ${colors[0]} 0%, ${colors[0]} 48%, ${colors[1]} 52%, ${colors[1]} 100%)` }}>
      {stream.logos?.home && stream.logos?.away ? (
        <>
          <img src={stream.logos.home} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span>vs</span>
          <img src={stream.logos.away} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </>
      ) : (
        <span className="st-game-art-icon"><CatIcon category={stream.category} size={44} /></span>
      )}
    </div>
  );
}

// "TA&M 6  MIZ 20  3:30 - 4th" over the art, like a broadcast score bug.
function Scorebug({ stream }) {
  const hideScores = useContext(HideScores);
  const score = stream.score;
  if (!score || score.state === 'pre' || score.teams.length !== 2) return null;
  return (
    <span className="st-scorebug">
      {!hideScores && teamsInNameOrder(stream, score).map((team) => (
        <span key={team.short || team.name} className={`st-scorebug-team${score.state === 'post' && team.winner ? ' won' : ''}`}>
          {team.short}<b>{team.score}</b>
        </span>
      ))}
      <span className="st-scorebug-clock">{score.detail}</span>
    </span>
  );
}

export function GameCard({ stream, nowMs, onSelect, active = false, multi }) {
  const hideScores = useContext(HideScores);
  const status = getStatus(stream, nowMs);
  const countdown = status === 'upcoming' ? timeUntil(stream.startsAt) : null;
  const picked = multi?.picks.includes(stream.id);
  const warmTimer = useRef(null);
  const broadcast = stream.score?.broadcast;
  const card = (
    <button
      type="button"
      className={`st-game${active ? ' active' : ''}`}
      onClick={() => onSelect(stream)}
      onMouseEnter={() => { if (status === 'live') warmTimer.current = setTimeout(() => warmGame(stream), 200); }}
      onMouseLeave={() => clearTimeout(warmTimer.current)}
      onFocus={() => { if (status === 'live') warmGame(stream); }}
      aria-label={[stream.name, statusLabel(stream, nowMs), scoreWords(stream, hideScores), stream.score?.state === 'in' ? stream.score.detail : '', stream.score?.close && status === 'live' ? 'close game' : '']
        .filter(Boolean).join(', ')}
    >
      <div className="st-game-thumb">
        <GameArt stream={stream} />
        <span className={`st-game-status st-game-status--${status}`}>
          {status === 'live' && <span className="st-live-dot" aria-hidden="true" />}
          {statusLabel(stream, nowMs)}
        </span>
        {countdown && <span className="st-game-countdown">{countdown}</span>}
        {!countdown && status === 'live' && stream.score?.close && <span className="st-game-close">Close game</span>}
        <Scorebug stream={stream} />
        <span className="st-game-play" aria-hidden="true"><Play size={20} weight="fill" /></span>
      </div>
      <p className="st-game-title">{stream.name}</p>
      <p className="st-game-meta">
        <CatIcon category={stream.category} /> {stream.league}
        {broadcast && status !== 'final' && <><span aria-hidden="true"> · </span>{broadcast}</>}
      </p>
    </button>
  );
  if (!multi || status === 'upcoming') return card;
  const full = !picked && multi.picks.length >= MULTIVIEW_MAX;
  return (
    <div className="st-game-wrap">
      {card}
      <button
        type="button"
        className={`st-game-multi${picked ? ' on' : ''}`}
        onClick={() => multi.toggle(stream.id)}
        disabled={full}
        aria-pressed={picked}
        aria-label={picked ? `Remove ${stream.name} from Multiview` : `Add ${stream.name} to Multiview`}
        title={full ? `Multiview holds up to ${MULTIVIEW_MAX} games` : picked ? 'Remove from Multiview' : 'Add to Multiview'}
      >
        {picked ? <Check size={14} weight="bold" /> : <SquaresFour size={14} weight="bold" />}
        <span>{picked ? 'In Multiview' : 'Multiview'}</span>
      </button>
    </div>
  );
}

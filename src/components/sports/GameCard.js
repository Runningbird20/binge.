import { useContext, useRef, useState } from 'react';
import { Check, Play, SquaresFour } from '@phosphor-icons/react';
import { expandStreamProviders } from '../../utils/sportsProviders';
import { hostOf, reachabilityMap } from '../../utils/hostReachability';
import { MULTIVIEW_MAX, teamsInNameOrder, timeUntil, getStatus, statusLabel, scoreWords } from './gameInfo';
import { HideScores } from './HideScores';
import { CatIcon } from './CatIcon';
import { conferenceLogo, leagueLogo } from './leagueLogos';

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

// The colors a game's art falls back to when no feed or ESPN has the teams'.
const NO_COLORS = ['#2b3446', '#2b3446'];
const HEX = /^#[0-9a-f]{6}$/i;

const ART_BASE = [0x10, 0x14, 0x1d];

// A team color toned down toward the art's dark base, as PPV's thumbnails
// do, so a bright one (Ohio State red, Oregon green) doesn't swallow a logo
// in the same color.
function deepen(hex, keep = 0.68) {
  const rgb = [1, 3, 5].map((index, channel) => Math.round(parseInt(hex.slice(index, index + 2), 16) * keep + ART_BASE[channel] * (1 - keep)));
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// PPV's thumbnail look: each team's color glows in from its own side and fades
// into a dark middle, under a soft shade at the top and bottom.
export function artBackground(colors) {
  const [left, right] = (colors?.length >= 2 && HEX.test(colors[0]) && HEX.test(colors[1]) ? colors : NO_COLORS).map((color) => deepen(color));
  return [
    'linear-gradient(180deg, rgba(0, 0, 0, 0.22) 0%, transparent 30%, transparent 70%, rgba(0, 0, 0, 0.32) 100%)',
    `radial-gradient(ellipse 70% 140% at 0% 50%, ${left} 0%, transparent 100%)`,
    `radial-gradient(ellipse 70% 140% at 100% 50%, ${right} 0%, transparent 100%)`,
    '#10141d',
  ].join(', ');
}

// The mark between the teams: a college conference game's conference (SEC,
// ACC...), else the league's (the NBA's silhouette, the NFL shield), else a
// bold VS.
function MatchupMark({ league, conference }) {
  // Logos that failed to load; the next one in line shows instead.
  const [failed, setFailed] = useState(() => new Set());
  const conferenceSrc = conferenceLogo(conference);
  const src = [conferenceSrc, leagueLogo(league)].find((candidate) => candidate && !failed.has(candidate));
  if (!src) return <span className="st-game-art-vs">VS</span>;
  return (
    <img
      className={`st-game-art-league${src === conferenceSrc ? ' st-game-art-conference' : ''}`}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed((before) => new Set(before).add(src))}
    />
  );
}

// ESPN's version of a team logo made for dark backgrounds (the Giants' "ny" in
// white, as PPV's thumbnails show it): the same address under 500-dark.
export function darkLogo(url) {
  return typeof url === 'string' ? url.replace(/(espncdn\.com\/i\/teamlogos\/[^/]+\/)500\//, '$1500-dark/') : url;
}

// A team's logo on the art, falling back to the regular version when a team
// has no dark one.
function TeamLogo({ src }) {
  const [darkFailed, setDarkFailed] = useState(false);
  const dark = darkLogo(src);
  return (
    <img
      className="st-game-art-team"
      src={darkFailed ? src : dark}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => { if (dark !== src) setDarkFailed(true); }}
    />
  );
}

// Team-logo art for games without a provider thumbnail, in the teams' colors.
export function GameArt({ stream }) {
  const [posterFailed, setPosterFailed] = useState(false);

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
    <div className="st-game-art" style={{ background: artBackground(stream.colors) }}>
      {hasLogos ? (
        <>
          <TeamLogo key={stream.logos.home} src={stream.logos.home} />
          <MatchupMark key={`${stream.league || ''}|${stream.conference || ''}`} league={stream.league} conference={stream.conference} />
          <TeamLogo key={stream.logos.away} src={stream.logos.away} />
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

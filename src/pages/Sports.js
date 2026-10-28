import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowsOut, Baseball, Basketball, BoxingGlove, CaretUp, Check, CornersOut, Cricket, Eye, EyeSlash, FlagCheckered, Football,
  Golf, GridFour, Hockey, Play, SkipForward, SoccerBall, SquaresFour, Target, TennisBall, Trophy, Volleyball, X,
} from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import TitleRow from '../components/TitleRow';
import LiveScorePanel from '../components/LiveScorePanel';
import FantasyBoard from '../components/FantasyBoard';
import useDeviceType from '../hooks/useDeviceType';
import { expandStreamProviders, loadSportsStreams, resolveProviderEmbedUrl, providerLabel, sameGame, splitTeamsFromTitle, teamsMatch } from '../utils/sportsProviders';
import { fetchScoreboards } from '../utils/liveScores';
import { rankFeeds, recordFeedFailed, recordFeedWorked } from '../utils/sportsServerMemory';
import { listFollowedTeams, TEAMS_EVENT } from '../utils/teams';
import { hostOf, isHostReachable, reachabilityMap } from '../utils/hostReachability';

const POLL_MS = 60_000;
// How long a server's iframe gets to fire `load` before we silently move to
// the next one. Only catches network-level failures — a cross-origin player
// that loads but shows a dead stream looks identical from outside, which is
// what the "Next server" button is for.
const LOAD_TIMEOUT_MS = 8_000;
// Staying this long on a server counts as "it worked" (see sportsServerMemory).
const WORKED_AFTER_MS = 60_000;
// Expanding Streamed sources waits at most this long before starting.
const EXPAND_TIMEOUT_MS = 3_500;
const MULTIVIEW_MAX = 4;
// The last schedule, shown at once on the next visit while the feeds load.
const SCHEDULE_CACHE_KEY = 'binge.sports.schedule.v1';
const SCHEDULE_CACHE_MAX_AGE_MS = 20 * 60_000;
const HIDE_SCORES_KEY = 'binge.sports.hideScores';
// "Starting soon" row: games beginning within this many seconds.
const SOON_SEC = 3 * 3600;
const SCORES_POLL_MS = 30_000;

// Spoiler-free mode (scores hidden everywhere on the page).
const HideScores = createContext(false);

function readScheduleCache() {
  try {
    const { at, streams } = JSON.parse(localStorage.getItem(SCHEDULE_CACHE_KEY) || 'null') || {};
    if (!Array.isArray(streams) || Date.now() - at > SCHEDULE_CACHE_MAX_AGE_MS) return null;
    const nowSec = Date.now() / 1000;
    return streams.filter((stream) => stream.alwaysLive || stream.replay || (stream.endsAt || 0) > nowSec - 3600);
  } catch {
    return null;
  }
}

function writeScheduleCache(streams) {
  try { localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify({ at: Date.now(), streams })); } catch { /* full or blocked */ }
}

function readHideScores() {
  try { return localStorage.getItem(HIDE_SCORES_KEY) === '1'; } catch { return false; }
}

// The ESPN teams in the order the game is named ("A vs B" → [A, B]).
function teamsInNameOrder(stream, score) {
  const named = stream.teams || splitTeamsFromTitle(stream.name);
  const [first, second] = score.teams;
  if (named && second && teamsMatch(named.home, second.name)) return [second, first];
  return [first, second];
}

// Adds the ESPN score to a schedule entry, and its logos when the feeds
// had none (most NFL/NBA/MLB/Premier League listings).
function withScore(stream, score) {
  if (!score) return stream;
  const next = { ...stream, score };
  if (!(stream.logos?.home && stream.logos?.away)) {
    const [first, second] = teamsInNameOrder(stream, score);
    if (first?.logo && second?.logo) next.logos = { home: first.logo, away: second.logo };
  }
  return next;
}

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

// League rows, in the order a US-centric sports home would show them; any
// league not listed follows, biggest first.
const LEAGUE_ORDER = [
  'NFL', 'College Football', 'NBA', 'WNBA', 'NHL', 'MLB', 'MLS', 'Premier League', 'LaLiga', 'Champions League',
  'Serie A', 'Bundesliga', 'Ligue 1', 'Liga MX', 'Formula 1', 'UFC', 'Wrestling', 'Combat Sports',
];

// One icon family for every sport (no emoji standing in for icons).
const CAT_ICONS = {
  'American Football': Football, 'Australian Football': Football, Rugby: Football, Basketball, Soccer: SoccerBall,
  Baseball, Hockey, 'Combat Sports': BoxingGlove, Tennis: TennisBall, Golf, Racing: FlagCheckered,
  Cricket, Volleyball, Darts: Target,
};

function CatIcon({ category, size = 16 }) {
  const Icon = CAT_ICONS[category] || Trophy;
  return <Icon size={size} weight="bold" aria-hidden="true" className="st-cat-icon" />;
}

function fmtTime(unix) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDay(unix) {
  if (!unix) return '';
  const date = new Date(unix * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeUntil(unix) {
  const diff = unix * 1000 - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return null;
  return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
}

function getStatus(stream, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  if (stream.alwaysLive) return 'live';
  // ESPN knows when a game actually started and ended; the feeds only
  // estimate a window from the start time.
  if (stream.score?.state === 'post') return 'final';
  if (stream.score?.state === 'in') return 'live';
  if (stream.startsAt <= nowSec && stream.endsAt >= nowSec) return 'live';
  if (stream.startsAt > nowSec) return 'upcoming';
  return 'replay';
}

function statusLabel(stream, nowMs) {
  const status = getStatus(stream, nowMs);
  if (status === 'live') return stream.alwaysLive ? '24/7' : 'LIVE';
  if (status === 'replay') return 'REPLAY';
  if (status === 'final') return 'FINAL';
  return `${fmtDay(stream.startsAt)} · ${fmtTime(stream.startsAt)}`;
}

// Team-logo art for games without a provider thumbnail, tinted with the
// teams' colors when PPV provides them.
function GameArt({ stream }) {
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

function scoreWords(stream, hideScores) {
  const score = stream.score;
  if (!score || score.state === 'pre' || hideScores) return '';
  return teamsInNameOrder(stream, score).map((team) => `${team.short || team.name} ${team.score}`).join(', ');
}

function GameCard({ stream, nowMs, onSelect, active = false, multi }) {
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

function sortForRow(streams, nowMs) {
  const rank = { live: 0, upcoming: 1, final: 2, replay: 3 };
  return [...streams].sort((a, b) => {
    const statusDiff = rank[getStatus(a, nowMs)] - rank[getStatus(b, nowMs)];
    if (statusDiff) return statusDiff;
    if (getStatus(a, nowMs) === 'live') {
      // Close games first, then games ESPN confirms are on, then the
      // best-served ones.
      const close = Number(Boolean(b.score?.close)) - Number(Boolean(a.score?.close));
      if (close) return close;
      const on = Number(b.score?.state === 'in') - Number(a.score?.state === 'in');
      if (on) return on;
    }
    if (b.providers.length !== a.providers.length && getStatus(a, nowMs) === 'live') return b.providers.length - a.providers.length;
    return a.startsAt - b.startsAt;
  });
}

function buildLeagueRows(streams, nowMs) {
  const byLeague = new Map();
  streams.forEach((stream) => {
    if (stream.alwaysLive) return;
    const list = byLeague.get(stream.league) || [];
    list.push(stream);
    byLeague.set(stream.league, list);
  });
  return [...byLeague.entries()]
    .map(([league, list]) => ({
      league,
      items: sortForRow(list, nowMs),
      liveCount: list.filter((stream) => getStatus(stream, nowMs) === 'live').length,
      order: LEAGUE_ORDER.indexOf(league) === -1 ? 100 : LEAGUE_ORDER.indexOf(league),
    }))
    .sort((a, b) => (b.liveCount > 0) - (a.liveCount > 0) || a.order - b.order || b.items.length - a.items.length);
}

// ── Player ─────────────────────────────────────────────────────────────

// Server rotation for one game: probes which provider hosts this network
// can reach, resolves the embed URL, and auto-advances past servers that
// fail to load. Shared by the single-game player and Multiview tiles.
function useServerRotation(stream, status) {
  const [serverIndex, setServerIndex] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [embedUrl, setEmbedUrl] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(new Set());
  // Servers whose host this network blocks (see utils/hostReachability).
  const [blocked, setBlocked] = useState(new Set());
  // Every stream of every feed, best first; null while it's being worked out.
  const [list, setList] = useState(null);
  const loadedRef = useRef(false);
  const workedRef = useRef(false);
  const servers = useMemo(() => list || [], [list]);
  // Once a game has been live, a schedule refresh that briefly calls it
  // "upcoming" (a feed moved its start time) must not unload the stream:
  // that reload is what threw viewers out of full screen and restarted the
  // player muted (browsers mute players that start without a click).
  const wasLive = useRef({ id: null, live: false });
  if (wasLive.current.id !== stream.id) wasLive.current = { id: stream.id, live: false };
  if (status !== 'upcoming') wasLive.current.live = true;
  const upcoming = status === 'upcoming' && !wasLive.current.live;

  useEffect(() => {
    setServerIndex(0);
    setFailed(new Set());
    setBlocked(new Set());
    setRetryNonce(0);
    setList(null);
    let cancelled = false;
    (async () => {
      // Each Streamed source becomes all of its streams; don't wait on a
      // slow lookup for long (unexpanded sources still resolve on demand).
      const expanded = await Promise.race([
        expandStreamProviders(stream.providers).catch(() => stream.providers),
        new Promise((resolve) => { setTimeout(() => resolve(stream.providers), EXPAND_TIMEOUT_MS); }),
      ]);
      const ranked = rankFeeds(expanded, stream.id);
      // Probe the hosts we know and start on the first server this network
      // can actually reach.
      const reach = await reachabilityMap(ranked.map((provider) => hostOf(provider.embedUrl)));
      if (cancelled) return;
      const blockedNow = new Set(ranked
        .map((provider, index) => (provider.embedUrl && reach[hostOf(provider.embedUrl)] === false ? index : -1))
        .filter((index) => index >= 0));
      setBlocked(blockedNow);
      setList(ranked);
      const firstOk = ranked.findIndex((_, index) => !blockedNow.has(index));
      setServerIndex(Math.max(0, firstOk));
    })();
    return () => { cancelled = true; };
  }, [stream.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance past a server that failed, unless every server has.
  const advance = useCallback(() => {
    recordFeedFailed(servers[serverIndex], stream.id);
    setFailed((current) => {
      const next = new Set(current);
      next.add(serverIndex);
      return next;
    });
    setServerIndex((index) => {
      for (let step = 1; step <= servers.length; step += 1) {
        const candidate = (index + step) % servers.length;
        if (!failed.has(candidate) && !blocked.has(candidate) && candidate !== index) return candidate;
      }
      return index;
    });
  }, [serverIndex, servers, failed, blocked, stream.id]);

  useEffect(() => {
    const provider = servers[serverIndex];
    if (!provider || upcoming) { setEmbedUrl(null); setResolving(false); return undefined; }
    let cancelled = false;
    setResolving(true);
    setEmbedUrl(null);
    resolveProviderEmbedUrl(provider).then(async (url) => {
      if (cancelled) return;
      if (url && !(await isHostReachable(hostOf(url)))) {
        if (cancelled) return;
        setBlocked((current) => new Set(current).add(serverIndex));
        setResolving(false);
        advance();
        return;
      }
      setResolving(false);
      if (url) setEmbedUrl(url);
      else advance();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, list, serverIndex, retryNonce, upcoming]);

  useEffect(() => {
    loadedRef.current = false;
    if (!embedUrl) return undefined;
    const timer = setTimeout(() => {
      if (!loadedRef.current) advance();
    }, LOAD_TIMEOUT_MS);
    // Still on this server a minute later: remember that it works.
    const provider = servers[serverIndex];
    const worked = setTimeout(() => {
      if (loadedRef.current) { workedRef.current = true; recordFeedWorked(provider, stream.id); }
    }, WORKED_AFTER_MS);
    workedRef.current = false;
    return () => { clearTimeout(timer); clearTimeout(worked); };
  }, [embedUrl, advance]); // eslint-disable-line react-hooks/exhaustive-deps

  const preparing = list === null;
  const unavailable = new Set([...failed, ...blocked]);
  const allFailed = !preparing && unavailable.size >= servers.length;
  const allBlocked = !preparing && blocked.size >= servers.length;

  function chooseServer(index) {
    // Leaving a server within its first minute counts against it.
    if (index !== serverIndex && embedUrl && !workedRef.current) recordFeedFailed(servers[serverIndex], stream.id);
    setFailed((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
    if (index === serverIndex) setRetryNonce((n) => n + 1);
    else setServerIndex(index);
  }

  function nextServer() {
    if (servers.length > 1) chooseServer((serverIndex + 1) % servers.length);
    else setRetryNonce((n) => n + 1);
  }

  function retryAll() {
    setFailed(new Set());
    chooseServer(0);
  }

  return {
    servers, serverIndex, retryNonce, embedUrl, resolving: resolving || preparing, failed, blocked,
    allFailed, allBlocked, advance, chooseServer, nextServer, retryAll,
    onFrameLoad: () => { loadedRef.current = true; },
  };
}

function GamePlayer({ stream, nowMs, onBack, otherStreams, onSelect, onAddToMultiview }) {
  const frameRef = useRef(null);
  const hideScores = useContext(HideScores);
  const status = getStatus(stream, nowMs);
  const {
    servers, serverIndex, retryNonce, embedUrl, resolving, failed, blocked,
    allFailed, allBlocked, advance, chooseServer, nextServer, retryAll, onFrameLoad,
  } = useServerRotation(stream, status);


  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else frameRef.current?.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className="st-sp-player">
      <div className="st-sp-player-head">
        <button type="button" className="st-btn st-btn--ghost" onClick={onBack}>
          <ArrowLeft size={18} weight="bold" /> All games
        </button>
        <div className="st-sp-player-title">
          {status === 'live' && <span className="st-game-status st-game-status--live"><span className="st-live-dot" aria-hidden="true" />{stream.alwaysLive ? '24/7' : 'LIVE'}</span>}
          <h1>{stream.name}</h1>
          <span className="st-sp-player-league"><CatIcon category={stream.category} /> {stream.league}</span>
        </div>
      </div>

      <div className="st-sp-stage">
      <div className="st-sp-frame" ref={frameRef}>
        {embedUrl ? (
          <iframe
            key={`${stream.id}-${serverIndex}-${retryNonce}`}
            src={embedUrl}
            title={stream.name}
            allowFullScreen
            allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *"
            referrerPolicy="no-referrer-when-downgrade"
            scrolling="no"
            onLoad={onFrameLoad}
            onError={advance}
          />
        ) : (
          <div className="st-sp-frame-empty">
            <span className="st-game-art-icon"><CatIcon category={stream.category} size={44} /></span>
            {status === 'upcoming' ? (
              <>
                <p>Starts {fmtDay(stream.startsAt)} at {fmtTime(stream.startsAt)}{timeUntil(stream.startsAt) ? ` (${timeUntil(stream.startsAt)})` : ''}</p>
                <p className="st-muted">The stream appears here when the game goes live.</p>
              </>
            ) : resolving ? (
              <p>{servers[serverIndex] ? `Connecting to ${providerLabel(servers[serverIndex])}…` : 'Finding the best stream…'}</p>
            ) : allFailed ? (
              <>
                <p>{allBlocked
                  ? 'Every server for this game is blocked on the network you’re on (common on school or work Wi-Fi). It should play on a different network, like mobile data.'
                  : `None of the ${servers.length} servers responded.`}</p>
                <button type="button" className="st-btn st-btn--primary" onClick={retryAll}>Try again</button>
              </>
            ) : (
              <p>Loading stream…</p>
            )}
          </div>
        )}
      </div>

      <LiveScorePanel stream={stream} hideScores={hideScores} />
      </div>

      <div className="st-sp-controls">
        <button type="button" className="st-btn st-btn--ghost" onClick={nextServer} disabled={status === 'upcoming'}>
          <SkipForward size={18} weight="bold" /> {servers.length > 1 ? 'Not working? Next server' : 'Reload stream'}
        </button>
        <button type="button" className="st-btn st-btn--ghost" onClick={toggleFullscreen} disabled={!embedUrl}>
          <ArrowsOut size={18} weight="bold" /> Fullscreen
        </button>
        {onAddToMultiview && status !== 'upcoming' && (
          <button type="button" className="st-btn st-btn--ghost" onClick={() => onAddToMultiview(stream)}>
            <SquaresFour size={18} weight="bold" /> Watch with other games
          </button>
        )}
      </div>

      {servers.length > 0 && status !== 'upcoming' && (
        <div className="st-servers" role="group" aria-label="Servers">
          {servers.map((provider, index) => {
            const down = blocked.has(index) ? 'blocked on your network' : failed.has(index) ? 'not responding' : '';
            return (
              <button
                key={`${provider.id}-${provider.source || ''}-${index}`}
                type="button"
                className={`st-server${index === serverIndex ? ' active' : ''}${down ? ' down' : ''}`}
                aria-pressed={index === serverIndex}
                onClick={() => chooseServer(index)}
                title={down ? `${providerLabel(provider)}: ${down}` : providerLabel(provider)}
              >
                <span className="st-server-no">{index + 1}</span>
                {providerLabel(provider)}
                {down && <span className="sr-only">, {down}</span>}
              </button>
            );
          })}
        </div>
      )}

      {otherStreams.length > 0 && (
        <TitleRow
          className="st-row--wide"
          title="More live & upcoming"
          items={otherStreams}
          renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={onSelect} />}
        />
      )}
    </div>
  );
}

// ── Multiview ──────────────────────────────────────────────────────────

function MultiviewTile({ stream, nowMs, focused, order, autoplay, onFocus, onRemove }) {
  const status = getStatus(stream, nowMs);
  const {
    servers, serverIndex, retryNonce, embedUrl, resolving, blocked, failed,
    allFailed, allBlocked, advance, chooseServer, retryAll, onFrameLoad,
  } = useServerRotation(stream, status);
  // Only the first focused tile may autoplay with sound. The permission is
  // fixed when the iframe loads, so later focus changes just move the tile;
  // sound is switched inside each player (cross-origin — we can't mute it).
  const [allow] = useState(autoplay
    ? 'autoplay *; fullscreen *; picture-in-picture *; encrypted-media *'
    : 'fullscreen *; picture-in-picture *; encrypted-media *');
  const tileRef = useRef(null);
  // This game's servers, opened from the tile's Server button.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !pickerRef.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [pickerOpen]);

  return (
    <div className={`st-mv-tile${focused ? ' focused' : ''}`} style={{ order }} ref={tileRef}>
      <div className="st-mv-frame">
        {embedUrl ? (
          <iframe
            key={`${stream.id}-${serverIndex}-${retryNonce}`}
            src={embedUrl}
            title={stream.name}
            allowFullScreen
            allow={allow}
            referrerPolicy="no-referrer-when-downgrade"
            scrolling="no"
            onLoad={onFrameLoad}
            onError={advance}
          />
        ) : (
          <div className="st-sp-frame-empty">
            <span className="st-game-art-icon"><CatIcon category={stream.category} size={44} /></span>
            {resolving ? <p>Connecting…</p> : allFailed ? (
              <>
                <p>{allBlocked ? 'Blocked on this network.' : 'No server responded.'}</p>
                <button type="button" className="st-btn st-btn--ghost" onClick={retryAll}>Try again</button>
              </>
            ) : <p>Loading…</p>}
          </div>
        )}
      </div>
      <div className="st-mv-bar">
        <p className="st-mv-name" title={stream.name}>
          {status === 'live' && <span className="st-live-dot" aria-hidden="true" />}
          {stream.name}
        </p>
        <div className="st-mv-server" ref={pickerRef}>
          <button
            type="button"
            className="st-mv-server-btn"
            aria-expanded={pickerOpen}
            aria-label={`Server for ${stream.name}: ${servers[serverIndex] ? providerLabel(servers[serverIndex]) : 'none yet'}. Change server`}
            onClick={() => setPickerOpen((open) => !open)}
            disabled={!servers.length}
          >
            <span className="st-server-no">{servers.length ? serverIndex + 1 : '–'}</span>
            Server
            <CaretUp size={12} weight="bold" aria-hidden="true" />
          </button>
          {pickerOpen && (
            <div className="st-mv-server-list" role="group" aria-label={`Servers for ${stream.name}`}>
              {servers.map((provider, index) => {
                const down = blocked.has(index) ? 'blocked on your network' : failed.has(index) ? 'not responding' : '';
                return (
                  <button
                    key={`${provider.id}-${provider.source || ''}-${index}`}
                    type="button"
                    className={`st-server${index === serverIndex ? ' active' : ''}${down ? ' down' : ''}`}
                    aria-pressed={index === serverIndex}
                    onClick={() => { chooseServer(index); setPickerOpen(false); }}
                    title={down ? `${providerLabel(provider)}: ${down}` : providerLabel(provider)}
                  >
                    <span className="st-server-no">{index + 1}</span>
                    {providerLabel(provider)}
                    {down && <span className="sr-only">, {down}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {!focused && (
          <button type="button" className="st-mv-btn" onClick={onFocus} aria-label={`Make ${stream.name} the main game`} title="Make this the main game">
            <CornersOut size={16} weight="bold" />
          </button>
        )}
        <button type="button" className="st-mv-btn" onClick={() => tileRef.current?.requestFullscreen?.().catch(() => {})} aria-label={`Fullscreen ${stream.name}`} title="Fullscreen">
          <ArrowsOut size={16} weight="bold" />
        </button>
        <button type="button" className="st-mv-btn" onClick={onRemove} aria-label={`Remove ${stream.name} from Multiview`} title="Remove">
          <X size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function Multiview({ games, nowMs, onBack, onRemove, onAdd, addable }) {
  const [focusId, setFocusId] = useState(games[0]?.id);
  const [layout, setLayout] = useState('focus');
  const [firstId] = useState(games[0]?.id);
  const focused = games.some((game) => game.id === focusId) ? focusId : games[0]?.id;

  return (
    <div className="st-mv">
      <div className="st-sp-player-head">
        <button type="button" className="st-btn st-btn--ghost" onClick={onBack}>
          <ArrowLeft size={18} weight="bold" /> All games
        </button>
        <div className="st-sp-player-title">
          <h1>Multiview</h1>
          <span className="st-sp-player-league">{games.length} games</span>
        </div>
        <div className="st-mv-layouts" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked={layout === 'focus'} className={layout === 'focus' ? 'active' : ''} onClick={() => setLayout('focus')}>
            <CornersOut size={16} weight="bold" /> Focus
          </button>
          <button type="button" role="radio" aria-checked={layout === 'grid'} className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}>
            <GridFour size={16} weight="bold" /> Grid
          </button>
        </div>
      </div>

      <p className="st-mv-hint">
        Click <CornersOut size={13} weight="bold" aria-label="main game" /> to make a game the big one. Sound plays from the main game first; to switch,
        mute and unmute inside each player — browsers don’t let a site control another site’s player audio.
      </p>

      <div className={`st-mv-grid st-mv-grid--${layout} st-mv-grid--n${games.length}`}>
        {games.map((game, index) => (
          <MultiviewTile
            key={game.id}
            stream={game}
            nowMs={nowMs}
            focused={layout === 'focus' && game.id === focused}
            order={layout === 'focus' && game.id === focused ? -1 : index}
            autoplay={game.id === firstId}
            onFocus={() => { setFocusId(game.id); setLayout('focus'); }}
            onRemove={() => onRemove(game.id)}
          />
        ))}
      </div>

      {games.length < MULTIVIEW_MAX && addable.length > 0 && (
        <TitleRow
          className="st-row--wide"
          title="Add another game"
          items={addable}
          renderItem={(item) => (
            <GameCard stream={item} nowMs={nowMs} onSelect={() => onAdd(item.id)} />
          )}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function Sports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cached] = useState(readScheduleCache);
  const [schedule, setSchedule] = useState(() => cached || []);
  const [loading, setLoading] = useState(!cached);
  const [hideScores, setHideScores] = useState(readHideScores);
  const lastLoad = useRef(0);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');
  const [nowMs, setNowMs] = useState(Date.now());
  const selectedId = searchParams.get('game');
  const multiIds = useMemo(() => (searchParams.get('multi') || '').split(',').filter(Boolean), [searchParams]);
  // Multiview is desktop/tablet only: 2–4 players on a phone screen are
  // too small to watch and too fiddly to control.
  const { isMobile } = useDeviceType();
  const multiviewAllowed = !isMobile;
  const [picks, setPicks] = useState([]);

  const load = useCallback(async () => {
    lastLoad.current = Date.now();
    try {
      // Games appear as soon as two feeds are in; the slowest merges after.
      const next = await loadSportsStreams((partial) => { setSchedule(partial); setLoading(false); });
      writeScheduleCache(next);
      setError('');
    } catch (e) {
      setError(`Could not load sports streams. ${e.message || ''}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    // No polling in a background tab; catch up when it's shown again.
    const poll = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const onVisible = () => {
      if (document.hidden) return;
      setNowMs(Date.now());
      if (Date.now() - lastLoad.current > POLL_MS) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(tick); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  // ESPN scores, clocks and logos for every game ESPN covers.
  const [scores, setScores] = useState(() => new Map());
  useEffect(() => {
    if (!schedule.length) return undefined;
    let cancelled = false;
    const run = () => {
      if (document.hidden) return;
      fetchScoreboards(schedule).then((next) => { if (!cancelled) setScores(next); }).catch(() => {});
    };
    run();
    const timer = setInterval(run, SCORES_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [schedule]);
  const streams = useMemo(() => schedule.map((stream) => withScore(stream, scores.get(stream.id))), [schedule, scores]);

  const toggleHideScores = () => {
    setHideScores((on) => {
      try { localStorage.setItem(HIDE_SCORES_KEY, on ? '0' : '1'); } catch { /* blocked */ }
      return !on;
    });
  };

  // The game being watched survives schedule refreshes: if its id changed (a
  // feed renamed a team) it's found again by matchup, keeping the id the
  // player knows so the stream isn't reloaded. Only a fresh visit to a game
  // that's really gone shows "not in the schedule".
  const watching = useRef(null);
  let selected = selectedId ? streams.find((stream) => stream.id === selectedId) || null : null;
  if (selectedId && !selected && watching.current?.id === selectedId) {
    const again = streams.find((stream) => sameGame(stream, watching.current));
    selected = again ? { ...again, id: selectedId } : watching.current;
  }
  if (selectedId) watching.current = selected;

  const select = useCallback((stream) => {
    setSearchParams({ game: stream.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const togglePick = useCallback((id) => {
    setPicks((current) => (current.includes(id)
      ? current.filter((x) => x !== id)
      : current.length >= MULTIVIEW_MAX ? current : [...current, id]));
  }, []);
  const multi = useMemo(() => (multiviewAllowed ? { picks, toggle: togglePick } : undefined), [multiviewAllowed, picks, togglePick]);

  // A Multiview link opened on a phone (shared, or the window was resized):
  // play the first game on its own instead.
  useEffect(() => {
    if (!multiviewAllowed && multiIds.length) setSearchParams({ game: multiIds[0] }, { replace: true });
    if (!multiviewAllowed) setPicks([]);
  }, [multiviewAllowed, multiIds, setSearchParams]);

  const openMultiview = useCallback((ids) => {
    setSearchParams({ multi: ids.slice(0, MULTIVIEW_MAX).join(',') });
    setPicks([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(streams.map((stream) => stream.category).filter(Boolean))).sort()], [streams]);
  const filtered = useMemo(() => (category === 'All' ? streams : streams.filter((stream) => stream.category === category)), [streams, category]);
  const live = useMemo(() => sortForRow(filtered.filter((stream) => getStatus(stream, nowMs) === 'live' && !stream.alwaysLive), nowMs), [filtered, nowMs]);
  const channels = useMemo(() => filtered.filter((stream) => stream.alwaysLive), [filtered]);
  const leagueRows = useMemo(() => buildLeagueRows(filtered, nowMs), [filtered, nowMs]);

  // Followed teams' games lead the page.
  const [followedTeams, setFollowedTeams] = useState([]);
  useEffect(() => {
    const load = () => listFollowedTeams().then(setFollowedTeams);
    load();
    window.addEventListener(TEAMS_EVENT, load);
    return () => window.removeEventListener(TEAMS_EVENT, load);
  }, []);
  const yourGames = useMemo(() => {
    if (!followedTeams.length) return [];
    return sortForRow(streams.filter((stream) => {
      if (stream.alwaysLive || getStatus(stream, nowMs) === 'replay') return false;
      const teams = stream.teams || splitTeamsFromTitle(stream.name);
      if (!teams) return false;
      return followedTeams.some((team) => teamsMatch(team.team_name, teams.home) || teamsMatch(team.team_name, teams.away));
    }), nowMs);
  }, [streams, followedTeams, nowMs]);
  const soon = useMemo(() => sortForRow(filtered.filter((stream) => getStatus(stream, nowMs) === 'upcoming'
    && stream.startsAt - nowMs / 1000 <= SOON_SEC), nowMs), [filtered, nowMs]);
  // Spotlight: your team on now, else a close game, else a game ESPN says is
  // on, else the best-served live game.
  // It stays on its game while that game is live, so scores updating
  // (and close games changing) never swap it out under you.
  const featuredId = useRef(null);
  const keptFeature = live.find((stream) => stream.id === featuredId.current);
  const featured = keptFeature
    || yourGames.find((stream) => getStatus(stream, nowMs) === 'live')
    || live.find((stream) => stream.score?.close)
    || live.find((stream) => stream.score?.state === 'in')
    || live[0] || soon[0] || leagueRows[0]?.items[0] || null;
  featuredId.current = featured?.id || null;

  // Same for Multiview tiles: a refresh never drops a game that's still on.
  const multiSeen = useRef(new Map());
  const multiGames = multiIds.map((id) => {
    let game = streams.find((stream) => stream.id === id);
    const before = multiSeen.current.get(id);
    if (!game && before) {
      const again = streams.find((stream) => sameGame(stream, before));
      game = again ? { ...again, id } : before;
    }
    if (game) multiSeen.current.set(id, game);
    return game;
  }).filter(Boolean);
  if (multiviewAllowed && multiIds.length && multiGames.length) {
    const addable = sortForRow(streams.filter((stream) => !multiIds.includes(stream.id) && getStatus(stream, nowMs) === 'live'), nowMs).slice(0, 24);
    return (
      <HideScores.Provider value={hideScores}>
      <div className="app-layout">
        <Navbar />
        <main className="page-content st-sports">
          <Multiview
            games={multiGames}
            nowMs={nowMs}
            onBack={() => setSearchParams({})}
            onRemove={(id) => {
              const rest = multiIds.filter((x) => x !== id);
              if (rest.length === 1) setSearchParams({ game: rest[0] });
              else setSearchParams(rest.length ? { multi: rest.join(',') } : {});
            }}
            onAdd={(id) => setSearchParams({ multi: [...multiIds, id].slice(0, MULTIVIEW_MAX).join(',') })}
            addable={addable}
          />
        </main>
      </div>
      </HideScores.Provider>
    );
  }

  if (selected) {
    const others = sortForRow(streams.filter((stream) => stream.id !== selected.id && getStatus(stream, nowMs) !== 'replay'), nowMs).slice(0, 24);
    return (
      <HideScores.Provider value={hideScores}>
      <div className="app-layout">
        <Navbar />
        <main className="page-content st-sports">
          <GamePlayer
            stream={selected}
            nowMs={nowMs}
            onBack={() => setSearchParams({})}
            otherStreams={others}
            onSelect={select}
            onAddToMultiview={multiviewAllowed ? () => { setPicks([selected.id]); setSearchParams({}); } : undefined}
          />
        </main>
      </div>
      </HideScores.Provider>
    );
  }

  return (
    <HideScores.Provider value={hideScores}>
    <div className="app-layout">
      <Navbar />
      <main className="page-content st-sports">
        {selectedId && !loading && (
          <div className="st-coldstart">
            <p>That game isn't in the schedule anymore — it may have ended.</p>
            <button type="button" className="st-btn st-btn--ghost" onClick={() => setSearchParams({})}>See all games</button>
          </div>
        )}

        {featured && (
          <section className="st-sp-feature">
            <div className="st-sp-feature-art">
              {featured.poster && !(featured.logos?.home && featured.logos?.away) ? (
                <>
                  {/* Provider thumbnails are small: blurred copy as the
                      backdrop, the real image at a size it stays sharp. */}
                  <img className="st-sp-feature-blur" src={featured.poster} alt="" aria-hidden="true" referrerPolicy="no-referrer" />
                  <img className="st-sp-feature-poster" src={featured.poster} alt="" referrerPolicy="no-referrer" />
                </>
              ) : (
                <GameArt stream={featured} />
              )}
            </div>
            <div className="st-sp-feature-scrim" aria-hidden="true" />
            <div className="st-sp-feature-content">
              <span className={`st-game-status st-game-status--${getStatus(featured, nowMs)}`}>
                {getStatus(featured, nowMs) === 'live' && <span className="st-live-dot" aria-hidden="true" />}
                {statusLabel(featured, nowMs)}
              </span>
              <h1 className="st-hero-title">{featured.name}</h1>
              {featured.score && featured.score.state !== 'pre' && (
                <p className="st-sp-feature-score">
                  {!hideScores && teamsInNameOrder(featured, featured.score).map((team) => (
                    <span key={team.short || team.name}>{team.short} <b>{team.score}</b></span>
                  ))}
                  <span className="st-sp-feature-clock">{featured.score.detail}</span>
                  {featured.score.close && getStatus(featured, nowMs) === 'live' && <span className="st-game-close st-game-close--inline">Close game</span>}
                </p>
              )}
              <p className="st-sp-feature-meta">
                <CatIcon category={featured.category} /> {featured.league}
                {featured.score?.broadcast && <> · {featured.score.broadcast}</>}
                {getStatus(featured, nowMs) === 'upcoming' && featured.startsAt && <> · {fmtDay(featured.startsAt)} {fmtTime(featured.startsAt)}</>}
              </p>
              <button type="button" className="st-btn st-btn--primary" onClick={() => select(featured)}>
                <Play size={18} weight="fill" /> {getStatus(featured, nowMs) === 'live' ? 'Watch live' : 'View game'}
              </button>
            </div>
          </section>
        )}

        <GenreScrollBar ariaLabel="Sports">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`genre-chip${category === cat ? ' active' : ''}`}
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat !== 'All' && <CatIcon category={cat} />}{cat}
            </button>
          ))}
        </GenreScrollBar>

        <div className="st-sp-tools">
          <button type="button" className="st-btn st-btn--ghost st-btn--small" aria-pressed={hideScores} onClick={toggleHideScores}>
            {hideScores ? <EyeSlash size={16} weight="bold" /> : <Eye size={16} weight="bold" />}
            {hideScores ? 'Scores hidden' : 'Hide scores'}
          </button>
        </div>

        {loading && (
          <div className="st-rows">
            <TitleRow className="st-row--wide" title="Live Now" loading />
            <TitleRow className="st-row--wide" title="Loading schedule" loading />
          </div>
        )}

        {error && !loading && (
          <div className="st-coldstart">
            <p>{error}</p>
            <button type="button" className="st-btn st-btn--ghost" onClick={load}>Retry</button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="st-coldstart"><p>No games in this sport right now.</p></div>
        )}

        {!loading && (
          <div className="st-rows">
            {yourGames.length > 0 && (
              <TitleRow
                className="st-row--wide"
                title="Your teams"
                subtitle={followedTeams.map((team) => team.team_abbr || team.team_name).join(' · ')}
                items={yourGames}
                eager
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} multi={multi} />}
              />
            )}
            {live.length > 0 && (
              <TitleRow
                className="st-row--wide"
                title={`Live Now · ${live.length}`}
                items={live}
                eager
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} multi={multi} />}
              />
            )}
            <FantasyBoard streams={streams} />
            {soon.length > 0 && (
              <TitleRow
                className="st-row--wide"
                title="Starting soon"
                subtitle="In the next 3 hours"
                items={soon}
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} multi={multi} />}
              />
            )}
            {leagueRows.map((row) => (
              <TitleRow
                key={row.league}
                className="st-row--wide"
                title={row.league}
                subtitle={row.liveCount ? `${row.liveCount} live now` : `Next: ${fmtDay(row.items[0].startsAt)} ${fmtTime(row.items[0].startsAt)}`}
                items={row.items}
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} multi={multi} />}
              />
            ))}
            {channels.length > 0 && (
              <TitleRow
                className="st-row--wide"
                title="24/7 Sports Channels"
                items={channels}
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} />}
              />
            )}
          </div>
        )}
        {multiviewAllowed && picks.length > 0 && (
          <div className="st-mv-tray" role="region" aria-label="Multiview selection">
            <div className="st-mv-tray-picks">
              {picks.map((id) => {
                const game = streams.find((stream) => stream.id === id);
                return game ? (
                  <span key={id} className="st-mv-chip">
                    {game.name}
                    <button type="button" onClick={() => togglePick(id)} aria-label={`Remove ${game.name}`}><X size={12} weight="bold" /></button>
                  </span>
                ) : null;
              })}
              {picks.length < 2 && <span className="st-mv-tray-note">Pick {2 - picks.length} more game{picks.length === 1 ? '' : 's'} (up to {MULTIVIEW_MAX})</span>}
            </div>
            <div className="st-mv-tray-actions">
              <button type="button" className="st-btn st-btn--ghost" onClick={() => setPicks([])}>Clear</button>
              <button type="button" className="st-btn st-btn--primary" disabled={picks.length < 2} onClick={() => openMultiview(picks)}>
                <SquaresFour size={18} weight="bold" /> Watch {picks.length > 1 ? picks.length : ''} together
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
    </HideScores.Provider>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowsOut, CaretDown, Check, CornersOut, GridFour, Play, SkipForward, SquaresFour, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import TitleRow from '../components/TitleRow';
import LiveScorePanel from '../components/LiveScorePanel';
import { fetchSportsStreams, resolveProviderEmbedUrl, providerLabel } from '../utils/sportsProviders';
import { hostOf, isHostReachable, reachabilityMap } from '../utils/hostReachability';

const POLL_MS = 60_000;
// How long a server's iframe gets to fire `load` before we silently move to
// the next one. Only catches network-level failures — a cross-origin player
// that loads but shows a dead stream looks identical from outside, which is
// what the "Next server" button is for.
const LOAD_TIMEOUT_MS = 8_000;
const MULTIVIEW_MAX = 4;

// League rows, in the order a US-centric sports home would show them; any
// league not listed follows, biggest first.
const LEAGUE_ORDER = [
  'NFL', 'College Football', 'NBA', 'WNBA', 'NHL', 'MLB', 'MLS', 'Premier League', 'LaLiga', 'Champions League',
  'Serie A', 'Bundesliga', 'Ligue 1', 'Liga MX', 'Formula 1', 'UFC', 'Wrestling', 'Combat Sports',
];

const CAT_ICONS = {
  'American Football': '🏈', 'Australian Football': '🏉', Basketball: '🏀', Soccer: '⚽',
  Baseball: '⚾', Hockey: '🏒', 'Combat Sports': '🥊', Tennis: '🎾', Golf: '⛳', Racing: '🏎️',
  Rugby: '🏉', Cricket: '🏏', Volleyball: '🏐', Billiards: '🎱', Darts: '🎯',
};

function catIcon(category) {
  return CAT_ICONS[category] || '🏆';
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
  if (stream.startsAt <= nowSec && stream.endsAt >= nowSec) return 'live';
  if (stream.startsAt > nowSec) return 'upcoming';
  return 'replay';
}

function statusLabel(stream, nowMs) {
  const status = getStatus(stream, nowMs);
  if (status === 'live') return stream.alwaysLive ? '24/7' : 'LIVE';
  if (status === 'replay') return 'REPLAY';
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
        <span className="st-game-art-icon">{catIcon(stream.category)}</span>
      )}
    </div>
  );
}

function GameCard({ stream, nowMs, onSelect, active = false, multi }) {
  const status = getStatus(stream, nowMs);
  const countdown = status === 'upcoming' ? timeUntil(stream.startsAt) : null;
  const picked = multi?.picks.includes(stream.id);
  const card = (
    <button
      type="button"
      className={`st-game${active ? ' active' : ''}`}
      onClick={() => onSelect(stream)}
      aria-label={`${stream.name}, ${statusLabel(stream, nowMs)}, ${stream.providers.length} server${stream.providers.length === 1 ? '' : 's'}`}
    >
      <div className="st-game-thumb">
        <GameArt stream={stream} />
        <span className={`st-game-status st-game-status--${status}`}>
          {status === 'live' && <span className="st-live-dot" aria-hidden="true" />}
          {statusLabel(stream, nowMs)}
        </span>
        {countdown && <span className="st-game-countdown">{countdown}</span>}
        <span className="st-game-play" aria-hidden="true"><Play size={20} weight="fill" /></span>
      </div>
      <p className="st-game-title">{stream.name}</p>
      <p className="st-game-meta">
        {catIcon(stream.category)} {stream.league}
        <span aria-hidden="true"> · </span>
        {stream.providers.length} server{stream.providers.length === 1 ? '' : 's'}
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
  const rank = { live: 0, upcoming: 1, replay: 2 };
  return [...streams].sort((a, b) => {
    const statusDiff = rank[getStatus(a, nowMs)] - rank[getStatus(b, nowMs)];
    if (statusDiff) return statusDiff;
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
  const loadedRef = useRef(false);
  const servers = stream.providers;

  useEffect(() => {
    setServerIndex(0);
    setFailed(new Set());
    setBlocked(new Set());
    setRetryNonce(0);
    let cancelled = false;
    // Probe the hosts we already know (PPV / StreamFree embed URLs) and
    // start on the first server this network can actually reach.
    reachabilityMap(stream.providers.map((provider) => hostOf(provider.embedUrl))).then((reach) => {
      if (cancelled) return;
      const blockedNow = new Set(stream.providers
        .map((provider, index) => (provider.embedUrl && reach[hostOf(provider.embedUrl)] === false ? index : -1))
        .filter((index) => index >= 0));
      setBlocked(blockedNow);
      const firstOk = stream.providers.findIndex((_, index) => !blockedNow.has(index));
      if (firstOk > 0) setServerIndex(firstOk);
    });
    return () => { cancelled = true; };
  }, [stream.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance past a server that failed, unless every server has.
  const advance = useCallback(() => {
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
  }, [serverIndex, servers.length, failed, blocked]);

  useEffect(() => {
    const provider = servers[serverIndex];
    if (!provider || status === 'upcoming') { setEmbedUrl(null); return undefined; }
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
  }, [stream.id, serverIndex, retryNonce, status === 'upcoming']);

  useEffect(() => {
    loadedRef.current = false;
    if (!embedUrl) return undefined;
    const timer = setTimeout(() => {
      if (!loadedRef.current) advance();
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [embedUrl, advance]);

  const unavailable = new Set([...failed, ...blocked]);
  const allFailed = unavailable.size >= servers.length;
  const allBlocked = blocked.size >= servers.length;

  function chooseServer(index) {
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
    servers, serverIndex, retryNonce, embedUrl, resolving, failed, blocked,
    allFailed, allBlocked, advance, chooseServer, nextServer, retryAll,
    onFrameLoad: () => { loadedRef.current = true; },
  };
}

function GamePlayer({ stream, nowMs, onBack, otherStreams, onSelect, onAddToMultiview }) {
  const frameRef = useRef(null);
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
          <span className="st-sp-player-league">{catIcon(stream.category)} {stream.league}</span>
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
            <span className="st-game-art-icon">{catIcon(stream.category)}</span>
            {status === 'upcoming' ? (
              <>
                <p>Starts {fmtDay(stream.startsAt)} at {fmtTime(stream.startsAt)}{timeUntil(stream.startsAt) ? ` (${timeUntil(stream.startsAt)})` : ''}</p>
                <p className="st-muted">The stream appears here when the game goes live.</p>
              </>
            ) : resolving ? (
              <p>Connecting to {providerLabel(servers[serverIndex])}…</p>
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

      <LiveScorePanel stream={stream} />
      </div>

      <div className="st-sp-controls">
        <label className="st-select" htmlFor="st-server-select">
          <span className="st-select-label">Server</span>
          <select
            id="st-server-select"
            value={serverIndex}
            onChange={(event) => chooseServer(Number(event.target.value))}
            disabled={status === 'upcoming'}
          >
            {servers.map((provider, index) => (
              <option key={`${provider.id}-${provider.source || ''}-${index}`} value={index}>
                {`Server ${index + 1} — ${providerLabel(provider)}${blocked.has(index) ? ' (blocked on your network)' : failed.has(index) ? ' (not responding)' : ''}`}
              </option>
            ))}
          </select>
          <CaretDown size={16} weight="bold" className="st-select-caret" aria-hidden="true" />
        </label>
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
            <span className="st-game-art-icon">{catIcon(stream.category)}</span>
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
        <label className="st-mv-server">
          <span className="sr-only">Server for {stream.name}</span>
          <select value={serverIndex} onChange={(event) => chooseServer(Number(event.target.value))}>
            {servers.map((provider, index) => (
              <option key={`${provider.id}-${provider.source || ''}-${index}`} value={index}>
                {`S${index + 1} · ${providerLabel(provider)}${blocked.has(index) ? ' (blocked)' : failed.has(index) ? ' (down)' : ''}`}
              </option>
            ))}
          </select>
        </label>
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
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');
  const [nowMs, setNowMs] = useState(Date.now());
  const selectedId = searchParams.get('game');
  const multiIds = useMemo(() => (searchParams.get('multi') || '').split(',').filter(Boolean), [searchParams]);
  const [picks, setPicks] = useState([]);

  const load = useCallback(async () => {
    try {
      const next = await fetchSportsStreams();
      setStreams(next);
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
    const poll = setInterval(load, POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load]);

  const selected = selectedId ? streams.find((stream) => stream.id === selectedId) || null : null;

  const select = useCallback((stream) => {
    setSearchParams({ game: stream.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const togglePick = useCallback((id) => {
    setPicks((current) => (current.includes(id)
      ? current.filter((x) => x !== id)
      : current.length >= MULTIVIEW_MAX ? current : [...current, id]));
  }, []);
  const multi = useMemo(() => ({ picks, toggle: togglePick }), [picks, togglePick]);

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
  const featured = live[0] || leagueRows[0]?.items[0] || null;

  const multiGames = multiIds.map((id) => streams.find((stream) => stream.id === id)).filter(Boolean);
  if (multiIds.length && multiGames.length) {
    const addable = sortForRow(streams.filter((stream) => !multiIds.includes(stream.id) && getStatus(stream, nowMs) === 'live'), nowMs).slice(0, 24);
    return (
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
    );
  }

  if (selected) {
    const others = sortForRow(streams.filter((stream) => stream.id !== selected.id && getStatus(stream, nowMs) !== 'replay'), nowMs).slice(0, 24);
    return (
      <div className="app-layout">
        <Navbar />
        <main className="page-content st-sports">
          <GamePlayer
            stream={selected}
            nowMs={nowMs}
            onBack={() => setSearchParams({})}
            otherStreams={others}
            onSelect={select}
            onAddToMultiview={() => { setPicks([selected.id]); setSearchParams({}); }}
          />
        </main>
      </div>
    );
  }

  return (
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
              <p className="st-sp-feature-meta">{catIcon(featured.category)} {featured.league} · {featured.providers.length} server{featured.providers.length === 1 ? '' : 's'}</p>
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
              onClick={() => setCategory(cat)}
            >
              {cat !== 'All' ? `${catIcon(cat)} ` : ''}{cat}
            </button>
          ))}
        </GenreScrollBar>

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
            {live.length > 0 && (
              <TitleRow
                className="st-row--wide"
                title={`Live Now · ${live.length}`}
                items={live}
                eager
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
        {picks.length > 0 && (
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
  );
}

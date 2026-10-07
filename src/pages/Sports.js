import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowsOut, CaretDown, Play, SkipForward } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import TitleRow from '../components/TitleRow';
import { fetchSportsStreams, resolveProviderEmbedUrl, providerLabel } from '../utils/sportsProviders';

const POLL_MS = 60_000;
// How long a server's iframe gets to fire `load` before we silently move to
// the next one. Only catches network-level failures — a cross-origin player
// that loads but shows a dead stream looks identical from outside, which is
// what the "Next server" button is for.
const LOAD_TIMEOUT_MS = 8_000;

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

  if (stream.poster && !posterFailed) {
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

function GameCard({ stream, nowMs, onSelect, active = false }) {
  const status = getStatus(stream, nowMs);
  const countdown = status === 'upcoming' ? timeUntil(stream.startsAt) : null;
  return (
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

function GamePlayer({ stream, nowMs, onBack, otherStreams, onSelect }) {
  const [serverIndex, setServerIndex] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [embedUrl, setEmbedUrl] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(new Set());
  const loadedRef = useRef(false);
  const frameRef = useRef(null);
  const servers = stream.providers;
  const status = getStatus(stream, nowMs);

  useEffect(() => {
    setServerIndex(0);
    setFailed(new Set());
    setRetryNonce(0);
  }, [stream.id]);

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
        if (!failed.has(candidate) && candidate !== index) return candidate;
      }
      return index;
    });
  }, [serverIndex, servers.length, failed]);

  useEffect(() => {
    const provider = servers[serverIndex];
    if (!provider || status === 'upcoming') { setEmbedUrl(null); return undefined; }
    let cancelled = false;
    setResolving(true);
    setEmbedUrl(null);
    resolveProviderEmbedUrl(provider).then((url) => {
      if (cancelled) return;
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

  const allFailed = failed.size >= servers.length;

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

      <div className="st-sp-frame" ref={frameRef}>
        {embedUrl ? (
          <iframe
            key={`${stream.id}-${serverIndex}-${retryNonce}`}
            src={embedUrl}
            title={stream.name}
            allowFullScreen
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            referrerPolicy="no-referrer-when-downgrade"
            scrolling="no"
            onLoad={() => { loadedRef.current = true; }}
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
                <p>None of the {servers.length} servers responded.</p>
                <button type="button" className="st-btn st-btn--primary" onClick={() => { setFailed(new Set()); chooseServer(0); }}>Try again</button>
              </>
            ) : (
              <p>Loading stream…</p>
            )}
          </div>
        )}
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
                {`Server ${index + 1} — ${providerLabel(provider)}${failed.has(index) ? ' (not responding)' : ''}`}
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

// ── Page ───────────────────────────────────────────────────────────────

export default function Sports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');
  const [nowMs, setNowMs] = useState(Date.now());
  const selectedId = searchParams.get('game');

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

  const categories = useMemo(() => ['All', ...Array.from(new Set(streams.map((stream) => stream.category).filter(Boolean))).sort()], [streams]);
  const filtered = useMemo(() => (category === 'All' ? streams : streams.filter((stream) => stream.category === category)), [streams, category]);
  const live = useMemo(() => sortForRow(filtered.filter((stream) => getStatus(stream, nowMs) === 'live' && !stream.alwaysLive), nowMs), [filtered, nowMs]);
  const channels = useMemo(() => filtered.filter((stream) => stream.alwaysLive), [filtered]);
  const leagueRows = useMemo(() => buildLeagueRows(filtered, nowMs), [filtered, nowMs]);
  const featured = live[0] || leagueRows[0]?.items[0] || null;

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
            <div className="st-sp-feature-art"><GameArt stream={featured} /></div>
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
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} />}
              />
            )}
            {leagueRows.map((row) => (
              <TitleRow
                key={row.league}
                className="st-row--wide"
                title={row.league}
                subtitle={row.liveCount ? `${row.liveCount} live now` : `Next: ${fmtDay(row.items[0].startsAt)} ${fmtTime(row.items[0].startsAt)}`}
                items={row.items}
                renderItem={(item) => <GameCard stream={item} nowMs={nowMs} onSelect={select} />}
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
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, EyeSlash, Play, SquaresFour, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import TitleRow from '../components/TitleRow';
import FantasyBoard from '../components/FantasyBoard';
import useDeviceType from '../hooks/useDeviceType';
import { loadSportsStreams, sameGame, splitTeamsFromTitle } from '../utils/sportsProviders';
import { fetchScoreboards } from '../utils/liveScores';
import { followedTeamPlays, listFollowedTeams, TEAMS_EVENT } from '../utils/teams';
import {
  MULTIVIEW_MAX,
  teamsInNameOrder,
  withScore,
  fmtTime,
  fmtDay,
  getStatus,
  statusLabel,
} from '../components/sports/gameInfo';
import { sortForRow, buildLeagueRows } from '../components/sports/rows';
import { HIDE_SCORES_KEY, HideScores, readHideScores } from '../components/sports/HideScores';
import { CatIcon } from '../components/sports/CatIcon';
import { GameArt, GameCard } from '../components/sports/GameCard';
import { GamePlayer } from '../components/sports/GamePlayer';
import { Multiview } from '../components/sports/Multiview';

const POLL_MS = 60_000;
// The last schedule, shown at once on the next visit while the feeds load.
const SCHEDULE_CACHE_KEY = 'binge.sports.schedule.v1';
const SCHEDULE_CACHE_MAX_AGE_MS = 20 * 60_000;
// "Starting soon" row: games beginning within this many seconds.
const SOON_SEC = 3 * 3600;
const SCORES_POLL_MS = 30_000;

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
      if (!teams && !stream.score?.teams?.length) return false;
      return followedTeamPlays(followedTeams, stream, teams);
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

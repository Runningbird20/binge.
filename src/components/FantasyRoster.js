import LoadingBar from './LoadingBar';
import ThemedSelect from './ThemedSelect';
// "Your fantasy teams" under the live score: every ESPN Fantasy team this
// profile tracks for the sport being watched (utils/fantasy.js), each with
// this week's matchup and the players who are in this game, points updating
// while it's live. Adding a team uses the same form as the Sports page board.
import { useEffect, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { FantasyTeamForm } from './FantasyBoard';
import {
  fantasyGameFor, fetchFantasyLeague, FANTASY_EVENT, formatPoints, GAME_LABELS, isBenchSlot, loadFantasy, playingInGame,
  setFantasyTeam, slotName, summarizeTeam,
} from '../utils/fantasy';

const LIVE_POLL_MS = 30_000;

function PlayerRow({ game, player }) {
  const bench = isBenchSlot(game, player.slotId);
  return (
    <li className={`st-fr-player in-game${bench ? ' bench' : ''}`}>
      <span className="st-fr-slot">{slotName(game, player.slotId)}</span>
      <span className="st-fr-name">
        <strong>{player.name}</strong>
        <span>{[player.proTeam, player.injury && player.injury.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="st-fr-points">
        {player.points != null ? formatPoints(player.points) : player.projected != null ? <span className="proj">{formatPoints(player.projected)} proj</span> : ''}
      </span>
    </li>
  );
}

function TrackedTeam({ entry, gameTeams, live, onNeedsLogin }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function load(fresh) {
      try {
        const next = await fetchFantasyLeague(entry.game, entry, { fresh });
        if (!cancelled) { setData(next); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
      if (!cancelled && live) timer = setTimeout(() => load(true), LIVE_POLL_MS);
    }
    load(false);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [entry.game, entry.leagueId, entry.teamId, live]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="st-fr-team">
        <p className="st-fr-note" role="alert">{error.message}</p>
        {error.needsCredentials && <button type="button" className="st-fr-edit" onClick={onNeedsLogin}>Add ESPN login</button>}
      </div>
    );
  }
  if (!data) return <LoadingBar compact label="Loading roster…" />;
  const summary = summarizeTeam(entry.game, data, entry);
  if (!summary) {
    return (
      <label className="st-fr-field">
        <span>Which team is yours in {data.leagueName || 'this league'}?</span>
        <ThemedSelect aria-label="Choose your fantasy team" value="" onChange={(e) => setFantasyTeam(entry, Number(e.target.value)).catch(() => {})}
            options={[{ value: '', label: 'Choose your team', disabled: true }, ...data.teams.map((team) => ({ value: team.id, label: `${team.name}${team.owner ? ` (${team.owner})` : ''}` }))]} />
      </label>
    );
  }

  const { team, opponent, roster, points, opponentPoints } = summary;
  const inGame = roster.filter((player) => playingInGame(player, gameTeams));
  return (
    <div className="st-fr-team">
      <div className="st-fr-head">
        {team.logo && <img className="st-fr-logo" src={team.logo} alt="" referrerPolicy="no-referrer" />}
        <h4>{team.name}</h4>
        <strong className="st-fr-total">
          {formatPoints(points)}
          {opponentPoints != null && <span className="st-fr-opp"> – {formatPoints(opponentPoints)} {opponent?.abbrev || ''}</span>}
        </strong>
      </div>
      {data.leagueName && <p className="st-fr-league">{data.leagueName}</p>}
      {inGame.length > 0 ? (
        <ul className="st-fr-list">{inGame.map((player) => <PlayerRow key={player.id} game={entry.game} player={player} />)}</ul>
      ) : (
        <p className="st-fr-sub">None of this team&rsquo;s players are in this game.</p>
      )}
    </div>
  );
}

export default function FantasyRoster({ espnPath, gameTeams, live }) {
  const game = fantasyGameFor(espnPath);
  const [saved, setSaved] = useState(undefined); // undefined = loading
  const [adding, setAdding] = useState(false);
  const [askLogin, setAskLogin] = useState(false);

  useEffect(() => {
    if (!game) return undefined;
    let cancelled = false;
    const load = () => loadFantasy().then((next) => { if (!cancelled) setSaved(next); });
    load();
    window.addEventListener(FANTASY_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(FANTASY_EVENT, load); };
  }, [game]);

  if (!game) return null;
  const sport = GAME_LABELS[game].toLowerCase();
  const teams = (saved?.teams || []).filter((entry) => entry.game === game);

  let body;
  if (adding) {
    body = <FantasyTeamForm presetGame={game} login={saved?.login} signedIn={saved?.signedIn} askLogin={askLogin} onDone={() => { setAdding(false); setAskLogin(false); }} />;
  } else if (saved === undefined) {
    body = <LoadingBar compact label="Loading roster…" />;
  } else if (!teams.length) {
    body = <p className="st-fr-note">Add your ESPN {sport} teams to see your players during {sport} games.</p>;
  } else {
    body = teams.map((entry) => (
      <TrackedTeam key={entry.key} entry={entry} gameTeams={gameTeams} live={live} onNeedsLogin={() => { setAskLogin(true); setAdding(true); }} />
    ));
  }

  return (
    <section className="st-fr" aria-label={`Your fantasy ${sport} teams`}>
      {body}
      {!adding && saved !== undefined && (
        <button type="button" className="st-btn st-btn--ghost st-btn--small st-fr-add" onClick={() => { setAskLogin(false); setAdding(true); }}>
          <Plus size={14} weight="bold" /> {teams.length ? `Add another ${sport} team` : `Add an ESPN ${sport} team`}
        </button>
      )}
    </section>
  );
}

// "Your fantasy team" under the live score: the ESPN Fantasy roster for the
// sport being watched (utils/fantasy.js), with the players in this game first
// and their points updating while it's live.
import { useEffect, useMemo, useState } from 'react';
import {
  fantasyGameFor, fetchFantasyLeague, FANTASY_EVENT, GAME_LABELS, getFantasyLeague, isBenchSlot,
  parseLeagueInput, pickMyTeam, playingInGame, removeFantasyLeague, saveFantasyLeague, slotName, sortRoster,
} from '../utils/fantasy';

const LIVE_POLL_MS = 30_000;

function formatPoints(value) {
  if (value == null) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function LeagueForm({ game, league, onDone }) {
  const [leagueText, setLeagueText] = useState(league?.leagueId || '');
  const [s2, setS2] = useState(league?.s2 || '');
  const [swid, setSwid] = useState(league?.swid || '');
  const [privateOpen, setPrivateOpen] = useState(Boolean(league?.s2));
  const [error, setError] = useState('');

  function submit(event) {
    event.preventDefault();
    const parsed = parseLeagueInput(leagueText);
    if (!parsed) { setError('Paste your league’s ESPN link or its league id.'); return; }
    if (Boolean(s2.trim()) !== Boolean(swid.trim())) { setError('Private leagues need both espn_s2 and SWID.'); return; }
    saveFantasyLeague(game, {
      leagueId: parsed.leagueId,
      teamId: parsed.teamId ?? (parsed.leagueId === league?.leagueId ? league?.teamId : undefined),
      s2: s2.trim() || undefined,
      swid: swid.trim() || undefined,
    });
    onDone();
  }

  return (
    <form className="st-fr-form" onSubmit={submit}>
      <label className="st-fr-field">
        <span>ESPN league link or id</span>
        <input value={leagueText} onChange={(e) => { setLeagueText(e.target.value); setError(''); }} placeholder="https://fantasy.espn.com/…?leagueId=…" autoComplete="off" spellCheck="false" />
      </label>
      <details className="st-fr-private" open={privateOpen} onToggle={(e) => setPrivateOpen(e.currentTarget.open)}>
        <summary>Private league</summary>
        <p>
          On espn.com, signed in, open your browser&rsquo;s developer tools &rarr; Application &rarr; Cookies &rarr; espn.com and copy
          {' '}<code>espn_s2</code> and <code>SWID</code>. They act like your ESPN password, so they stay on this device and are only sent to ESPN.
        </p>
        <label className="st-fr-field">
          <span>espn_s2</span>
          <input value={s2} onChange={(e) => { setS2(e.target.value); setError(''); }} autoComplete="off" spellCheck="false" />
        </label>
        <label className="st-fr-field">
          <span>SWID</span>
          <input value={swid} onChange={(e) => { setSwid(e.target.value); setError(''); }} placeholder="{XXXXXXXX-XXXX-…}" autoComplete="off" spellCheck="false" />
        </label>
      </details>
      {error && <p className="st-fr-error" role="alert">{error}</p>}
      <div className="st-fr-actions">
        <button type="submit" className="st-btn st-btn--primary">Save league</button>
        <button type="button" className="st-btn st-btn--ghost" onClick={onDone}>Cancel</button>
        {league && (
          <button type="button" className="st-btn st-btn--ghost st-fr-remove" onClick={() => { removeFantasyLeague(game); onDone(); }}>Remove</button>
        )}
      </div>
    </form>
  );
}

function PlayerRow({ game, player, inGame }) {
  const bench = isBenchSlot(game, player.slotId);
  return (
    <li className={`st-fr-player${inGame ? ' in-game' : ''}${bench ? ' bench' : ''}`}>
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

export default function FantasyRoster({ espnPath, gameTeams, live }) {
  const game = fantasyGameFor(espnPath);
  const [league, setLeague] = useState(() => (game ? getFantasyLeague(game) : null));
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!game) return undefined;
    const load = () => setLeague(getFantasyLeague(game));
    load();
    window.addEventListener(FANTASY_EVENT, load);
    return () => window.removeEventListener(FANTASY_EVENT, load);
  }, [game]);

  useEffect(() => {
    if (!game || !league?.leagueId) { setData(null); return undefined; }
    let cancelled = false;
    let timer = null;
    setError('');
    async function load(fresh) {
      try {
        const next = await fetchFantasyLeague(game, league, { fresh });
        if (cancelled) return;
        setData(next);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
      if (!cancelled && live) timer = setTimeout(() => load(true), LIVE_POLL_MS);
    }
    load(false);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [game, league, live]);

  const myTeam = pickMyTeam(data, league);
  const roster = useMemo(() => (myTeam ? sortRoster(game, myTeam.roster) : []), [game, myTeam]);
  if (!game) return null;

  const sport = GAME_LABELS[game].toLowerCase();
  const inGame = roster.filter((player) => playingInGame(player, gameTeams));
  const others = roster.filter((player) => !inGame.includes(player));
  const starters = roster.filter((player) => !isBenchSlot(game, player.slotId));
  const total = starters.reduce((sum, player) => sum + (player.points || 0), 0);

  let body;
  if (editing) {
    body = <LeagueForm game={game} league={league} onDone={() => setEditing(false)} />;
  } else if (!league) {
    body = (
      <>
        <p className="st-fr-note">Add your ESPN {sport} league to see your roster during {sport} games.</p>
        <button type="button" className="st-btn st-btn--ghost" onClick={() => setEditing(true)}>Add ESPN league</button>
      </>
    );
  } else if (error) {
    body = (
      <>
        <p className="st-fr-note" role="alert">{error}</p>
        <button type="button" className="st-btn st-btn--ghost" onClick={() => setEditing(true)}>Edit league</button>
      </>
    );
  } else if (!data) {
    body = <div className="st-fr-skel skeleton-block" aria-hidden="true" />;
  } else if (!myTeam) {
    body = (
      <label className="st-fr-field">
        <span>Which team is yours?</span>
        <select value="" onChange={(e) => saveFantasyLeague(game, { teamId: Number(e.target.value) })}>
          <option value="" disabled>Choose your team</option>
          {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.owner ? ` (${team.owner})` : ''}</option>)}
        </select>
      </label>
    );
  } else {
    body = (
      <>
        {inGame.length > 0 ? (
          <>
            <p className="st-fr-sub">{inGame.length === 1 ? '1 of your players is in this game' : `${inGame.length} of your players are in this game`}</p>
            <ul className="st-fr-list">{inGame.map((player) => <PlayerRow key={player.id} game={game} player={player} inGame />)}</ul>
          </>
        ) : (
          <p className="st-fr-sub">None of your players are in this game.</p>
        )}
        <details className="st-fr-rest">
          <summary>Full roster</summary>
          <ul className="st-fr-list">{others.map((player) => <PlayerRow key={player.id} game={game} player={player} />)}</ul>
        </details>
      </>
    );
  }

  return (
    <section className="st-fr" aria-label={`Your fantasy ${sport} team`}>
      <div className="st-fr-head">
        <h4>{myTeam && !editing ? myTeam.name : `Your fantasy ${sport} team`}</h4>
        {myTeam && !editing && <strong className="st-fr-total">{formatPoints(Math.round(total * 10) / 10)} pts</strong>}
        {league && !editing && (
          <button type="button" className="st-fr-edit" onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>
      {data?.leagueName && myTeam && !editing && <p className="st-fr-league">{data.leagueName}</p>}
      {body}
    </section>
  );
}

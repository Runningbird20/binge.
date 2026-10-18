// "Your fantasy team" under the live score: the ESPN Fantasy roster for the
// sport being watched (utils/fantasy.js), with the players in this game first
// and their points updating while it's live.
import { useEffect, useMemo, useState } from 'react';
import {
  fantasyGameFor, fetchFantasyLeague, FANTASY_EVENT, forgetEspnLogin, GAME_LABELS, isBenchSlot, loadFantasy,
  parseLeagueInput, pickMyTeam, playingInGame, removeFantasyLeague, saveEspnLogin, saveFantasyLeague, slotName, sortRoster,
} from '../utils/fantasy';

const LIVE_POLL_MS = 30_000;

function formatPoints(value) {
  if (value == null) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function LeagueForm({ game, league, login, signedIn, askLogin, onDone }) {
  const [leagueText, setLeagueText] = useState(league?.leagueId || '');
  const [s2, setS2] = useState('');
  const [swid, setSwid] = useState('');
  const [replacing, setReplacing] = useState(askLogin || !login?.saved);
  const [privateOpen, setPrivateOpen] = useState(askLogin || Boolean(login?.saved));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const parsed = parseLeagueInput(leagueText);
    if (!parsed) { setError('Paste your league\u2019s ESPN link or its league id.'); return; }
    if (Boolean(s2.trim()) !== Boolean(swid.trim())) { setError('Private leagues need both espn_s2 and SWID.'); return; }
    setSaving(true);
    try {
      await saveFantasyLeague(game, {
        leagueId: parsed.leagueId,
        teamId: parsed.teamId ?? (parsed.leagueId === league?.leagueId ? league?.teamId : undefined),
      });
      if (s2.trim()) await saveEspnLogin(s2.trim(), swid.trim());
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function forget() {
    try {
      await forgetEspnLogin();
      setReplacing(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="st-fr-form" onSubmit={submit}>
      <label className="st-fr-field">
        <span>ESPN league link or id</span>
        <input value={leagueText} onChange={(e) => { setLeagueText(e.target.value); setError(''); }} placeholder="https://fantasy.espn.com/…?leagueId=…" autoComplete="off" spellCheck="false" />
      </label>
      <details className="st-fr-private" open={privateOpen} onToggle={(e) => setPrivateOpen(e.currentTarget.open)}>
        <summary>Private league</summary>
        {login?.saved && !replacing ? (
          <div className="st-fr-login">
            <p>ESPN login saved{login.swidHint ? ` (\u2026${login.swidHint})` : ''}. It covers all your leagues.</p>
            <button type="button" className="st-fr-edit" onClick={() => setReplacing(true)}>Replace</button>
            <button type="button" className="st-fr-edit" onClick={forget}>Forget</button>
          </div>
        ) : (
          <>
            <p>
              On espn.com, signed in, open your browser&rsquo;s developer tools &rarr; Application &rarr; Cookies &rarr; espn.com and copy
              {' '}<code>espn_s2</code> and <code>SWID</code>.
              {signedIn
                ? ' They act like your ESPN password: they\u2019re saved encrypted to your binge. account and only ever sent to ESPN, so you add them once.'
                : ' They act like your ESPN password, so they stay on this device and are only sent to ESPN. Sign in to keep them on every device.'}
            </p>
            <label className="st-fr-field">
              <span>espn_s2</span>
              <input value={s2} onChange={(e) => { setS2(e.target.value); setError(''); }} autoComplete="off" spellCheck="false" />
            </label>
            <label className="st-fr-field">
              <span>SWID</span>
              <input value={swid} onChange={(e) => { setSwid(e.target.value); setError(''); }} placeholder="{XXXXXXXX-XXXX-…}" autoComplete="off" spellCheck="false" />
            </label>
          </>
        )}
      </details>
      {error && <p className="st-fr-error" role="alert">{error}</p>}
      <div className="st-fr-actions">
        <button type="submit" className="st-btn st-btn--primary" disabled={saving}>{saving ? 'Saving\u2026' : 'Save league'}</button>
        <button type="button" className="st-btn st-btn--ghost" onClick={onDone}>Cancel</button>
        {league && (
          <button type="button" className="st-btn st-btn--ghost st-fr-remove" onClick={() => removeFantasyLeague(game).then(onDone, (err) => setError(err.message))}>Remove</button>
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
  const [saved, setSaved] = useState(undefined); // undefined = loading
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null); // Error from fetchFantasyLeague

  useEffect(() => {
    if (!game) return undefined;
    let cancelled = false;
    const load = () => loadFantasy().then((next) => { if (!cancelled) setSaved(next); });
    load();
    window.addEventListener(FANTASY_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(FANTASY_EVENT, load); };
  }, [game]);
  const league = saved?.leagues[game] || null;
  const login = saved?.login;

  useEffect(() => {
    if (!game || !league?.leagueId) { setData(null); return undefined; }
    let cancelled = false;
    let timer = null;
    setError(null);
    async function load(fresh) {
      try {
        const next = await fetchFantasyLeague(game, league, { fresh });
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
      if (!cancelled && live) timer = setTimeout(() => load(true), LIVE_POLL_MS);
    }
    load(false);
    return () => { cancelled = true; clearTimeout(timer); };
    // Re-run when the saved league or login changes, not on every reload of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, league?.leagueId, league?.teamId, login?.saved, login?.swidHint, live]);

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
    body = (
      <LeagueForm
        game={game}
        league={league}
        login={login}
        signedIn={saved?.signedIn}
        askLogin={Boolean(error?.needsCredentials)}
        onDone={() => setEditing(false)}
      />
    );
  } else if (saved === undefined) {
    body = <div className="st-fr-skel skeleton-block" aria-hidden="true" />;
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
        <p className="st-fr-note" role="alert">{error.message}</p>
        <button type="button" className="st-btn st-btn--ghost" onClick={() => setEditing(true)}>{error.needsCredentials ? 'Add ESPN login' : 'Edit league'}</button>
      </>
    );
  } else if (!data) {
    body = <div className="st-fr-skel skeleton-block" aria-hidden="true" />;
  } else if (!myTeam) {
    body = (
      <label className="st-fr-field">
        <span>Which team is yours?</span>
        <select value="" onChange={(e) => saveFantasyLeague(game, { teamId: Number(e.target.value) }).catch(() => {})}>
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

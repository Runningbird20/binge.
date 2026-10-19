// "Your fantasy teams" on the Sports page: every ESPN Fantasy team this
// profile tracks (any sport, several per sport), as cards with this week's
// matchup and how many starters are playing right now. A card opens its
// lineup with live points. The form is shared with the game panel.
import { useEffect, useMemo, useState } from 'react';
import { CaretDown, Plus, Trophy, X } from '@phosphor-icons/react';
import {
  addFantasyTeam, fetchFantasyLeague, FANTASY_EVENT, forgetEspnLogin, formatPoints, GAME_LABELS, GAME_PATHS, isBenchSlot,
  loadFantasy, parseLeagueInput, playingNow, removeFantasyTeam, saveEspnLogin, setFantasyTeam, slotName, summarizeTeam,
} from '../utils/fantasy';

const LIVE_POLL_MS = 30_000;
const GAMES = ['ffl', 'fba', 'fhl', 'flb'];

// Add a team: sport, league link or id, and (for private leagues) the ESPN login.
export function FantasyTeamForm({ presetGame, login, signedIn, askLogin, onDone }) {
  const [game, setGame] = useState(presetGame || 'ffl');
  const [leagueText, setLeagueText] = useState('');
  const [s2, setS2] = useState('');
  const [swid, setSwid] = useState('');
  const [replacing, setReplacing] = useState(askLogin || !login?.saved);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const parsed = parseLeagueInput(leagueText);
    if (!parsed) { setError('Paste your league’s ESPN link or its league id.'); return; }
    if (Boolean(s2.trim()) !== Boolean(swid.trim())) { setError('Private leagues need both espn_s2 and SWID.'); return; }
    setSaving(true);
    try {
      if (s2.trim()) await saveEspnLogin(s2.trim(), swid.trim());
      await addFantasyTeam(game, parsed);
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="fb-form" onSubmit={submit}>
      {!presetGame && (
        <div className="fb-sports" role="group" aria-label="Sport">
          {GAMES.map((g) => (
            <button key={g} type="button" className={`genre-chip${game === g ? ' active' : ''}`} aria-pressed={game === g} onClick={() => setGame(g)}>
              {GAME_LABELS[g]}
            </button>
          ))}
        </div>
      )}
      <label className="fb-field">
        <span>ESPN league link or id</span>
        <input value={leagueText} onChange={(e) => { setLeagueText(e.target.value); setError(''); }} placeholder="https://fantasy.espn.com/…?leagueId=…&teamId=…" autoComplete="off" spellCheck="false" />
      </label>
      <p className="fb-hint">Paste the link from your team page (it includes your team) or just the league id; you can pick your team after.</p>
      <details className="fb-private" open={askLogin || undefined}>
        <summary>Private league</summary>
        {login?.saved && !replacing ? (
          <div className="fb-login">
            <p>ESPN login saved{login.swidHint ? ` (…${login.swidHint})` : ''}. It covers all your leagues.</p>
            <button type="button" className="fb-link" onClick={() => setReplacing(true)}>Replace</button>
            <button type="button" className="fb-link" onClick={() => forgetEspnLogin().then(() => setReplacing(true), (err) => setError(err.message))}>Forget</button>
          </div>
        ) : (
          <>
            <p>
              On espn.com, signed in, open your browser&rsquo;s developer tools &rarr; Application &rarr; Cookies &rarr; espn.com and copy
              {' '}<code>espn_s2</code> and <code>SWID</code>.
              {signedIn
                ? ' They act like your ESPN password: they’re saved encrypted to your binge. account and only ever sent to ESPN.'
                : ' They act like your ESPN password, so they stay on this device. Sign in to keep them on every device.'}
            </p>
            <label className="fb-field"><span>espn_s2</span><input value={s2} onChange={(e) => { setS2(e.target.value); setError(''); }} autoComplete="off" spellCheck="false" /></label>
            <label className="fb-field"><span>SWID</span><input value={swid} onChange={(e) => { setSwid(e.target.value); setError(''); }} placeholder="{XXXXXXXX-XXXX-…}" autoComplete="off" spellCheck="false" /></label>
          </>
        )}
      </details>
      {error && <p className="fb-error" role="alert">{error}</p>}
      <div className="fb-actions">
        <button type="submit" className="st-btn st-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add team'}</button>
        <button type="button" className="st-btn st-btn--ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function TeamLogo({ team, size = 44 }) {
  const [failed, setFailed] = useState(false);
  if (team?.logo && !failed) {
    return <img className="fb-logo" src={team.logo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <span className="fb-logo fb-logo--blank" style={{ width: size, height: size }} aria-hidden="true">{(team?.abbrev || team?.name || '?').slice(0, 3)}</span>;
}

function useLeague(entry, live) {
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
  return { data, error };
}

function TeamCard({ entry, liveTeams, open, onToggle, onFixLogin }) {
  const live = liveTeams.length > 0;
  const { data, error } = useLeague(entry, live);
  const summary = data ? summarizeTeam(entry.game, data, entry) : null;
  const sport = GAME_LABELS[entry.game];

  if (error) {
    return (
      <div className="fb-card fb-card--problem">
        <p className="fb-card-name">{sport} league {entry.leagueId}</p>
        <p className="fb-card-meta" role="alert">{error.message}</p>
        <div className="fb-card-actions">
          {error.needsCredentials && <button type="button" className="fb-link" onClick={onFixLogin}>Add ESPN login</button>}
          <button type="button" className="fb-link" onClick={() => removeFantasyTeam(entry)}>Remove</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="fb-card fb-card--skel skeleton-block" aria-hidden="true" />;
  if (!summary) {
    return (
      <div className="fb-card">
        <p className="fb-card-name">{data.leagueName || `${sport} league`}</p>
        <label className="fb-field">
          <span>Which team is yours?</span>
          <select value="" onChange={(e) => setFantasyTeam(entry, Number(e.target.value)).catch(() => {})}>
            <option value="" disabled>Choose a team</option>
            {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.owner ? ` (${team.owner})` : ''}</option>)}
          </select>
        </label>
      </div>
    );
  }

  const { team, opponent, starters, points, opponentPoints } = summary;
  const now = playingNow(starters, liveTeams);
  const record = team.record ? `${team.record.wins}–${team.record.losses}${team.record.ties ? `–${team.record.ties}` : ''}` : '';
  const leading = opponentPoints != null && points > opponentPoints;
  return (
    <button type="button" className={`fb-card${open ? ' open' : ''}`} onClick={onToggle} aria-expanded={open}>
      <span className="fb-card-top">
        <TeamLogo team={team} />
        <span className="fb-card-id">
          <span className="fb-card-name">{team.name}</span>
          <span className="fb-card-meta">{[sport, data.leagueName, record, team.seed ? `#${team.seed}` : ''].filter(Boolean).join(' · ')}</span>
        </span>
        <CaretDown size={16} weight="bold" className="fb-caret" aria-hidden="true" />
      </span>
      {team.matchup ? (
        <span className={`fb-score${leading ? ' leading' : ''}`}>
          <span className="fb-score-side"><b>{formatPoints(points)}</b> {team.abbrev || 'You'}</span>
          <span className="fb-score-vs">vs</span>
          <span className="fb-score-side fb-score-side--opp">{opponent?.abbrev || opponent?.name || 'Opponent'} <b>{formatPoints(opponentPoints)}</b></span>
        </span>
      ) : (
        <span className="fb-score"><span className="fb-score-side"><b>{formatPoints(points)}</b> pts from starters</span></span>
      )}
      <span className="fb-card-foot">
        {now.length > 0 ? <><span className="st-live-dot" aria-hidden="true" /> {now.length} starter{now.length === 1 ? '' : 's'} playing now</> : 'No starters playing right now'}
      </span>
    </button>
  );
}

function Lineup({ entry, liveTeams }) {
  const { data } = useLeague(entry, liveTeams.length > 0);
  const summary = data ? summarizeTeam(entry.game, data, entry) : null;
  if (!summary) return null;
  const starters = summary.roster.filter((p) => !isBenchSlot(entry.game, p.slotId));
  const bench = summary.roster.filter((p) => isBenchSlot(entry.game, p.slotId));
  const row = (player) => {
    const on = playingNow([player], liveTeams).length > 0;
    return (
      <li key={player.id} className={`fb-player${on ? ' on' : ''}`}>
        <span className="fb-slot">{slotName(entry.game, player.slotId)}</span>
        <span className="fb-player-name">
          <strong>{player.name}</strong>
          <span>{[player.proTeam, on ? 'playing now' : '', player.injury && player.injury.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="fb-points">
          {player.points != null ? formatPoints(player.points) : player.projected != null ? <span className="proj">{formatPoints(player.projected)} proj</span> : '–'}
        </span>
      </li>
    );
  };
  return (
    <div className="fb-lineup">
      <div className="fb-lineup-head">
        <h3>{summary.team.name}</h3>
        <button type="button" className="fb-link" onClick={() => removeFantasyTeam(entry)}><X size={14} weight="bold" /> Stop tracking</button>
      </div>
      <ul className="fb-players">{starters.map(row)}</ul>
      {bench.length > 0 && (
        <details className="fb-bench">
          <summary>Bench &amp; IR ({bench.length})</summary>
          <ul className="fb-players">{bench.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

// streams: the Sports page's games (with ESPN scores) — tells which pro teams are on now.
export default function FantasyBoard({ streams }) {
  const [saved, setSaved] = useState(undefined);
  const [adding, setAdding] = useState(false);
  const [askLogin, setAskLogin] = useState(false);
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => loadFantasy().then((next) => { if (!cancelled) setSaved(next); });
    load();
    window.addEventListener(FANTASY_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(FANTASY_EVENT, load); };
  }, []);

  // Pro teams on the field right now, per fantasy game.
  const liveBy = useMemo(() => {
    const out = {};
    Object.entries(GAME_PATHS).forEach(([game, path]) => {
      out[game] = (streams || []).filter((s) => s.score?.state === 'in' && s.score.path === path).flatMap((s) => s.score.teams);
    });
    return out;
  }, [streams]);

  if (saved === undefined) return null;
  const teams = saved.teams || [];
  const open = teams.find((t) => t.key === openKey) || null;

  return (
    <section className="fb" aria-labelledby="fb-title">
      <div className="fb-head">
        <div>
          <h2 id="fb-title" className="fb-title"><Trophy size={20} weight="bold" aria-hidden="true" /> Your fantasy teams</h2>
          <p className="fb-sub">{teams.length ? 'ESPN Fantasy, live while games are on' : 'Follow your ESPN Fantasy teams here: any sport, as many as you like.'}</p>
        </div>
        {!adding && (
          <button type="button" className="st-btn st-btn--ghost st-btn--small" onClick={() => { setAskLogin(false); setAdding(true); }}>
            <Plus size={16} weight="bold" /> Add a team
          </button>
        )}
      </div>
      {adding && (
        <FantasyTeamForm login={saved.login} signedIn={saved.signedIn} askLogin={askLogin} onDone={() => { setAdding(false); setAskLogin(false); }} />
      )}
      {teams.length > 0 && (
        <div className="fb-cards">
          {teams.map((entry) => (
            <TeamCard
              key={entry.key}
              entry={entry}
              liveTeams={liveBy[entry.game] || []}
              open={entry.key === openKey}
              onToggle={() => setOpenKey((current) => (current === entry.key ? null : entry.key))}
              onFixLogin={() => { setAskLogin(true); setAdding(true); }}
            />
          ))}
        </div>
      )}
      {open && <Lineup entry={open} liveTeams={liveBy[open.game] || []} />}
    </section>
  );
}

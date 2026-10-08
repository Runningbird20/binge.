import { useEffect, useState } from 'react';
import { Star } from '@phosphor-icons/react';
import { followTeam, listFollowedTeams, TEAMS_EVENT, unfollowTeam } from '../utils/teams';
import { haptic } from '../utils/haptics';
import { findEspnEvent, fetchGameSummary } from '../utils/liveScores';

const LIVE_POLL_MS = 20_000;
const TABS = [
  { id: 'score', label: 'Score' },
  { id: 'stats', label: 'Stats' },
  { id: 'plays', label: 'Plays' },
];

// "Second screen" next to a game's stream: live score, line score, team
// stats, leaders and play-by-play (ESPN). Renders nothing for games ESPN
// doesn't cover (most non-US sports, fights, channels).
export default function LiveScorePanel({ stream }) {
  const [event, setEvent] = useState(undefined); // undefined = looking, null = not found
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('score');
  const [followed, setFollowed] = useState([]);

  useEffect(() => {
    const load = () => listFollowedTeams().then(setFollowed);
    load();
    window.addEventListener(TEAMS_EVENT, load);
    return () => window.removeEventListener(TEAMS_EVENT, load);
  }, []);

  async function toggleFollow(team) {
    haptic();
    const existing = followed.find((row) => row.league_path === event.path && row.team_id === String(team.id));
    try {
      if (existing) await unfollowTeam(existing.id);
      else await followTeam({ leaguePath: event.path, team });
    } catch { /* signed out */ }
  }

  useEffect(() => {
    let cancelled = false;
    setEvent(undefined);
    setSummary(null);
    findEspnEvent(stream).then((found) => { if (!cancelled) setEvent(found); }).catch(() => { if (!cancelled) setEvent(null); });
    return () => { cancelled = true; };
    // The schedule refreshes every minute with new objects; same game, same panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  useEffect(() => {
    if (!event) return undefined;
    let cancelled = false;
    let timer = null;
    async function load(fresh) {
      const next = await fetchGameSummary(event, { fresh }).catch(() => null);
      if (cancelled) return;
      if (next) setSummary(next);
      // Poll only while the game is on (and the tab is visible).
      if (next?.state === 'in') timer = setTimeout(() => load(true), LIVE_POLL_MS);
    }
    load(false);
    const onVisible = () => { if (document.visibilityState === 'visible' && !timer) load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [event]);

  if (event === null || (event && !summary)) {
    return event === null ? null : <aside className="st-ls st-ls--loading skeleton-block" aria-hidden="true" />;
  }
  if (!summary) return null;

  const [away, home] = summary.teams;
  const periods = Array.from({ length: summary.periods }, (_, index) => index + 1);
  const available = TABS.filter((entry) => (entry.id === 'stats' ? summary.statRows.length || summary.leaders.length : entry.id === 'plays' ? summary.plays.length : true));

  return (
    <aside className="st-ls" aria-label="Live score and stats">
      <div className="st-ls-score">
        {[away, home].filter(Boolean).map((team) => (
          <div key={team.id} className="st-ls-team">
            {team.logo && <img src={team.logo} alt="" loading="lazy" />}
            <span className="st-ls-team-name">{team.short || team.name}</span>
            {(() => {
              const isFollowed = followed.some((row) => row.league_path === event.path && row.team_id === String(team.id));
              return (
                <button
                  type="button"
                  className={`st-ls-follow${isFollowed ? ' on' : ''}`}
                  onClick={() => toggleFollow(team)}
                  aria-pressed={isFollowed}
                  aria-label={isFollowed ? `Unfollow ${team.name}` : `Follow ${team.name}`}
                  title={isFollowed ? 'Following — alerts on' : 'Follow team'}
                >
                  <Star size={13} weight={isFollowed ? 'fill' : 'bold'} /> {isFollowed ? 'Following' : 'Follow'}
                </button>
              );
            })()}
            <strong className="st-ls-team-score">{summary.state === 'pre' ? '' : team.score}</strong>
          </div>
        ))}
        <p className={`st-ls-status${summary.state === 'in' ? ' live' : ''}`}>
          {summary.state === 'in' && <span className="st-live-dot" aria-hidden="true" />}
          {summary.detail}
        </p>
      </div>

      {available.length > 1 && (
        <div className="st-ls-tabs" role="tablist" aria-label="Game details">
          {available.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? 'active' : ''} onClick={() => setTab(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="st-ls-body" role="tabpanel">
        {tab === 'score' && periods.length > 0 && (
          <table className="st-ls-lines">
            <thead>
              <tr><th scope="col"><span className="sr-only">Team</span></th>{periods.map((p) => <th key={p} scope="col">{p}</th>)}<th scope="col">T</th></tr>
            </thead>
            <tbody>
              {[away, home].filter(Boolean).map((team) => (
                <tr key={team.id}>
                  <th scope="row">{team.short}</th>
                  {periods.map((p) => <td key={p}>{team.lines[p - 1] ?? ''}</td>)}
                  <td className="st-ls-total">{team.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'score' && !periods.length && <p className="st-ls-empty">{summary.state === 'pre' ? 'The line score appears once the game starts.' : 'No line score for this game.'}</p>}
        {tab === 'score' && summary.plays[0] && (
          <p className="st-ls-last"><span>Last play</span>{summary.plays[0].text}</p>
        )}

        {tab === 'stats' && (
          <>
            {summary.statRows.length > 0 && (
              <table className="st-ls-stats">
                <thead><tr><th scope="col">{away?.short}</th><th scope="col"><span className="sr-only">Stat</span></th><th scope="col">{home?.short}</th></tr></thead>
                <tbody>
                  {summary.statRows.map((row) => (
                    <tr key={row.label}><td>{row.away}</td><th scope="row">{row.label}</th><td>{row.home}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {summary.leaders.map((group) => (
              <div key={group.team} className="st-ls-leaders">
                <h4>{group.team} leaders</h4>
                <ul>{group.items.map((leader) => <li key={leader.category}><span>{leader.category}</span>{leader.name} <strong>{leader.value}</strong></li>)}</ul>
              </div>
            ))}
          </>
        )}

        {tab === 'plays' && (
          <ol className="st-ls-plays">
            {summary.plays.map((play) => (
              <li key={play.id} className={play.scoring ? 'scoring' : ''}>
                <span className="st-ls-play-time">{[play.period, play.clock].filter(Boolean).join(' · ')}</span>
                <span>{play.text}</span>
                {play.score && <strong>{play.score}</strong>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="st-ls-source">Scores from ESPN · updates every 20s while live</p>
    </aside>
  );
}

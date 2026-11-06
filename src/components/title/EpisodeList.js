import LoadingBar from '../LoadingBar';
import { useEffect, useState } from 'react';
import { Check, CheckCircle, Play } from '@phosphor-icons/react';
import ThemedSelect from '../ThemedSelect';
import { episodeKey, episodesUpTo, lastOf, seasonEpisodes, unwatchedOnly } from '../../utils/episodeMarking';
import { useSeasonEpisodes } from '../../hooks/useTitleDetails';
import { formatRuntime } from './format';

// onMark / onUnmark are only given when the viewer can keep track (signed
// in); without them the list just plays episodes.
export function EpisodeList({ tmdbId, seasons, watched, currentSeason, onPlay, onMark, onUnmark, busy, status }) {
  const [season, setSeason] = useState(currentSeason || seasons[0]?.season_number || 1);
  const episodes = useSeasonEpisodes(tmdbId, season);

  useEffect(() => {
    if (currentSeason) setSeason(currentSeason);
  }, [currentSeason]);

  const canMark = Boolean(onMark && onUnmark);
  const aired = episodes ? seasonEpisodes(season, episodes) : [];
  const seasonDone = aired.length > 0 && aired.every((entry) => watched.has(episodeKey(entry.season, entry.episode)));
  const seasonName = seasons.find((entry) => entry.season_number === season)?.name || `Season ${season}`;

  function toggleSeason() {
    if (seasonDone) onUnmark(aired, `${seasonName} marked unwatched.`);
    else onMark(unwatchedOnly(aired, watched), { last: lastOf(aired), episodes });
  }

  return (
    <section className="td-section td-episodes-section" aria-label="Episodes">
      <div className="td-section-head td-episodes-head">
        <h3>Episodes</h3>
        <div className="td-episodes-tools">
          {canMark && aired.length > 0 && (
            <button
              type="button"
              className={`td-mark-season${seasonDone ? ' on' : ''}`}
              onClick={toggleSeason}
              disabled={busy}
              aria-pressed={seasonDone}
              title={seasonDone ? `Mark ${seasonName} unwatched` : `Mark every aired episode of ${seasonName} watched`}
            >
              <CheckCircle size={18} weight={seasonDone ? 'fill' : 'bold'} aria-hidden="true" />
              {seasonDone ? 'Season watched' : 'Mark season watched'}
            </button>
          )}
          {seasons.length > 1 ? (
            <ThemedSelect
              className="td-season-select"
              variant="pill"
              aria-label="Season"
              value={String(season)}
              options={seasons.map((entry) => ({ value: String(entry.season_number), label: `${entry.name || `Season ${entry.season_number}`} (${entry.episode_count} ep)` }))}
              onChange={(event) => setSeason(Number(event.target.value))}
            />
          ) : (
            <span className="td-muted">{seasons[0]?.name || 'Season 1'}</span>
          )}
        </div>
      </div>
      <p className="td-mark-status" role="status">
        {status?.text}
        {status?.undo && <button type="button" className="td-mark-undo" onClick={status.undo} disabled={busy}>Undo</button>}
      </p>

      <ol className="td-episodes">
        {!episodes && <li style={{ listStyle: 'none' }}><LoadingBar compact label="Loading episodes…" /></li>}
        {episodes?.map((episode) => {
          const isWatched = watched.has(episodeKey(season, episode.number));
          const upcoming = episode.airDate && new Date(episode.airDate) > new Date();
          return (
            <li key={episode.number} className="td-episode-item">
              <button
                type="button"
                className={`td-episode${isWatched ? ' watched' : ''}`}
                onClick={() => !upcoming && onPlay(season, episode.number)}
                disabled={upcoming}
                aria-label={`Play episode ${episode.number}: ${episode.title}${isWatched ? ' (watched)' : ''}`}
              >
                <span className="td-episode-num">{episode.number}</span>
                <span className="td-episode-still">
                  {episode.still ? <img src={episode.still} alt="" loading="lazy" /> : <span className="td-episode-still-empty" />}
                  {!upcoming && <span className="td-episode-play"><Play size={18} weight="fill" /></span>}
                  {isWatched && <span className="td-episode-watched"><Check size={12} weight="bold" /> Watched</span>}
                </span>
                <span className="td-episode-body">
                  <span className="td-episode-title">
                    <strong>{episode.title}</strong>
                    <span className="td-muted">{upcoming ? `Airs ${new Date(episode.airDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : formatRuntime(episode.runtime)}</span>
                  </span>
                  {episode.overview && <span className="td-episode-overview">{episode.overview}</span>}
                </span>
              </button>
              {canMark && !upcoming && (
                <button
                  type="button"
                  className={`td-episode-mark${isWatched ? ' on' : ''}`}
                  onClick={() => (isWatched
                    ? onUnmark([{ season, episode: episode.number }], `Episode ${episode.number} marked unwatched.`)
                    : onMark(unwatchedOnly(episodesUpTo(seasons, season, episode.number), watched), { last: { season, episode: episode.number }, episodes }))}
                  disabled={busy}
                  aria-label={isWatched ? `Mark episode ${episode.number} unwatched` : `Watched up to episode ${episode.number}`}
                  title={isWatched ? 'Mark unwatched' : 'Watched up to here'}
                >
                  <CheckCircle size={26} weight={isWatched ? 'fill' : 'regular'} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

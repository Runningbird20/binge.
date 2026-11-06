import LoadingBar from '../LoadingBar';
import { useEffect, useMemo } from 'react';
import { ClockCounterClockwise, Play } from '@phosphor-icons/react';
import { useSeasonEpisodes } from '../../hooks/useTitleDetails';

// "Previously on…": after a long break, the summaries of the last few
// episodes before the one you're resuming (TMDB season data).
export const RECAP_AFTER_DAYS = 14;

export function PreviouslyOn({ tmdbId, season, episode, daysAway, onPlay, onCancel }) {
  const current = useSeasonEpisodes(tmdbId, season);
  const previous = useSeasonEpisodes(tmdbId, episode <= 3 && season > 1 ? season - 1 : null);
  const recap = useMemo(() => {
    if (!current) return null;
    const before = current.filter((ep) => ep.number < episode).map((ep) => ({ ...ep, season }));
    const earlier = (previous || []).map((ep) => ({ ...ep, season: season - 1 }));
    return [...earlier, ...before].filter((ep) => ep.overview).slice(-3);
  }, [current, previous, season, episode]);

  useEffect(() => {
    // Nothing to recap (TMDB has no summaries) — go straight to playing.
    if (recap && recap.length === 0) onPlay();
  }, [recap, onPlay]);

  return (
    <div className="td-recap" role="dialog" aria-modal="true" aria-labelledby="td-recap-title">
      <div className="td-recap-card">
        <h3 id="td-recap-title">Previously on…</h3>
        <p className="td-recap-note"><ClockCounterClockwise size={16} weight="bold" aria-hidden="true" /> You were last here {daysAway} days ago.</p>
        {!recap && <LoadingBar compact label="Loading recap…" />}
        <ol className="td-recap-list">
          {recap?.map((ep) => (
            <li key={`${ep.season}:${ep.number}`}>
              {ep.still && <img src={ep.still} alt="" loading="lazy" />}
              <div>
                <p className="td-recap-ep">S{ep.season} · E{ep.number}{ep.title ? ` — ${ep.title}` : ''}</p>
                <p className="td-recap-text">{ep.overview}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="td-recap-actions">
          <button type="button" className="st-btn st-btn--primary" onClick={onPlay} autoFocus>
            <Play size={18} weight="fill" /> Continue S{season} · E{episode}
          </button>
          <button type="button" className="st-btn st-btn--ghost" onClick={onCancel}>Not now</button>
        </div>
      </div>
    </div>
  );
}

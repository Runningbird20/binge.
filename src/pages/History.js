import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EyeSlash, Eye, Star, Trash, ClockCounterClockwise } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import {
  fetchEpisodeHistory,
  fetchHiddenRecommendations,
  fetchSupabaseContinueWatching,
  fetchSupabaseRatings,
  removeTitleFromHistory,
  setRecommendationHidden,
} from '../utils/supabaseData';
import { computeStarRating } from '../components/RatingArtifact';
import { posterSrc } from '../utils/imageQuality';

function titleHref(entry) {
  if (entry.media_type === 'book') return `/book/${entry.media_id}`;
  return entry.media_type === 'tv_show' ? `/tv-show/${entry.media_id}` : `/movie/${entry.media_id}`;
}

function dayLabel(date) {
  const today = new Date();
  const d = new Date(date);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// Watch history: episodes watched, titles played and ratings, newest first,
// with per-title "remove from history" and "hide from recommendations".
export default function History() {
  const location = useLocation();
  const [entries, setEntries] = useState(null);
  const [hidden, setHidden] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [episodes, playing, ratings, hiddenRows] = await Promise.all([
      fetchEpisodeHistory().catch(() => []),
      fetchSupabaseContinueWatching().catch(() => []),
      fetchSupabaseRatings().catch(() => []),
      fetchHiddenRecommendations().catch(() => []),
    ]);
    const list = [
      ...episodes.map((row) => ({ ...row, kind: 'episode', at: row.watched_at })),
      ...playing.map((row) => ({ ...row, kind: 'played', at: row.updated_at })),
      ...ratings.map((row) => ({ ...row, kind: 'rated', at: row.created_at })),
    ].filter((row) => row.at && row.media_id);
    list.sort((a, b) => new Date(b.at) - new Date(a.at));
    // Collapse consecutive episodes of the same show on the same day.
    const collapsed = [];
    list.forEach((row) => {
      const previous = collapsed[collapsed.length - 1];
      if (previous && row.kind === 'episode' && previous.kind === 'episode' && previous.media_id === row.media_id
        && dayLabel(previous.at) === dayLabel(row.at)) {
        previous.episodes.push(`S${row.season} E${row.episode}`);
        return;
      }
      collapsed.push(row.kind === 'episode' ? { ...row, episodes: [`S${row.season} E${row.episode}`] } : row);
    });
    setEntries(collapsed);
    setHidden(new Set(hiddenRows.map((row) => `${row.media_type}:${row.media_id}`)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map();
    (entries || []).forEach((entry) => {
      const label = dayLabel(entry.at);
      map.set(label, [...(map.get(label) || []), entry]);
    });
    return [...map.entries()];
  }, [entries]);

  async function remove(entry) {
    if (!window.confirm(`Remove "${entry.title}" from your watch history? Your rating and My List aren’t affected.`)) return;
    setBusy(`${entry.media_type}:${entry.media_id}`);
    try {
      await removeTitleFromHistory({ mediaType: entry.media_type, mediaId: entry.media_id });
      setEntries((current) => current.filter((row) => !(row.media_id === entry.media_id && row.media_type === entry.media_type && row.kind !== 'rated')));
      setMessage(`Removed “${entry.title}” from your history.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  async function toggleHidden(entry) {
    const key = `${entry.media_type}:${entry.media_id}`;
    const nextHidden = !hidden.has(key);
    setBusy(key);
    try {
      await setRecommendationHidden({ mediaType: entry.media_type, mediaId: entry.media_id, hidden: nextHidden });
      setHidden((current) => {
        const next = new Set(current);
        if (nextHidden) next.add(key); else next.delete(key);
        return next;
      });
      setMessage(nextHidden ? `“${entry.title}” won’t shape your recommendations.` : `“${entry.title}” counts toward your recommendations again.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <header className="st-page-head">
          <div>
            <p className="st-page-kicker">Your activity</p>
            <h1 className="st-page-title">Watch History</h1>
          </div>
          <Link to="/profile" className="st-btn st-btn--ghost">Back to profile</Link>
        </header>

        {message && <p className="hist-message" role="status">{message}</p>}

        {!entries && <div className="hist-skeleton skeleton-block" aria-hidden="true" />}
        {entries && entries.length === 0 && (
          <div className="pf-empty">
            <ClockCounterClockwise size={32} weight="duotone" />
            <p>Nothing here yet — what you watch and rate shows up here.</p>
          </div>
        )}

        {groups.map(([label, items]) => (
          <section key={label} className="hist-day" aria-label={label}>
            <h2 className="hist-day-title">{label}</h2>
            <ul className="hist-list">
              {items.map((entry, index) => {
                const key = `${entry.media_type}:${entry.media_id}`;
                const isHidden = hidden.has(key);
                const stars = entry.kind === 'rated' ? computeStarRating(entry.media_type, entry) : null;
                return (
                  <li key={`${entry.kind}-${key}-${index}`} className={`hist-item${isHidden ? ' hidden-rec' : ''}`}>
                    <Link to={titleHref(entry)} state={{ backgroundLocation: location }} className="hist-poster" tabIndex={-1} aria-hidden="true">
                      {entry.image_url ? <img src={posterSrc(entry.image_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{entry.title?.charAt(0)}</span>}
                    </Link>
                    <div className="hist-body">
                      <Link to={titleHref(entry)} state={{ backgroundLocation: location }} className="hist-title">{entry.title}</Link>
                      <p className="hist-detail">
                        {entry.kind === 'episode' && `Watched ${entry.episodes.slice(0, 4).join(', ')}${entry.episodes.length > 4 ? ` +${entry.episodes.length - 4} more` : ''}`}
                        {entry.kind === 'played' && (entry.media_type === 'tv_show' && entry.current_episode ? `Watching S${entry.current_season} E${entry.current_episode}` : 'Watched')}
                        {entry.kind === 'rated' && <>Rated <Star size={12} weight="fill" /> {stars != null ? Number(stars).toFixed(1) : ''}</>}
                        <span className="hist-time"> · {new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </p>
                      {isHidden && <p className="hist-hidden-note">Hidden from recommendations</p>}
                    </div>
                    <div className="hist-actions">
                      <button
                        type="button"
                        className="pf-icon-btn"
                        onClick={() => toggleHidden(entry)}
                        disabled={busy === key}
                        title={isHidden ? 'Use for recommendations again' : 'Hide from recommendations'}
                        aria-label={isHidden ? `Use ${entry.title} for recommendations again` : `Hide ${entry.title} from recommendations`}
                      >
                        {isHidden ? <Eye size={16} weight="bold" /> : <EyeSlash size={16} weight="bold" />}
                      </button>
                      {entry.kind !== 'rated' && (
                        <button
                          type="button"
                          className="pf-icon-btn"
                          onClick={() => remove(entry)}
                          disabled={busy === key}
                          title="Remove from history"
                          aria-label={`Remove ${entry.title} from history`}
                        >
                          <Trash size={16} weight="bold" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

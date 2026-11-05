import LoadingBar from './LoadingBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Check, CheckCircle, ClockCounterClockwise, FilmStrip, Play, Plus, Star, X } from '@phosphor-icons/react';
import EmbedPlayer from './EmbedPlayer';
import RemindButton from './RemindButton';
import SendToProfileButton from './SendToProfileButton';
import OutsideRatings from './OutsideRatings';
import WhereToWatch from './WhereToWatch';
import CastRow from './CastRow';
import EpisodeHeatmap from './EpisodeHeatmap';
import FranchiseOrder from './FranchiseOrder';
import { haptic } from '../utils/haptics';
import { isTvMode } from '../utils/tvMode';
import RateReviewPanel from './RateReviewPanel';
import ThemedSelect from './ThemedSelect';
import { computeProgressBadge, computeResumeProgress, formatTimeLeft } from '../utils/continueWatching';
import { getPositionEntry, positionKey } from '../utils/playbackPositions';
import {
  fetchEpisodeProgress,
  markEpisodesWatched,
  removeContinueWatchingFor,
  unmarkEpisodesWatched,
  updateWatchlistProgress,
  upsertSupabaseContinueWatching,
} from '../utils/supabaseData';
import { episodeKey, episodesUpTo, isAfter, lastOf, nextEpisode, seasonEpisodes, unwatchedOnly } from '../utils/episodeMarking';
import { STATUS_LABELS, getStatusOptions } from '../utils/watchlistStatus';
import useTitleDetails, { useSeasonEpisodes } from '../hooks/useTitleDetails';
import useSwipeDismiss from '../hooks/useSwipeDismiss';
import useDeviceType from '../hooks/useDeviceType';
import { fetchTmdbRecommendations, languageName } from '../utils/tmdb';
import { resolveTmdbItems } from '../utils/catalogLookup';
import { useWatchedKeys, withoutWatched } from '../utils/watchedTitles';
import { maturityRestriction } from '../utils/kidsMode';
import { useAuth } from '../contexts/AuthContext';
import { backdropSrc, backdropSrcSet, posterSrc } from '../utils/imageQuality';
import { titleUrl } from './TitleCard';
import { isComingSoon, formatReleaseDay } from '../utils/releaseWindow';
import { findSourceBooks, splitBookTitle } from '../utils/adaptations';

function splitList(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function formatRuntime(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// onMark / onUnmark are only given when the viewer can keep track (signed
// in); without them the list just plays episodes.
function EpisodeList({ tmdbId, seasons, watched, currentSeason, onPlay, onMark, onUnmark, busy, status }) {
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

// "Previously on…": after a long break, the summaries of the last few
// episodes before the one you're resuming (TMDB season data).
const RECAP_AFTER_DAYS = 14;

function PreviouslyOn({ tmdbId, season, episode, daysAway, onPlay, onCancel }) {
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

// "Read the book behind it" — the novel an adaptation is credited to.
function SourceBooks({ mediaType, tmdbId, title }) {
  const location = useLocation();
  const [source, setSource] = useState(null);

  useEffect(() => {
    setSource(null);
    if (!tmdbId) return undefined;
    let cancelled = false;
    findSourceBooks({ mediaType, tmdbId, title })
      .then((result) => { if (!cancelled) setSource(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType, tmdbId, title]);

  if (!source?.author) return null;
  const background = location.state?.backgroundLocation || location;
  const heading = source.exact ? 'Read the book behind it' : `Based on the work of ${source.author}`;

  return (
    <section className="td-section" aria-label={heading}>
      <div className="td-section-head"><h3>{heading}</h3></div>
      {source.books.length > 0 ? (
        <div className="td-adapt-list">
          {source.books.map((book) => {
            const { main, series, number } = splitBookTitle(book.title);
            return (
              <Link key={book.id} to={`/book/${book.id}`} state={{ backgroundLocation: background }} className="td-adapt">
                {book.cover_url ? <img src={posterSrc(book.cover_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="td-adapt-fallback"><BookOpen size={22} /></span>}
                <span className="td-adapt-body">
                  <span className="td-adapt-title">{main}</span>
                  <span className="td-muted">{[book.author, book.year].filter(Boolean).join(' · ')}</span>
                  {series && <span className="td-muted">{series}{number ? ` · Book ${number}` : ''}</span>}
                  <span className="td-adapt-cta"><BookOpen size={14} weight="bold" /> See the book</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="td-muted">Based on a book by {source.author}. It isn’t in the binge. library yet.</p>
      )}
    </section>
  );
}

// TMDB's recommendations for this title within the profile's maturity
// level, minus what the profile has watched.
function MoreLikeThis({ mediaType, tmdbId }) {
  const location = useLocation();
  const kidsSafe = maturityRestriction(useAuth()?.activeProfile);
  const [loaded, setItems] = useState(null);
  const watched = useWatchedKeys();
  const items = useMemo(() => (loaded && watched ? withoutWatched(loaded, watched).slice(0, 12) : null), [loaded, watched]);

  useEffect(() => {
    setItems(null);
    if (!tmdbId) return undefined;
    let cancelled = false;
    fetchTmdbRecommendations(mediaType, tmdbId)
      .then((list) => resolveTmdbItems(list || [], mediaType, { kidsSafe }))
      .then((resolved) => { if (!cancelled) setItems(resolved.slice(0, 30)); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [mediaType, tmdbId, kidsSafe]);

  if (items && items.length === 0) return null;
  const background = location.state?.backgroundLocation || location;

  return (
    <section className="td-section" aria-label="More like this">
      <div className="td-section-head"><h3>More Like This</h3></div>
      <div className="td-more-grid">
        {!items && <div style={{ gridColumn: '1 / -1' }}><LoadingBar compact label="Loading similar titles…" /></div>}
        {items?.map((entry) => (
          <Link
            key={entry.id}
            to={titleUrl(entry)}
            state={{ backgroundLocation: background }}
            replace={Boolean(location.state?.backgroundLocation)}
            className="td-more-card"
          >
            <span className="td-more-art">
              <img
                src={backdropSrc(entry.backdrop_url, 'w780') || posterSrc(entry.poster_url)}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              {entry._comingSoon && <span className="st-badge st-badge--soon">Coming {formatReleaseDay(entry)}</span>}
            </span>
            <span className="td-more-body">
              <span className="td-more-title">{entry.title}</span>
              <span className="td-muted">
                {[entry.year || String(entry.release_date || '').slice(0, 4), splitList(entry.genre)[0]].filter(Boolean).join(' · ')}
              </span>
              {entry.overview && <span className="td-more-overview">{entry.overview}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// Netflix-style title page, shared by desktop and mobile (it reflows to a
// full-screen sheet on phones): backdrop + logo art, Play/Resume, Trailer,
// My List, facts, episodes, More Like This, and your rating.
export default function MediaDetailsModal({
  item,
  mediaType,
  onClose,
  onRate,
  onWatchlist,
  watchlistEntry,
  onStatusChange,
  userRating,
  isAddingWatchlist,
  detailMessage,
  allowActions = true,
  browseOnlyMessage = '',
  autoPlay = false,
  initialSeason,
  initialEpisode,
  initialPosition,
  closeOnPlayerExit = false,
  // Called after this popup changes library rows itself (a franchise's
  // "Mark all watched"), so the page can reload them.
  onLibraryChange,
}) {
  const [showPlayer, setShowPlayer] = useState(Boolean(autoPlay));
  const [playerStart, setPlayerStart] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  // Watched episodes: "season:episode" -> when (null if marked by hand).
  const [watched, setWatched] = useState(new Map());
  const [lastWatchedAt, setLastWatchedAt] = useState(0);
  const [showRecap, setShowRecap] = useState(false);
  // Marking episodes from the list: where the show picks up afterwards (it
  // moves forward when you catch up), a save in progress, and the last
  // change's note with its Undo.
  const [resumeOverride, setResumeOverride] = useState(null);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markStatus, setMarkStatus] = useState(null);
  const dialogRef = useRef(null);
  const overlayRef = useRef(null);
  const { isMobile } = useDeviceType();
  const details = useTitleDetails(item, mediaType);
  const isTV = mediaType === 'tv_show';
  const comingSoon = item ? isComingSoon(item) : false;

  const progressBadge = computeProgressBadge({
    ...watchlistEntry,
    ...(resumeOverride ? { current_season: resumeOverride.season, current_episode: resumeOverride.episode } : {}),
    media_type: mediaType,
  });
  const resumeSeason = resumeOverride?.season ?? initialSeason ?? watchlistEntry?.current_season ?? undefined;
  const resumeEpisode = resumeOverride?.episode ?? initialEpisode ?? watchlistEntry?.current_episode ?? undefined;

  useEffect(() => {
    setShowPlayer(Boolean(autoPlay));
    setPlayerStart(null);
    setShowTrailer(false);
    setShowRecap(false);
  }, [autoPlay, item?.id]);

  useEffect(() => {
    setResumeOverride(null);
    setMarkStatus(null);
    setProgressLoaded(false);
  }, [item?.id]);

  // Marking waits for this, so it never works from a stale list.
  useEffect(() => {
    if (!isTV || !item?.id) return undefined;
    let cancelled = false;
    fetchEpisodeProgress(item.id)
      .then((rows) => {
        if (cancelled) return;
        setWatched(new Map(rows.map((row) => [episodeKey(row.season, row.episode), row.watched_at || null])));
        setLastWatchedAt(rows.reduce((max, row) => Math.max(max, new Date(row.watched_at).getTime() || 0), 0));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProgressLoaded(true); });
    return () => { cancelled = true; };
  }, [isTV, item?.id, showPlayer]);

  const close = useCallback(() => {
    if (showRecap) { setShowRecap(false); return; }
    if (showTrailer) { setShowTrailer(false); return; }
    onClose();
  }, [onClose, showTrailer, showRecap]);

  useSwipeDismiss({ enabled: isMobile && Boolean(item) && !showPlayer && !showRecap, scrollRef: overlayRef, sheetRef: dialogRef, onDismiss: onClose });

  const playFromRecap = useCallback(() => {
    setShowRecap(false);
    setPlayerStart(null);
    setShowPlayer(true);
  }, []);

  useEffect(() => {
    if (!item) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !showPlayer) close();
    }
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // TV remote: land on Play, the button you almost always want.
    const primary = isTvMode() && dialogRef.current?.querySelector('.td-play, .td-actions .st-btn, .td-actions button');
    (primary || dialogRef.current)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [item, close, showPlayer]);

  const facts = useMemo(() => {
    if (!item) return {};
    return {
      genres: details?.genres?.length ? details.genres : splitList(item.genre),
      language: languageName(details?.originalLanguage || item.original_language),
    };
  }, [details, item]);

  if (!item) return null;

  const backdrop = details?.backdrop || item.backdrop_url || null;
  const overview = details?.overview || (item.overview !== 'No description available yet.' ? item.overview : '') || item.synopsis || '';
  const year = item.year || String(item.release_date || '').slice(0, 4);
  const score = details?.voteAverage || Number(item.vote_average) || 0;
  const seasonsCount = details?.seasons?.length || item.seasons;
  const canWatch = !comingSoon;
  const saved = Boolean(watchlistEntry?.status);
  const resumeProgress = computeResumeProgress({
    media_type: mediaType,
    media_id: item.id,
    current_season: resumeSeason,
    current_episode: resumeEpisode,
  });
  const resumeLabel = (progressBadge || resumeProgress)
    ? ['Resume', isTV ? progressBadge : null, resumeProgress ? `· ${formatTimeLeft(resumeProgress.secondsLeft)}` : null].filter(Boolean).join(' ')
    : 'Play';

  function play(season, episode) {
    haptic();
    setPlayerStart(season ? { season, episode } : null);
    setShowPlayer(true);
  }

  // Resuming a show after a long break gets a short catch-up first.
  const lastActivity = Math.max(
    lastWatchedAt,
    resumeOverride?.at || 0,
    new Date(watchlistEntry?.updated_at || 0).getTime() || 0,
    isTV && resumeSeason ? getPositionEntry(positionKey(mediaType, item.id, resumeSeason, resumeEpisode))?.at || 0 : 0,
  );
  const daysAway = lastActivity ? Math.floor((Date.now() - lastActivity) / 86400000) : 0;
  const offerRecap = isTV && details?.tmdbId && resumeSeason && resumeEpisode
    && (Number(resumeSeason) > 1 || Number(resumeEpisode) > 1) && daysAway >= RECAP_AFTER_DAYS;

  function resume() {
    haptic();
    if (offerRecap) setShowRecap(true);
    else play();
  }

  // ── Marking episodes from the list ──
  const withEpisodes = (list, at) => (current) => {
    const next = new Map(current);
    list.forEach((entry) => next.set(episodeKey(entry.season, entry.episode), at === undefined ? entry.watchedAt ?? null : at));
    return next;
  };
  const withoutEpisodes = (list) => (current) => {
    const next = new Map(current);
    list.forEach((entry) => next.delete(episodeKey(entry.season, entry.episode)));
    return next;
  };

  // Continue Watching and the library row both carry where a show picks up.
  async function setResumePoint(point) {
    if (point) {
      await upsertSupabaseContinueWatching({ mediaType, mediaId: item.id, currentSeason: point.season, currentEpisode: point.episode, positionSeconds: 0 });
    } else {
      await removeContinueWatchingFor({ mediaType, mediaId: item.id });
    }
    await updateWatchlistProgress({ mediaType, mediaId: item.id, currentSeason: point?.season ?? null, currentEpisode: point?.episode ?? null }).catch(() => {});
  }

  // Marks `list` watched. When that catches you up past where the show
  // picked up, it now picks up at the next episode (Resume, Continue
  // Watching). Undo puts both back.
  async function markEpisodes(list, { last, episodes: seasonList }) {
    if (!list.length || marking) return;
    haptic();
    // A season without an episode starts at its first (as the player does).
    const before = resumeSeason ? { season: Number(resumeSeason), episode: Number(resumeEpisode) || 1 } : null;
    const next = last ? nextEpisode(last, details?.seasons, seasonList) : null;
    const moveTo = next && isAfter(next, before) ? next : null;
    setMarking(true);
    setWatched(withEpisodes(list, null));
    try {
      await markEpisodesWatched({ mediaId: item.id, episodes: list });
      let moved = false;
      if (moveTo) {
        try {
          await setResumePoint(moveTo);
          setResumeOverride({ ...moveTo, at: Date.now() });
          moved = true;
        } catch {
          // The episodes are saved; only the resume point stayed put.
        }
      }
      const count = list.length === 1 ? '1 episode' : `${list.length} episodes`;
      setMarkStatus({
        text: `Marked ${count} watched.${moved ? ` Up next: S${moveTo.season} · E${moveTo.episode}.` : ''}`,
        undo: () => undoMark(list, moved ? before : undefined),
      });
    } catch (error) {
      setWatched(withoutEpisodes(list));
      setMarkStatus({ text: error?.message || 'Couldn’t save that. Try again.' });
    } finally {
      setMarking(false);
    }
  }

  // previous: the resume point to restore (null = none), undefined = untouched.
  async function undoMark(list, previous) {
    setMarking(true);
    setWatched(withoutEpisodes(list));
    try {
      await unmarkEpisodesWatched({ mediaId: item.id, episodes: list });
      if (previous !== undefined) {
        await setResumePoint(previous).catch(() => {});
        setResumeOverride(previous ? { ...previous, at: Date.now() } : null);
      }
      setMarkStatus(null);
    } catch (error) {
      setWatched(withEpisodes(list, null));
      setMarkStatus({ text: error?.message || 'Couldn’t undo that. Try again.' });
    } finally {
      setMarking(false);
    }
  }

  // Unmarks `list`; Undo puts the episodes back with their original watch times.
  async function unmarkEpisodes(list, text) {
    if (!list.length || marking) return;
    haptic();
    const saved = list.map((entry) => ({ ...entry, watchedAt: watched.get(episodeKey(entry.season, entry.episode)) ?? null }));
    setMarking(true);
    setWatched(withoutEpisodes(list));
    try {
      await unmarkEpisodesWatched({ mediaId: item.id, episodes: list });
      setMarkStatus({ text, undo: () => restoreEpisodes(saved) });
    } catch (error) {
      setWatched(withEpisodes(saved));
      setMarkStatus({ text: error?.message || 'Couldn’t save that. Try again.' });
    } finally {
      setMarking(false);
    }
  }

  async function restoreEpisodes(saved) {
    setMarking(true);
    setWatched(withEpisodes(saved));
    try {
      await markEpisodesWatched({ mediaId: item.id, episodes: saved });
      setMarkStatus(null);
    } catch (error) {
      setWatched(withoutEpisodes(saved));
      setMarkStatus({ text: error?.message || 'Couldn’t undo that. Try again.' });
    } finally {
      setMarking(false);
    }
  }

  // "Your Rating & Review": under the facts for movies, after the episodes
  // for series.
  const ratingSection = (
    <section className={`td-section td-rate${isTV ? '' : ' td-rate--aside'}`} aria-label="Your rating">
      <div className="td-section-head">
        <h3>Your Rating &amp; Review</h3>
        {saved && <span className="td-muted">In My List · {STATUS_LABELS[watchlistEntry.status]}</span>}
      </div>
      <RateReviewPanel
        mediaType={mediaType}
        value={userRating}
        onSave={handleRatingSave}
        allowActions={allowActions}
        size="lg"
      />
      {!allowActions && browseOnlyMessage && <p className="td-status-msg">{browseOnlyMessage}</p>}
      {detailMessage && <p className="td-status-msg" role="status">{detailMessage}</p>}
    </section>
  );

  async function handleRatingSave(categories) {
    if (typeof onRate !== 'function') return;
    await onRate(item, categories);
    haptic('success');
  }

  return (
    <>
      <div className="td-overlay" onClick={close} ref={overlayRef}>
        <div
          className="td-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="td-title"
          tabIndex={-1}
          ref={dialogRef}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="td-close td-round-btn" onClick={close} aria-label="Close details">
            <X size={20} weight="bold" />
          </button>

          <header className="td-hero">
            {showTrailer && details?.trailerKey ? (
              <iframe
                className="td-trailer"
                src={`https://www.youtube-nocookie.com/embed/${details.trailerKey}?autoplay=1&rel=0&modestbranding=1`}
                title={`${item.title} trailer`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            ) : (
              <>
                {backdrop ? (
                  <img
                    className="td-hero-img"
                    src={backdropSrc(backdrop, 'w1280')}
                    srcSet={backdropSrcSet(backdrop)}
                    sizes="(max-width: 980px) 100vw, 980px"
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <img className="td-hero-img td-hero-img--poster" src={posterSrc(item.poster_url || item.cover_url)} alt="" referrerPolicy="no-referrer" />
                )}
                <div className="td-hero-scrim" aria-hidden="true" />
              </>
            )}

            {!showTrailer && (
              <div className="td-hero-content">
                {details?.logo ? (
                  <h2 id="td-title" className="td-logo-title">
                    <img src={details.logo} alt={item.title} />
                  </h2>
                ) : (
                  <h2 id="td-title" className="td-title">{item.title}</h2>
                )}
                <div className="td-actions">
                  {canWatch ? (
                    <button type="button" className={`st-btn td-resume-control td-play${resumeLabel === 'Play' ? ' td-play--compact' : ''}`} onClick={resume}>
                      <Play size={20} weight="fill" />
                      {resumeLabel}
                    </button>
                  ) : (
                    <span className="st-badge st-badge--soon st-badge--lg">Coming {formatReleaseDay(item) || 'soon'}</span>
                  )}
                  {details?.trailerKey && (
                    <button type="button" className="st-btn td-resume-control td-play--compact" onClick={() => setShowTrailer(true)}>
                      <FilmStrip size={18} weight="bold" /> Trailer
                    </button>
                  )}
                  {onWatchlist && !saved && (
                    <button
                      type="button"
                      className="td-round-btn"
                      onClick={() => { haptic('success'); onWatchlist(item); }}
                      disabled={!allowActions || isAddingWatchlist}
                      aria-label="Add to My List"
                      title="Add to My List"
                    >
                      <Plus size={20} weight="bold" />
                    </button>
                  )}
                  {onWatchlist && saved && (
                    <div className="td-status">
                      <Check size={16} weight="bold" aria-hidden="true" />
                      <ThemedSelect
                        className="td-status-select"
                        variant="pill"
                        aria-label="My List status"
                        value={watchlistEntry.status}
                        options={getStatusOptions(mediaType).map((value) => ({ value, label: STATUS_LABELS[value] }))}
                        onChange={(event) => onStatusChange?.(item, watchlistEntry, event.target.value)}
                      />
                    </div>
                  )}
                  {allowActions && <RemindButton item={item} mediaType={mediaType} />}
                  {allowActions && <SendToProfileButton item={item} mediaType={mediaType} />}
                </div>
              </div>
            )}
            {showTrailer && (
              <button type="button" className="st-btn st-btn--secondary td-trailer-close" onClick={() => setShowTrailer(false)}>
                Back to details
              </button>
            )}
          </header>

          {isMobile && canWatch && !showTrailer && (
            <div className="td-mobile-bar">
              <button type="button" className={`st-btn td-resume-control${resumeLabel === 'Play' ? ' td-play--compact' : ''}`} onClick={resume}>
                <Play size={20} weight="fill" /> {resumeLabel}
              </button>
              {onWatchlist && !saved && (
                <button type="button" className="td-round-btn" onClick={() => { haptic('success'); onWatchlist(item); }} disabled={!allowActions || isAddingWatchlist} aria-label="Add to My List">
                  <Plus size={20} weight="bold" />
                </button>
              )}
            </div>
          )}

          {/* Wide screens: a series' episodes sit beside the details. */}
          <div className={`td-split${isTV && details?.seasons?.length ? ' td-split--tv' : ''}`}>
          <div className="td-body">
            <div className="td-main">
              <div className="td-meta">
                {score > 0 && <span className="td-score"><Star size={14} weight="fill" /> {score.toFixed(1)}</span>}
                {year && <span>{year}</span>}
                {details?.certification && <span className="td-cert">{details.certification}</span>}
                {isTV
                  ? (seasonsCount ? <span>{seasonsCount} Season{seasonsCount === 1 ? '' : 's'}</span> : null)
                  : (details?.runtime ? <span>{formatRuntime(details.runtime)}</span> : null)}
                <span className="td-hd">HD</span>
              </div>
              <WhereToWatch watch={details?.watch} mediaType={mediaType} />
              <OutsideRatings item={item} />
              {details?.tagline && <p className="td-tagline">{details.tagline}</p>}
              {overview && <p className="td-overview">{overview}</p>}
              {item._reason && <p className="td-reason">{item._reason}</p>}
            </div>

            <div className="td-aside">
            <dl className="td-facts">
              {facts.genres?.length > 0 && (<><dt>Genres</dt><dd>{facts.genres.join(', ')}</dd></>)}
              {facts.language && (<><dt>Original language</dt><dd>{facts.language}</dd></>)}
              {details?.networks?.length > 0 && (<><dt>{isTV ? 'Network' : 'Studio'}</dt><dd>{details.networks.join(', ')}</dd></>)}
              {item.imdb_rating && (<><dt>IMDb</dt><dd>{item.imdb_rating}/10</dd></>)}
              {item.rotten_tomatoes_score && (<><dt>Rotten Tomatoes</dt><dd>{item.rotten_tomatoes_score}%</dd></>)}
            </dl>
            {/* Movies: your rating right under the facts (series keep it
                beside their episodes). */}
            {!isTV && ratingSection}
            </div>
            {/* The whole width under the description (on phones straight
                after it, before the facts). */}
            <CastRow people={details?.people} />
          </div>

          {isTV && details?.seasons?.length > 0 && (
            <EpisodeList
              tmdbId={details.tmdbId}
              seasons={details.seasons}
              watched={watched}
              currentSeason={resumeSeason ? Number(resumeSeason) : null}
              onPlay={play}
              onMark={allowActions ? markEpisodes : undefined}
              onUnmark={allowActions ? unmarkEpisodes : undefined}
              busy={marking || !progressLoaded}
              status={markStatus}
            />
          )}

          {isTV && details?.seasons?.length > 0 && (
            <EpisodeHeatmap tmdbId={details.tmdbId} seasons={details.seasons} onPlay={play} />
          )}

          {!isTV && details?.tmdbId && <FranchiseOrder tmdbId={details.tmdbId} currentId={item.id} canMark={allowActions} onLibraryChange={onLibraryChange} />}

          <SourceBooks mediaType={mediaType} tmdbId={details?.tmdbId} title={item.title} />

          <MoreLikeThis mediaType={mediaType} tmdbId={details?.tmdbId} />

          {isTV && ratingSection}

          {onWatchlist && !saved && allowActions && (
            <div className="td-footer-cta">
              <button type="button" className="st-btn st-btn--ghost" onClick={() => onWatchlist(item)} disabled={isAddingWatchlist}>
                <Plus size={16} weight="bold" />
                {isAddingWatchlist ? 'Saving…' : 'Add to Library'}
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {showRecap && !showPlayer && (
        <PreviouslyOn
          tmdbId={details.tmdbId}
          season={Number(resumeSeason)}
          episode={Number(resumeEpisode)}
          daysAway={daysAway}
          onPlay={playFromRecap}
          onCancel={() => setShowRecap(false)}
        />
      )}

      {showPlayer && canWatch && (
        <EmbedPlayer
          item={item}
          mediaType={mediaType}
          onClose={() => (closeOnPlayerExit && !playerStart ? onClose() : setShowPlayer(false))}
          initialSeason={playerStart?.season ?? resumeSeason}
          initialEpisode={playerStart?.episode ?? resumeEpisode}
          initialPosition={playerStart || resumeOverride ? undefined : initialPosition}
        />
      )}
    </>
  );
}

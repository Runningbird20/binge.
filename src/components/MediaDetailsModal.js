import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Check, ClockCounterClockwise, FilmStrip, Play, Plus, Star, X } from '@phosphor-icons/react';
import EmbedPlayer from './EmbedPlayer';
import RemindButton from './RemindButton';
import { haptic } from '../utils/haptics';
import RateReviewPanel from './RateReviewPanel';
import ThemedSelect from './ThemedSelect';
import { computeProgressBadge, computeResumeProgress, formatTimeLeft } from '../utils/continueWatching';
import { getPositionEntry, positionKey } from '../utils/playbackPositions';
import { fetchEpisodeProgress } from '../utils/supabaseData';
import { STATUS_LABELS, getStatusOptions } from '../utils/watchlistStatus';
import useTitleDetails, { useSeasonEpisodes } from '../hooks/useTitleDetails';
import useSwipeDismiss from '../hooks/useSwipeDismiss';
import useDeviceType from '../hooks/useDeviceType';
import { fetchTmdbRecommendations, languageName } from '../utils/tmdb';
import { resolveTmdbItems } from '../utils/catalogLookup';
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

function EpisodeList({ tmdbId, seasons, watched, currentSeason, onPlay }) {
  const [season, setSeason] = useState(currentSeason || seasons[0]?.season_number || 1);
  const episodes = useSeasonEpisodes(tmdbId, season);

  useEffect(() => {
    if (currentSeason) setSeason(currentSeason);
  }, [currentSeason]);

  return (
    <section className="td-section td-episodes-section" aria-label="Episodes">
      <div className="td-section-head">
        <h3>Episodes</h3>
        {seasons.length > 1 ? (
          <ThemedSelect
            className="td-season-select"
            aria-label="Season"
            value={String(season)}
            options={seasons.map((entry) => ({ value: String(entry.season_number), label: `${entry.name || `Season ${entry.season_number}`} (${entry.episode_count} ep)` }))}
            onChange={(event) => setSeason(Number(event.target.value))}
          />
        ) : (
          <span className="td-muted">{seasons[0]?.name || 'Season 1'}</span>
        )}
      </div>

      <ol className="td-episodes">
        {!episodes && Array.from({ length: 4 }, (_, index) => <li key={index} className="td-episode td-episode--skeleton skeleton-block" />)}
        {episodes?.map((episode) => {
          const isWatched = watched.has(`${season}:${episode.number}`);
          const upcoming = episode.airDate && new Date(episode.airDate) > new Date();
          return (
            <li key={episode.number}>
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
        <p className="td-recap-kicker"><ClockCounterClockwise size={16} weight="bold" /> It’s been {daysAway} days</p>
        <h3 id="td-recap-title">Previously on…</h3>
        {!recap && <div className="td-recap-skeleton skeleton-block" aria-hidden="true" />}
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

function MoreLikeThis({ mediaType, tmdbId }) {
  const location = useLocation();
  const [items, setItems] = useState(null);

  useEffect(() => {
    setItems(null);
    if (!tmdbId) return undefined;
    let cancelled = false;
    fetchTmdbRecommendations(mediaType, tmdbId)
      .then((list) => resolveTmdbItems(list || [], mediaType))
      .then((resolved) => { if (!cancelled) setItems(resolved.slice(0, 12)); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [mediaType, tmdbId]);

  if (items && items.length === 0) return null;
  const background = location.state?.backgroundLocation || location;

  return (
    <section className="td-section" aria-label="More like this">
      <div className="td-section-head"><h3>More Like This</h3></div>
      <div className="td-more-grid">
        {!items && Array.from({ length: 6 }, (_, index) => <div key={index} className="td-more-card td-more-card--skeleton skeleton-block" />)}
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
// My List, facts, episodes, More Like This, and your rating & review.
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
}) {
  const [showPlayer, setShowPlayer] = useState(Boolean(autoPlay));
  const [playerStart, setPlayerStart] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [watched, setWatched] = useState(new Set());
  const [lastWatchedAt, setLastWatchedAt] = useState(0);
  const [showRecap, setShowRecap] = useState(false);
  const dialogRef = useRef(null);
  const overlayRef = useRef(null);
  const rateRef = useRef(null);
  const { isMobile } = useDeviceType();
  const details = useTitleDetails(item, mediaType);
  const isTV = mediaType === 'tv_show';
  const comingSoon = item ? isComingSoon(item) : false;

  const progressBadge = computeProgressBadge({ ...watchlistEntry, media_type: mediaType });
  const resumeSeason = initialSeason ?? watchlistEntry?.current_season ?? undefined;
  const resumeEpisode = initialEpisode ?? watchlistEntry?.current_episode ?? undefined;

  useEffect(() => {
    setShowPlayer(Boolean(autoPlay));
    setPlayerStart(null);
    setShowTrailer(false);
    setShowRecap(false);
  }, [autoPlay, item?.id]);

  useEffect(() => {
    if (!isTV || !item?.id) return undefined;
    let cancelled = false;
    fetchEpisodeProgress(item.id)
      .then((rows) => {
        if (cancelled) return;
        setWatched(new Set(rows.map((row) => `${row.season}:${row.episode}`)));
        setLastWatchedAt(rows.reduce((max, row) => Math.max(max, new Date(row.watched_at).getTime() || 0), 0));
      })
      .catch(() => {});
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
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [item, close, showPlayer]);

  const facts = useMemo(() => {
    if (!item) return {};
    return {
      cast: details?.cast?.length ? details.cast : splitList(item.cast_members).slice(0, 8),
      creators: details?.creators?.length ? details.creators : splitList(item.director || item.creator),
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

  async function handleRatingSave(categories, review) {
    if (typeof onRate !== 'function') return;
    await onRate(item, categories, review);
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
          <button type="button" className="td-close" onClick={close} aria-label="Close details">
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
                    <button type="button" className="st-btn st-btn--primary td-play" onClick={resume}>
                      <Play size={20} weight="fill" />
                      {resumeLabel}
                    </button>
                  ) : (
                    <span className="st-badge st-badge--soon st-badge--lg">Coming {formatReleaseDay(item) || 'soon'}</span>
                  )}
                  {details?.trailerKey && (
                    <button type="button" className="st-btn st-btn--secondary" onClick={() => setShowTrailer(true)}>
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
                        aria-label="My List status"
                        value={watchlistEntry.status}
                        options={getStatusOptions(mediaType).map((value) => ({ value, label: STATUS_LABELS[value] }))}
                        onChange={(event) => onStatusChange?.(item, watchlistEntry, event.target.value)}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    className="td-round-btn"
                    onClick={() => rateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    aria-label="Rate this title"
                    title="Rate this title"
                  >
                    <Star size={20} weight={userRating ? 'fill' : 'bold'} />
                  </button>
                  {allowActions && <RemindButton item={item} mediaType={mediaType} />}
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
              <button type="button" className="st-btn st-btn--primary" onClick={resume}>
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
              {details?.tagline && <p className="td-tagline">{details.tagline}</p>}
              {overview && <p className="td-overview">{overview}</p>}
              {item._reason && <p className="td-reason">{item._reason}</p>}
            </div>

            <dl className="td-facts">
              {facts.cast?.length > 0 && (<><dt>Cast</dt><dd>{facts.cast.slice(0, 5).join(', ')}</dd></>)}
              {facts.creators?.length > 0 && (<><dt>{isTV ? 'Created by' : 'Director'}</dt><dd>{facts.creators.join(', ')}</dd></>)}
              {facts.genres?.length > 0 && (<><dt>Genres</dt><dd>{facts.genres.join(', ')}</dd></>)}
              {facts.language && (<><dt>Original language</dt><dd>{facts.language}</dd></>)}
              {details?.networks?.length > 0 && (<><dt>{isTV ? 'Network' : 'Studio'}</dt><dd>{details.networks.join(', ')}</dd></>)}
              {item.imdb_rating && (<><dt>IMDb</dt><dd>{item.imdb_rating}/10</dd></>)}
              {item.rotten_tomatoes_score && (<><dt>Rotten Tomatoes</dt><dd>{item.rotten_tomatoes_score}%</dd></>)}
            </dl>
          </div>

          {isTV && details?.seasons?.length > 0 && (
            <EpisodeList
              tmdbId={details.tmdbId}
              seasons={details.seasons}
              watched={watched}
              currentSeason={resumeSeason ? Number(resumeSeason) : null}
              onPlay={play}
            />
          )}

          <SourceBooks mediaType={mediaType} tmdbId={details?.tmdbId} title={item.title} />

          <MoreLikeThis mediaType={mediaType} tmdbId={details?.tmdbId} />

          <section className="td-section td-rate" ref={rateRef} aria-label="Your rating and review">
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
          initialPosition={playerStart ? undefined : initialPosition}
        />
      )}
    </>
  );
}

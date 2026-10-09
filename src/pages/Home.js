import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Info, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import PullToRefresh from '../components/PullToRefresh';
import BrowseHero from '../components/BrowseHero';
import TitleRow from '../components/TitleRow';
import TitleCard from '../components/TitleCard';
import { computeStarRating } from '../components/RatingArtifact';
import UserAvatar from '../components/UserAvatar';
import ProfileAvatar from '../components/ProfileAvatar';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
  fetchSupabaseContinueWatching,
  removeSupabaseContinueWatching,
} from '../utils/supabaseData';
import { generateSupabaseTypeRecommendations } from '../utils/recommendations';
import { buildPersonalizedRows } from '../utils/personalization';
import { loadRowItems, orderRowsForTaste, rowsFor } from '../utils/browseRows';
import { resumeUrl, detailsUrl, computeProgressBadge, computeResumeProgress, formatTimeLeft } from '../utils/continueWatching';
import { excludeRated, computeWatchMinutes, countCompleted } from '../utils/libraryStats';
import { getCached, setCached, buildUserDataCacheKey } from '../utils/sessionCache';
import { tmdbGet, tmdbIdFromItem, tmdbImage, tmdbKind } from '../utils/tmdb';
import { findNewEpisodes } from '../utils/newEpisodes';
import { enableNewEpisodeAlerts, isSubscribed, pushSupported } from '../utils/pushNotifications';
import { Bell, BellRinging } from '@phosphor-icons/react';

// Library/continue-watching rows carry media_id; cards key off id.
function asTitle(record) {
  return {
    ...record,
    id: record.media_id,
    poster_url: record.poster_url || record.image_url,
  };
}

// Continue Watching has no backdrop art of its own — fetch TMDB's so the
// hero gets a proper wide image instead of a stretched poster.
async function withBackdrop(item) {
  const tmdbId = tmdbIdFromItem(item);
  if (!tmdbId || item.media_type === 'book') return item;
  const details = await tmdbGet(`/${tmdbKind(item.media_type)}/${tmdbId}`);
  return details?.backdrop_path
    ? { ...item, backdrop_url: tmdbImage(details.backdrop_path, 'w1280'), overview: details.overview || item.overview }
    : item;
}

// Opt-in for push alerts when a show in your list gets a new episode.
function NotifyButton() {
  const [state, setState] = useState('idle'); // idle | on | busy | error
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    isSubscribed().then((on) => { if (!cancelled && on) setState('on'); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!pushSupported()) return null;
  if (state === 'on') {
    return <span className="st-notify st-notify--on"><BellRinging size={16} weight="fill" /> Alerts on</span>;
  }
  return (
    <span className="st-notify-wrap">
      <button
        type="button"
        className="st-btn st-btn--ghost st-notify"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try { await enableNewEpisodeAlerts(); setState('on'); } catch (error) { setState('error'); setMessage(error.message); }
        }}
      >
        <Bell size={16} weight="bold" /> {state === 'busy' ? 'Turning on…' : 'Get notified'}
      </button>
      {state === 'error' && <span className="st-notify-error" role="status">{message}</span>}
    </span>
  );
}

function ContinueWatchingCard({ item, onRemove, priority }) {
  const location = useLocation();
  const episodeLabel = computeProgressBadge(item);
  const resume = computeResumeProgress(item);
  const subtitle = [item.media_type === 'tv_show' ? episodeLabel : null, resume ? formatTimeLeft(resume.secondsLeft) : null]
    .filter(Boolean).join(' · ');
  // The card itself plays straight from the saved position and server;
  // details live behind the (i) button.
  return (
    <div className="st-cw-cell">
      <TitleCard
        item={{
          ...asTitle(item),
          _progress: resume ? Math.max(0.03, resume.fraction) : null,
          _subtitle: subtitle || episodeLabel,
          _match: null,
        }}
        to={resumeUrl(item)}
        priority={priority}
        showMatch={false}
        playNow
      />
      <Link
        to={detailsUrl(item)}
        state={{ backgroundLocation: location }}
        className="st-cw-info"
        title="Episodes & info"
        aria-label={`Details for ${item.title}`}
      >
        <Info size={15} weight="bold" />
      </Link>
      <button
        type="button"
        className="st-cw-remove"
        title="Remove from Continue Watching"
        aria-label={`Remove ${item.title} from Continue Watching`}
        onClick={(event) => { event.preventDefault(); onRemove(item.id); }}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

// Home's mixed (movies + series) taste rows: the first two language/genre
// rows this profile leans toward for each type.
function tasteRowDefinitions(taste, kidsSafe) {
  if (kidsSafe) return [];
  const pick = (mediaType) => orderRowsForTaste(rowsFor(mediaType), taste)
    .filter((definition) => definition.kind)
    .slice(0, 2)
    .map((definition) => ({ ...definition, mediaType }));
  return [...pick('tv_show'), ...pick('movie')];
}

async function loadBookPicks() {
  const result = await generateSupabaseTypeRecommendations('book');
  return (result.recommendations || []).map((rec) => ({
    id: rec.id,
    title: rec.title,
    media_type: 'book',
    year: rec.year,
    genre: rec.genre,
    poster_url: rec.posterUrl,
    _reason: rec.reason,
  }));
}

function ProfileStatsHeader({ user, activeProfile, watchlist, ratings }) {
  const stats = useMemo(() => {
    // Rated titles move to Ratings & Reviews, so in-progress (a library-only
    // status) is measured against the watchlist minus anything already rated.
    const libraryWatchlist = excludeRated(watchlist, ratings);
    const completed  = countCompleted(watchlist, ratings);
    const inProgress = libraryWatchlist.filter(i => i.status === 'watching' || i.status === 'reading').length;

    const scores = ratings.map(r => computeStarRating(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

    // Watch time counts both watchlist progress and rated titles (a rating
    // means it was watched, even if never marked "watched" in the library).
    const minutes = computeWatchMinutes(watchlist, ratings);

    return { completed, inProgress, avg, minutes, totalRatings: ratings.length };
  }, [watchlist, ratings]);

  const hours = Math.round(stats.minutes / 60);
  const editTo = activeProfile && !activeProfile.is_default ? '/profiles' : '/account-settings';
  const tiles = [
    { label: 'Watched', value: hours >= 2 ? `${hours.toLocaleString()}h` : `${stats.minutes}m` },
    { label: 'Completed', value: stats.completed },
    { label: 'In progress', value: stats.inProgress },
    { label: 'Ratings', value: stats.totalRatings },
    { label: 'Avg score', value: stats.avg },
  ];

  // Same look as the Profile page header (pf-*), condensed for Home.
  return (
    <section className="hm-me" aria-label="Your stats">
      <Link to="/profile" className="hm-me-id">
        {activeProfile ? (
          <ProfileAvatar profile={activeProfile} size={56} />
        ) : (
          <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
        )}
        <span className="hm-me-text">
          <span className="hm-me-name">{activeProfile?.name || user.username}</span>
        </span>
      </Link>
      <dl className="pf-stats hm-me-stats">
        {tiles.map((tile) => (
          <div key={tile.label}><dt>{tile.label}</dt><dd>{tile.value}</dd></div>
        ))}
      </dl>
      <Link to={editTo} className="st-btn st-btn--ghost hm-me-edit">
        {activeProfile && !activeProfile.is_default ? 'Manage profiles' : 'Edit profile'}
      </Link>
    </section>
  );
}

export default function Home() {
  const { user, authLoading, activeProfile, profilesLoading } = useAuth();
  const location = useLocation();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ratingsItems, setRatingsItems] = useState([]);
  const [continueWatchingItems, setContinueWatchingItems] = useState([]);
  const jumpToContinue = new URLSearchParams(location.search).get('jump') === 'continue';
  const [dataLoading, setDataLoading] = useState(true);
  const [personal, setPersonal] = useState(null);
  const [heroItems, setHeroItems] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [newEpisodes, setNewEpisodes] = useState([]);

  const userId = user?.id;
  const kidsSafe = Boolean(activeProfile?.is_kids);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const profileId = activeProfile?.id || null;

  // Stale-while-revalidate: the mount effect below hydrates instantly from
  // cache when there's a hit, but this always does the real fetch and
  // re-caches, so data self-heals within a session.
  const fetchStats = useCallback(async () => {
    const cacheKey = buildUserDataCacheKey('home-stats', userId, profileId);
    if (!getCached(cacheKey)) setDataLoading(true);
    try {
      const [ratingsResult, watchlistResult, continueWatchingResult] = await Promise.allSettled([
        fetchSupabaseRatings(),
        fetchSupabaseWatchlist(),
        fetchSupabaseContinueWatching(),
      ]);

      if (!mountedRef.current) return;

      const pick = (result) => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
      const nextRatings = pick(ratingsResult);
      const nextWatchlist = pick(watchlistResult);
      const nextContinueWatching = pick(continueWatchingResult);
      setWatchlistItems(nextWatchlist);
      setRatingsItems(nextRatings);
      setContinueWatchingItems(nextContinueWatching);
      setCached(cacheKey, {
        watchlistItems: nextWatchlist,
        ratingsItems: nextRatings,
        continueWatchingItems: nextContinueWatching,
      });
    } catch {
      if (!mountedRef.current) return;
      setWatchlistItems([]);
      setRatingsItems([]);
      setContinueWatchingItems([]);
    } finally {
      if (mountedRef.current) setDataLoading(false);
    }
  }, [userId, profileId]);

  useEffect(() => {
    if (authLoading || !userId) return;

    const cached = getCached(buildUserDataCacheKey('home-stats', userId, profileId));
    if (cached) {
      setWatchlistItems(cached.watchlistItems);
      setRatingsItems(cached.ratingsItems);
      setContinueWatchingItems(cached.continueWatchingItems);
      setDataLoading(false);
    }
    fetchStats();
  }, [authLoading, userId, profileId, fetchStats]);

  // Personalized rows (Top Picks, Because you watched...) across both types.
  useEffect(() => {
    if (authLoading || !userId || profilesLoading) return undefined;
    let cancelled = false;
    buildPersonalizedRows({ mediaTypes: ['movie', 'tv_show'], kidsSafe, becauseLimit: 4 })
      .then((result) => { if (!cancelled) setPersonal(result); })
      .catch(() => { if (!cancelled) setPersonal({ hasHistory: false, topPicks: [], becauseYouWatched: [], taste: {} }); });
    return () => { cancelled = true; };
  }, [authLoading, userId, profilesLoading, kidsSafe, refreshKey]);

  // Hero: resume what you were watching first, then your top picks — or
  // trending for a brand-new profile.
  useEffect(() => {
    let cancelled = false;
    async function buildHero() {
      const resume = continueWatchingItems
        .filter((item) => item.media_type !== 'book')
        .slice(0, 1)
        .map((item) => ({ ...asTitle(item), _playUrl: resumeUrl(item), _playLabel: 'Resume', _reason: computeProgressBadge(item) ? `Continue ${computeProgressBadge(item)}` : 'Continue where you left off' }));
      let picks = personal?.topPicks?.slice(0, 4) || [];
      if (!picks.length && personal) {
        picks = (await loadRowItems(rowsFor('movie', { kidsSafe })[0], 'movie', { kidsSafe }).catch(() => [])).slice(0, 4);
      }
      const withArt = await Promise.all(resume.map(withBackdrop));
      if (!cancelled) setHeroItems([...withArt, ...picks]);
    }
    buildHero();
    return () => { cancelled = true; };
  }, [continueWatchingItems, personal, kidsSafe]);

  // Shows in your list with an episode newer than where you are.
  useEffect(() => {
    if (dataLoading) return undefined;
    let cancelled = false;
    findNewEpisodes({ watchlist: watchlistItems, continueWatching: continueWatchingItems })
      .then((items) => { if (!cancelled) setNewEpisodes(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataLoading, watchlistItems, continueWatchingItems]);

  async function handleRefresh() {
    setRefreshKey((n) => n + 1);
    await fetchStats();
  }

  // The details overlay that saves a rating is a separately-mounted screen
  // on top of Home, so it broadcasts instead of updating Home's state.
  useEffect(() => {
    function onRatingSaved(event) {
      const { mediaType, mediaId, categories } = event.detail || {};
      if (!mediaType || !Number.isFinite(mediaId)) return;

      setRatingsItems((current) => {
        const next = { ...categories, media_type: mediaType, media_id: mediaId };
        const index = current.findIndex(
          (entry) => entry.media_type === mediaType && entry.media_id === mediaId
        );
        if (index === -1) return [...current, next];
        const updated = [...current];
        updated[index] = { ...updated[index], ...next };
        return updated;
      });
    }

    window.addEventListener('binge:ratingSaved', onRatingSaved);
    return () => window.removeEventListener('binge:ratingSaved', onRatingSaved);
  }, []);

  async function handleRemoveContinueWatching(id) {
    setContinueWatchingItems(prev => prev.filter(item => item.id !== id));
    try {
      await removeSupabaseContinueWatching(id);
    } catch {
      // Re-fetching on next visit will reconcile if the delete failed.
    }
  }

  // Bottom-nav "For You" tab links to /home#for-you.
  useEffect(() => {
    if (location.hash !== '#for-you' || authLoading || !userId) return;
    document.getElementById('for-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, authLoading, userId, personal]);

  const myList = useMemo(
    () => excludeRated(watchlistItems, ratingsItems)
      .filter((item) => item.status !== 'watched' && item.status !== 'read')
      .map((item) => ({ ...asTitle(item), _progressLabel: computeProgressBadge(item) })),
    [watchlistItems, ratingsItems]
  );

  const tasteRows = useMemo(() => tasteRowDefinitions(personal?.taste, kidsSafe), [personal?.taste, kidsSafe]);
  const headlineRows = useMemo(() => ({
    movie: rowsFor('movie', { kidsSafe })[0],
    tv_show: rowsFor('tv_show', { kidsSafe })[0],
    newMovies: rowsFor('movie', { kidsSafe }).find((definition) => definition.id === 'new'),
  }), [kidsSafe]);

  const name = activeProfile?.name || user?.username;

  // Home-screen shortcut "Continue Watching" (manifest) lands here.
  useEffect(() => {
    if (!jumpToContinue || !continueWatchingItems.length) return;
    const row = document.getElementById('continue-watching');
    row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    row?.querySelector('.st-card')?.focus({ preventScroll: true });
  }, [jumpToContinue, continueWatchingItems.length]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content st-home">
        <PullToRefresh onRefresh={handleRefresh} disabled={authLoading || !user}>
        {(authLoading || !user) ? (
          <div className="loading-state">Loading dashboard...</div>
        ) : (
        <>
        <BrowseHero items={heroItems} kicker={`Welcome back, ${name}`} />

        <div className="st-rows">
          {continueWatchingItems.length > 0 && (
            <div id="continue-watching" className="st-anchor">
            <TitleRow
              title={`Continue Watching for ${name}`}
              items={continueWatchingItems}
              eager
              renderItem={(item, index) => (
                <ContinueWatchingCard item={item} onRemove={handleRemoveContinueWatching} priority={index < 6} />
              )}
            />
            </div>
          )}

          {newEpisodes.length > 0 && (
            <TitleRow
              title="New Episodes"
              subtitle="New in shows you’re watching"
              items={newEpisodes}
              action={<NotifyButton />}
              renderItem={(item) => (
                <TitleCard
                  item={item}
                  to={`/tv-show/${item.id}?play=1&season=${item.current_season}&episode=${item.current_episode}`}
                  showMatch={false}
                />
              )}
            />
          )}

          <div id="for-you" />
          {personal?.hasHistory && personal.topPicks.length > 0 && (
            <TitleRow
              title={`Top Picks for ${name}`}
              subtitle="Based on what you watch and how you rate it"
              items={personal.topPicks}
              eager
            />
          )}
          {personal && !personal.hasHistory && (
            <div className="st-coldstart">
              <p>Rate or watch a few titles and binge. will start building rows just for you — or bring your history from Letterboxd, IMDb, Trakt or Netflix.</p>
              <div className="st-coldstart-actions">
                <Link className="st-btn st-btn--primary" to="/import">Import my history</Link>
                <Link className="st-btn st-btn--ghost" to="/movies">Find something to watch</Link>
              </div>
            </div>
          )}

          {personal?.becauseYouWatched?.[0] && (
            <TitleRow title={personal.becauseYouWatched[0].title} items={personal.becauseYouWatched[0].items} />
          )}

          <TitleRow
            key={`top10-tv-${refreshKey}`}
            title={kidsSafe ? 'Popular Kids Series' : 'Top 10 Series This Week'}
            ranked={!kidsSafe}
            load={() => loadRowItems(headlineRows.tv_show, 'tv_show', { kidsSafe }).then((items) => items.slice(0, kidsSafe ? 30 : 10))}
          />

          {myList.length > 0 && <TitleRow title="My List" items={myList} />}

          {personal?.becauseYouWatched?.slice(1, 3).map((row) => (
            <TitleRow key={row.id} title={row.title} items={row.items} />
          ))}

          <TitleRow
            key={`top10-movie-${refreshKey}`}
            title={kidsSafe ? 'Popular Kids Movies' : 'Top 10 Movies This Week'}
            ranked={!kidsSafe}
            load={() => loadRowItems(headlineRows.movie, 'movie', { kidsSafe }).then((items) => items.slice(0, kidsSafe ? 30 : 10))}
          />

          {tasteRows.map((definition) => (
            <TitleRow
              key={`${definition.mediaType}-${definition.id}-${refreshKey}`}
              title={definition.title}
              load={() => loadRowItems(definition, definition.mediaType, { kidsSafe })}
              minItems={5}
            />
          ))}

          {personal?.becauseYouWatched?.slice(3).map((row) => (
            <TitleRow key={row.id} title={row.title} items={row.items} />
          ))}

          {headlineRows.newMovies && (
            <TitleRow
              key={`new-movies-${refreshKey}`}
              title="New Movies"
              load={() => loadRowItems(headlineRows.newMovies, 'movie', { kidsSafe })}
              minItems={5}
            />
          )}

          {!kidsSafe && (
            <TitleRow key={`books-${refreshKey}`} title="Books for You" load={loadBookPicks} minItems={3} />
          )}
        </div>

        <div className="home-sections st-home-stats">
          <ProfileStatsHeader user={user} activeProfile={activeProfile} watchlist={watchlistItems} ratings={ratingsItems} />
          {dataLoading && <div className="loading-state">Loading your library…</div>}
        </div>
        </>
        )}
        </PullToRefresh>
      </main>
    </div>
  );
}

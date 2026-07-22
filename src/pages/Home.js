import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import PullToRefresh from '../components/PullToRefresh';
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
import { detailsUrl, resumeUrl, computeProgressBadge } from '../utils/continueWatching';
import { excludeRated, computeWatchMinutes, countCompleted } from '../utils/libraryStats';
import { getCached, setCached, buildUserDataCacheKey } from '../utils/sessionCache';
import { FilmSlate, MonitorPlay, BookOpen } from '@phosphor-icons/react';

const MEDIA_ICONS = {
  movie: FilmSlate,
  tv_show: MonitorPlay,
  book: BookOpen,
};

function MediaTypeIcon({ type, size = 16 }) {
  const Icon = MEDIA_ICONS[type];
  if (!Icon) return null;
  return <Icon size={size} weight="bold" aria-hidden="true" />;
}

// Edge fade — matches the genre-bar scroll fade, but only shown when the
// row actually has enough items to scroll (checked on mount, on scroll,
// and whenever the row resizes or its item count changes).
function useEdgeFade(items) {
  const ref = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });

    // Not every environment has ResizeObserver (e.g. jsdom in tests) —
    // the scroll listener + the mount/items-change check above still
    // cover the cases that matter, this just adds live resize tracking.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkScroll) : null;
    ro?.observe(el);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro?.disconnect();
    };
  }, [items, checkScroll]);

  return { ref, canLeft, canRight };
}

function resolvePosterUrl(url) {
  if (!url) return null;

  try {
    if (url.includes('plex.tv')) {
      const parsed = new URL(url);
      const inner = parsed.searchParams.get('url');
      if (inner) {
        try {
          return decodeURIComponent(inner);
        } catch {
          return inner;
        }
      }
    }
  } catch {
    return url;
  }

  return url;
}

const HERO_TYPE_LABELS = { movie: 'Movie', tv_show: 'Series', book: 'Book' };

function StreamHero({ user, activeProfile, continueWatchingItems, watchlistItems }) {
  const location = useLocation();
  const inProgressItem = continueWatchingItems.find(
    (item) => resolvePosterUrl(item.image_url || item.poster_url)
  ) || null;
  const libraryItem = watchlistItems.find(
    (item) => resolvePosterUrl(item.image_url || item.poster_url)
  ) || null;
  const heroItem = inProgressItem || libraryItem;
  const poster = heroItem ? resolvePosterUrl(heroItem.image_url || heroItem.poster_url) : null;
  const inProgress = Boolean(inProgressItem) && heroItem === inProgressItem;

  return (
    <section className="stream-hero">
      {poster && (
        <div
          className="stream-hero-backdrop"
          style={{ backgroundImage: `url(${poster})` }}
          aria-hidden="true"
        />
      )}
      <div className="stream-hero-scrim" aria-hidden="true" />
      <div className="stream-hero-content">
        <p className="stream-hero-kicker">Welcome back, {activeProfile?.name || user.username}</p>
        <h1 className="stream-hero-title">
          {heroItem ? heroItem.title : 'What will you binge tonight?'}
        </h1>
        <div className="stream-hero-meta">
          {heroItem ? (
            <>
              <span className="stream-hero-chip">
                {HERO_TYPE_LABELS[heroItem.media_type] || 'Title'}
              </span>
              {heroItem.year && <span>{heroItem.year}</span>}
              <span className="stream-hero-dot">•</span>
              <span>{inProgress ? 'Continue where you left off' : 'From your library'}</span>
            </>
          ) : (
            <span>Pick up where you left off or discover something new.</span>
          )}
        </div>
        <div className="stream-hero-actions">
          {heroItem ? (
            <>
              <Link
                className="btn-primary"
                to={inProgress ? resumeUrl(heroItem) : detailsUrl(heroItem)}
                state={{ backgroundLocation: location }}
              >
                {inProgress ? 'Resume' : 'Details'}
              </Link>
              <Link className="btn-secondary" to="/profile">My Library</Link>
            </>
          ) : (
            <>
              <Link className="btn-primary" to="/movies">Browse Movies</Link>
              <Link className="btn-secondary" to="/tv-shows">Browse Series</Link>
            </>
          )}
        </div>
      </div>
      {poster && (
        <img
          className="stream-hero-poster"
          src={poster}
          alt={heroItem.title}
          referrerPolicy="no-referrer"
          loading="eager"
          fetchPriority="high"
        />
      )}
    </section>
  );
}

function ContinueWatchingCard({ item, onRemove, priority }) {
  const location = useLocation();
  const poster = resolvePosterUrl(item.image_url || item.poster_url);
  const url = resumeUrl(item);
  const progressBadge = computeProgressBadge(item);

  return (
    <div className="cw-card-wrap">
      <Link to={url} className="profile-wl-card profile-wl-card--own" state={{ backgroundLocation: location }}>
        <div className="profile-wl-poster">
          {poster
            ? (
              <img
                src={poster}
                alt={item.title}
                referrerPolicy="no-referrer"
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : 'auto'}
                decoding="async"
              />
            )
            : <div className="profile-wl-placeholder"><MediaTypeIcon type={item.media_type} size={24} /></div>
          }
          {progressBadge && <span className="profile-wl-progress-badge">{progressBadge}</span>}
        </div>
        <p className="profile-wl-title">{item.title || '—'}</p>
        {item.year && <p className="profile-wl-year">{item.year}</p>}
      </Link>
      <button
        type="button"
        className="cw-remove-btn"
        title="Remove from Continue Watching"
        aria-label={`Remove ${item.title} from Continue Watching`}
        onClick={(event) => { event.preventDefault(); onRemove(item.id); }}
      >
        ✕
      </button>
    </div>
  );
}

// Uses the same card markup as the Library section below it (LibraryCard /
// .profile-wl-card) rather than ForYouSection's cards, minus the Library
// section's type filter bar — clicking a card resumes playback directly
// (see resumeUrl) instead of opening the details view.
function ContinueWatching({ items, onRemove }) {
  const { ref: cwRowRef, canLeft: cwCanLeft, canRight: cwCanRight } = useEdgeFade(items);
  if (!items.length) return null;

  return (
    <section className="home-section">
      <div className="section-header">
        <h2>Continue Watching</h2>
      </div>
      <div className="mr-track-wrap">
        <div className="profile-watchlist-row" ref={cwRowRef}>
          {items.map((item, index) => (
            <ContinueWatchingCard key={item.id} item={item} onRemove={onRemove} priority={index < 4} />
          ))}
        </div>
        {cwCanLeft && <div className="mr-fade mr-fade-left" />}
        {cwCanRight && <div className="mr-fade mr-fade-right" />}
      </div>
    </section>
  );
}

const FOR_YOU_LABELS = { movie: 'Movie', tv_show: 'Series', book: 'Book' };
const FOR_YOU_ROWS = [
  { mediaType: 'movie', heading: 'Movies For You' },
  { mediaType: 'tv_show', heading: 'Series For You' },
  { mediaType: 'book', heading: 'Books For You' },
];

function ForYouCard({ rec }) {
  const location = useLocation();
  return (
    <Link to={rec.siteUrl} className="foryou-card" state={{ backgroundLocation: location }}>
      <div className="foryou-card-poster">
        {rec.posterUrl ? (
          <img src={rec.posterUrl} alt={rec.title} loading="lazy" decoding="async" />
        ) : (
          <div className="foryou-card-placeholder"><MediaTypeIcon type={rec.media_type} size={28} /></div>
        )}
      </div>
      <div className="foryou-card-body">
        <div className="foryou-card-type">
          <MediaTypeIcon type={rec.media_type} /> {FOR_YOU_LABELS[rec.media_type]}
          {rec.year && <span className="foryou-card-year">{rec.year}</span>}
        </div>
        <h4 className="foryou-card-title">{rec.title}</h4>
        {rec.genre && <p className="foryou-card-genre">{rec.genre.split(',')[0].trim()}</p>}
      </div>
    </Link>
  );
}

// One row per media type, fetched and shown independently and simultaneously
// (Netflix/Hulu-style sectioned rows) rather than one mixed list behind a tab
// switcher — so "Movies", "Series", and "Books" never blur into one pile.
function ForYouRow({ mediaType, heading, ready, refreshSignal, kidsSafe }) {
  const [state, setState] = useState('idle');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const result = await generateSupabaseTypeRecommendations(mediaType, kidsSafe);
      setData(result);
      setState(result.recommendations?.length ? 'done' : 'empty');
    } catch (err) {
      setError(String(err?.message || '').trim() || 'Something went wrong.');
      setState('error');
    }
  }, [mediaType, kidsSafe]);

  useEffect(() => {
    if (ready && state === 'idle') fetchData();
  }, [ready, state, fetchData]);

  // activeProfile (and so kidsSafe) resolves asynchronously after mount —
  // often after the 'idle' fetch above has already fired with the wrong
  // (stale) kidsSafe value. Re-fetch specifically when kidsSafe changes post-
  // mount so switching into/out of a kids profile actually re-filters this
  // row instead of leaving it showing whatever the first, pre-resolution
  // fetch returned.
  const previousKidsSafe = useRef(kidsSafe);
  useEffect(() => {
    if (previousKidsSafe.current === kidsSafe) return;
    previousKidsSafe.current = kidsSafe;
    if (ready && state !== 'idle') fetchData();
  }, [kidsSafe, ready, state, fetchData]);

  // Pull-to-refresh signal — re-run on demand. The ref skips the very first
  // run (mount), which the effect above already covers via the 'idle' check.
  const skippedFirstRefresh = useRef(true);
  useEffect(() => {
    if (skippedFirstRefresh.current) {
      skippedFirstRefresh.current = false;
      return;
    }
    if (!ready) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const { ref: foryouRowRef, canLeft: foryouCanLeft, canRight: foryouCanRight } = useEdgeFade(data?.recommendations);

  if (state === 'idle') return null;

  return (
    <section className="home-section">
      <div className="section-header">
        <h2>{heading}</h2>
      </div>

      <div className="foryou-section">
        {state === 'loading' && (
          <div className="foryou-loading">
            <div className="foryou-loading-owl">🍿</div>
            <p>Matching your taste...</p>
            <div className="foryou-loading-dots"><span /><span /><span /></div>
          </div>
        )}

        {state === 'error' && (
          <div className="foryou-error">
            <p>⚠️ {error}</p>
            <button type="button" className="foryou-generate-btn" onClick={fetchData}>Try again</button>
          </div>
        )}

        {state === 'empty' && (
          <div className="foryou-idle">
            <p className="foryou-idle-text">
              {data?.message || 'Rate some movies, TV shows, or books first to unlock personalized recommendations!'}
            </p>
            <Link to="/movies" className="foryou-generate-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Browse & Rate Media
            </Link>
          </div>
        )}

        {state === 'done' && data && (
          <div className="mr-track-wrap">
            <div className="foryou-grid" ref={foryouRowRef}>
              {data.recommendations.map((rec) => (
                <ForYouCard key={`${rec.media_type}:${rec.id}`} rec={rec} />
              ))}
            </div>
            {foryouCanLeft && <div className="mr-fade mr-fade-left" />}
            {foryouCanRight && <div className="mr-fade mr-fade-right" />}
          </div>
        )}
      </div>
    </section>
  );
}

function ForYouSection({ ready, refreshSignal, kidsSafe }) {
  return (
    <div id="for-you">
      {FOR_YOU_ROWS.map((row) => (
        <ForYouRow
          key={row.mediaType}
          mediaType={row.mediaType}
          heading={row.heading}
          ready={ready}
          refreshSignal={refreshSignal}
          kidsSafe={kidsSafe}
        />
      ))}
    </div>
  );
}

function LibraryCard({ item, ratingScore }) {
  const location = useLocation();

  // Library always opens the media card (details view) — auto-play is
  // reserved for the Continue Watching row, which resumes at the saved point.
  const mediaUrl = item.media_type === 'movie'
    ? `/movie/${item.media_id}`
    : item.media_type === 'tv_show'
    ? `/tv-show/${item.media_id}`
    : `/book/${item.media_id}`;

  const poster = resolvePosterUrl(item.poster_url || item.image_url);
  const progressBadge = computeProgressBadge(item);

  const ratingOutOfFive = ratingScore != null ? ratingScore.toFixed(1) : null;

  return (
    <Link
      to={mediaUrl}
      className="profile-wl-card profile-wl-card--own"
      state={{ backgroundLocation: location }}
    >
      <div className="profile-wl-poster">
        {poster
          ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" loading="lazy" decoding="async" />
          : <div className="profile-wl-placeholder"><MediaTypeIcon type={item.media_type} size={24} /></div>}
        {progressBadge && <span className="profile-wl-progress-badge">{progressBadge}</span>}
        {ratingOutOfFive != null && (
          <span className="profile-wl-status-ind profile-wl-status-ind--rated" title={`Rated ${ratingOutOfFive}/5`}>
            <span className="profile-wl-status-ind-num">{ratingOutOfFive}</span>
            <span className="profile-wl-status-ind-den">/5</span>
          </span>
        )}
      </div>
      <p className="profile-wl-title">{item.title || '—'}</p>
      {item.year && <p className="profile-wl-year">{item.year}</p>}
    </Link>
  );
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

  return (
    <section className="home-section dashboard-section">
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          {activeProfile ? (
            <ProfileAvatar profile={activeProfile} size={72} />
          ) : (
            <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
          )}
        </div>
        <div className="profile-info">
          <h1 className="profile-username">{activeProfile?.name || user.username}</h1>
          <p className="profile-minutes">
            <span className="profile-minutes-num">{stats.minutes.toLocaleString()}</span> minutes watched
          </p>
        </div>
        <div className="profile-actions profile-actions--stacked">
          <Link to={activeProfile && !activeProfile.is_default ? '/profiles' : '/account-settings'} className="btn-ghost">
            {activeProfile && !activeProfile.is_default ? 'Manage Profiles' : 'Edit Profile'}
          </Link>
          <div className="profile-stat-squares">
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.completed}</span>
              <span className="profile-stat-square-label">Completed</span>
            </div>
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.inProgress}</span>
              <span className="profile-stat-square-label">In Progress</span>
            </div>
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.totalRatings}</span>
              <span className="profile-stat-square-label">Ratings</span>
            </div>
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.avg}</span>
              <span className="profile-stat-square-label">Avg Score</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LibrarySection({ watchlist, ratings, loading }) {
  const [wlTypeFilter, setWlTypeFilter] = useState('');

  // Rated titles belong to Ratings & Reviews, not the library grid.
  const libraryWatchlist = excludeRated(watchlist, ratings);
  const filteredWatchlist = libraryWatchlist.filter(item => {
    return !wlTypeFilter || item.media_type === wlTypeFilter;
  });

  const { ref: libraryRowRef, canLeft: libraryCanLeft, canRight: libraryCanRight } = useEdgeFade(filteredWatchlist);

  const ratingScores = useMemo(() => {
    const map = new Map();
    ratings.forEach(r => {
      const score = computeStarRating(r.media_type, r);
      if (score != null) map.set(`${r.media_type}:${r.media_id}`, score);
    });
    return map;
  }, [ratings]);

  return (
    <section className="home-section">
      <div className="section-header">
        <h2>Library</h2>
      </div>

      <div className="profile-wl-filters">
        <div className="books-tab-bar books-tab-bar--inline">
          {[
            { value: '', label: 'All', Icon: null },
            { value: 'movie', label: 'Movies', Icon: FilmSlate },
            { value: 'tv_show', label: 'Series', Icon: MonitorPlay },
            { value: 'book', label: 'Books', Icon: BookOpen },
          ].map(t => (
            <button key={t.value} className={`books-tab ${wlTypeFilter === t.value ? 'active' : ''}`} onClick={() => setWlTypeFilter(t.value)} type="button">
              {t.Icon && <t.Icon size={16} weight="bold" aria-hidden="true" />} {t.label}
            </button>
          ))}
        </div>
        <span className="profile-filter-count">{filteredWatchlist.length} items</span>
      </div>

      {loading ? (
        <div className="loading-state">Loading library...</div>
      ) : filteredWatchlist.length === 0 ? (
        <div className="empty-state">
          <p>Your library is empty.</p>
          <Link to="/movies" className="btn-secondary" style={{ marginTop: '1rem', display: 'inline-block' }}>Browse the catalog</Link>
        </div>
      ) : (
        <div className="mr-track-wrap">
          <div className="profile-watchlist-row" ref={libraryRowRef}>
            {filteredWatchlist.map((item, i) => (
              <LibraryCard
                key={item.id ?? i}
                item={item}
                ratingScore={ratingScores.get(`${item.media_type}:${item.media_id}`) ?? null}
              />
            ))}
          </div>
          {libraryCanLeft && <div className="mr-fade mr-fade-left" />}
          {libraryCanRight && <div className="mr-fade mr-fade-right" />}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const { user, authLoading, activeProfile, profilesLoading } = useAuth();
  const location = useLocation();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ratingsItems, setRatingsItems] = useState([]);
  const [continueWatchingItems, setContinueWatchingItems] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  const userId = user?.id;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const profileId = activeProfile?.id || null;

  // Lifted out of the mount effect (rather than an inline async function
  // inside it) so pull-to-refresh can call the exact same fetch again later.
  // Stale-while-revalidate: the mount effect below hydrates instantly from
  // cache when there's a hit, but this function always does the real fetch
  // and re-caches the result, so data self-heals within a session.
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

      const ratingsData = ratingsResult.status === 'fulfilled' ? ratingsResult.value : [];
      const watchlistData = watchlistResult.status === 'fulfilled' ? watchlistResult.value : [];
      const continueWatchingData = continueWatchingResult.status === 'fulfilled' ? continueWatchingResult.value : [];
      const nextRatings = Array.isArray(ratingsData) ? ratingsData : [];
      const nextWatchlist = Array.isArray(watchlistData) ? watchlistData : [];
      const nextContinueWatching = Array.isArray(continueWatchingData) ? continueWatchingData : [];
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

  const [foryouRefreshSignal, setForyouRefreshSignal] = useState(0);

  async function handleRefresh() {
    setForyouRefreshSignal((n) => n + 1);
    await fetchStats();
  }

  // The details overlay that saves a rating is a separately-mounted screen
  // on top of Home (background-location routing), so it can't update Home's
  // own state directly — it broadcasts instead. Merge the new rating in
  // immediately so the Library hover-rating badge reflects it right away,
  // rather than only after Home's next full data fetch.
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

  // Bottom-nav "For You" tab links to /home#for-you — scroll it into view
  // once the section has actually mounted (gated behind authLoading below).
  useEffect(() => {
    if (location.hash !== '#for-you' || authLoading || !userId) return;
    document.getElementById('for-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, authLoading, userId]);

  return (
    <>
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <PullToRefresh onRefresh={handleRefresh} disabled={authLoading || !user}>
        {(authLoading || !user) ? (
          <div className="loading-state">Loading dashboard...</div>
        ) : (
        <>
        <StreamHero user={user} activeProfile={activeProfile} continueWatchingItems={continueWatchingItems} watchlistItems={watchlistItems} />

        <div className="home-sections">
          <ProfileStatsHeader user={user} activeProfile={activeProfile} watchlist={watchlistItems} ratings={ratingsItems} />

          <ContinueWatching items={continueWatchingItems} onRemove={handleRemoveContinueWatching} />

          <LibrarySection
            watchlist={watchlistItems}
            ratings={ratingsItems}
            loading={dataLoading}
          />

          <ForYouSection ready={!authLoading && !!user && !profilesLoading} refreshSignal={foryouRefreshSignal} kidsSafe={Boolean(activeProfile?.is_kids)} />
        </div>
        </>
        )}
        </PullToRefresh>
      </main>
    </div>
    </>
  );
}

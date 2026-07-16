import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Onboarding from '../components/Onboarding';
import PullToRefresh from '../components/PullToRefresh';
import { computeStarRating } from '../components/RatingArtifact';
import UserAvatar from '../components/UserAvatar';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
  fetchSupabaseContinueWatching,
  removeSupabaseContinueWatching,
} from '../utils/supabaseData';
import { generateSupabaseRecommendations, generateSupabaseTypeRecommendations } from '../utils/recommendations';
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

function detailsUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}`;
  if (item.media_type === 'tv_show') return `/tv-show/${item.media_id}`;
  if (item.media_type === 'book') return `/book/${item.media_id}`;
  return '/home';
}

function resumeUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}?play=1`;
  if (item.media_type === 'tv_show') {
    const params = new URLSearchParams({ play: '1' });
    if (item.current_season) params.set('season', item.current_season);
    if (item.current_episode) params.set('episode', item.current_episode);
    return `/tv-show/${item.media_id}?${params.toString()}`;
  }
  return detailsUrl(item);
}

function StreamHero({ user, continueWatchingItems, watchlistItems }) {
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
        <p className="stream-hero-kicker">Welcome back, {user.username}</p>
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
        />
      )}
    </section>
  );
}

function ContinueWatchingCard({ item, onRemove }) {
  const location = useLocation();
  const poster = resolvePosterUrl(item.image_url || item.poster_url);
  const url = resumeUrl(item);

  const s  = item.current_season;
  const e  = item.current_episode;
  const ch = item.current_chapter;
  const pg = item.current_page;

  const progressBadge = item.media_type === 'tv_show' && (s || e)
    ? `S${s || 1} · E${e || 1}`
    : item.media_type === 'book' && (ch || pg)
    ? (ch ? `Ch ${ch}` : `Pg ${pg}`)
    : null;

  return (
    <div className="cw-card-wrap">
      <Link to={url} className="profile-wl-card profile-wl-card--own" state={{ backgroundLocation: location }}>
        <div className="profile-wl-poster">
          {poster
            ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
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
          {items.map(item => (
            <ContinueWatchingCard key={item.id} item={item} onRemove={onRemove} />
          ))}
        </div>
        {cwCanLeft && <div className="mr-fade mr-fade-left" />}
        {cwCanRight && <div className="mr-fade mr-fade-right" />}
      </div>
    </section>
  );
}

const FOR_YOU_TABS = [
  { id: 'all', label: 'All', Icon: null },
  { id: 'movie', label: 'Movies', Icon: FilmSlate },
  { id: 'tv_show', label: 'Series', Icon: MonitorPlay },
  { id: 'book', label: 'Books', Icon: BookOpen },
];
const FOR_YOU_LABELS = { movie: 'Movie', tv_show: 'Series', book: 'Book' };
const FOR_YOU_IDLE_STATE = { all: 'idle', movie: 'idle', tv_show: 'idle', book: 'idle' };

function ForYouCard({ rec }) {
  const location = useLocation();
  return (
    <Link to={rec.siteUrl} className="foryou-card" state={{ backgroundLocation: location }}>
      <div className="foryou-card-poster">
        {rec.posterUrl ? (
          <img src={rec.posterUrl} alt={rec.title} />
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

function ForYouSection({ ready, refreshSignal }) {
  const [activeType, setActiveType]     = useState('all');
  const [tabState, setTabState]         = useState(FOR_YOU_IDLE_STATE);
  const [tabData, setTabData]           = useState({});
  const [tabError, setTabError]         = useState({});

  const fetchType = useCallback(async (mediaType) => {
    setTabState((prev) => ({ ...prev, [mediaType]: 'loading' }));
    setTabError((prev) => ({ ...prev, [mediaType]: '' }));
    try {
      const result = mediaType === 'all'
        ? await generateSupabaseRecommendations()
        : await generateSupabaseTypeRecommendations(mediaType);
      setTabData((prev) => ({ ...prev, [mediaType]: result }));
      setTabState((prev) => ({ ...prev, [mediaType]: result.recommendations?.length ? 'done' : 'empty' }));
    } catch (err) {
      setTabError((prev) => ({ ...prev, [mediaType]: String(err?.message || '').trim() || 'Something went wrong.' }));
      setTabState((prev) => ({ ...prev, [mediaType]: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (ready && tabState[activeType] === 'idle') fetchType(activeType);
  }, [ready, activeType, tabState, fetchType]);

  // Pull-to-refresh signal — re-run the active tab's fetch on demand. The
  // ref skips the very first run (mount), which the effect above already
  // covers via the 'idle' check.
  const skippedFirstRefresh = useRef(true);
  useEffect(() => {
    if (skippedFirstRefresh.current) {
      skippedFirstRefresh.current = false;
      return;
    }
    if (!ready) return;
    fetchType(activeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const state = tabState[activeType];
  const data = tabData[activeType];
  const error = tabError[activeType];
  const { ref: foryouRowRef, canLeft: foryouCanLeft, canRight: foryouCanRight } = useEdgeFade(data?.recommendations);

  return (
    <section className="home-section" id="for-you">
      <div className="section-header">
        <h2>For You</h2>
      </div>

      <div className="profile-wl-filters">
        <div className="books-tab-bar books-tab-bar--inline">
          {FOR_YOU_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`books-tab ${activeType === tab.id ? 'active' : ''}`}
              onClick={() => setActiveType(tab.id)}
            >
              {tab.Icon && <tab.Icon size={16} weight="bold" aria-hidden="true" />} {tab.label}
            </button>
          ))}
        </div>
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
            <button type="button" className="foryou-generate-btn" onClick={() => fetchType(activeType)}>Try again</button>
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

  const progressBadge = item.media_type === 'tv_show' && (item.current_season || item.current_episode)
    ? `S${item.current_season || '?'} · E${item.current_episode || '?'}`
    : item.media_type === 'book' && (item.current_chapter || item.current_page)
    ? [item.current_chapter ? `Ch ${item.current_chapter}` : null, item.current_page ? `Pg ${item.current_page}` : null].filter(Boolean).join(' · ')
    : null;

  const ratingOutOfFive = ratingScore != null ? ratingScore.toFixed(1) : null;

  return (
    <Link
      to={mediaUrl}
      className="profile-wl-card profile-wl-card--own"
      state={{ backgroundLocation: location }}
    >
      <div className="profile-wl-poster">
        {poster
          ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
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

function ProfileStatsHeader({ user, watchlist, ratings }) {
  const stats = useMemo(() => {
    const completed  = watchlist.filter(i => i.status === 'watched' || i.status === 'read').length;
    const inProgress = watchlist.filter(i => i.status === 'watching' || i.status === 'reading').length;

    const scores = ratings.map(r => computeStarRating(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

    // The catalog has no per-title runtime data, so estimate: watched
    // movies at ~115 min each, tracked TV progress at ~45 min/episode
    // assuming ~10 episodes per season.
    let minutes = 0;
    watchlist.forEach(i => {
      if (i.media_type === 'movie' && i.status === 'watched') minutes += 115;
      if (i.media_type === 'tv_show') {
        const season  = Number(i.current_season)  || 0;
        const episode = Number(i.current_episode) || 0;
        if (season || episode) minutes += (Math.max(season - 1, 0) * 10 + episode) * 45;
      }
    });

    return { completed, inProgress, avg, minutes, totalRatings: ratings.length };
  }, [watchlist, ratings]);

  return (
    <section className="home-section dashboard-section">
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
        </div>
        <div className="profile-info">
          <h1 className="profile-username">{user.username}</h1>
          <p className="profile-minutes">
            <span className="profile-minutes-num">{stats.minutes.toLocaleString()}</span> minutes watched
          </p>
        </div>
        <div className="profile-actions profile-actions--stacked">
          <Link to="/account-settings" className="btn-ghost">Edit Profile</Link>
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

  const filteredWatchlist = watchlist.filter(item => {
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
  const { user, authLoading } = useAuth();
  const location = useLocation();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ratingsItems, setRatingsItems] = useState([]);
  const [continueWatchingItems, setContinueWatchingItems] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const onboardingKey = `onboarding_done_${user?.id || user?.username}`;

  const userId = user?.id;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Lifted out of the mount effect (rather than an inline async function
  // inside it) so pull-to-refresh can call the exact same fetch again later.
  const fetchStats = useCallback(async () => {
    setDataLoading(true);
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
      if (nextRatings.length === 0 && !localStorage.getItem(onboardingKey)) {
        setShowOnboarding(true);
      }
    } catch {
      if (!mountedRef.current) return;
      setWatchlistItems([]);
      setRatingsItems([]);
      setContinueWatchingItems([]);
      if (!localStorage.getItem(onboardingKey)) {
        setShowOnboarding(true);
      }
    } finally {
      if (mountedRef.current) setDataLoading(false);
    }
  }, [onboardingKey]);

  useEffect(() => {
    if (authLoading || !userId) return;
    fetchStats();
  }, [authLoading, userId, fetchStats]);

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

  function completeOnboarding() {
    localStorage.setItem(onboardingKey, '1');
    setShowOnboarding(false);
  }

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
    {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <PullToRefresh onRefresh={handleRefresh} disabled={authLoading || !user}>
        {(authLoading || !user) ? (
          <div className="loading-state">Loading dashboard...</div>
        ) : (
        <>
        <StreamHero user={user} continueWatchingItems={continueWatchingItems} watchlistItems={watchlistItems} />

        <div className="home-sections">
          <ProfileStatsHeader user={user} watchlist={watchlistItems} ratings={ratingsItems} />

          <ContinueWatching items={continueWatchingItems} onRemove={handleRemoveContinueWatching} />

          <LibrarySection
            watchlist={watchlistItems}
            ratings={ratingsItems}
            loading={dataLoading}
          />

          <ForYouSection ready={!authLoading && !!user} refreshSignal={foryouRefreshSignal} />
        </div>
        </>
        )}
        </PullToRefresh>
      </main>
    </div>
    </>
  );
}

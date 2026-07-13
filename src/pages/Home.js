import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Onboarding from '../components/Onboarding';
import { useAuth } from '../contexts/AuthContext';
import { fetchSupabaseRatings, fetchSupabaseWatchlist } from '../utils/supabaseData';

const MEDIA_ICONS = {
  movie: '\ud83c\udfac',
  tv_show: '\ud83d\udcfa',
  book: '\ud83d\udcda',
};

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
  if (item.media_type === 'movie') return `/movies?open=${item.media_id}`;
  if (item.media_type === 'tv_show') return `/tv-shows?open=${item.media_id}`;
  if (item.media_type === 'book') return `/books?open=${item.media_id}`;
  return '/watchlist';
}

function resumeUrl(item) {
  if (item.media_type === 'movie') return `/movies?open=${item.media_id}&play=1`;
  if (item.media_type === 'tv_show') return `/tv-shows?open=${item.media_id}&play=1`;
  return detailsUrl(item);
}

function StreamHero({ user, watchlistItems }) {
  const withPoster = watchlistItems.filter(
    (item) => resolvePosterUrl(item.image_url || item.poster_url)
  );
  const heroItem =
    withPoster.find((item) => item.status === 'watching' || item.status === 'reading') ||
    withPoster[0] ||
    null;
  const poster = heroItem ? resolvePosterUrl(heroItem.image_url || heroItem.poster_url) : null;
  const inProgress = heroItem && (heroItem.status === 'watching' || heroItem.status === 'reading');

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
              <span>{inProgress ? 'Continue where you left off' : 'From your watchlist'}</span>
            </>
          ) : (
            <span>Pick up where you left off or discover something new.</span>
          )}
        </div>
        <div className="stream-hero-actions">
          {heroItem ? (
            <>
              <Link className="btn-primary" to={inProgress ? resumeUrl(heroItem) : detailsUrl(heroItem)}>
                {inProgress ? 'Resume' : 'Details'}
              </Link>
              <Link className="btn-secondary" to="/watchlist">My Watchlist</Link>
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

function ContinueWatching({ items }) {
  const inProgress = items.filter(
    i => i.status === 'watching' || i.status === 'reading'
  );
  if (!inProgress.length) return null;

  return (
    <section className="home-section">
      <div className="section-header">
        <h2>Continue Watching</h2>
      </div>
      <div className="continue-watching-row">
        {inProgress.map(item => {
          const poster = resolvePosterUrl(item.image_url || item.poster_url);
          const url = resumeUrl(item);

          const s  = item.current_season;
          const e  = item.current_episode;
          const ch = item.current_chapter;
          const pg = item.current_page;

          let badge = null;
          let sub   = null;
          if (item.media_type === 'tv_show' && (s || e)) {
            badge = `S${s || 1} E${e || 1}`;
            sub   = `Season ${s || 1}, Ep ${e || 1}`;
          } else if (item.media_type === 'book' && (ch || pg)) {
            badge = ch ? `Ch ${ch}` : `Pg ${pg}`;
            sub   = [ch ? `Chapter ${ch}` : null, pg ? `Page ${pg}` : null].filter(Boolean).join(', ');
          } else {
            sub = item.media_type === 'book' ? 'Reading' : 'Watching';
          }

          return (
            <Link key={item.id} to={url} className="continue-card">
              <div className="continue-card-poster">
                {poster
                  ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                  : <div className="continue-card-placeholder">{MEDIA_ICONS[item.media_type]}</div>
                }
                <div className="continue-card-play">▶</div>
                {badge && <div className="continue-card-badge">{badge}</div>}
              </div>
              <p className="continue-card-title">{item.title}</p>
              <p className="continue-card-sub">{sub}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function WatchlistGallery({ items, loading }) {
  const scrollRef = useRef(null);
  const watchableItems = items.filter((item) => (
    item.media_type === 'movie' || item.media_type === 'tv_show'
  ));

  function scroll(direction) {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: direction * 220, behavior: 'smooth' });
    }
  }

  function getSiteUrl(item) {
    return detailsUrl(item);
  }

  if (loading) {
    return <div className="loading-state" style={{ padding: '2rem' }}>Loading...</div>;
  }

  if (watchableItems.length === 0) {
    return (
      <div className="empty-state">
        <p>Your movie and TV watchlist is empty.</p>
        <p className="empty-hint">Add movies or TV shows to keep your next picks ready.</p>
        <div className="cta-buttons" style={{ marginTop: '1rem' }}>
          <Link to="/movies" className="btn-secondary">Browse movies</Link>
          <Link to="/tv-shows" className="btn-secondary">Browse TV shows</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wl-gallery-wrap">
      {watchableItems.length > 4 && (
        <button
          className="wl-gallery-arrow wl-gallery-arrow--left"
          onClick={() => scroll(-1)}
          type="button"
        >
          {'\u2039'}
        </button>
      )}
      <div className="wl-gallery-scroll" ref={scrollRef}>
        {watchableItems.map((item) => (
          <Link key={item.id} to={getSiteUrl(item)} className="wl-gallery-card">
            <div className="wl-gallery-poster">
              {item.image_url || item.poster_url ? (
                <img
                  src={resolvePosterUrl(item.image_url || item.poster_url)}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="wl-gallery-placeholder">
                  {MEDIA_ICONS[item.media_type] || MEDIA_ICONS.tv_show}
                </div>
              )}
              <div className="wl-gallery-overlay">
                <span className="wl-gallery-type">{MEDIA_ICONS[item.media_type]}</span>
              </div>
            </div>
            <div className="wl-gallery-info">
              <p className="wl-gallery-title">{item.title}</p>
              {item.year && <p className="wl-gallery-year">{item.year}</p>}
            </div>
          </Link>
        ))}
      </div>
      {watchableItems.length > 4 && (
        <button
          className="wl-gallery-arrow wl-gallery-arrow--right"
          onClick={() => scroll(1)}
          type="button"
        >
          {'\u203a'}
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const { user, authLoading } = useAuth();
  const [stats, setStats] = useState({ ratings: 0, watchlist: 0 });
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const onboardingKey = `onboarding_done_${user?.id || user?.username}`;

  useEffect(() => {
    let cancelled = false;

    if (authLoading || !user) {
      setLoading(true);
      return () => {
        cancelled = true;
      };
    }

    async function fetchStats() {
      setLoading(true);

      try {
        const [ratingsResult, watchlistResult] = await Promise.allSettled([
          fetchSupabaseRatings(),
          fetchSupabaseWatchlist(),
        ]);

        if (cancelled) return;

        const ratingsData = ratingsResult.status === 'fulfilled' ? ratingsResult.value : [];
        const watchlistData = watchlistResult.status === 'fulfilled' ? watchlistResult.value : [];
        const nextRatings = Array.isArray(ratingsData) ? ratingsData : [];
        const nextWatchlist = Array.isArray(watchlistData) ? watchlistData : [];
        setWatchlistItems(nextWatchlist);
        setStats({ ratings: nextRatings.length, watchlist: nextWatchlist.length });
        if (nextRatings.length === 0 && !localStorage.getItem(onboardingKey)) {
          setShowOnboarding(true);
        }
      } catch {
        if (cancelled) return;
        setWatchlistItems([]);
        setStats({ ratings: 0, watchlist: 0 });
        // Still show onboarding for fresh accounts even if the data fetch failed
        if (!localStorage.getItem(onboardingKey)) {
          setShowOnboarding(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, [authLoading, onboardingKey, user]);

  function completeOnboarding() {
    localStorage.setItem(onboardingKey, '1');
    setShowOnboarding(false);
  }

  return (
    <>
    {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        {(authLoading || !user) ? (
          <div className="loading-state">Loading dashboard...</div>
        ) : (
        <>
        <StreamHero user={user} watchlistItems={watchlistItems} />

        <div className="home-sections">
          <ContinueWatching items={watchlistItems} />

          <section className="home-section">
            <div className="section-header">
              <h2>Your Watchlist</h2>
              <Link to="/watchlist" className="section-link">View all →</Link>
            </div>
            <WatchlistGallery items={watchlistItems} loading={loading} />
          </section>

          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-number">{stats.ratings}</div>
              <div className="stat-label">Ratings</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{stats.watchlist}</div>
              <div className="stat-label">Saved Titles</div>
            </div>
          </div>

          <section className="home-section surface-panel">
            <div className="section-header">
              <h2>Plan Together</h2>
               <Link to="/lists" className="section-link">Open lists</Link>
            </div>
            <div className="home-action-card">
              <p className="home-panel-copy">
                Create public or private lists, invite collaborators, and let anonymous vibe votes surface the group favorite.
              </p>
              <Link to="/lists" className="btn-secondary">Go to shared lists</Link>
            </div>
          </section>
        </div>
        </>
        )}
      </main>
    </div>
    </>
  );
}

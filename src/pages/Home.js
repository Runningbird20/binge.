import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Onboarding from '../components/Onboarding';
import RequestModal from '../components/RequestModal';
import { useAuth } from '../contexts/AuthContext';
import { fetchSupabaseRatings, fetchSupabaseWatchlist } from '../utils/supabaseData';
import { generateSupabaseTypeRecommendations } from '../utils/recommendations';

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

const FOR_YOU_TABS = [
  { id: 'movie', label: 'Movies', icon: '🎬' },
  { id: 'tv_show', label: 'TV Shows', icon: '📺' },
  { id: 'book', label: 'Books', icon: '📚' },
];
const FOR_YOU_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const FOR_YOU_IDLE_STATE = { movie: 'idle', tv_show: 'idle', book: 'idle' };

function ForYouCard({ rec }) {
  return (
    <a href={rec.siteUrl} className="foryou-card">
      <div className="foryou-card-poster">
        {rec.posterUrl ? (
          <img src={rec.posterUrl} alt={rec.title} />
        ) : (
          <div className="foryou-card-placeholder">{MEDIA_ICONS[rec.media_type]}</div>
        )}
      </div>
      <div className="foryou-card-body">
        <div className="foryou-card-type">
          {MEDIA_ICONS[rec.media_type]} {FOR_YOU_LABELS[rec.media_type]}
          {rec.year && <span className="foryou-card-year">{rec.year}</span>}
        </div>
        <h4 className="foryou-card-title">{rec.title}</h4>
        {rec.genre && <p className="foryou-card-genre">{rec.genre.split(',')[0].trim()}</p>}
        <p className="foryou-card-reason">✨ {rec.reason}</p>
      </div>
    </a>
  );
}

function ForYouSection({ ready }) {
  const [activeType, setActiveType]     = useState('movie');
  const [tabState, setTabState]         = useState(FOR_YOU_IDLE_STATE);
  const [tabData, setTabData]           = useState({});
  const [tabError, setTabError]         = useState({});
  const [showRequestModal, setShowRequestModal] = useState(false);

  const fetchType = useCallback(async (mediaType) => {
    setTabState((prev) => ({ ...prev, [mediaType]: 'loading' }));
    setTabError((prev) => ({ ...prev, [mediaType]: '' }));
    try {
      const result = await generateSupabaseTypeRecommendations(mediaType);
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

  const state = tabState[activeType];
  const data = tabData[activeType];
  const error = tabError[activeType];

  return (
    <section className="home-section surface-panel" id="for-you">
      <div className="section-header">
        <h2>For You</h2>
      </div>

      <div className="tabs">
        {FOR_YOU_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn ${activeType === tab.id ? 'active' : ''}`}
            onClick={() => setActiveType(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
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
          <>
            {data.tasteProfile && (
              <div className="foryou-taste-profile">
                <span className="foryou-taste-label">Your taste</span>
                <p>{data.tasteProfile}</p>
              </div>
            )}
            <div className="foryou-grid">
              {data.recommendations.map((rec) => (
                <ForYouCard key={`${rec.media_type}:${rec.id}`} rec={rec} />
              ))}
            </div>
          </>
        )}
      </div>

      <button type="button" className="btn-ghost" onClick={() => setShowRequestModal(true)}>
        Can't find it? Request media →
      </button>

      {showRequestModal && (
        <RequestModal onClose={() => setShowRequestModal(false)} />
      )}
    </section>
  );
}

export default function Home() {
  const { user, authLoading } = useAuth();
  const location = useLocation();
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

  // Bottom-nav "For You" tab links to /home#for-you — scroll it into view
  // once the section has actually mounted (gated behind authLoading below).
  useEffect(() => {
    if (location.hash !== '#for-you' || authLoading || !user) return;
    document.getElementById('for-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, authLoading, user]);

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
          <ForYouSection ready={!authLoading && !!user} />

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
        </div>
        </>
        )}
      </main>
    </div>
    </>
  );
}

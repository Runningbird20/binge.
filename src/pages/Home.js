import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import ForYou from '../components/ForYou';
import { useAuth } from '../contexts/AuthContext';
import { buildHomeInsights, buildRecapNarrative } from '../homeInsights';
import { fetchSupabaseRatings, fetchSupabaseWatchlist } from '../utils/supabaseData';
import { hasLegacyBackendSession } from '../utils/legacyBackend';

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

function BadgeIcon({ iconKey, label, toneKey }) {
  const commonProps = {
    viewBox: '0 0 64 64',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2.6',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };

  const icons = {
    collection: (
      <svg {...commonProps}>
        <rect x="14" y="18" width="18" height="28" rx="5" />
        <rect x="32" y="14" width="18" height="28" rx="5" />
        <path d="M22 31l4 4 8-9" />
      </svg>
    ),
    film: (
      <svg {...commonProps}>
        <rect x="14" y="18" width="36" height="28" rx="6" />
        <path d="M24 18v28M40 18v28M14 26h36M14 38h36" />
        <circle cx="22" cy="24" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="42" cy="24" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="22" cy="40" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="42" cy="40" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
    tv: (
      <svg {...commonProps}>
        <rect x="14" y="18" width="36" height="22" rx="5" />
        <path d="M24 46h16M32 40v6M22 14l10 8 10-8" />
        <path d="M19 24h26M19 30h18" />
      </svg>
    ),
    book: (
      <svg {...commonProps}>
        <path d="M18 18h14c4 0 7 3 7 7v21c-2.2-2-4.8-3-8-3H18z" />
        <path d="M46 18H32c-4 0-7 3-7 7v21c2.2-2 4.8-3 8-3h13z" />
        <path d="M32 22v20" />
      </svg>
    ),
    review: (
      <svg {...commonProps}>
        <path d="M18 18h20c4.4 0 8 3.6 8 8v12c0 4.4-3.6 8-8 8H28l-10 8v-8h-2c-4.4 0-8-3.6-8-8V26c0-4.4 3.6-8 8-8z" />
        <path d="M24 28h16M24 34h12" />
        <path d="M42 18l4-4" />
      </svg>
    ),
    trilogy: (
      <svg {...commonProps}>
        <path d="M16 40c3-11 11-18 16-18s13 7 16 18" />
        <circle cx="20" cy="40" r="6" />
        <circle cx="32" cy="24" r="6" />
        <circle cx="44" cy="40" r="6" />
      </svg>
    ),
    adaptation: (
      <svg {...commonProps}>
        <path d="M18 18h12c4 0 7 3 7 7v21c-2-2-4.8-3-8-3H18z" />
        <path d="M46 18H34c-4 0-7 3-7 7v21c2-2 4.8-3 8-3h11z" />
        <path d="M43 31l7 5-7 5z" />
      </svg>
    ),
    spectrum: (
      <svg {...commonProps}>
        <circle cx="20" cy="22" r="6" />
        <rect x="27" y="34" width="10" height="10" rx="2" />
        <path d="M44 18h8l-4 10z" />
        <path d="M25 26l7 8M39 33l7-10M22 28l10 10" />
      </svg>
    ),
    shelf: (
      <svg {...commonProps}>
        <path d="M18 18v28M46 18v28M18 46h28" />
        <rect x="22" y="22" width="6" height="20" rx="2" />
        <rect x="30" y="20" width="7" height="22" rx="2" />
        <rect x="39" y="24" width="4" height="18" rx="2" />
      </svg>
    ),
  };

  return (
    <div
      className={`badge-card-icon-shell badge-card-icon-shell-${toneKey}`}
      aria-label={label}
      role="img"
    >
      {icons[iconKey] || icons.collection}
    </div>
  );
}

function WatchlistGallery({ items, loading }) {
  const scrollRef = useRef(null);

  function scroll(direction) {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: direction * 220, behavior: 'smooth' });
    }
  }

  function getSiteUrl(item) {
    if (item.media_type === 'movie') return `/movies?open=${item.media_id}`;
    if (item.media_type === 'tv_show') return `/tv-shows?open=${item.media_id}`;
    if (item.media_type === 'book') return `/books?open=${item.media_id}`;
    return '/watchlist';
  }

  if (loading) {
    return <div className="loading-state" style={{ padding: '2rem' }}>Loading...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>Your watchlist is empty.</p>
        <p className="empty-hint">Browse movies, TV shows, and books to add items.</p>
      </div>
    );
  }

  return (
    <div className="wl-gallery-wrap">
      {items.length > 4 && (
        <button
          className="wl-gallery-arrow wl-gallery-arrow--left"
          onClick={() => scroll(-1)}
          type="button"
        >
          {'\u2039'}
        </button>
      )}
      <div className="wl-gallery-scroll" ref={scrollRef}>
        {items.map((item) => (
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
      {items.length > 4 && (
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
  const { user } = useAuth();
  const canUseLegacyBackend = hasLegacyBackendSession();
  const [stats, setStats] = useState({ ratings: 0, watchlist: 0 });
  const [ratings, setRatings] = useState([]);
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [selectedYear, setSelectedYear] = useState();
  const [loading, setLoading] = useState(true);
  const insights = buildHomeInsights(ratings, watchlistItems, selectedYear);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setLoading(true);

      try {
        const [ratingsData, watchlistData] = await Promise.all([
          fetchSupabaseRatings(),
          fetchSupabaseWatchlist(),
        ]);

        if (cancelled) return;

        const nextRatings = Array.isArray(ratingsData) ? ratingsData : [];
        const nextWatchlist = Array.isArray(watchlistData) ? watchlistData : [];
        setRatings(nextRatings);
        setWatchlistItems(nextWatchlist);
        setStats({ ratings: nextRatings.length, watchlist: nextWatchlist.length });
        setSelectedYear((currentYear) => (
          currentYear == null ? buildHomeInsights(nextRatings, nextWatchlist).selectedYear : currentYear
        ));
      } catch {
        if (cancelled) return;
        setRatings([]);
        setWatchlistItems([]);
        setStats({ ratings: 0, watchlist: 0 });
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
  }, []);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header home-header">
          <p className="page-kicker">Dashboard</p>
          <div className="home-profile">
            <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
            <div>
              <h1>Welcome back, {user.username}.</h1>
              <p className="page-subtitle home-subtitle">
                Track what you finish, jump back into your library, and plan the next pick with friends.
              </p>
              {user.bio && <p className="home-bio">{user.bio}</p>}
            </div>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-number">{stats.ratings}</div>
            <div className="stat-label">Ratings</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.watchlist}</div>
            <div className="stat-label">Saved Titles</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{insights.earnedBadgeCount}</div>
            <div className="stat-label">Badges Complete</div>
          </div>
        </div>

        <div className="home-sections">
          <section className="home-section surface-panel">
            <div className="section-header home-insights-header">
              <div>
                <h2>Annual Recap</h2>
                <p className="home-panel-copy">
                  See how your movies, shows, and books add up over the year.
                </p>
              </div>
              <label className="home-year-filter">
                <span>Year</span>
                <select
                  className="filter-input"
                  aria-label="Choose recap year"
                  value={insights.selectedYear}
                  onChange={(event) => setSelectedYear(Number(event.target.value))}
                >
                  {insights.availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {stats.ratings === 0 ? (
              <div className="empty-state home-empty-card">
                <p>Your recap will fill in as soon as you start rating titles.</p>
                <p className="empty-hint">
                  Log a movie, TV show, or book to unlock milestones and a yearly summary.
                </p>
                <Link to="/movies" className="btn-secondary">Browse the catalog</Link>
              </div>
            ) : (
              <>
                <p className="home-recap-summary">{buildRecapNarrative(insights.recap)}</p>

                <div className="home-recap-stat-grid">
                  <div className="home-recap-stat-card">
                    <span className="home-recap-stat-label">Logged</span>
                    <strong>{insights.recap.totalLogged}</strong>
                  </div>
                  <div className="home-recap-stat-card">
                    <span className="home-recap-stat-label">Movies</span>
                    <strong>{insights.recap.countsByType.movie}</strong>
                  </div>
                  <div className="home-recap-stat-card">
                    <span className="home-recap-stat-label">TV Shows</span>
                    <strong>{insights.recap.countsByType.tv_show}</strong>
                  </div>
                  <div className="home-recap-stat-card">
                    <span className="home-recap-stat-label">Books</span>
                    <strong>{insights.recap.countsByType.book}</strong>
                  </div>
                </div>

                <div className="home-recap-grid">
                  <div className="home-recap-card">
                    <div className="home-recap-card-header">
                      <h3>Monthly Pace</h3>
                    </div>
                    <div className="home-monthly-chart" aria-label="Monthly recap chart">
                      {insights.recap.monthly.map((month) => (
                        <div key={month.label} className="home-month-bar">
                          <div className="home-month-bar-track">
                            <span
                              className="home-month-bar-fill"
                              style={{ height: `${month.percent}%` }}
                            />
                          </div>
                          <span className="home-month-bar-label">{month.label}</span>
                          <span className="home-month-bar-count">{month.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="home-recap-card">
                    <div className="home-recap-card-header">
                      <h3>Highlights</h3>
                    </div>
                    <div className="home-highlight-grid">
                      <div className="home-highlight-card">
                        <span className="home-highlight-label">Active Months</span>
                        <strong>{insights.recap.activeMonths}</strong>
                      </div>
                      <div className="home-highlight-card">
                        <span className="home-highlight-label">Busiest Month</span>
                        <strong>
                          {insights.recap.busiestMonth
                            ? insights.recap.busiestMonth.label
                            : 'None yet'}
                        </strong>
                      </div>
                    </div>

                    <div className="home-genre-block">
                      <h4>Top Genres</h4>
                      {insights.recap.topGenres.length === 0 ? (
                        <p className="home-genre-empty">No genre breakdown yet.</p>
                      ) : (
                        <div className="home-genre-list">
                          {insights.recap.topGenres.map((genre) => (
                            <span key={genre.label} className="home-genre-chip">
                              {genre.label} <strong>{genre.count}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="home-section">
            <div className="section-header">
              <h2>Explore the Library</h2>
            </div>
            <div className="browse-grid">
              <Link to="/movies" className="browse-card browse-movies">
                <div className="browse-card-badge">FILM</div>
                <h3>Movies</h3>
                <p>Browse the catalog, open full details, and rate what you watch.</p>
              </Link>
              <Link to="/tv-shows" className="browse-card browse-tv">
                <div className="browse-card-badge">SHOW</div>
                <h3>TV Shows</h3>
                <p>Keep up with series, seasons, and your next binge pick.</p>
              </Link>
              <Link to="/books" className="browse-card browse-books">
                <div className="browse-card-badge">BOOK</div>
                <h3>Books</h3>
                <p>Search the shelf, open book details, and save future reads.</p>
              </Link>
              {canUseLegacyBackend && (
                <Link to="/lists" className="browse-card browse-lists">
                  <div className="browse-card-badge">LIST</div>
                  <h3>Shared Lists</h3>
                  <p>Build collaborative watchlists and book-club queues with vibe voting.</p>
                </Link>
              )}
            </div>
          </section>

          {canUseLegacyBackend && <ForYou />}

          <section className="home-section">
            <div className="section-header">
              <h2>Your Watchlist</h2>
              <Link to="/watchlist" className="section-link">View all</Link>
            </div>
            <WatchlistGallery items={watchlistItems} loading={loading} />
          </section>

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
        
          <section className="home-section surface-panel">
            <div className="section-header home-insights-header">
              <div>
                <h2>Achievements</h2>
                <p className="home-panel-copy">
                  Achievements level up from bronze to rarer metals based on what you finish and save in your library.
                </p>
              </div>
              <p className="surface-panel-meta">
                {insights.earnedBadgeCount} of {insights.badges.length} unlocked
              </p>
            </div>

            <div className="home-badge-grid">
              {insights.badges.map((badge) => (
                <article
                  key={badge.id}
                  className={`badge-card badge-card-tier-${badge.displayTier.key}${badge.completed ? ' badge-card-earned' : ''}`}
                >
                  <BadgeIcon
                    iconKey={badge.iconKey}
                    label={badge.iconLabel}
                    toneKey={badge.currentTier ? badge.currentTier.key : 'locked'}
                  />
                  <div className="badge-card-main">
                    <div className="badge-card-header">
                      <div className="badge-card-chip-row">
                        <span className="badge-card-progress-chip">{badge.progressLabel}</span>
                        <span className="badge-card-kicker">{badge.kicker}</span>
                      </div>
                      <span
                        className={`badge-card-status${badge.currentTier ? ` badge-card-tier badge-card-tier-${badge.currentTier.key}` : ' badge-card-status-locked'}`}
                      >
                        {badge.statusLabel}
                      </span>
                    </div>
                    <div className="badge-card-copy-block">
                      <h3>{badge.name}</h3>
                      <p className="badge-card-copy">{badge.description}</p>
                    </div>
                    <div className="badge-progress-row">
                      <div className="badge-progress-track" aria-hidden="true">
                        <span style={{ width: `${badge.progressPercent}%` }} />
                      </div>
                      <span className="badge-progress-value">{badge.progressPercent}%</span>
                    </div>
                    <div className="badge-card-footer">
                      <p className="badge-progress-caption">{badge.progressCaption}</p>
                      <p className="badge-card-detail">{badge.detail}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

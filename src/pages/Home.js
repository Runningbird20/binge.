import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';
import ForYou from '../components/ForYou';
import { buildHomeInsights, buildRecapNarrative } from '../homeInsights';

export default function Home() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ ratings: 0, watchlist: 0 });
  const [ratings, setRatings] = useState([]);
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [selectedYear, setSelectedYear] = useState();
  const insights = buildHomeInsights(ratings, watchlistItems, selectedYear);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [ratingsData, watchlist] = await Promise.all([
          api.get('/ratings/my'),
          api.get('/watchlist'),
        ]);
        const nextRatings = Array.isArray(ratingsData) ? ratingsData : [];
        const nextWatchlist = Array.isArray(watchlist) ? watchlist : [];
        setRatings(nextRatings);
        setWatchlistItems(nextWatchlist);
        setStats({ ratings: nextRatings.length, watchlist: nextWatchlist.length });
        setSelectedYear((currentYear) => (
          currentYear == null ? buildHomeInsights(nextRatings, nextWatchlist).selectedYear : currentYear
        ));
      } catch {
        // stats stay at zero if request fails
        setRatings([]);
        setWatchlistItems([]);
        setStats({ ratings: 0, watchlist: 0 });
      }
    }

    fetchStats();
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
                <h2>Milestones</h2>
                <p className="home-panel-copy">
                  Badges advance from bronze to rarer metals based on titles marked Watched or Read.
                </p>
              </div>
              <p className="surface-panel-meta">
                {insights.earnedBadgeCount} of {insights.badges.length} completed
              </p>
            </div>

            <div className="home-badge-grid">
              {insights.badges.map((badge) => (
                <article
                  key={badge.id}
                  className={`badge-card badge-card-tier-${badge.displayTier.key}${badge.completed ? ' badge-card-earned' : ''}`}
                >
                  <div className="badge-card-header">
                    <span className="badge-card-kicker">{badge.kicker}</span>
                    <span
                      className={`badge-card-status${badge.completed ? ' badge-card-status-earned' : ''}`}
                    >
                      {badge.statusLabel}
                    </span>
                  </div>
                  <div className="badge-card-tier-row">
                    <span className={`badge-card-tier badge-card-tier-${badge.displayTier.key}`}>
                      {badge.displayTier.label}
                    </span>
                    <span className="badge-card-tier-copy">{badge.tierSummary}</span>
                  </div>
                  <h3>{badge.name}</h3>
                  <p className="badge-card-copy">{badge.description}</p>
                  <div className="badge-progress-meta">
                    <span>{badge.progressLabel}</span>
                    <span>{badge.progressPercent}%</span>
                  </div>
                  <div className="badge-progress-track" aria-hidden="true">
                    <span style={{ width: `${badge.progressPercent}%` }} />
                  </div>
                  <p className="badge-progress-caption">{badge.progressCaption}</p>
                  <p className="badge-card-detail">{badge.detail}</p>
                </article>
              ))}
            </div>
          </section>

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
              <Link to="/lists" className="browse-card browse-lists">
                <div className="browse-card-badge">LIST</div>
                <h3>Shared Lists</h3>
                <p>Build collaborative watchlists and book-club queues with vibe voting.</p>
              </Link>
            </div>
          </section>

          <ForYou />

          <div className="home-secondary-grid">
            <section className="home-section surface-panel">
              <div className="section-header">
                <h2>My Library</h2>
                <Link to="/watchlist" className="section-link">Open library</Link>
              </div>
              {stats.watchlist === 0 ? (
                <div className="empty-state home-empty-card">
                  <p>Your library is still empty.</p>
                  <p className="empty-hint">
                    Browse movies, TV shows, and books to save titles for later.
                  </p>
                  <Link to="/movies" className="btn-secondary">Browse the catalog</Link>
                </div>
              ) : (
                <div className="home-action-card">
                  <p className="home-panel-copy">
                    You already have {stats.watchlist} saved title{stats.watchlist === 1 ? '' : 's'} across movies, shows, and books.
                  </p>
                  <Link to="/watchlist" className="btn-secondary">Open my library</Link>
                </div>
              )}
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
          </div>
        </div>
      </main>
    </div>
  );
}

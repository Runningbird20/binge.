import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';
import ForYou from '../components/ForYou';

export default function Home() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ ratings: 0, watchlist: 0 });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [ratings, watchlist] = await Promise.all([
          api.get('/ratings/my'),
          api.get('/watchlist'),
        ]);
        setStats({ ratings: ratings.length, watchlist: watchlist.length });
      } catch {
        // stats stay at zero if request fails
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
        </div>

        <div className="home-sections">
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

<<<<<<< HEAD
          <div className="home-secondary-grid">
            <section className="home-section surface-panel">
              <div className="section-header">
                <h2>My Library</h2>
                <Link to="/watchlist" className="section-link">Open library</Link>
=======
          <ForYou />

          <section className="home-section">
            <div className="section-header">
              <h2>Your Watchlist</h2>
              <Link to="/watchlist" className="section-link">View all</Link>
            </div>
            {stats.watchlist === 0 ? (
              <div className="empty-state">
                <p>Your watchlist is empty.</p>
                <p className="empty-hint">Browse movies, TV shows, and books to add items.</p>
>>>>>>> 465db07ff1fca1574291f604c7421ff73e627156
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

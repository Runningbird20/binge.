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
        <div className="home-header">
          <div className="home-profile">
            <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
            <div>
              <h1>Welcome back, {user.username}.</h1>
              <p className="home-subtitle">What are you watching or reading today?</p>
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
            <div className="stat-label">In Watchlist</div>
          </div>
        </div>

        <div className="home-sections">
          <section className="home-section">
            <div className="section-header">
              <h2>The Library</h2>
            </div>
            <div className="browse-grid">
              <Link to="/movies" className="browse-card browse-movies">
                <div className="browse-card-icon">🎬</div>
                <h3>Movies</h3>
                <p>Rate and review films</p>
              </Link>
              <Link to="/tv-shows" className="browse-card browse-tv">
                <div className="browse-card-icon">📺</div>
                <h3>TV Shows</h3>
                <p>Track series you've watched</p>
              </Link>
              <Link to="/books" className="browse-card browse-books">
                <div className="browse-card-icon">📚</div>
                <h3>Books</h3>
                <p>Log everything you've read</p>
              </Link>
            </div>
          </section>

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
              </div>
            ) : (
              <div className="empty-state">
                <Link to="/watchlist" className="btn-secondary">View your watchlist →</Link>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

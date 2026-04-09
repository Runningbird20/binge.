import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import ForYou from '../components/ForYou';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';

const MEDIA_ICONS = { movie: '🎬', tv_show: '📺', book: '📚' };

// Extract the actual image URL from Plex proxy URLs
// e.g. https://images.plex.tv/photo?size=large-1280&url=https%3A%2F%2Fimage.tmdb.org%2F...
// becomes https://image.tmdb.org/t/p/original/...
function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    // Plex wraps real image URLs — extract the inner url= param
    if (url.includes('plex.tv')) {
      const parsed = new URL(url);
      const inner = parsed.searchParams.get('url');
      if (inner) {
        // Sometimes inner is also encoded — decode it
        try {
          const decoded = decodeURIComponent(inner);
          return decoded;
        } catch {
          return inner;
        }
      }
    }
  } catch { /* fall through */ }
  return url;
}

function WatchlistGallery() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    api.get('/watchlist')
      .then(data => setItems(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function scroll(dir) {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir * 220, behavior: 'smooth' });
    }
  }

  function getSiteUrl(item) {
    if (item.media_type === 'movie')   return `/movies?open=${item.media_id}`;
    if (item.media_type === 'tv_show') return `/tv-shows?open=${item.media_id}`;
    if (item.media_type === 'book')    return `/books?open=${item.media_id}`;
    return '/watchlist';
  }

  if (loading) return <div className="loading-state" style={{ padding: '2rem' }}>Loading...</div>;

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
        <button className="wl-gallery-arrow wl-gallery-arrow--left" onClick={() => scroll(-1)}>‹</button>
      )}
      <div className="wl-gallery-scroll" ref={scrollRef}>
        {items.map(item => (
          <Link key={item.id} to={getSiteUrl(item)} className="wl-gallery-card">
            <div className="wl-gallery-poster">
              {(item.image_url || item.poster_url) ? (
                <img src={resolvePosterUrl(item.image_url || item.poster_url)} alt={item.title} referrerPolicy="no-referrer" />
              ) : (
                <div className="wl-gallery-placeholder">
                  {MEDIA_ICONS[item.media_type] || '📺'}
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
        <button className="wl-gallery-arrow wl-gallery-arrow--right" onClick={() => scroll(1)}>›</button>
      )}
    </div>
  );
}

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
      } catch { /* stats stay at zero */ }
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
            <WatchlistGallery />
          </section>
        </div>
      </main>
    </div>
  );
}

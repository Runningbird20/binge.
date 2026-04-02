import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import { api } from '../api';

export default function Movies() {
  const [movies, setMovies] = useState([]);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [userRatings, setUserRatings] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchMovies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (genre) params.set('genre', genre);
      const data = await api.get(`/media/movies?${params}`);
      setMovies(data);
    } catch {
      setMovies([]);
    } finally {
      setLoading(false);
    }
  }, [search, genre]);

  useEffect(() => {
    fetchMovies();
  }, [fetchMovies]);

  useEffect(() => {
    api.get('/ratings/my?media_type=movie')
      .then((ratings) => {
        const map = {};
        ratings.forEach((r) => { map[r.media_id] = r.rating; });
        setUserRatings(map);
      })
      .catch(() => {});
  }, []);

  async function handleRate(item, rating) {
    try {
      await api.post('/ratings', { media_type: 'movie', media_id: item.id, rating });
      setUserRatings((prev) => ({ ...prev, [item.id]: rating }));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleWatchlist(item) {
    try {
      await api.post('/watchlist', { media_type: 'movie', media_id: item.id });
      alert(`"${item.title}" added to watchlist`);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <h1>Movies</h1>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search movies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            className="filter-input"
            type="text"
            placeholder="Genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : movies.length === 0 ? (
          <div className="empty-state">
            <p>No movies found.</p>
            <p className="empty-hint">Movies will appear here once the database is populated.</p>
          </div>
        ) : (
          <div className="media-grid">
            {movies.map((movie) => (
              <MediaCard
                key={movie.id}
                item={movie}
                mediaType="movie"
                userRating={userRatings[movie.id]}
                onRate={handleRate}
                onWatchlist={handleWatchlist}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

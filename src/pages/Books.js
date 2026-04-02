import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import { api } from '../api';

export default function Books() {
  const [books, setBooks] = useState([]);
  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState('');
  const [userRatings, setUserRatings] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (author) params.set('author', author);
      const data = await api.get(`/media/books?${params}`);
      setBooks(data);
    } catch {
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, [search, author]);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useEffect(() => {
    api.get('/ratings/my?media_type=book')
      .then((ratings) => {
        const map = {};
        ratings.forEach((r) => { map[r.media_id] = r.rating; });
        setUserRatings(map);
      })
      .catch(() => {});
  }, []);

  async function handleRate(item, rating) {
    try {
      await api.post('/ratings', { media_type: 'book', media_id: item.id, rating });
      setUserRatings((prev) => ({ ...prev, [item.id]: rating }));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleWatchlist(item) {
    try {
      await api.post('/watchlist', { media_type: 'book', media_id: item.id, status: 'plan_to_read' });
      alert(`"${item.title}" added to reading list`);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <h1>Books</h1>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            type="text"
            placeholder="Search books…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            className="filter-input"
            type="text"
            placeholder="Author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : books.length === 0 ? (
          <div className="empty-state">
            <p>No books found.</p>
            <p className="empty-hint">Books will appear here once the database is populated.</p>
          </div>
        ) : (
          <div className="media-grid">
            {books.map((book) => (
              <MediaCard
                key={book.id}
                item={book}
                mediaType="book"
                userRating={userRatings[book.id]}
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

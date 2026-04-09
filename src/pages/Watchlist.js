import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

const TABS = [
  { label: 'All', value: '', types: ['movie', 'tv_show', 'book'] },
  { label: 'Plan to Watch', value: 'plan_to_watch', types: ['movie', 'tv_show'] },
  { label: 'Watching', value: 'watching', types: ['tv_show'] },
  { label: 'Watched', value: 'watched', types: ['movie', 'tv_show'] },
  { label: 'Plan to Read', value: 'plan_to_read', types: ['book'] },
  { label: 'Reading', value: 'reading', types: ['book'] },
  { label: 'Read', value: 'read', types: ['book'] },
];

const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching: 'Watching',
  watched: 'Watched',
  plan_to_read: 'Plan to Read',
  reading: 'Reading',
  read: 'Read',
};

const TYPE_LABELS = {
  movie: 'Movie',
  tv_show: 'TV Show',
  book: 'Book',
};

export default function Watchlist() {
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState('');
  const [search, setSearch] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeTab) params.set('status', activeTab);
        const data = await api.get(`/watchlist?${params}`);
        setItems(Array.isArray(data) ? data : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    fetchList();
  }, [activeTab]);

  async function handleStatusChange(item, newStatus) {
    try {
      await api.patch(`/watchlist/${item.id}`, { status: newStatus });
      setItems((current) =>
        current.map((entry) => (
          entry.id === item.id ? { ...entry, status: newStatus } : entry
        ))
      );
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleRemove(item) {
    if (!window.confirm(`Remove "${item.title}" from your library?`)) return;

    try {
      await api.delete(`/watchlist/${item.id}`);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      alert(error.message);
    }
  }

  function getStatusOptions(mediaType) {
    if (mediaType === 'book') return ['plan_to_read', 'reading', 'read'];
    if (mediaType === 'tv_show') return ['plan_to_watch', 'watching', 'watched'];
    return ['plan_to_watch', 'watched'];
  }

  function clearFilters() {
    setSearch('');
    setMediaTypeFilter('');
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      !normalizedSearch ||
      item.title?.toLowerCase().includes(normalizedSearch);
    const matchesType =
      !mediaTypeFilter || item.media_type === mediaTypeFilter;

    return matchesSearch && matchesType;
  });

  const hasClientFilters = Boolean(search || mediaTypeFilter);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Track</p>
          <h1>My Library</h1>
          <p className="page-subtitle">
            Search saved titles, update your progress, and keep movies, shows, and books in one tidy place.
          </p>
        </div>

        <section className="surface-panel">
          <div className="surface-panel-header">
            <div>
              <h2>Filter Your Saved Titles</h2>
              <p className="surface-panel-copy">
                Narrow the library by status, media type, or title without losing your place.
              </p>
            </div>
            <p className="surface-panel-meta">
              {loading ? 'Loading your library...' : `${filteredItems.length} visible item${filteredItems.length === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                className={`tab-btn ${activeTab === tab.value ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="filter-bar watchlist-filters">
            <input
              className="search-input"
              type="text"
              aria-label="Search saved titles"
              placeholder="Search your library..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="filter-input"
              aria-label="Filter by type"
              value={mediaTypeFilter}
              onChange={(event) => setMediaTypeFilter(event.target.value)}
            >
              <option value="">All Types</option>
              <option value="movie">Movies</option>
              <option value="tv_show">TV Shows</option>
              <option value="book">Books</option>
            </select>
            {hasClientFilters && (
              <button type="button" className="btn-ghost btn-sm" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </section>

        <section className="surface-panel surface-panel-spacious">
          {loading ? (
            <div className="loading-state">Loading...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <p>Nothing here yet.</p>
              <p className="empty-hint">
                Browse movies, TV shows, and books to add them to your library.
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">
              <p>No saved titles match those filters.</p>
              <p className="empty-hint">Try a different search or clear the active filters.</p>
            </div>
          ) : (
            <div className="watchlist-grid">
              {filteredItems.map((item) => (
                <article key={item.id} className="watchlist-item">
                  <div className="watchlist-poster">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.title} />
                    ) : (
                      <div className="watchlist-placeholder">
                        <span>{item.title?.charAt(0)}</span>
                      </div>
                    )}
                  </div>

                  <div className="watchlist-info">
                    <div className="watchlist-title-row">
                      <div className="watchlist-title">{item.title}</div>
                      <span className="type-badge">{TYPE_LABELS[item.media_type]}</span>
                    </div>
                    <div className="watchlist-meta">
                      {item.year && <span>{item.year}</span>}
                      <span>{STATUS_LABELS[item.status] || item.status}</span>
                    </div>
                  </div>

                  <div className="watchlist-item-actions">
                    <select
                      className="status-select"
                      value={item.status}
                      onChange={(event) => handleStatusChange(item, event.target.value)}
                    >
                      {getStatusOptions(item.media_type).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-ghost btn-sm watchlist-remove-button"
                      onClick={() => handleRemove(item)}
                      title={`Remove ${item.title}`}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

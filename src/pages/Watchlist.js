import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ThemedSelect from '../components/ThemedSelect';
import {
  fetchSupabaseWatchlist,
  removeSupabaseWatchlistItem,
  updateSupabaseWatchlistStatus,
} from '../utils/supabaseData';

const TABS = [
  { label: 'All', value: '', types: ['movie', 'tv_show'] },
  { label: 'Plan to Watch', value: 'plan_to_watch', types: ['movie', 'tv_show'] },
  { label: 'Watching', value: 'watching', types: ['tv_show'] },
  { label: 'Watched', value: 'watched', types: ['movie', 'tv_show'] },
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
    let cancelled = false;

    async function fetchList() {
      setLoading(true);
      try {
        const data = await fetchSupabaseWatchlist({ status: activeTab });
        if (!cancelled) {
          const watchableItems = Array.isArray(data)
            ? data.filter((item) => item.media_type === 'movie' || item.media_type === 'tv_show')
            : [];
          setItems(watchableItems);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchList();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  async function handleStatusChange(item, newStatus) {
    try {
      await updateSupabaseWatchlistStatus(item.id, newStatus);
      setItems((current) => {
        const updatedItems = current.map((entry) => (
          entry.id === item.id ? { ...entry, status: newStatus } : entry
        ));

        if (!activeTab) {
          return updatedItems;
        }

        return updatedItems.filter((entry) => entry.status === activeTab);
      });
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleRemove(item) {
    if (!window.confirm(`Remove "${item.title}" from your library?`)) return;

    try {
      await removeSupabaseWatchlistItem(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      alert(error.message);
    }
  }

  function getStatusOptions(mediaType) {
    if (mediaType === 'tv_show') return ['plan_to_watch', 'watching', 'watched'];
    return ['plan_to_watch', 'watched'];
  }

  function clearFilters() {
    setSearch('');
    setMediaTypeFilter('');
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesSearch = !normalizedSearch || item.title?.toLowerCase().includes(normalizedSearch);
    const matchesType = !mediaTypeFilter || item.media_type === mediaTypeFilter;
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
            Search saved movies and shows, update your progress, and keep your next watch in one tidy place.
          </p>
        </div>

        <section className="surface-panel">
          <div className="surface-panel-header">
            <div>
              <h2>Filter Your Saved Titles</h2>
              <p className="surface-panel-copy">
                Narrow your watchlist by status, media type, or title without losing your place.
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
            <ThemedSelect
              className="filter-input"
              aria-label="Filter by type"
              value={mediaTypeFilter}
              options={[
                { value: '', label: 'All Types' },
                { value: 'movie', label: 'Movies' },
                { value: 'tv_show', label: 'TV Shows' },
              ]}
              onChange={(event) => setMediaTypeFilter(event.target.value)}
            />
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
              <p>No movies or TV shows in your watchlist yet.</p>
              <p className="empty-hint">
                Add movies and TV shows from the catalog so your full watchlist is ready here.
              </p>
              <div className="cta-buttons" style={{ marginTop: '1rem' }}>
                <Link to="/movies" className="btn-secondary">Browse movies</Link>
                <Link to="/tv-shows" className="btn-secondary">Browse TV shows</Link>
              </div>
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
                    </div>
                    <div className="watchlist-meta">
                      {item.year && <span>{item.year}</span>}
                      <span className="watchlist-status-label">{STATUS_LABELS[item.status] || item.status}</span>
                      <span className={`type-badge type-badge--${item.media_type}`}>
                        {TYPE_LABELS[item.media_type]}
                      </span>
                    </div>
                  </div>

                  <div className="watchlist-item-actions">
                    <ThemedSelect
                      className="status-select"
                      value={item.status}
                      aria-label={`Status for ${item.title}`}
                      options={getStatusOptions(item.media_type).map((status) => ({
                        value: status,
                        label: STATUS_LABELS[status],
                      }))}
                      onChange={(event) => handleStatusChange(item, event.target.value)}
                    />
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

import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

const TABS = [
  { label: 'All',           value: '',               types: ['movie', 'tv_show', 'book'] },
  { label: 'Plan to Watch', value: 'plan_to_watch',  types: ['movie', 'tv_show'] },
  { label: 'Watching',      value: 'watching',       types: ['tv_show'] },
  { label: 'Watched',       value: 'watched',        types: ['movie', 'tv_show'] },
  { label: 'Plan to Read',  value: 'plan_to_read',   types: ['book'] },
  { label: 'Reading',       value: 'reading',        types: ['book'] },
  { label: 'Read',          value: 'read',           types: ['book'] },
];

const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching: 'Watching',
  watched: 'Watched',
  plan_to_read: 'Plan to Read',
  reading: 'Reading',
  read: 'Read',
};

const TYPE_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };

export default function Watchlist() {
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeTab) params.set('status', activeTab);
        const data = await api.get(`/watchlist?${params}`);
        setItems(data);
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
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i))
      );
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRemove(item) {
    if (!window.confirm(`Remove "${item.title}" from your list?`)) return;
    try {
      await api.delete(`/watchlist/${item.id}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      alert(err.message);
    }
  }

  function getStatusOptions(mediaType) {
    if (mediaType === 'book') return ['plan_to_read', 'reading', 'read'];
    if (mediaType === 'tv_show') return ['plan_to_watch', 'watching', 'watched'];
    return ['plan_to_watch', 'watched'];
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <h1>My List</h1>
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

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <p>Nothing here yet.</p>
            <p className="empty-hint">Browse movies, TV shows, and books to add them to your list.</p>
          </div>
        ) : (
          <div className="watchlist-grid">
            {items.map((item) => (
              <div key={item.id} className="watchlist-item">
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
                  <div className="watchlist-title">{item.title}</div>
                  <div className="watchlist-meta">
                    <span className="type-badge">{TYPE_LABELS[item.media_type]}</span>
                    {item.year && <span>{item.year}</span>}
                  </div>
                  <select
                    className="status-select"
                    value={item.status}
                    onChange={(e) => handleStatusChange(item, e.target.value)}
                  >
                    {getStatusOptions(item.media_type).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="remove-btn"
                  onClick={() => handleRemove(item)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

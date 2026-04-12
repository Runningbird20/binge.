import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import {
  fetchSupabaseWatchlist,
  removeSupabaseWatchlistItem,
  updateSupabaseWatchlistStatus,
} from '../utils/supabaseData';

const STATUS_OPTIONS = {
  movie:   ['plan_to_watch', 'watching', 'watched'],
  tv_show: ['plan_to_watch', 'watching', 'watched'],
  book:    ['plan_to_read',  'reading',  'read'],
};

const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching:      'Watching',
  watched:       'Watched',
  plan_to_read:  'Plan to Read',
  reading:       'Reading',
  read:          'Read',
};

const STATUS_COLORS = {
  plan_to_watch: '#555',
  watching:      '#e8c97a',
  watched:       '#4caf82',
  plan_to_read:  '#555',
  reading:       '#e8c97a',
  read:          '#4caf82',
};

const TYPE_ICON = { movie: '🎬', tv_show: '📺', book: '📖' };

const TABS = [
  { label: 'All',         value: '' },
  { label: '🎬 Movies',   value: 'movie' },
  { label: '📺 TV Shows', value: 'tv_show' },
  { label: '📖 Books',    value: 'book' },
];

function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch { /* fall through */ }
  return url;
}

function ProgressEditor({ item, onSave }) {
  const [season,  setSeason]  = useState(item.current_season  || '');
  const [episode, setEpisode] = useState(item.current_episode || '');
  const [page,    setPage]    = useState(item.current_page    || '');
  const [chapter, setChapter] = useState(item.current_chapter || '');
  const [notes,   setNotes]   = useState(item.notes           || '');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { media_type: item.media_type, media_id: item.media_id, notes: notes || null };
      if (item.media_type === 'tv_show') {
        payload.current_season  = season  ? Number(season)  : null;
        payload.current_episode = episode ? Number(episode) : null;
      }
      if (item.media_type === 'book') {
        payload.current_page    = page    ? Number(page)    : null;
        payload.current_chapter = chapter || null;
      }
      await api.patch('/watchlist/progress', payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSave(payload);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  return (
    <div className="wl-progress-editor">
      {item.media_type === 'tv_show' && (
        <div className="wl-progress-row">
          <label>Season</label>
          <input type="number" min="1" value={season} onChange={e => setSeason(e.target.value)} placeholder="—" />
          <label>Episode</label>
          <input type="number" min="1" value={episode} onChange={e => setEpisode(e.target.value)} placeholder="—" />
        </div>
      )}
      {item.media_type === 'book' && (
        <div className="wl-progress-row">
          <label>Page</label>
          <input type="number" min="1" value={page} onChange={e => setPage(e.target.value)} placeholder="—" />
          <label>Chapter</label>
          <input type="text" value={chapter} onChange={e => setChapter(e.target.value)} placeholder="—" />
        </div>
      )}
      <div className="wl-progress-row">
        <label>Notes</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add a note..." className="wl-notes-input" />
      </div>
      <button className="wl-save-btn" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Progress'}
      </button>
    </div>
  );
}

function WatchlistCard({ item, onStatusChange, onRemove, onProgressSave }) {
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const posterUrl = resolvePosterUrl(item.image_url);

  const hasProgress = item.current_season || item.current_episode || item.current_page || item.current_chapter;
  const progressLabel = item.media_type === 'tv_show' && item.current_season
    ? `S${item.current_season}${item.current_episode ? ` · E${item.current_episode}` : ''}`
    : item.media_type === 'book' && (item.current_page || item.current_chapter)
    ? [item.current_chapter && `Ch. ${item.current_chapter}`, item.current_page && `p. ${item.current_page}`].filter(Boolean).join(' · ')
    : null;

  const statusColor = STATUS_COLORS[item.status] || '#555';

  return (
    <article className={`wl-card ${expanded ? 'wl-card--expanded' : ''}`}>
      <div className="wl-card-main" onClick={() => setExpanded(e => !e)}>
        {/* Poster */}
        <div className="wl-poster">
          {posterUrl && !imgError ? (
            <img src={posterUrl} alt={item.title} referrerPolicy="no-referrer" onError={() => setImgError(true)} />
          ) : (
            <div className="wl-poster-placeholder">{item.title?.charAt(0)}</div>
          )}
          <div className="wl-type-badge">{TYPE_ICON[item.media_type]}</div>
        </div>

        {/* Info */}
        <div className="wl-info">
          <h3 className="wl-title">{item.title}</h3>
          <div className="wl-meta">
            {item.year && <span>{item.year}</span>}
            {progressLabel && (
              <span className="wl-progress-pill">{progressLabel}</span>
            )}
          </div>
          {item.notes && <p className="wl-notes-preview">"{item.notes}"</p>}
        </div>

        {/* Status + chevron */}
        <div className="wl-right">
          <span className="wl-status-dot" style={{ background: statusColor }} />
          <select
            className="wl-status-select"
            value={item.status}
            onClick={e => e.stopPropagation()}
            onChange={e => onStatusChange(item, e.target.value)}
          >
            {STATUS_OPTIONS[item.media_type]?.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <span className="wl-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="wl-expanded">
          <ProgressEditor item={item} onSave={onProgressSave} />
          <button className="wl-remove-btn" onClick={() => onRemove(item)}>Remove from Library</button>
        </div>
      )}
    </article>
  );
}

export default function Watchlist() {
  const [items, setItems]         = useState([]);
  const [activeTab, setActiveTab] = useState('');
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading]     = useState(true);
  const [stats, setStats]         = useState({});

<<<<<<< HEAD
  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      try {
        const data = await fetchSupabaseWatchlist({ status: activeTab });
        setItems(Array.isArray(data) ? data : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
=======
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/watchlist');
      const all = Array.isArray(data) ? data : [];
      setItems(all);
      // Compute stats
      const s = { total: all.length, watching: 0, watched: 0, reading: 0, read: 0, plan: 0 };
      all.forEach(i => {
        if (i.status === 'watching' || i.status === 'reading') s.watching++;
        else if (i.status === 'watched' || i.status === 'read') s.watched++;
        else s.plan++;
      });
      setStats(s);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915

  useEffect(() => { fetchList(); }, [fetchList]);

  async function handleStatusChange(item, newStatus) {
    try {
<<<<<<< HEAD
      await updateSupabaseWatchlistStatus(item.id, newStatus);
      setItems((current) =>
        current.map((entry) => (
          entry.id === item.id ? { ...entry, status: newStatus } : entry
        ))
      );
    } catch (error) {
      alert(error.message);
    }
=======
      await api.patch('/watchlist/progress', { media_type: item.media_type, media_id: item.media_id, status: newStatus });
      setItems(cur => cur.map(e => e.id === item.id ? { ...e, status: newStatus } : e));
    } catch (err) { alert(err.message); }
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915
  }

  async function handleRemove(item) {
    if (!window.confirm(`Remove "${item.title}" from your library?`)) return;
    try {
<<<<<<< HEAD
      await removeSupabaseWatchlistItem(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      alert(error.message);
    }
=======
      await api.delete(`/watchlist/${item.id}`);
      setItems(cur => cur.filter(e => e.id !== item.id));
    } catch (err) { alert(err.message); }
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915
  }

  function handleProgressSave(item, payload) {
    setItems(cur => cur.map(e => e.id === item.id ? { ...e, ...payload } : e));
  }

  const q = search.trim().toLowerCase();
  const filtered = items.filter(i => {
    if (activeTab && i.media_type !== activeTab) return false;
    if (statusFilter && i.status !== statusFilter) return false;
    if (q && !i.title?.toLowerCase().includes(q)) return false;
    return true;
  });

  // Group by status for the "All" tab
  const grouped = activeTab
    ? { [activeTab]: filtered }
    : filtered.reduce((acc, i) => { (acc[i.status] = acc[i.status] || []).push(i); return acc; }, {});

  const STATUS_GROUP_ORDER = ['watching', 'reading', 'plan_to_watch', 'plan_to_read', 'watched', 'read'];
  const STATUS_GROUP_LABELS = {
    watching:      '▶ Currently Watching',
    reading:       '▶ Currently Reading',
    plan_to_watch: '◷ Plan to Watch',
    plan_to_read:  '◷ Plan to Read',
    watched:       '✓ Watched',
    read:          '✓ Read',
  };

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content wl-page">

        {/* Header */}
        <div className="wl-header">
          <div>
            <h1 className="wl-heading">My Library</h1>
            <p className="wl-subheading">Track everything you're watching and reading</p>
          </div>
          {!loading && stats.total > 0 && (
            <div className="wl-stats">
              <div className="wl-stat"><span>{stats.total}</span><label>Total</label></div>
              <div className="wl-stat"><span>{stats.watching}</span><label>In Progress</label></div>
              <div className="wl-stat"><span>{stats.watched}</span><label>Completed</label></div>
              <div className="wl-stat"><span>{stats.plan}</span><label>Planned</label></div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="wl-filters">
          <div className="wl-tabs">
            {TABS.map(t => (
              <button key={t.value} className={`wl-tab ${activeTab === t.value ? 'active' : ''}`} onClick={() => setActiveTab(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="wl-filter-row">
            <input className="search-input" type="text" placeholder="Search library…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="filter-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {(search || statusFilter) && <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear</button>}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="loading-state">Loading your library…</div>
        ) : items.length === 0 ? (
          <div className="wl-empty">
            <p className="wl-empty-icon">📚</p>
            <h2>Your library is empty</h2>
            <p>Browse movies, TV shows, and books to add them here. Items you watch or read will also be added automatically.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="wl-empty">
            <p className="wl-empty-icon">🔍</p>
            <h2>No matches</h2>
            <p>Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div className="wl-content">
            {(activeTab ? [activeTab] : STATUS_GROUP_ORDER).map(statusKey => {
              const group = grouped[statusKey] || [];
              if (!group.length) return null;
              return (
                <section key={statusKey} className="wl-group">
                  {!activeTab && (
                    <h2 className="wl-group-heading">
                      {STATUS_GROUP_LABELS[statusKey]}
                      <span className="wl-group-count">{group.length}</span>
                    </h2>
                  )}
                  <div className="wl-list">
                    {group.map(item => (
                      <WatchlistCard
                        key={item.id}
                        item={item}
                        onStatusChange={handleStatusChange}
                        onRemove={handleRemove}
                        onProgressSave={(payload) => handleProgressSave(item, payload)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FilmSlate, MonitorPlay, BookOpen } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import ThemedSelect from '../components/ThemedSelect';
import RatingBadge from '../components/RatingBadge';
import RatingArtifact, { computeStarRating, computeNormalizedScore } from '../components/RatingArtifact';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseWatchlist,
  fetchSupabaseRatings,
  updateSupabaseWatchlistStatus,
  removeSupabaseWatchlistItem,
} from '../utils/supabaseData';

const MEDIA_ICONS = { movie: FilmSlate, tv_show: MonitorPlay, book: BookOpen };

function MediaTypeIcon({ type, size = 16 }) {
  const Icon = MEDIA_ICONS[type];
  if (!Icon) return null;
  return <Icon size={size} weight="bold" aria-hidden="true" />;
}

const TYPE_FILTERS = [
  { value: '', label: 'All', Icon: null },
  { value: 'movie', label: 'Movies', Icon: FilmSlate },
  { value: 'tv_show', label: 'Series', Icon: MonitorPlay },
  { value: 'book', label: 'Books', Icon: BookOpen },
];

const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching: 'Watching',
  watched: 'Watched',
  plan_to_read: 'Plan to Read',
  reading: 'Reading',
  read: 'Read',
};

function getStatusOptions(mediaType) {
  if (mediaType === 'tv_show') return ['plan_to_watch', 'watching', 'watched'];
  if (mediaType === 'book') return ['plan_to_read', 'reading', 'read'];
  return ['plan_to_watch', 'watched'];
}

function getMediaUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}`;
  if (item.media_type === 'tv_show') return `/tv-show/${item.media_id}`;
  return `/book/${item.media_id}`;
}

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

function TypeFilterBar({ value, onChange }) {
  return (
    <div className="books-tab-bar books-tab-bar--inline">
      {TYPE_FILTERS.map((t) => (
        <button
          key={t.value}
          type="button"
          className={`books-tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.Icon && <t.Icon size={16} weight="bold" aria-hidden="true" />} {t.label}
        </button>
      ))}
    </div>
  );
}

function WatchlistCard({ item, location, onStatusChange, onRemove }) {
  const poster = resolvePosterUrl(item.poster_url || item.image_url);

  return (
    <article className="profile-card">
      <Link
        to={getMediaUrl(item)}
        state={{ backgroundLocation: location }}
        className="poster-tile profile-card-link"
      >
        <div className="poster-tile-frame profile-card-poster">
          {poster
            ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
            : <div className="poster-tile-placeholder"><MediaTypeIcon type={item.media_type} size={24} /></div>}
        </div>
        <p className="poster-tile-title">{item.title || '—'}</p>
        {item.year && <p className="poster-tile-year">{item.year}</p>}
      </Link>

      <div className="profile-card-controls">
        <ThemedSelect
          className="status-select"
          value={item.status}
          aria-label={`Status for ${item.title}`}
          options={getStatusOptions(item.media_type).map((status) => ({
            value: status,
            label: STATUS_LABELS[status],
          }))}
          onChange={(event) => onStatusChange(item, event.target.value)}
        />
        <button
          type="button"
          className="btn-ghost btn-sm profile-card-remove"
          onClick={() => onRemove(item)}
          title={`Remove ${item.title}`}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

function WatchlistTab({ items, loading, location, typeFilter, onTypeFilterChange, onStatusChange, onRemove }) {
  const filtered = typeFilter ? items.filter((item) => item.media_type === typeFilter) : items;

  return (
    <>
      <div className="profile-tab-controls">
        <TypeFilterBar value={typeFilter} onChange={onTypeFilterChange} />
        <span className="profile-filter-count">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div className="loading-state">Loading your library...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{items.length === 0 ? 'Your library is empty.' : 'No saved titles match this filter.'}</p>
          {items.length === 0 && (
            <div className="cta-buttons" style={{ marginTop: '1rem' }}>
              <Link to="/movies" className="btn-secondary">Browse movies</Link>
              <Link to="/tv-shows" className="btn-secondary">Browse TV shows</Link>
              <Link to="/books" className="btn-secondary">Browse books</Link>
            </div>
          )}
        </div>
      ) : (
        <div className="poster-grid">
          {filtered.map((item) => (
            <WatchlistCard
              key={item.id}
              item={item}
              location={location}
              onStatusChange={onStatusChange}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RatingCard({ rating, location }) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const poster = resolvePosterUrl(rating.poster_url || rating.image_url);
  const stars = computeStarRating(rating.media_type, rating);

  return (
    <article className="profile-card">
      <Link
        to={getMediaUrl(rating)}
        state={{ backgroundLocation: location }}
        className="poster-tile profile-card-link"
      >
        <div className="poster-tile-frame profile-card-poster">
          {poster
            ? <img src={poster} alt={rating.title} referrerPolicy="no-referrer" />
            : <div className="poster-tile-placeholder"><MediaTypeIcon type={rating.media_type} size={24} /></div>}
          {stars != null && <RatingBadge value={stars} corner />}
        </div>
        <p className="poster-tile-title">{rating.title || '—'}</p>
        {rating.year && <p className="poster-tile-year">{rating.year}</p>}
      </Link>

      <div className="profile-card-controls">
        <button
          type="button"
          className="rate-review-detail-toggle"
          onClick={() => setBreakdownOpen((open) => !open)}
        >
          {breakdownOpen ? 'Hide breakdown' : 'View breakdown'}
        </button>
        {breakdownOpen && (
          <RatingArtifact mediaType={rating.media_type} scores={rating} size={180} />
        )}
        {rating.review && <p className="profile-card-review">{rating.review}</p>}
      </div>
    </article>
  );
}

function RatingsTab({ items, loading, location, typeFilter, onTypeFilterChange, sort, onSortChange }) {
  const filtered = useMemo(() => {
    const byType = typeFilter ? items.filter((r) => r.media_type === typeFilter) : items;
    const sorted = [...byType];
    if (sort === 'score_desc') {
      sorted.sort((a, b) => (computeNormalizedScore(b.media_type, b) || 0) - (computeNormalizedScore(a.media_type, a) || 0));
    } else if (sort === 'score_asc') {
      sorted.sort((a, b) => (computeNormalizedScore(a.media_type, a) || 0) - (computeNormalizedScore(b.media_type, b) || 0));
    } else if (sort === 'title') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else {
      sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return sorted;
  }, [items, typeFilter, sort]);

  return (
    <>
      <div className="profile-tab-controls">
        <TypeFilterBar value={typeFilter} onChange={onTypeFilterChange} />
        <ThemedSelect
          className="filter-input"
          aria-label="Sort ratings"
          value={sort}
          options={[
            { value: 'recent', label: 'Most Recent' },
            { value: 'score_desc', label: 'Highest Rated' },
            { value: 'score_asc', label: 'Lowest Rated' },
            { value: 'title', label: 'Title A-Z' },
          ]}
          onChange={(event) => onSortChange(event.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-state">Loading your ratings...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No ratings yet{typeFilter ? ' for this type' : ''}.</p>
          <p className="empty-hint">Rate a title from the Movies, TV Shows, or Books pages.</p>
        </div>
      ) : (
        <div className="poster-grid">
          {filtered.map((rating) => (
            <RatingCard key={`${rating.media_type}-${rating.media_id}`} rating={rating} location={location} />
          ))}
        </div>
      )}
    </>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const location = useLocation();
  const [watchlist, setWatchlist] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('watchlist');
  const [wlTypeFilter, setWlTypeFilter] = useState('');
  const [ratingsTypeFilter, setRatingsTypeFilter] = useState('');
  const [ratingsSort, setRatingsSort] = useState('recent');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [watchlistResult, ratingsResult] = await Promise.allSettled([
        fetchSupabaseWatchlist(),
        fetchSupabaseRatings(),
      ]);
      if (cancelled) return;
      setWatchlist(watchlistResult.status === 'fulfilled' ? watchlistResult.value : []);
      setRatings(ratingsResult.status === 'fulfilled' ? ratingsResult.value : []);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  function handleStatusChange(item, nextStatus) {
    setWatchlist((current) => current.map((entry) => (
      entry.id === item.id ? { ...entry, status: nextStatus } : entry
    )));
    updateSupabaseWatchlistStatus(item.id, nextStatus).catch((error) => {
      window.alert(error.message);
      setWatchlist((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, status: item.status } : entry
      )));
    });
  }

  function handleRemove(item) {
    if (!window.confirm(`Remove "${item.title}" from your library?`)) return;
    setWatchlist((current) => current.filter((entry) => entry.id !== item.id));
    removeSupabaseWatchlistItem(item.id).catch((error) => window.alert(error.message));
  }

  const stats = useMemo(() => {
    const completed = watchlist.filter((i) => i.status === 'watched' || i.status === 'read').length;
    const inProgress = watchlist.filter((i) => i.status === 'watching' || i.status === 'reading').length;
    const scores = ratings.map((r) => computeStarRating(r.media_type, r)).filter((s) => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
    return { completed, inProgress, avg, totalRatings: ratings.length };
  }, [watchlist, ratings]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="profile-header">
          <div className="profile-avatar-wrap">
            <UserAvatar avatarUrl={user?.avatarUrl} name={user?.username} size="lg" />
          </div>
          <div className="profile-info">
            <h1 className="profile-username">{user?.username}</h1>
            {user?.bio && <p className="profile-bio-line">{user.bio}</p>}
          </div>
          <div className="profile-actions profile-actions--stacked">
            <Link to="/account-settings" className="btn-ghost">Edit Profile</Link>
            <div className="profile-stat-squares">
              <div className="profile-stat-square">
                <span className="profile-stat-square-num">{stats.completed}</span>
                <span className="profile-stat-square-label">Completed</span>
              </div>
              <div className="profile-stat-square">
                <span className="profile-stat-square-num">{stats.inProgress}</span>
                <span className="profile-stat-square-label">In Progress</span>
              </div>
              <div className="profile-stat-square">
                <span className="profile-stat-square-num">{stats.totalRatings}</span>
                <span className="profile-stat-square-label">Ratings</span>
              </div>
              <div className="profile-stat-square">
                <span className="profile-stat-square-num">{stats.avg}</span>
                <span className="profile-stat-square-label">Avg Score</span>
              </div>
            </div>
          </div>
        </div>

        <section className="surface-panel">
          <div className="tabs">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'watchlist' ? 'active' : ''}`}
              onClick={() => setActiveTab('watchlist')}
            >
              Watchlist <span className="tab-count">{watchlist.length}</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'ratings' ? 'active' : ''}`}
              onClick={() => setActiveTab('ratings')}
            >
              Ratings &amp; Reviews <span className="tab-count">{ratings.length}</span>
            </button>
          </div>

          {activeTab === 'watchlist' ? (
            <WatchlistTab
              items={watchlist}
              loading={loading}
              location={location}
              typeFilter={wlTypeFilter}
              onTypeFilterChange={setWlTypeFilter}
              onStatusChange={handleStatusChange}
              onRemove={handleRemove}
            />
          ) : (
            <RatingsTab
              items={ratings}
              loading={loading}
              location={location}
              typeFilter={ratingsTypeFilter}
              onTypeFilterChange={setRatingsTypeFilter}
              sort={ratingsSort}
              onSortChange={setRatingsSort}
            />
          )}
        </section>
      </main>
    </div>
  );
}

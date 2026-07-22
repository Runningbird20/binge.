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
import { STATUS_LABELS, getStatusOptions } from '../utils/watchlistStatus';
import { computeProgressBadge } from '../utils/continueWatching';
import { excludeRated, countCompleted } from '../utils/libraryStats';
import { getCached, setCached, buildUserDataCacheKey } from '../utils/sessionCache';

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

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Statuses' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

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
  const progressBadge = computeProgressBadge(item);

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
          {progressBadge && <span className="profile-wl-progress-badge">{progressBadge}</span>}
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

const WATCHLIST_PAGE_SIZE = 49;

function PaginationBar({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="profile-pagination">
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
      >
        ‹ Prev
      </button>
      <span className="profile-pagination-label">Page {page + 1} of {totalPages}</span>
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1}
        aria-label="Next page"
      >
        Next ›
      </button>
    </div>
  );
}

function WatchlistTab({
  items,
  loading,
  location,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  onStatusChange,
  onRemove,
}) {
  const [page, setPage] = useState(0);

  const filtered = items.filter((item) => (
    (!typeFilter || item.media_type === typeFilter)
    && (!statusFilter || item.status === statusFilter)
  ));

  const totalPages = Math.max(1, Math.ceil(filtered.length / WATCHLIST_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    clampedPage * WATCHLIST_PAGE_SIZE,
    clampedPage * WATCHLIST_PAGE_SIZE + WATCHLIST_PAGE_SIZE,
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); }, [typeFilter, statusFilter]);

  return (
    <>
      <div className="profile-tab-controls">
        <TypeFilterBar value={typeFilter} onChange={onTypeFilterChange} />
        <ThemedSelect
          className="filter-input"
          aria-label="Filter by status"
          value={statusFilter}
          options={STATUS_FILTER_OPTIONS}
          onChange={(event) => onStatusFilterChange(event.target.value)}
        />
      </div>
      <p className="profile-filter-count">{filtered.length} item{filtered.length === 1 ? '' : 's'}</p>

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
        <>
          <PaginationBar page={clampedPage} totalPages={totalPages} onPageChange={setPage} />
          <div className="poster-grid">
            {pageItems.map((item) => (
              <WatchlistCard
                key={item.id}
                item={item}
                location={location}
                onStatusChange={onStatusChange}
                onRemove={onRemove}
              />
            ))}
          </div>
          <PaginationBar page={clampedPage} totalPages={totalPages} onPageChange={setPage} />
        </>
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
  const { user, activeProfile } = useAuth();
  const location = useLocation();
  const [watchlist, setWatchlist] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('watchlist');
  const [wlTypeFilter, setWlTypeFilter] = useState('');
  const [wlStatusFilter, setWlStatusFilter] = useState('');
  const [ratingsTypeFilter, setRatingsTypeFilter] = useState('');
  const [ratingsSort, setRatingsSort] = useState('recent');

  const userId = user?.id;
  const profileId = activeProfile?.id || null;

  useEffect(() => {
    let cancelled = false;
    const cacheKey = buildUserDataCacheKey('profile-stats', userId, profileId);

    // Stale-while-revalidate: hydrate instantly from cache if we have it,
    // then always still fetch fresh in the background to self-heal.
    const cached = getCached(cacheKey);
    if (cached) {
      setWatchlist(cached.watchlist);
      setRatings(cached.ratings);
      setLoading(false);
    } else {
      setLoading(true);
    }

    async function load() {
      const [watchlistResult, ratingsResult] = await Promise.allSettled([
        fetchSupabaseWatchlist(),
        fetchSupabaseRatings(),
      ]);
      if (cancelled) return;
      const nextWatchlist = watchlistResult.status === 'fulfilled' ? watchlistResult.value : [];
      const nextRatings = ratingsResult.status === 'fulfilled' ? ratingsResult.value : [];
      setWatchlist(nextWatchlist);
      setRatings(nextRatings);
      setLoading(false);
      setCached(cacheKey, { watchlist: nextWatchlist, ratings: nextRatings });
    }

    load();
    return () => { cancelled = true; };
  }, [userId, profileId]);

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

  // Rated titles move to the Ratings & Reviews tab, so exclude them from the
  // watchlist tab (display, count, and the in-progress stat).
  const libraryWatchlist = useMemo(() => excludeRated(watchlist, ratings), [watchlist, ratings]);

  const stats = useMemo(() => {
    const completed = countCompleted(watchlist, ratings);
    const inProgress = libraryWatchlist.filter((i) => i.status === 'watching' || i.status === 'reading').length;
    const scores = ratings.map((r) => computeStarRating(r.media_type, r)).filter((s) => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
    return { completed, inProgress, avg, totalRatings: ratings.length };
  }, [watchlist, ratings, libraryWatchlist]);

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
              Watchlist <span className="tab-count">{libraryWatchlist.length}</span>
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
              items={libraryWatchlist}
              loading={loading}
              location={location}
              typeFilter={wlTypeFilter}
              onTypeFilterChange={setWlTypeFilter}
              statusFilter={wlStatusFilter}
              onStatusFilterChange={setWlStatusFilter}
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

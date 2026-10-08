import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FilmSlate, MonitorPlay, BookOpen, Trash, Star, PencilSimple, Users, ClockCounterClockwise, Sparkle, SlidersHorizontal } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import ProfileAvatar from '../components/ProfileAvatar';
import ThemedSelect from '../components/ThemedSelect';
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
import { excludeRated, countCompleted, computeWatchMinutes } from '../utils/libraryStats';
import { posterSrc, posterSrcSet } from '../utils/imageQuality';
import { tmdbGet, tmdbIdFromItem, tmdbImage, tmdbKind } from '../utils/tmdb';
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
    <div className="st-tabs st-tabs--sm" role="group" aria-label="Filter by type">
      {TYPE_FILTERS.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={value === t.value}
          className={`st-tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.Icon && <t.Icon size={15} weight="bold" aria-hidden="true" />} {t.label}
        </button>
      ))}
    </div>
  );
}

function CardPoster({ item, children }) {
  const raw = resolvePosterUrl(item.poster_url || item.image_url);
  return (
    <div className="st-card-poster">
      {raw
        ? <img src={posterSrc(raw)} srcSet={posterSrcSet(raw)} sizes="(max-width: 768px) 46vw, 210px" alt="" loading="lazy" referrerPolicy="no-referrer" />
        : <div className="st-card-placeholder"><MediaTypeIcon type={item.media_type} size={28} /></div>}
      {children}
    </div>
  );
}

function WatchlistCard({ item, location, onStatusChange, onRemove }) {
  const progressBadge = computeProgressBadge(item);

  return (
    <article className="st-grid-cell pf-card">
      <Link to={getMediaUrl(item)} state={{ backgroundLocation: location }} className="st-card" aria-label={item.title}>
        <CardPoster item={item}>
          {progressBadge && <span className="st-badge">{progressBadge}</span>}
        </CardPoster>
        <p className="st-card-title">{item.title || '—'}</p>
      </Link>

      <div className="pf-card-controls">
        <ThemedSelect
          className="pf-status-select"
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
          className="pf-icon-btn"
          onClick={() => onRemove(item)}
          title={`Remove ${item.title}`}
          aria-label={`Remove ${item.title}`}
        >
          <Trash size={16} weight="bold" />
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
      <div className="pf-controls">
        <TypeFilterBar value={typeFilter} onChange={onTypeFilterChange} />
        <ThemedSelect
          className="filter-input"
          aria-label="Filter by status"
          value={statusFilter}
          options={STATUS_FILTER_OPTIONS}
          onChange={(event) => onStatusFilterChange(event.target.value)}
        />
      </div>
      <p className="pf-count">{filtered.length} title{filtered.length === 1 ? '' : 's'}</p>

      {loading ? (
        <div className="loading-state">Loading your library...</div>
      ) : filtered.length === 0 ? (
        <div className="pf-empty">
          <p>{items.length === 0 ? 'Your list is empty.' : 'No saved titles match this filter.'}</p>
          {items.length === 0 && (
            <div className="pf-empty-actions">
              <Link to="/movies" className="st-btn st-btn--ghost">Browse movies</Link>
              <Link to="/tv-shows" className="st-btn st-btn--ghost">Browse series</Link>
              <Link to="/books" className="st-btn st-btn--ghost">Browse books</Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <PaginationBar page={clampedPage} totalPages={totalPages} onPageChange={setPage} />
          <div className="st-grid">
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
  const stars = computeStarRating(rating.media_type, rating);

  return (
    <article className="st-grid-cell pf-card">
      <Link to={getMediaUrl(rating)} state={{ backgroundLocation: location }} className="st-card" aria-label={rating.title}>
        <CardPoster item={rating}>
          {stars != null && (
            <span className="pf-stars" aria-label={`Rated ${stars} out of 5`}>
              <Star size={13} weight="fill" /> {Number(stars).toFixed(1)}
            </span>
          )}
        </CardPoster>
        <p className="st-card-title">{rating.title || '—'}</p>
      </Link>
      {rating.review && <p className="pf-review">“{rating.review}”</p>}
      <button type="button" className="pf-link-btn" onClick={() => setBreakdownOpen((open) => !open)}>
        {breakdownOpen ? 'Hide breakdown' : 'View breakdown'}
      </button>
      {breakdownOpen && <RatingArtifact mediaType={rating.media_type} scores={rating} size={170} />}
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
      <div className="pf-controls">
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
        <div className="pf-empty">
          <p>No ratings yet{typeFilter ? ' for this type' : ''}.</p>
          <p className="td-muted">Open any title and tap the star to rate it — ratings shape your recommendations.</p>
        </div>
      ) : (
        <div className="st-grid">
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
    return { completed, inProgress, avg, totalRatings: ratings.length, minutes: computeWatchMinutes(watchlist, ratings) };
  }, [watchlist, ratings, libraryWatchlist]);

  // Top genres across highly rated + finished titles — a quick "taste DNA".
  const taste = useMemo(() => {
    const weights = new Map();
    const add = (genreText, weight) => String(genreText || '').split(',').map((g) => g.trim()).filter(Boolean)
      .forEach((genre) => weights.set(genre, (weights.get(genre) || 0) + weight));
    ratings.forEach((rating) => add(rating.genre, (computeStarRating(rating.media_type, rating) || 3) - 2.5));
    watchlist.forEach((item) => add(item.genre, item.status === 'watched' || item.status === 'read' ? 1 : 0.3));
    return [...weights.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g);
  }, [ratings, watchlist]);

  // Banner art from the profile's top-rated movie/series.
  const [bannerUrl, setBannerUrl] = useState(null);
  const favorite = useMemo(() => [...ratings]
    .filter((rating) => rating.media_type !== 'book' && tmdbIdFromItem(rating))
    .sort((a, b) => (computeStarRating(b.media_type, b) || 0) - (computeStarRating(a.media_type, a) || 0))[0] || null, [ratings]);
  useEffect(() => {
    if (!favorite) { setBannerUrl(null); return undefined; }
    let cancelled = false;
    tmdbGet(`/${tmdbKind(favorite.media_type)}/${tmdbIdFromItem(favorite)}`).then((data) => {
      if (!cancelled) setBannerUrl(data?.backdrop_path ? tmdbImage(data.backdrop_path, 'w1280') : null);
    });
    return () => { cancelled = true; };
  }, [favorite]);

  const displayName = activeProfile?.name || user?.username;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <header className="pf-hero">
          {bannerUrl && <img className="pf-hero-bg" src={bannerUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer" />}
          <div className="pf-hero-scrim" aria-hidden="true" />
          <div className="pf-hero-main">
            <div className="pf-avatar">
              {activeProfile
                ? <ProfileAvatar profile={activeProfile} size={104} />
                : <UserAvatar avatarUrl={user?.avatarUrl} name={user?.username} size="lg" />}
            </div>
            <div className="pf-identity">
              <p className="st-page-kicker">Profile</p>
              <h1 className="pf-name">{displayName}</h1>
              {user?.bio && <p className="pf-bio">{user.bio}</p>}
              <div className="pf-actions">
                <Link to="/account-settings" className="st-btn st-btn--ghost"><PencilSimple size={16} weight="bold" /> Edit profile</Link>
                <Link to="/settings" className="st-btn st-btn--ghost"><SlidersHorizontal size={16} weight="bold" /> Settings</Link>
                <Link to="/profiles" className="st-btn st-btn--ghost"><Users size={16} weight="bold" /> Switch profile</Link>
                <Link to="/history" className="st-btn st-btn--ghost"><ClockCounterClockwise size={16} weight="bold" /> Watch history</Link>
                <Link to="/wrapped" className="st-btn st-btn--ghost"><Sparkle size={16} weight="bold" /> Your {new Date().getFullYear()} Wrapped</Link>
              </div>
            </div>
          </div>
          <dl className="pf-stats">
            <div><dt>Minutes watched</dt><dd>{stats.minutes.toLocaleString()}</dd></div>
            <div><dt>Completed</dt><dd>{stats.completed}</dd></div>
            <div><dt>In progress</dt><dd>{stats.inProgress}</dd></div>
            <div><dt>Ratings</dt><dd>{stats.totalRatings}</dd></div>
            <div><dt>Avg score</dt><dd>{stats.avg}</dd></div>
          </dl>
          {taste.length > 0 && (
            <div className="pf-taste">
              <span className="pf-taste-label">Your taste</span>
              {taste.map((genre) => <span key={genre} className="st-chip">{genre}</span>)}
            </div>
          )}
        </header>

        <section className="pf-section">
          <div className="st-tabs" role="tablist" aria-label="Library">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'watchlist'}
              className={`st-tab ${activeTab === 'watchlist' ? 'active' : ''}`}
              onClick={() => setActiveTab('watchlist')}
            >
              My List <span className="pf-tab-count">{libraryWatchlist.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'ratings'}
              className={`st-tab ${activeTab === 'ratings' ? 'active' : ''}`}
              onClick={() => setActiveTab('ratings')}
            >
              Ratings &amp; Reviews <span className="pf-tab-count">{ratings.length}</span>
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

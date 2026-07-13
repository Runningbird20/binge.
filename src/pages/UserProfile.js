import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useLocation, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import RatingArtifact, { computeNormalizedScore } from '../components/RatingArtifact';
import ThemedSelect from '../components/ThemedSelect';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseWatchlist,
  fetchSupabaseRatings,
  fetchSupabaseContinueWatching,
  updateWatchlistProgress,
  removeSupabaseWatchlistItem,
} from '../utils/supabaseData';
import { useToast } from '../contexts/ToastContext';

function resolvePoster(url) {
  if (!url) return null;
  try { if (url.includes('plex.tv')) { const inner = new URL(url).searchParams.get('url'); if (inner) return decodeURIComponent(inner); } } catch {}
  return url;
}

const STATUS_LABELS = { watching: 'Watching', watched: 'Watched', plan_to_watch: 'Plan to Watch', reading: 'Reading', read: 'Read', plan_to_read: 'Plan to Read' };
const STATUS_COLORS = { watching: '#f4f6f8', watched: '#4caf82', reading: '#f4f6f8', read: '#4caf82', plan_to_watch: '#7ab8e8', plan_to_read: '#7ab8e8' };
const TYPE_LABELS   = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const MEDIA_ICONS   = { movie: '🎬', tv_show: '📺', book: '📖' };

const TV_STATUSES   = ['plan_to_watch', 'watching', 'watched'];
const BOOK_STATUSES = ['plan_to_read', 'reading', 'read'];

function WatchlistCard({ item, isOwn, onUpdate, onRemove }) {
  const location = useLocation();
  const [status, setStatus]   = useState(item.status);
  const [season, setSeason]   = useState(item.current_season ?? '');
  const [episode, setEpisode] = useState(item.current_episode ?? '');
  const [chapter, setChapter] = useState(item.current_chapter ?? '');
  const [page, setPage]       = useState(item.current_page ?? '');
  const [saving, setSaving]   = useState(false);
  const pendingRef  = useRef({});
  const debounceRef = useRef(null);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const mediaUrl = item.media_type === 'movie'
    ? (status === 'watching' ? `/movie/${item.media_id}?play=1` : `/movie/${item.media_id}`)
    : item.media_type === 'tv_show'
    ? (status === 'watching' ? `/tv-show/${item.media_id}?play=1` : `/tv-show/${item.media_id}`)
    : `/book/${item.media_id}`;

  async function save(updates) {
    setSaving(true);
    try {
      await updateWatchlistProgress({ mediaType: item.media_type, mediaId: item.media_id, ...updates });
      onUpdate?.(item.id, updates);
    } catch {}
    finally { setSaving(false); }
  }

  async function handleStatusChange(e) {
    const val = e.target.value;
    setStatus(val);
    await save({ status: val });
  }

  function scheduleProgressSave(field, value) {
    pendingRef.current[field] = value;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const pending = { ...pendingRef.current };
      pendingRef.current = {};
      save(pending);
    }, 750);
  }

  function handleSeasonChange(e)  { const n = parseInt(e.target.value, 10); setSeason(e.target.value);  if (!isNaN(n) && n > 0) scheduleProgressSave('currentSeason', n); }
  function handleEpisodeChange(e) { const n = parseInt(e.target.value, 10); setEpisode(e.target.value); if (!isNaN(n) && n > 0) scheduleProgressSave('currentEpisode', n); }
  function handleChapterChange(e) { const n = parseInt(e.target.value, 10); setChapter(e.target.value); if (!isNaN(n) && n > 0) scheduleProgressSave('currentChapter', n); }
  function handlePageChange(e)    { const n = parseInt(e.target.value, 10); setPage(e.target.value);    if (!isNaN(n) && n > 0) scheduleProgressSave('currentPage', n); }

  const poster   = resolvePoster(item.poster_url || item.image_url);
  const color    = STATUS_COLORS[status] || '#555';
  const statuses = item.media_type === 'book' ? BOOK_STATUSES : TV_STATUSES;

  const progressBadge = item.media_type === 'tv_show' && (season !== '' || episode !== '')
    ? `S${season || '?'} · E${episode || '?'}`
    : item.media_type === 'book' && (chapter !== '' || page !== '')
    ? [chapter ? `Ch ${chapter}` : null, page ? `Pg ${page}` : null].filter(Boolean).join(' · ')
    : null;

  if (!isOwn) {
    return (
      <Link to={mediaUrl} className="profile-wl-card" state={{ backgroundLocation: location }}>
        <div className="profile-wl-poster">
          {poster
            ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
            : <div className="profile-wl-placeholder">{MEDIA_ICONS[item.media_type]}</div>}
          <span className="profile-wl-status" style={{ background: color + '22', color, borderColor: color + '44' }}>
            {STATUS_LABELS[status] || status}
          </span>
        </div>
        <p className="profile-wl-title">{item.title || '—'}</p>
        {item.year && <p className="profile-wl-year">{item.year}</p>}
      </Link>
    );
  }

  return (
    <div className={`profile-wl-card profile-wl-card--own${saving ? ' profile-wl-card--saving' : ''}`}>
      <div className="profile-wl-poster">
        {poster
          ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
          : <div className="profile-wl-placeholder">{MEDIA_ICONS[item.media_type]}</div>}
        {progressBadge && <span className="profile-wl-progress-badge">{progressBadge}</span>}

        {/* Hover overlay */}
        <div className="profile-wl-overlay">
          <div className="profile-wl-overlay-top">
            <Link to={mediaUrl} className="profile-wl-overlay-open" state={{ backgroundLocation: location }} onClick={e => e.stopPropagation()}>
              Open →
            </Link>
            <button
              type="button"
              className="profile-wl-overlay-remove"
              title="Remove from library"
              onClick={e => { e.stopPropagation(); onRemove?.(item); }}
            >
              ✕
            </button>
          </div>
          <div className="profile-wl-overlay-controls">
            {item.media_type === 'tv_show' && (
              <div className="profile-wl-overlay-progress">
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Season</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={season} placeholder="—" onChange={handleSeasonChange} onClick={e => e.stopPropagation()} />
                </div>
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Episode</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={episode} placeholder="—" onChange={handleEpisodeChange} onClick={e => e.stopPropagation()} />
                </div>
              </div>
            )}
            {item.media_type === 'book' && (
              <div className="profile-wl-overlay-progress">
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Chapter</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={chapter} placeholder="—" onChange={handleChapterChange} onClick={e => e.stopPropagation()} />
                </div>
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Page</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={page} placeholder="—" onChange={handlePageChange} onClick={e => e.stopPropagation()} />
                </div>
              </div>
            )}
            <ThemedSelect
              className="profile-wl-overlay-status"
              value={status}
              aria-label="Watchlist status"
              options={statuses.map(s => ({ value: s, label: STATUS_LABELS[s] }))}
              onChange={handleStatusChange}
              disabled={saving}
              style={{ color, borderColor: color + '55' }}
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      </div>
      <p className="profile-wl-title">{item.title || '—'}</p>
      {item.year && <p className="profile-wl-year">{item.year}</p>}
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="profile-stat-card">
      <span className="profile-stat-num">{value}</span>
      <span className="profile-stat-label">{label}</span>
    </div>
  );
}

function ProfileStatsCard({ watchlist, ratings, joinDate }) {
  const stats = useMemo(() => {
    const completed = watchlist.filter(i => i.status === 'watched' || i.status === 'read').length;
    const inProgress = watchlist.filter(i => i.status === 'watching' || i.status === 'reading').length;

    const scores = ratings.map(r => computeNormalizedScore(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

    const genreCounts = {};
    ratings.forEach(r => {
      (r.genre || '').split(',').forEach(g => {
        const t = g.trim();
        if (t) genreCounts[t] = (genreCounts[t] || 0) + 1;
      });
    });
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const byType = { movie: 0, tv_show: 0, book: 0 };
    watchlist.forEach(i => { if (byType[i.media_type] !== undefined) byType[i.media_type]++; });

    const joined = joinDate ? new Date(joinDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;

    return { completed, inProgress, avg, topGenre, byType, joined, totalRatings: ratings.length };
  }, [watchlist, ratings, joinDate]);

  if (!watchlist.length && !ratings.length) return null;

  return (
    <div className="profile-stats-card">
      <div className="psc-grid">
        <div className="psc-cell">
          <span className="psc-num">{stats.completed}</span>
          <span className="psc-label">Completed</span>
        </div>
        {stats.inProgress > 0 && (
          <div className="psc-cell">
            <span className="psc-num">{stats.inProgress}</span>
            <span className="psc-label">In Progress</span>
          </div>
        )}
        <div className="psc-cell">
          <span className="psc-num">{stats.totalRatings}</span>
          <span className="psc-label">Ratings</span>
        </div>
        {stats.avg && (
          <div className="psc-cell">
            <span className="psc-num">{stats.avg}</span>
            <span className="psc-label">Avg Score</span>
          </div>
        )}
      </div>
      <div className="psc-pills">
        {stats.byType.movie > 0   && <span className="psc-pill">🎬 {stats.byType.movie} movies</span>}
        {stats.byType.tv_show > 0 && <span className="psc-pill">📺 {stats.byType.tv_show} shows</span>}
        {stats.byType.book > 0    && <span className="psc-pill">📖 {stats.byType.book} books</span>}
        {stats.topGenre           && <span className="psc-pill">🎭 {stats.topGenre}</span>}
        {stats.joined             && <span className="psc-pill psc-pill--muted">Joined {stats.joined}</span>}
      </div>
    </div>
  );
}

function CurrentlyWatchingStrip({ items }) {
  const location = useLocation();
  const active = items;
  if (!active.length) return null;

  return (
    <div className="cw-strip">
      <h3 className="cw-heading">
        {active.some(i => i.media_type === 'book') && active.some(i => i.media_type !== 'book')
          ? 'Currently Watching & Reading'
          : active[0].media_type === 'book'
          ? 'Currently Reading'
          : 'Currently Watching'}
      </h3>
      <div className="cw-row">
        {active.map((item, i) => {
          const poster = resolvePoster(item.poster_url || item.image_url);
          const progress = item.media_type === 'tv_show' && (item.current_season || item.current_episode)
            ? `S${item.current_season || '?'} · E${item.current_episode || '?'}`
            : item.media_type === 'book' && (item.current_chapter || item.current_page)
            ? [item.current_chapter ? `Ch ${item.current_chapter}` : null, item.current_page ? `Pg ${item.current_page}` : null].filter(Boolean).join(' · ')
            : null;
          const href = item.media_type === 'movie' ? `/movie/${item.media_id}?play=1`
            : item.media_type === 'tv_show' ? `/tv-show/${item.media_id}?play=1`
            : `/book/${item.media_id}`;
          return (
            <Link key={item.id ?? i} to={href} className="cw-card" title={item.title} state={{ backgroundLocation: location }}>
              <div className="cw-poster">
                {poster
                  ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                  : <div className="cw-placeholder">{MEDIA_ICONS[item.media_type]}</div>}
                {progress && <span className="cw-progress">{progress}</span>}
              </div>
              <p className="cw-title">{item.title}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function RatingStats({ ratings }) {
  const stats = useMemo(() => {
    if (!ratings.length) return null;
    const scores = ratings.map(r => computeNormalizedScore(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

    // Genre breakdown
    const genreCounts = {};
    ratings.forEach(r => {
      if (!r.genre) return;
      r.genre.split(',').forEach(g => {
        const trimmed = g.trim();
        if (trimmed) genreCounts[trimmed] = (genreCounts[trimmed] || 0) + 1;
      });
    });
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Top rated
    const sorted = [...ratings].sort((a, b) => {
      const sa = computeNormalizedScore(a.media_type, a) || 0;
      const sb = computeNormalizedScore(b.media_type, b) || 0;
      return sb - sa;
    });
    const topRated = sorted[0];

    return { avg, topGenre, topRated, total: ratings.length };
  }, [ratings]);

  if (!stats) return null;

  return (
    <div className="ratings-stats-row">
      {stats.avg && <div className="ratings-stat-pill">⭐ Avg {stats.avg}/10</div>}
      {stats.topGenre && <div className="ratings-stat-pill">🎭 Fav Genre: {stats.topGenre}</div>}
      {stats.topRated && <div className="ratings-stat-pill">🏆 Top Pick: {stats.topRated.title}</div>}
      <div className="ratings-stat-pill">📊 {stats.total} total ratings</div>
    </div>
  );
}

export default function UserProfile() {
  const { username } = useParams();
  const { user: currentUser } = useAuth();
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [searchParams] = useSearchParams();
  const [tab, setTab]             = useState(searchParams.get('tab') || 'watchlist');

  // Own-profile data loaded from Supabase directly
  const [ownWatchlist, setOwnWatchlist]     = useState(null);
  const [ownRatings, setOwnRatings]         = useState(null);
  const [ownContinueWatching, setOwnContinueWatching] = useState(null);
  const [ownDataLoading, setOwnDataLoading] = useState(false);

  // Filters
  const [wlFilter, setWlFilter]       = useState('');
  const [wlTypeFilter, setWlTypeFilter] = useState('');
  const [ratingsTab, setRatingsTab]   = useState('all');
  const [ratingsSort, setRatingsSort] = useState('score-desc');

  const loadedProfileId = data?.profile?.id;
  const isOwn = loadedProfileId
    ? currentUser?.id === loadedProfileId
    : currentUser?.username?.toLowerCase() === username?.toLowerCase();

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/profile/${username}`).then((profileData) => {
      setData(profileData);
    }).catch((err) => {
      setData(null);
      setError(err?.message || 'Unable to load this profile from Supabase.');
    }).finally(() => setLoading(false));
  }, [username]);

  // For own profile, load full watchlist + ratings + continue watching from Supabase
  useEffect(() => {
    if (!isOwn) return;
    setOwnDataLoading(true);
    Promise.allSettled([
      fetchSupabaseWatchlist(),
      fetchSupabaseRatings(),
      fetchSupabaseContinueWatching(),
    ]).then(([wl, rt, cw]) => {
      setOwnWatchlist(wl.status === 'fulfilled' && Array.isArray(wl.value) ? wl.value : []);
      setOwnRatings(rt.status === 'fulfilled' && Array.isArray(rt.value) ? rt.value : []);
      setOwnContinueWatching(cw.status === 'fulfilled' && Array.isArray(cw.value) ? cw.value : []);
    }).finally(() => setOwnDataLoading(false));
  }, [isOwn]);

  const toast = useToast();

  function handleWatchlistItemUpdate(id, updates) {
    setOwnWatchlist(prev => prev
      ? prev.map(item => item.id === id ? {
          ...item,
          ...(updates.status         !== undefined ? { status: updates.status }                     : {}),
          ...(updates.currentSeason  !== undefined ? { current_season: updates.currentSeason }      : {}),
          ...(updates.currentEpisode !== undefined ? { current_episode: updates.currentEpisode }    : {}),
          ...(updates.currentChapter !== undefined ? { current_chapter: updates.currentChapter }    : {}),
          ...(updates.currentPage    !== undefined ? { current_page: updates.currentPage }          : {}),
        } : item)
      : prev
    );
  }

  async function handleWatchlistItemRemove(item) {
    try {
      await removeSupabaseWatchlistItem(item.id);
      setOwnWatchlist(prev => prev ? prev.filter(i => i.id !== item.id) : prev);
      toast(`Removed "${item.title}" from your library`);
    } catch (err) {
      toast(err.message || 'Could not remove item', 'error');
    }
  }

  // All hooks must be called before any early returns
  const profile        = data?.profile || null;
  const publicRatings  = data?.ratings  || [];
  const publicWatchlist= data?.watchlist || [];
  const isPrivate      = data?.isPrivate || false;

  const displayWatchlist = isOwn && ownWatchlist != null ? ownWatchlist : publicWatchlist;
  const displayRatings   = isOwn && ownRatings   != null ? ownRatings   : publicRatings;

  // Watchlist filtering
  const filteredWatchlist = displayWatchlist.filter(item => {
    const matchStatus = !wlFilter     || item.status === wlFilter;
    const matchType   = !wlTypeFilter || item.media_type === wlTypeFilter;
    return matchStatus && matchType;
  });

  // Ratings filtering + sorting — must be before early returns
  const filteredRatings = useMemo(() => {
    let list = ratingsTab === 'all' ? displayRatings : displayRatings.filter(r => r.media_type === ratingsTab);
    return [...list].sort((a, b) => {
      if (ratingsSort === 'score-desc') return (computeNormalizedScore(b.media_type, b) || 0) - (computeNormalizedScore(a.media_type, a) || 0);
      if (ratingsSort === 'score-asc')  return (computeNormalizedScore(a.media_type, a) || 0) - (computeNormalizedScore(b.media_type, b) || 0);
      if (ratingsSort === 'recent')     return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (ratingsSort === 'title')      return (a.title || '').localeCompare(b.title || '');
      return 0;
    });
  }, [displayRatings, ratingsTab, ratingsSort]);

  // Early returns after all hooks
  if (loading) return <div className="app-layout"><Navbar /><main className="page-content"><div className="loading-state">Loading profile...</div></main></div>;
  if (error) return <div className="app-layout"><Navbar /><main className="page-content"><div className="empty-state">{error}</div></main></div>;
  if (!profile) return <div className="app-layout"><Navbar /><main className="page-content"><div className="empty-state">User not found.</div></main></div>;

  const tabs = [
    { id: 'watchlist', label: `📋 Library (${displayWatchlist.length})` },
    { id: 'ratings',   label: `⭐ Ratings (${displayRatings.length})` },
  ];

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content profile-page">

        {/* Profile header */}
        <div className="profile-header">
          <div className="profile-avatar-wrap">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt={profile.username} className="profile-avatar" />
              : <div className="profile-avatar-placeholder">{profile.username?.charAt(0).toUpperCase()}</div>
            }
          </div>
          <div className="profile-info">
            <h1 className="profile-username">{profile.username}</h1>
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            <div className="profile-stat-cards">
              <StatCard value={displayRatings.length}   label="Ratings" />
              <StatCard value={displayWatchlist.length} label="Library" />
            </div>
          </div>
          <div className="profile-actions">
            {isOwn && <Link to="/account-settings" className="btn-ghost">Edit Profile</Link>}
          </div>
        </div>

        {!isPrivate || isOwn ? (
          <ProfileStatsCard
            watchlist={displayWatchlist}
            ratings={displayRatings}
            joinDate={profile.created_at}
          />
        ) : null}

        {isPrivate && !isOwn ? (
          <div className="profile-private"><p>🔒 This profile is private.</p></div>
        ) : (
          <>
            <CurrentlyWatchingStrip items={isOwn ? (ownContinueWatching || []) : []} />

            <div className="profile-tabs">
              {tabs.map(t => (
                <button key={t.id} className={`profile-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} type="button">
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Watchlist tab ── */}
            {tab === 'watchlist' && (
              <>
                {/* Filters */}
                <div className="profile-wl-filters">
                  <ThemedSelect
                    className="admin-select"
                    aria-label="Filter watchlist by status"
                    value={wlFilter}
                    options={[
                      { value: '', label: 'All Statuses' },
                      { value: 'watching', label: 'Watching' },
                      { value: 'plan_to_watch', label: 'Plan to Watch' },
                      { value: 'watched', label: 'Watched' },
                      { value: 'reading', label: 'Reading' },
                      { value: 'plan_to_read', label: 'Plan to Read' },
                      { value: 'read', label: 'Read' },
                    ]}
                    onChange={e => setWlFilter(e.target.value)}
                  />
                  <ThemedSelect
                    className="admin-select"
                    aria-label="Filter watchlist by type"
                    value={wlTypeFilter}
                    options={[
                      { value: '', label: 'All Types' },
                      { value: 'movie', label: 'Movies' },
                      { value: 'tv_show', label: 'TV Shows' },
                      { value: 'book', label: 'Books' },
                    ]}
                    onChange={e => setWlTypeFilter(e.target.value)}
                  />
                  <span className="profile-filter-count">{filteredWatchlist.length} items</span>
                </div>

                {(ownDataLoading && isOwn) ? (
                  <div className="loading-state">Loading watchlist...</div>
                ) : filteredWatchlist.length === 0 ? (
                  <div className="empty-state">
                    <p>{isOwn ? 'Your watchlist is empty.' : 'Nothing in their watchlist yet.'}</p>
                    {isOwn && <Link to="/movies" className="btn-secondary" style={{ marginTop: '1rem', display: 'inline-block' }}>Browse the catalog</Link>}
                  </div>
                ) : (
                  <div className="profile-watchlist-grid">
                    {filteredWatchlist.map((item, i) => (
                      <WatchlistCard
                        key={item.id ?? i}
                        item={item}
                        isOwn={isOwn}
                        onUpdate={handleWatchlistItemUpdate}
                        onRemove={isOwn ? handleWatchlistItemRemove : undefined}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Ratings tab ── */}
            {tab === 'ratings' && (
              <>
                <RatingStats ratings={displayRatings} />

                <div className="profile-ratings-controls">
                  <div className="tabs" style={{ margin: 0 }}>
                    {[
                      { key: 'all', label: 'All' },
                      { key: 'movie', label: '🎬 Movies' },
                      { key: 'tv_show', label: '📺 TV' },
                      { key: 'book', label: '📖 Books' },
                    ].map(t => (
                      <button key={t.key} className={`tab-btn ${ratingsTab === t.key ? 'active' : ''}`} onClick={() => setRatingsTab(t.key)} type="button">
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <ThemedSelect
                    className="admin-select"
                    aria-label="Sort ratings"
                    value={ratingsSort}
                    options={[
                      { value: 'score-desc', label: 'Highest Score' },
                      { value: 'score-asc', label: 'Lowest Score' },
                      { value: 'recent', label: 'Most Recent' },
                      { value: 'title', label: 'A-Z' },
                    ]}
                    onChange={e => setRatingsSort(e.target.value)}
                  />
                </div>

                {(ownDataLoading && isOwn) ? (
                  <div className="loading-state">Loading ratings...</div>
                ) : filteredRatings.length === 0 ? (
                  <div className="empty-state">
                    <p>No ratings yet.</p>
                    {isOwn && <Link to="/movies" className="btn-secondary" style={{ marginTop: '1rem', display: 'inline-block' }}>Browse & rate something</Link>}
                  </div>
                ) : (
                  <div className="ratings-page-grid">
                    {filteredRatings.map(r => {
                      const score = computeNormalizedScore(r.media_type, r);
                      return (
                        <div key={`${r.media_type}-${r.media_id}`} className="ratings-page-card">
                          <div className="ratings-page-poster-wrap">
                            {r.image_url
                              ? <img src={resolvePoster(r.image_url)} alt={r.title} className="ratings-page-poster" referrerPolicy="no-referrer" />
                              : <div className="ratings-page-poster-placeholder">{(r.title || '?').charAt(0)}</div>
                            }
                          </div>
                          <div className="ratings-page-info">
                            <span className={`ratings-page-type-badge ratings-page-type-${r.media_type}`}>{TYPE_LABELS[r.media_type]}</span>
                            <h3 className="ratings-page-title">{r.title || `ID ${r.media_id}`}</h3>
                            {r.year && <p className="ratings-page-year">{r.year}</p>}
                            {score !== null && <p className="ratings-page-score">{score}<span>/10</span></p>}
                            <div className="ratings-page-artifact">
                              <RatingArtifact mediaType={r.media_type} scores={r} size={140} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

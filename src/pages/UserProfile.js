import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import RatingArtifact, { computeNormalizedScore } from '../components/RatingArtifact';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseWatchlist,
  fetchSupabaseRatings,
} from '../utils/supabaseData';

function resolvePoster(url) {
  if (!url) return null;
  try { if (url.includes('plex.tv')) { const inner = new URL(url).searchParams.get('url'); if (inner) return decodeURIComponent(inner); } } catch {}
  return url;
}

const STATUS_LABELS = { watching: 'Watching', watched: 'Watched', plan_to_watch: 'Plan to Watch', reading: 'Reading', read: 'Read', plan_to_read: 'Plan to Read' };
const STATUS_COLORS = { watching: '#e8c97a', watched: '#4caf82', reading: '#e8c97a', read: '#4caf82', plan_to_watch: '#7ab8e8', plan_to_read: '#7ab8e8' };
const TYPE_LABELS   = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const MEDIA_ICONS   = { movie: '🎬', tv_show: '📺', book: '📖' };

function StatCard({ value, label }) {
  return (
    <div className="profile-stat-card">
      <span className="profile-stat-num">{value}</span>
      <span className="profile-stat-label">{label}</span>
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
  const navigate = useNavigate();
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const [tab, setTab]             = useState(searchParams.get('tab') || 'watchlist');

  // Own-profile data loaded from Supabase directly
  const [ownWatchlist, setOwnWatchlist]   = useState(null);
  const [ownRatings, setOwnRatings]       = useState(null);
  const [ownDataLoading, setOwnDataLoading] = useState(false);

  // Filters
  const [wlFilter, setWlFilter]       = useState('');
  const [wlTypeFilter, setWlTypeFilter] = useState('');
  const [ratingsTab, setRatingsTab]   = useState('all');
  const [ratingsSort, setRatingsSort] = useState('score-desc');

  const isOwn = currentUser?.username === username;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/profile/${username}`),
      api.get(`/profile/${username}/follow-status`).catch(() => ({ following: false })),
    ]).then(([profileData, followStatus]) => {
      setData(profileData);
      setFollowing(followStatus.following);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [username]);

  // For own profile, load full watchlist + ratings from Supabase
  useEffect(() => {
    if (!isOwn) return;
    setOwnDataLoading(true);
    Promise.all([
      fetchSupabaseWatchlist(),
      fetchSupabaseRatings(),
    ]).then(([wl, rt]) => {
      setOwnWatchlist(wl);
      setOwnRatings(rt);
    }).catch(() => {
      setOwnWatchlist([]);
      setOwnRatings([]);
    }).finally(() => setOwnDataLoading(false));
  }, [isOwn]);

  async function handleFollow() {
    if (!currentUser) return navigate('/login');
    setFollowLoading(true);
    try {
      if (following) {
        await api.delete(`/profile/${username}/follow`);
        setFollowing(false);
        setData(d => d ? { ...d, followers: Math.max(0, (d.followers || 0) - 1) } : d);
      } else {
        await api.post(`/profile/${username}/follow`);
        setFollowing(true);
        setData(d => d ? { ...d, followers: (d.followers || 0) + 1 } : d);
      }
    } catch (err) { alert(err.message); }
    finally { setFollowLoading(false); }
  }

  // All hooks must be called before any early returns
  const profile        = data?.profile || null;
  const publicRatings  = data?.ratings  || [];
  const publicWatchlist= data?.watchlist || [];
  const posts          = data?.posts    || [];
  const followers      = data?.followers || 0;
  const followingCount = data?.following || 0;
  const isPrivate      = data?.isPrivate || false;

  // Use richer own-profile data when available
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
  if (!profile) return <div className="app-layout"><Navbar /><main className="page-content"><div className="empty-state">User not found.</div></main></div>;

  const tabs = [
    { id: 'watchlist', label: `📋 Watchlist (${displayWatchlist.length})` },
    { id: 'ratings',   label: `⭐ Ratings (${displayRatings.length})` },
    { id: 'posts',     label: '📝 Forum Posts' },
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
            <h1 className="profile-username">u/{profile.username}</h1>
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            <div className="profile-stat-cards">
              <StatCard value={followers || 0}      label="Followers" />
              <StatCard value={followingCount || 0} label="Following" />
              <StatCard value={displayRatings.length}   label="Ratings" />
              <StatCard value={displayWatchlist.length} label="Watchlist" />
            </div>
          </div>
          <div className="profile-actions">
            {!isOwn && currentUser && (
              <button className={following ? 'btn-ghost' : 'btn-primary'} onClick={handleFollow} disabled={followLoading} type="button">
                {followLoading ? '...' : following ? '✓ Following' : '+ Follow'}
              </button>
            )}
            {isOwn && <Link to="/account-settings" className="btn-ghost">Edit Profile</Link>}
          </div>
        </div>

        {isPrivate && !isOwn ? (
          <div className="profile-private"><p>🔒 This profile is private.</p></div>
        ) : (
          <>
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
                  <select className="admin-select" value={wlFilter} onChange={e => setWlFilter(e.target.value)}>
                    <option value="">All Statuses</option>
                    <option value="watching">Watching</option>
                    <option value="plan_to_watch">Plan to Watch</option>
                    <option value="watched">Watched</option>
                    <option value="reading">Reading</option>
                    <option value="plan_to_read">Plan to Read</option>
                    <option value="read">Read</option>
                  </select>
                  <select className="admin-select" value={wlTypeFilter} onChange={e => setWlTypeFilter(e.target.value)}>
                    <option value="">All Types</option>
                    <option value="movie">Movies</option>
                    <option value="tv_show">TV Shows</option>
                    <option value="book">Books</option>
                  </select>
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
                    {filteredWatchlist.map((item, i) => {
                      const poster = resolvePoster(item.poster_url || item.image_url);
                      const color  = STATUS_COLORS[item.status] || '#555';
                      const url    = item.media_type === 'movie' ? `/movies?open=${item.media_id}` : item.media_type === 'tv_show' ? `/tv-shows?open=${item.media_id}` : `/books?open=${item.media_id}`;
                      return (
                        <Link key={i} to={url} className="profile-wl-card">
                          <div className="profile-wl-poster">
                            {poster
                              ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                              : <div className="profile-wl-placeholder">{MEDIA_ICONS[item.media_type]}</div>
                            }
                            <span className="profile-wl-status" style={{ background: color + '22', color, borderColor: color + '44' }}>
                              {STATUS_LABELS[item.status] || item.status}
                            </span>
                          </div>
                          <p className="profile-wl-title">{item.title || '—'}</p>
                          {item.year && <p className="profile-wl-year">{item.year}</p>}
                        </Link>
                      );
                    })}
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
                  <select className="admin-select" value={ratingsSort} onChange={e => setRatingsSort(e.target.value)}>
                    <option value="score-desc">Highest Score</option>
                    <option value="score-asc">Lowest Score</option>
                    <option value="recent">Most Recent</option>
                    <option value="title">A–Z</option>
                  </select>
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
                            {r.review && <p className="ratings-page-review">"{r.review}"</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* ── Posts tab ── */}
            {tab === 'posts' && (
              <div className="profile-posts-list">
                {!posts?.length && <div className="empty-state"><p>No forum posts yet.</p></div>}
                {posts?.map(post => (
                  <Link key={post.id} to={`/forum/${post.forums?.slug}/post/${post.id}`} className="profile-post-card">
                    <div className="profile-post-meta">
                      <span className="forum-community-pill">{post.forums?.icon} {post.forums?.name}</span>
                      {post.flair && <span className="forum-flair" style={{ background: '#4a9eff22', color: '#4a9eff', border: '1px solid #4a9eff44' }}>{post.flair}</span>}
                    </div>
                    <p className="profile-post-title">{post.title}</p>
                    <div className="profile-post-stats">
                      <span>▲ {post.score}</span>
                      <span>💬 {post.comment_count}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

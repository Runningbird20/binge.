import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

function resolvePoster(url) {
  if (!url) return null;
  try { if (url.includes('plex.tv')) { const inner = new URL(url).searchParams.get('url'); if (inner) return decodeURIComponent(inner); } } catch {}
  return url;
}

const STATUS_LABELS = { watching: 'Watching', watched: 'Watched', plan_to_watch: 'Plan to Watch', reading: 'Reading', read: 'Read', plan_to_read: 'Plan to Read' };
const STATUS_COLORS = { watching: '#e8c97a', watched: '#4caf82', reading: '#e8c97a', read: '#4caf82' };

export default function UserProfile() {
  const { username } = useParams();
  const { user: currentUser } = useAuth();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [tab, setTab]           = useState('watchlist'); // watchlist | posts

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

  async function handleFollow() {
    if (!currentUser) return;
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

  if (loading) return <div className="app-layout"><Navbar /><main className="page-content"><div className="loading-state">Loading profile...</div></main></div>;
  if (!data?.profile) return <div className="app-layout"><Navbar /><main className="page-content"><div className="empty-state">User not found.</div></main></div>;

  const { profile, ratings, watchlist, posts, followers, following: followingCount, isPrivate } = data;
  const isOwn = currentUser?.id === profile.id;

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
            <div className="profile-stats">
              <span><strong>{followers || 0}</strong> followers</span>
              <span><strong>{followingCount || 0}</strong> following</span>
              <span><strong>{ratings?.length || 0}</strong> ratings</span>
              <span><strong>{watchlist?.length || 0}</strong> watchlist</span>
            </div>
          </div>
          <div className="profile-actions">
            {!isOwn && currentUser && (
              <button
                className={following ? 'btn-ghost' : 'btn-primary'}
                onClick={handleFollow}
                disabled={followLoading}
                type="button"
              >
                {followLoading ? '...' : following ? '✓ Following' : '+ Follow'}
              </button>
            )}
            {isOwn && <Link to="/account-settings" className="btn-ghost">Edit Profile</Link>}
          </div>
        </div>

        {isPrivate ? (
          <div className="profile-private">
            <p>🔒 This profile is private.</p>
          </div>
        ) : (
          <>
            <div className="profile-tabs">
              <button className={`profile-tab ${tab === 'watchlist' ? 'active' : ''}`} onClick={() => setTab('watchlist')} type="button">📋 Watchlist</button>
              <button className={`profile-tab ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')} type="button">📝 Forum Posts</button>
            </div>

            {tab === 'watchlist' && (
              <div className="profile-watchlist-grid">
                {watchlist?.length === 0 && <p className="profile-empty">Nothing in their watchlist yet.</p>}
                {watchlist?.map((item, i) => {
                  const poster = resolvePoster(item.poster_url);
                  const statusColor = STATUS_COLORS[item.status] || '#555';
                  return (
                    <div key={i} className="profile-wl-card">
                      <div className="profile-wl-poster">
                        {poster
                          ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                          : <div className="profile-wl-placeholder">{item.title?.charAt(0)}</div>
                        }
                        <span className="profile-wl-status" style={{ background: statusColor + '22', color: statusColor, borderColor: statusColor + '44' }}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </div>
                      <p className="profile-wl-title">{item.title || '—'}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'posts' && (
              <div className="profile-posts-list">
                {posts?.length === 0 && <p className="profile-empty">No forum posts yet.</p>}
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

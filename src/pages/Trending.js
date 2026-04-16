import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';

export default function Trending() {
  const [posts, setPosts]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/forum/trending')
      .then(data => setPosts(Array.isArray(data) ? data : []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Discovery</p>
          <h1>🔥 Trending</h1>
          <p className="page-subtitle">What the community is talking about most right now.</p>
        </div>

        {loading ? (
          <div className="trending-skeleton">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="trending-skeleton-card skeleton-pulse" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="empty-state">
            <p>🗣️ No trending posts yet.</p>
            <p className="empty-hint">Be the first to post in the forum and get the conversation going.</p>
            <Link to="/forum" className="btn-secondary" style={{ display: 'inline-block', marginTop: '1rem' }}>Go to Forum</Link>
          </div>
        ) : (
          <div className="trending-list">
            {posts.map((post, i) => {
              const mediaUrl = post.media_id
                ? post.media_type === 'movie'   ? `/movies?open=${post.media_id}`
                : post.media_type === 'tv_show' ? `/tv-shows?open=${post.media_id}`
                : null
                : null;

              return (
                <div key={post.id} className="trending-card">
                  <div className="trending-rank">#{i + 1}</div>

                  {post.poster_url && (
                    <img src={post.poster_url} alt={post.title} className="trending-poster" referrerPolicy="no-referrer" />
                  )}

                  <div className="trending-content">
                    <div className="trending-meta">
                      <span className="forum-community-pill">{post.forums?.icon} {post.forums?.name}</span>
                      {post.flair && <span className="forum-flair">{post.flair}</span>}
                    </div>
                    <Link to={`/forum/${post.forums?.slug}/post/${post.id}`} className="trending-title">
                      {post.title}
                    </Link>
                    <div className="trending-stats">
                      <span>▲ {post.score || 0} votes</span>
                      <span>💬 {post.comment_count || 0} comments</span>
                      <span>👤 by {post.author?.username || 'unknown'}</span>
                    </div>
                    {mediaUrl && (
                      <Link to={mediaUrl} className="trending-media-link">
                        🎬 View {post.media_type?.replace('_', ' ')} in catalog →
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

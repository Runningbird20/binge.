import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

const FLAIRS = ['Discussion', 'Review', 'News', 'Question', 'Fan Theory', 'Recommendation', 'Spoiler', 'Leak', 'Meme', 'Other'];
const FLAIR_COLORS = {
  'Discussion': '#4a9eff', 'Review': '#9b59b6', 'News': '#e67e22',
  'Question': '#27ae60', 'Fan Theory': '#8e44ad', 'Recommendation': '#16a085',
  'Spoiler': '#c0392b', 'Leak': '#d35400', 'Meme': '#f39c12', 'Other': '#555',
};
const SORT_OPTIONS = [
  { value: 'hot', label: '🔥 Hot' },
  { value: 'new', label: '✨ New' },
  { value: 'top', label: '⭐ Top' },
];

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function VoteButtons({ score, onVote, userVote, vertical = false }) {
  return (
    <div className={`vote-btns ${vertical ? 'vote-btns--vertical' : ''}`}>
      <button className={`vote-btn ${userVote === 1 ? 'vote-btn--up active' : 'vote-btn--up'}`} onClick={() => onVote(userVote === 1 ? 0 : 1)} type="button">▲</button>
      <span className={`vote-score ${score > 0 ? 'pos' : score < 0 ? 'neg' : ''}`}>{score}</span>
      <button className={`vote-btn ${userVote === -1 ? 'vote-btn--down active' : 'vote-btn--down'}`} onClick={() => onVote(userVote === -1 ? 0 : -1)} type="button">▼</button>
    </div>
  );
}

function PostCard({ post, forumSlug, onVote, userVote }) {
  const slug = forumSlug || post.forums?.slug;
  const flairColor = FLAIR_COLORS[post.flair] || '#555';
  return (
    <article className="forum-post-card">
      <VoteButtons score={post.score} onVote={onVote} userVote={userVote} vertical />
      <div className="forum-post-body">
        <div className="forum-post-meta">
          {post.forums && <Link to={`/forum/${post.forums.slug}`} className="forum-tag">{post.forums.icon} {post.forums.name}</Link>}
          <span className="forum-post-author">u/{post.profiles?.username || 'unknown'}</span>
          <span className="forum-post-time">{timeAgo(post.created_at)}</span>
        </div>
        <Link to={`/forum/${slug}/post/${post.id}`} className="forum-post-title">
          {post.flair && <span className="forum-flair" style={{ background: flairColor + '22', color: flairColor, border: `1px solid ${flairColor}44` }}>{post.flair}</span>}
          {post.title}
        </Link>
        {post.tags?.length > 0 && (
          <div className="forum-post-tags">{post.tags.map(t => <span key={t} className="forum-tag-pill">#{t}</span>)}</div>
        )}
        <div className="forum-post-footer">
          <Link to={`/forum/${slug}/post/${post.id}`} className="forum-comment-count">💬 {post.comment_count} comments</Link>
          {post.is_pinned && <span className="forum-pinned">📌 Pinned</span>}
        </div>
      </div>
    </article>
  );
}

function CreatePostModal({ forumSlug, onClose, onCreated }) {
  const [title, setTitle]   = useState('');
  const [body, setBody]     = useState('');
  const [flair, setFlair]   = useState('');
  const [tags, setTags]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!title.trim()) return setError('Title is required');
    setLoading(true); setError('');
    try {
      const tagArr = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const post = await api.post(`/forum/${forumSlug}/posts`, { title, body, flair: flair || null, tags: tagArr });
      onCreated(post);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="forum-modal" onClick={e => e.stopPropagation()}>
        <div className="forum-modal-header">
          <h2>Create Post</h2>
          <button onClick={onClose} type="button" className="modal-close-btn">✕</button>
        </div>

        {error && <div className="forum-error">{error}</div>}

        <input className="forum-input" placeholder="Title *" value={title} onChange={e => setTitle(e.target.value)} maxLength={300} />
        <textarea className="forum-textarea" placeholder="Body (optional — markdown supported)" value={body} onChange={e => setBody(e.target.value)} rows={6} />

        <div className="forum-modal-row">
          <select className="forum-select" value={flair} onChange={e => setFlair(e.target.value)}>
            <option value="">Select flair...</option>
            {FLAIRS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <input className="forum-input" placeholder="Tags (comma separated)" value={tags} onChange={e => setTags(e.target.value)} />
        </div>

        <div className="forum-modal-actions">
          <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading} type="button">
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateForumModal({ onClose, onCreated }) {
  const [name, setName]     = useState('');
  const [desc, setDesc]     = useState('');
  const [icon, setIcon]     = useState('💬');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return setError('Name is required');
    setLoading(true); setError('');
    try {
      const forum = await api.post('/forum', { name, description: desc, icon });
      onCreated(forum);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="forum-modal" onClick={e => e.stopPropagation()}>
        <div className="forum-modal-header">
          <h2>Create Community</h2>
          <button onClick={onClose} type="button" className="modal-close-btn">✕</button>
        </div>
        {error && <div className="forum-error">{error}</div>}
        <div className="forum-modal-row">
          <input className="forum-input forum-input--icon" placeholder="Icon emoji" value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} style={{ width: 70 }} />
          <input className="forum-input" placeholder="Community name *" value={name} onChange={e => setName(e.target.value)} maxLength={50} />
        </div>
        <textarea className="forum-textarea" placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} rows={3} />
        <div className="forum-modal-actions">
          <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading} type="button">{loading ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Forum home (list of communities) ─────────────────────────────────────────
function ForumHome() {
  const [forums, setForums]     = useState([]);
  const [myForums, setMyForums] = useState([]);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/forum').catch(() => []),
      api.get('/forum/user/my-forums').catch(() => []),
    ]).then(([all, mine]) => {
      setForums(Array.isArray(all) ? all : []);
      setMyForums(Array.isArray(mine) ? mine.map(f => f.id) : []);
    }).catch(() => {
      setForums([]);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = forums.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content forum-page">
        <div className="forum-home-header">
          <div>
            <h1 className="forum-page-title">💬 Communities</h1>
            <p className="forum-page-subtitle">Discuss movies, TV shows, books, and everything in between</p>
          </div>
          <button className="btn-primary" onClick={() => setShowCreate(true)} type="button">+ Create Community</button>
        </div>

        <div className="forum-search-bar">
          <input className="search-input" placeholder="Search communities..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? <div className="loading-state">Loading...</div> : (
          <div className="forum-grid">
            {filtered.map(forum => (
              <Link key={forum.id} to={`/forum/${forum.slug}`} className="forum-card">
                <div className="forum-card-icon" style={{ background: forum.banner_color || '#1a1a1a' }}>{forum.icon}</div>
                <div className="forum-card-info">
                  <h3>{forum.name}</h3>
                  <p className="forum-card-desc">{forum.description || 'No description'}</p>
                  <span className="forum-card-members">👥 {forum.member_count?.toLocaleString()} members</span>
                </div>
                {myForums.includes(forum.id) && <span className="forum-joined-badge">Joined</span>}
              </Link>
            ))}
          </div>
        )}

        {showCreate && <CreateForumModal onClose={() => setShowCreate(false)} onCreated={f => { setForums(prev => [f, ...prev]); navigate(`/forum/${f.slug}`); }} />}
      </main>
    </div>
  );
}

// ── Single forum view ─────────────────────────────────────────────────────────
function ForumView() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [forum, setForum]       = useState(null);
  const [posts, setPosts]       = useState([]);
  const [sort, setSort]         = useState('hot');
  const [page, setPage]         = useState(1);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [joined, setJoined]     = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [myVotes, setMyVotes]   = useState({});

  const fetchPosts = useCallback(async (pageNum, sortVal) => {
    try {
      const data = await api.get(`/forum/${slug}/posts?sort=${sortVal}&page=${pageNum}`);
      setPosts(prev => pageNum === 1 ? (data.posts || []) : [...prev, ...(data.posts || [])]);
      setTotal(data.total || 0);
    } catch (err) {
      console.warn('Forum posts unavailable:', err.message);
      if (pageNum === 1) setPosts([]);
    } finally { setLoading(false); }
  }, [slug]);

  useEffect(() => {
    api.get(`/forum/${slug}`).then(setForum).catch(() => {});
    api.get('/forum/user/my-forums').then(mine => {
      if (Array.isArray(mine)) setJoined(mine.some(f => f.slug === slug));
    }).catch(() => {});
  }, [slug]);

  useEffect(() => { setPage(1); setLoading(true); fetchPosts(1, sort); }, [sort, fetchPosts]);

  async function handleJoinLeave() {
    try {
      if (joined) { await api.post(`/forum/${slug}/leave`); setJoined(false); }
      else        { await api.post(`/forum/${slug}/join`);  setJoined(true); }
    } catch { /* ignore */ }
  }

  async function handleVote(postId, value) {
    if (!user) return;
    const prev = myVotes[postId] || 0;
    setMyVotes(v => ({ ...v, [postId]: value }));
    setPosts(ps => ps.map(p => p.id === postId ? { ...p, score: p.score + (value - prev) } : p));
    await api.post(`/forum/post/${postId}/vote`, { value }).catch(() => {
      setMyVotes(v => ({ ...v, [postId]: prev }));
    });
  }

  if (!forum && !loading) return <div className="app-layout"><Navbar /><main className="page-content"><div className="empty-state">Community not found.</div></main></div>;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content forum-page">
        {forum && (
          <div className="forum-banner" style={{ background: `linear-gradient(135deg, ${forum.banner_color || '#1a1a1a'}, #0a0a0a)` }}>
            <span className="forum-banner-icon">{forum.icon}</span>
            <div>
              <h1 className="forum-banner-name">{forum.name}</h1>
              <p className="forum-banner-desc">{forum.description}</p>
              <span className="forum-banner-members">👥 {forum.member_count?.toLocaleString()} members</span>
            </div>
            <div className="forum-banner-actions">
              {user && <button className={`${joined ? 'btn-ghost' : 'btn-primary'} btn-sm`} onClick={handleJoinLeave} type="button">{joined ? 'Leave' : '+ Join'}</button>}
              <button className="btn-primary btn-sm" onClick={() => setShowCreate(true)} type="button">+ Post</button>
            </div>
          </div>
        )}

        <div className="forum-controls">
          <div className="forum-sort-tabs">
            {SORT_OPTIONS.map(s => (
              <button key={s.value} className={`forum-sort-btn ${sort === s.value ? 'active' : ''}`} onClick={() => setSort(s.value)} type="button">{s.label}</button>
            ))}
          </div>
          <span className="forum-post-count">{total.toLocaleString()} posts</span>
        </div>

        {loading ? <div className="loading-state">Loading...</div> : posts.length === 0 ? (
          <div className="empty-state"><p>No posts yet.</p><p className="empty-hint">Be the first to post!</p></div>
        ) : (
          <>
            <div className="forum-posts-list">
              {posts.map(post => <PostCard key={post.id} post={post} forumSlug={slug} onVote={v => handleVote(post.id, v)} userVote={myVotes[post.id] || 0} />)}
            </div>
            {posts.length < total && (
              <button className="forum-load-more" onClick={() => { const next = page + 1; setPage(next); fetchPosts(next, sort); }} type="button">Load more</button>
            )}
          </>
        )}
      </main>

      {showCreate && <CreatePostModal forumSlug={slug} onClose={() => setShowCreate(false)} onCreated={p => setPosts(prev => [p, ...prev])} />}
    </div>
  );
}

// ── Post detail view ──────────────────────────────────────────────────────────
function PostView() {
  const { slug, postId } = useParams();
  const { user } = useAuth();
  const [post, setPost]       = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState('');
  const [myPostVote, setMyPostVote] = useState(0);
  const [myCommentVotes, setMyCommentVotes] = useState({});

  useEffect(() => {
    api.get(`/forum/post/${postId}`)
      .then(data => { setPost(data.post); setComments(data.comments || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  async function handlePostVote(value) {
    if (!user || !post) return;
    const prev = myPostVote;
    setMyPostVote(value);
    setPost(p => ({ ...p, score: p.score + (value - prev) }));
    await api.post(`/forum/post/${post.id}/vote`, { value }).catch(() => { setMyPostVote(prev); });
  }

  async function handleCommentVote(commentId, value) {
    if (!user) return;
    const prev = myCommentVotes[commentId] || 0;
    setMyCommentVotes(v => ({ ...v, [commentId]: value }));
    setComments(cs => cs.map(c => c.id === commentId ? { ...c, score: c.score + (value - prev) } : c));
    await api.post(`/forum/comment/${commentId}/vote`, { value }).catch(() => {
      setMyCommentVotes(v => ({ ...v, [commentId]: prev }));
    });
  }

  async function handleComment(e) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmitting(true); setError('');
    try {
      const data = await api.post(`/forum/post/${postId}/comments`, { body: commentBody, parent_comment_id: replyTo });
      setComments(prev => [data, ...prev]);
      setCommentBody('');
      setReplyTo(null);
      setPost(p => ({ ...p, comment_count: p.comment_count + 1 }));
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  // Nest comments
  function buildTree(comments) {
    const map = {};
    const roots = [];
    comments.forEach(c => { map[c.id] = { ...c, replies: [] }; });
    comments.forEach(c => {
      if (c.parent_comment_id && map[c.parent_comment_id]) map[c.parent_comment_id].replies.push(map[c.id]);
      else roots.push(map[c.id]);
    });
    return roots;
  }

  function CommentNode({ comment, depth = 0 }) {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <div className={`forum-comment depth-${Math.min(depth, 6)}`}>
        <div className="forum-comment-inner">
          <VoteButtons score={comment.score} onVote={v => handleCommentVote(comment.id, v)} userVote={myCommentVotes[comment.id] || 0} />
          <div className="forum-comment-content">
            <div className="forum-comment-meta">
              <span className="forum-comment-author">u/{comment.profiles?.username || 'unknown'}</span>
              <span className="forum-comment-time">{timeAgo(comment.created_at)}</span>
              <button className="forum-collapse-btn" onClick={() => setCollapsed(c => !c)} type="button">{collapsed ? '[+]' : '[−]'}</button>
            </div>
            {!collapsed && (
              <>
                {comment.is_removed
                  ? <p className="forum-comment-removed">[Removed by moderator{comment.removal_reason ? `: ${comment.removal_reason}` : ''}]</p>
                  : <p className="forum-comment-body">{comment.body}</p>
                }
                {!collapsed && user && (
                  <button className="forum-reply-btn" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)} type="button">Reply</button>
                )}
              </>
            )}
          </div>
        </div>
        {!collapsed && replyTo === comment.id && (
          <form className="forum-reply-form" onSubmit={handleComment}>
            <textarea className="forum-textarea forum-textarea--sm" value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder="Write a reply..." rows={3} />
            <div className="forum-modal-actions">
              <button className="btn-ghost btn-sm" onClick={() => setReplyTo(null)} type="button">Cancel</button>
              <button className="btn-primary btn-sm" type="submit" disabled={submitting}>{submitting ? '...' : 'Reply'}</button>
            </div>
          </form>
        )}
        {!collapsed && comment.replies?.length > 0 && (
          <div className="forum-replies">
            {comment.replies.map(r => <CommentNode key={r.id} comment={r} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  const flairColor = FLAIR_COLORS[post?.flair] || '#555';

  if (loading) return <div className="app-layout"><Navbar /><main className="page-content"><div className="loading-state">Loading...</div></main></div>;
  if (!post)   return <div className="app-layout"><Navbar /><main className="page-content"><div className="empty-state">Post not found.</div></main></div>;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content forum-page">
        <Link to={`/forum/${slug}`} className="forum-back-link">← Back to {post.forums?.name || 'community'}</Link>

        <article className="forum-post-detail">
          <div className="forum-post-detail-vote">
            <VoteButtons score={post.score} onVote={handlePostVote} userVote={myPostVote} vertical />
          </div>
          <div className="forum-post-detail-body">
            <div className="forum-post-meta">
              <span className="forum-post-author">u/{post.profiles?.username || 'unknown'}</span>
              <span className="forum-post-time">{timeAgo(post.created_at)}</span>
              {post.flair && <span className="forum-flair" style={{ background: flairColor + '22', color: flairColor, border: `1px solid ${flairColor}44` }}>{post.flair}</span>}
            </div>
            <h1 className="forum-post-detail-title">{post.title}</h1>
            {post.tags?.length > 0 && <div className="forum-post-tags">{post.tags.map(t => <span key={t} className="forum-tag-pill">#{t}</span>)}</div>}
            {post.body && <div className="forum-post-detail-text">{post.body}</div>}
          </div>
        </article>

        <section className="forum-comments-section">
          <h2 className="forum-comments-heading">{post.comment_count} Comments</h2>

          {user ? (
            <form className="forum-comment-form" onSubmit={handleComment}>
              {replyTo === null && (
                <>
                  <textarea className="forum-textarea" value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder="What are your thoughts?" rows={4} />
                  {error && <div className="forum-error">{error}</div>}
                  <button className="btn-primary btn-sm" type="submit" disabled={submitting || !commentBody.trim()}>{submitting ? 'Posting...' : 'Comment'}</button>
                </>
              )}
            </form>
          ) : (
            <p className="forum-login-prompt">Log in to comment</p>
          )}

          <div className="forum-comment-tree">
            {buildTree(comments).map(c => <CommentNode key={c.id} comment={c} />)}
          </div>
        </section>
      </main>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function ForumRouter() {
  const { slug, postId } = useParams();
  if (slug && postId) return <PostView />;
  if (slug)           return <ForumView />;
  return                     <ForumHome />;
}

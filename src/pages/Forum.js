import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { normalizeUserType } from '../utils/userAccess';

// ── Constants ─────────────────────────────────────────────────────────────────
const FLAIRS = ['Discussion', 'Review', 'News', 'Question', 'Fan Theory', 'Recommendation', 'Spoiler', 'Leak', 'Meme', 'Other'];
const FLAIR_COLORS = {
  'Discussion': '#4a9eff', 'Review': '#9b59b6', 'News': '#e67e22',
  'Question': '#27ae60', 'Fan Theory': '#8e44ad', 'Recommendation': '#16a085',
  'Spoiler': '#c0392b', 'Leak': '#d35400', 'Meme': '#f39c12', 'Other': '#555',
};
const SORT_OPTIONS = [
  { value: 'hot',  label: '🔥 Hot'  },
  { value: 'new',  label: '✨ New'  },
  { value: 'top',  label: '⭐ Top'  },
];
const COMMENT_SORT_OPTIONS = [
  { value: 'best', label: 'Best'  },
  { value: 'new',  label: 'New'   },
  { value: 'old',  label: 'Old'   },
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    const el = document.createElement('textarea');
    el.value = text; document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
  });
}

// Simple markdown renderer — bold, italic, code, links, blockquotes
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];

  lines.forEach((line, i) => {
    let el;
    if (line.startsWith('> ')) {
      el = <blockquote key={i} className="forum-blockquote">{inlineMarkdown(line.slice(2))}</blockquote>;
    } else if (line.startsWith('### ')) {
      el = <h3 key={i} className="forum-md-h3">{line.slice(4)}</h3>;
    } else if (line.startsWith('## ')) {
      el = <h2 key={i} className="forum-md-h2">{line.slice(3)}</h2>;
    } else if (line.trim() === '') {
      el = <br key={i} />;
    } else {
      el = <p key={i} className="forum-md-p">{inlineMarkdown(line)}</p>;
    }
    elements.push(el);
  });
  return elements;
}

function inlineMarkdown(text) {
  // Split on markdown tokens
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))   return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))   return <code key={i} className="forum-inline-code">{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="forum-link">{linkMatch[1]}</a>;
    return part;
  });
}

// ── Shared Components ─────────────────────────────────────────────────────────
function VoteButtons({ score, onVote, userVote, vertical = false, disabled = false }) {
  return (
    <div className={`vote-btns ${vertical ? 'vote-btns--vertical' : ''}`}>
      <button
        className={`vote-btn vote-btn--up ${userVote === 1 ? 'active' : ''}`}
        onClick={() => !disabled && onVote(userVote === 1 ? 0 : 1)}
        type="button" title="Upvote" disabled={disabled}
      >▲</button>
      <span className={`vote-score ${score > 0 ? 'pos' : score < 0 ? 'neg' : ''}`}>{score}</span>
      <button
        className={`vote-btn vote-btn--down ${userVote === -1 ? 'active' : ''}`}
        onClick={() => !disabled && onVote(userVote === -1 ? 0 : -1)}
        type="button" title="Downvote" disabled={disabled}
      >▼</button>
    </div>
  );
}

function FlairBadge({ flair, size = 'sm' }) {
  if (!flair) return null;
  const color = FLAIR_COLORS[flair] || '#555';
  return (
    <span className={`forum-flair forum-flair--${size}`}
      style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
      {flair}
    </span>
  );
}

function ShareButton({ url, title }) {
  const [copied, setCopied] = useState(false);
  function handleShare() {
    copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button className="forum-share-btn" onClick={handleShare} type="button" title="Copy link">
      {copied ? '✓ Copied!' : '🔗 Share'}
    </button>
  );
}

function ReportButton({ postId, commentId }) {
  const [reported, setReported] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');

  async function handleReport() {
    if (!reason.trim()) return;
    // Just log for now — in production would send to a reports table
    console.log('Report submitted:', { postId, commentId, reason });
    setReported(true);
    setShowForm(false);
  }

  if (reported) return <span className="forum-reported-badge">Reported</span>;

  return (
    <>
      <button className="forum-report-btn" onClick={() => setShowForm(v => !v)} type="button">⚑ Report</button>
      {showForm && (
        <div className="forum-report-form">
          <select className="forum-select forum-select--sm" value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select reason...</option>
            <option value="spam">Spam</option>
            <option value="harassment">Harassment</option>
            <option value="hate">Hate speech</option>
            <option value="misinformation">Misinformation</option>
            <option value="illegal">Illegal content</option>
            <option value="other">Other</option>
          </select>
          <button className="forum-action-btn forum-action-btn--report" onClick={handleReport} type="button" disabled={!reason}>Submit</button>
          <button className="forum-action-btn" onClick={() => setShowForm(false)} type="button">Cancel</button>
        </div>
      )}
    </>
  );
}

// ── Post Card (in feed) ───────────────────────────────────────────────────────
function PostCard({ post, forumSlug, onVote, userVote, user, isAdmin, onDelete }) {
  const slug = forumSlug || post.forums?.slug;
  const postUrl = `${window.location.origin}/forum/${slug}/post/${post.id}`;
  const isSpoiler = post.flair === 'Spoiler';
  const canDelete = user && (isAdmin || user.id === post.user_id);

  return (
    <article className="forum-post-card">
      <VoteButtons score={post.score} onVote={onVote} userVote={userVote} vertical disabled={!user} />
      <div className="forum-post-body">
        <div className="forum-post-meta">
          {post.forums && (
            <Link to={`/forum/${post.forums.slug}`} className="forum-community-pill">
              {post.forums.icon} {post.forums.name}
            </Link>
          )}
          <span className="forum-post-author">u/{post.profiles?.username || 'unknown'}</span>
          <span className="forum-post-time">{timeAgo(post.created_at)}</span>
          {post.is_pinned && <span className="forum-pinned">📌 Pinned</span>}
        </div>

        <Link to={`/forum/${slug}/post/${post.id}`} className="forum-post-title">
          <FlairBadge flair={post.flair} />
          {post.title}
        </Link>

        {isSpoiler && post.body && (
          <p className="forum-spoiler-hint">⚠️ Spoiler post — click to reveal inside</p>
        )}

        {post.tags?.length > 0 && (
          <div className="forum-post-tags">
            {post.tags.map(t => <span key={t} className="forum-tag-pill">#{t}</span>)}
          </div>
        )}

        <div className="forum-post-footer">
          <Link to={`/forum/${slug}/post/${post.id}`} className="forum-comment-count">
            💬 {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
          </Link>
          <ShareButton url={postUrl} />
          {user && !isAdmin && <ReportButton postId={post.id} />}
          {canDelete && (
            <button
              className="forum-action-btn forum-action-btn--delete forum-action-btn--inline"
              onClick={() => onDelete && onDelete(post.id, isAdmin)}
              type="button"
            >
              {isAdmin ? '🛡️ Remove' : '🗑️ Delete'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Create Post Modal ─────────────────────────────────────────────────────────
function CreatePostModal({ forumSlug, onClose, onCreated }) {
  const [title, setTitle]     = useState('');
  const [body, setBody]       = useState('');
  const [flair, setFlair]     = useState('');
  const [tags, setTags]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);
  const titleRef = useRef(null);

  // Focus title on open, Escape to close
  useEffect(() => {
    titleRef.current?.focus();
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSubmit();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [title, body, flair, tags]); // eslint-disable-line

  async function handleSubmit() {
    if (!title.trim()) return setError('Title is required');
    if (title.length > 300) return setError('Title is too long (300 char max)');
    setLoading(true); setError('');
    try {
      const tagArr = tags.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
      const post = await api.post(`/forum/${forumSlug}/posts`, { title: title.trim(), body, flair: flair || null, tags: tagArr });
      onCreated(post);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="forum-modal forum-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="forum-modal-header">
          <h2>Create Post</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className={`forum-preview-toggle ${preview ? 'active' : ''}`} onClick={() => setPreview(v => !v)} type="button">
              {preview ? '✏️ Edit' : '👁 Preview'}
            </button>
            <button onClick={onClose} type="button" className="modal-close-btn">✕</button>
          </div>
        </div>

        {error && <div className="forum-error">{error}</div>}

        {preview ? (
          <div className="forum-post-preview">
            <FlairBadge flair={flair} size="md" />
            <h3 className="forum-preview-title">{title || <em style={{ color: '#444' }}>No title yet</em>}</h3>
            <div className="forum-post-detail-text">{body ? renderMarkdown(body) : <em style={{ color: '#444' }}>No body yet</em>}</div>
          </div>
        ) : (
          <>
            <div className="forum-input-wrap">
              <input
                ref={titleRef}
                className="forum-input"
                placeholder="Title *"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={300}
              />
              <span className={`forum-char-count ${title.length > 280 ? 'warn' : ''}`}>{title.length}/300</span>
            </div>
            <div className="forum-input-wrap">
              <textarea
                className="forum-textarea"
                placeholder={"What's on your mind? Markdown supported:\n**bold** *italic* `code` [link](url) > quote"}
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={7}
              />
              <span className="forum-char-count">{body.length} chars</span>
            </div>
          </>
        )}

        <div className="forum-modal-row">
          <select className="forum-select" value={flair} onChange={e => setFlair(e.target.value)}>
            <option value="">No flair</option>
            {FLAIRS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <input className="forum-input" placeholder="Tags: anime, comedy, 2024..." value={tags} onChange={e => setTags(e.target.value)} style={{ marginBottom: 0 }} />
        </div>

        <div className="forum-modal-hint">💡 Tip: Ctrl+Enter to post quickly</div>

        <div className="forum-modal-actions">
          <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading || !title.trim()} type="button">
            {loading ? 'Checking content...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Community Modal ────────────────────────────────────────────────────
function CreateForumModal({ onClose, onCreated }) {
  const [name, setName]       = useState('');
  const [desc, setDesc]       = useState('');
  const [icon, setIcon]       = useState('💬');
  const [rules, setRules]     = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  async function handleSubmit() {
    if (!name.trim()) return setError('Name is required');
    if (name.length < 3) return setError('Name must be at least 3 characters');
    setLoading(true); setError('');
    try {
      const forum = await api.post('/forum', { name: name.trim(), description: desc, icon, rules });
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

        <div className="forum-modal-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <label className="forum-field-label">Icon</label>
            <input className="forum-input" value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} style={{ width: 64, textAlign: 'center', fontSize: '1.5rem' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="forum-field-label">Community Name *</label>
            <input className="forum-input" placeholder="e.g. Marvel Movies" value={name} onChange={e => setName(e.target.value)} maxLength={50} />
            {name && <p className="forum-slug-preview">f/{slug}</p>}
          </div>
        </div>

        <label className="forum-field-label">Description</label>
        <textarea className="forum-textarea" placeholder="What is this community about?" value={desc} onChange={e => setDesc(e.target.value)} rows={3} />

        <label className="forum-field-label">Community Rules <span className="forum-field-optional">(optional)</span></label>
        <textarea className="forum-textarea" placeholder={"1. Be respectful\n2. No spoilers without tags\n3. Stay on topic"} value={rules} onChange={e => setRules(e.target.value)} rows={4} />

        <div className="forum-modal-actions">
          <button className="btn-ghost" onClick={onClose} type="button">Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading || name.length < 3} type="button">
            {loading ? 'Creating...' : 'Create Community'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Forum Home ────────────────────────────────────────────────────────────────
function ForumHome() {
  const [forums, setForums]     = useState([]);
  const [myForums, setMyForums] = useState([]);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab]           = useState('all'); // 'all' | 'joined'
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    Promise.all([
      api.get('/forum').catch(() => []),
      api.get('/forum/user/my-forums').catch(() => []),
    ]).then(([all, mine]) => {
      setForums(Array.isArray(all) ? all : []);
      setMyForums(Array.isArray(mine) ? mine : []);
    }).finally(() => setLoading(false));
  }, []);

  const myForumIds = myForums.map(f => f.id);
  const filtered = forums
    .filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    .filter(f => tab === 'joined' ? myForumIds.includes(f.id) : true);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content forum-page">
        <div className="forum-home-header">
          <div>
            <h1 className="forum-page-title">💬 Communities</h1>
            <p className="forum-page-subtitle">Find your fandom. Discuss movies, TV, books, and more.</p>
          </div>
          {user && <button className="btn-primary" onClick={() => setShowCreate(true)} type="button">+ Create Community</button>}
        </div>

        <div className="forum-home-controls">
          <input className="search-input" placeholder="Search communities..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="forum-sort-tabs">
            <button className={`forum-sort-btn ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')} type="button">All</button>
            {user && <button className={`forum-sort-btn ${tab === 'joined' ? 'active' : ''}`} onClick={() => setTab('joined')} type="button">Joined</button>}
          </div>
        </div>

        {loading ? <div className="loading-state">Loading communities...</div> : filtered.length === 0 ? (
          <div className="forum-empty">
            <p className="forum-empty-icon">🏜️</p>
            <h3>{tab === 'joined' ? "You haven't joined any communities yet" : 'No communities found'}</h3>
            <p>{tab === 'joined' ? 'Browse all communities and click Join' : 'Try a different search or create one!'}</p>
            {user && tab !== 'joined' && <button className="btn-primary" onClick={() => setShowCreate(true)} type="button">Create the first one</button>}
          </div>
        ) : (
          <div className="forum-grid">
            {filtered.map(forum => (
              <Link key={forum.id} to={`/forum/${forum.slug}`} className="forum-card">
                <div className="forum-card-icon" style={{ background: forum.banner_color || '#1c1c1c' }}>{forum.icon}</div>
                <div className="forum-card-info">
                  <h3>{forum.name}</h3>
                  <p className="forum-card-desc">{forum.description || 'No description'}</p>
                  <span className="forum-card-members">👥 {(forum.member_count || 0).toLocaleString()} members</span>
                </div>
                {myForumIds.includes(forum.id) && <span className="forum-joined-badge">✓ Joined</span>}
              </Link>
            ))}
          </div>
        )}

        {showCreate && (
          <CreateForumModal
            onClose={() => setShowCreate(false)}
            onCreated={f => { setForums(prev => [f, ...prev]); navigate(`/forum/${f.slug}`); }}
          />
        )}
      </main>
    </div>
  );
}

// ── Forum View (community page) ───────────────────────────────────────────────
function ForumView() {
  const { slug } = useParams();
  const { user } = useAuth();
  const isAdmin = normalizeUserType(user?.userType) === 'admin';
  const [forum, setForum]         = useState(null);
  const [posts, setPosts]         = useState([]);
  const [sort, setSort]           = useState('hot');
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [joined, setJoined]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [myVotes, setMyVotes]     = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const fetchPosts = useCallback(async (pageNum, sortVal) => {
    try {
      const data = await api.get(`/forum/${slug}/posts?sort=${sortVal}&page=${pageNum}`);
      setPosts(prev => pageNum === 1 ? (data.posts || []) : [...prev, ...(data.posts || [])]);
      setTotal(data.total || 0);
    } catch (err) { console.warn('Posts error:', err.message); if (pageNum === 1) setPosts([]); }
    finally { setLoading(false); }
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
      if (joined) { await api.post(`/forum/${slug}/leave`); setJoined(false); setForum(f => f ? { ...f, member_count: Math.max(0, (f.member_count || 1) - 1) } : f); }
      else        { await api.post(`/forum/${slug}/join`);  setJoined(true);  setForum(f => f ? { ...f, member_count: (f.member_count || 0) + 1 } : f); }
    } catch (err) { alert(err.message); }
  }

  async function handleVote(postId, value) {
    if (!user) return;
    const prev = myVotes[postId] || 0;
    setMyVotes(v => ({ ...v, [postId]: value }));
    setPosts(ps => ps.map(p => p.id === postId ? { ...p, score: p.score + (value - prev) } : p));
    await api.post(`/forum/post/${postId}/vote`, { value }).catch(() => {
      setMyVotes(v => ({ ...v, [postId]: prev }));
      setPosts(ps => ps.map(p => p.id === postId ? { ...p, score: p.score - (value - prev) } : p));
    });
  }

  async function handleDeletePost(postId, asAdmin) {
    if (!window.confirm(asAdmin ? 'Remove this post and all its comments?' : 'Delete this post?')) return;
    try {
      if (asAdmin) await api.delete(`/forum/admin/post/${postId}`);
      else         await api.delete(`/forum/post/${postId}`);
      setPosts(ps => ps.filter(p => p.id !== postId));
      setTotal(t => Math.max(0, t - 1));
    } catch (err) { alert(err.message); }
  }

  const filteredPosts = searchQuery
    ? posts.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.tags?.some(t => t.includes(searchQuery.toLowerCase())))
    : posts;

  if (!forum && !loading) return (
    <div className="app-layout"><Navbar />
      <main className="page-content forum-page">
        <div className="forum-empty"><p className="forum-empty-icon">🔍</p><h3>Community not found</h3><Link to="/forum" className="btn-primary">Browse communities</Link></div>
      </main>
    </div>
  );

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content forum-page">
        {forum && (
          <div className="forum-banner" style={{ background: `linear-gradient(135deg, ${forum.banner_color || '#1c1c1c'} 0%, #0a0a0a 100%)` }}>
            <span className="forum-banner-icon">{forum.icon}</span>
            <div className="forum-banner-text">
              <h1 className="forum-banner-name">{forum.name}</h1>
              {forum.description && <p className="forum-banner-desc">{forum.description}</p>}
              <div className="forum-banner-stats">
                <span>👥 {(forum.member_count || 0).toLocaleString()} members</span>
                <span>📝 {total.toLocaleString()} posts</span>
              </div>
            </div>
            <div className="forum-banner-actions">
              {user && (
                <button className={joined ? 'btn-ghost' : 'btn-primary'} onClick={handleJoinLeave} type="button">
                  {joined ? '✓ Joined' : '+ Join'}
                </button>
              )}
              {user && <button className="btn-primary" onClick={() => setShowCreate(true)} type="button">✏️ Post</button>}
            </div>
          </div>
        )}

        <div className="forum-layout">
          <div className="forum-main-col">
            <div className="forum-controls">
              <div className="forum-sort-tabs">
                {SORT_OPTIONS.map(s => (
                  <button key={s.value} className={`forum-sort-btn ${sort === s.value ? 'active' : ''}`} onClick={() => setSort(s.value)} type="button">{s.label}</button>
                ))}
              </div>
              <input className="forum-search-input" placeholder="🔍 Search posts..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>

            {loading ? <div className="loading-state">Loading posts...</div>
            : filteredPosts.length === 0 ? (
              <div className="forum-empty">
                <p className="forum-empty-icon">{searchQuery ? '🔍' : '📭'}</p>
                <h3>{searchQuery ? 'No posts match your search' : 'No posts yet'}</h3>
                <p>{searchQuery ? 'Try different keywords' : 'Be the first to start a discussion!'}</p>
                {!searchQuery && user && <button className="btn-primary" onClick={() => setShowCreate(true)} type="button">Create first post</button>}
              </div>
            ) : (
              <>
                <div className="forum-posts-list">
                  {filteredPosts.map(post => (
                    <PostCard
                      key={post.id} post={post} forumSlug={slug}
                      onVote={v => handleVote(post.id, v)}
                      userVote={myVotes[post.id] || 0}
                      user={user} isAdmin={isAdmin}
                      onDelete={handleDeletePost}
                    />
                  ))}
                </div>
                {!searchQuery && posts.length < total && (
                  <button className="forum-load-more" onClick={() => { const next = page + 1; setPage(next); fetchPosts(next, sort); }} type="button">
                    Load more posts
                  </button>
                )}
              </>
            )}
          </div>

          {/* Sidebar */}
          <aside className="forum-sidebar">
            {forum && (
              <>
                <div className="forum-sidebar-card">
                  <h3 className="forum-sidebar-heading">About</h3>
                  <p className="forum-sidebar-text">{forum.description || 'A community for discussion.'}</p>
                  <div className="forum-sidebar-stats">
                    <div><strong>{(forum.member_count || 0).toLocaleString()}</strong><span>Members</span></div>
                    <div><strong>{total.toLocaleString()}</strong><span>Posts</span></div>
                  </div>
                  {user && (
                    <button className={`forum-sidebar-join-btn ${joined ? 'joined' : ''}`} onClick={handleJoinLeave} type="button">
                      {joined ? '✓ Joined' : '+ Join Community'}
                    </button>
                  )}
                </div>

                {forum.rules && (
                  <div className="forum-sidebar-card">
                    <h3 className="forum-sidebar-heading">📋 Rules</h3>
                    <div className="forum-rules">
                      {forum.rules.split('\n').filter(Boolean).map((rule, i) => (
                        <p key={i} className="forum-rule">{rule}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="forum-sidebar-card">
                  <h3 className="forum-sidebar-heading">🏷️ Flairs</h3>
                  <div className="forum-flair-list">
                    {FLAIRS.map(f => <FlairBadge key={f} flair={f} size="md" />)}
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </main>

      {showCreate && (
        <CreatePostModal
          forumSlug={slug}
          onClose={() => setShowCreate(false)}
          onCreated={p => { setPosts(prev => [p, ...prev]); setTotal(t => t + 1); }}
        />
      )}
    </div>
  );
}

// ── Post Detail View ──────────────────────────────────────────────────────────
function PostView() {
  const { slug, postId } = useParams();
  const { user } = useAuth();
  const isAdmin = normalizeUserType(user?.userType) === 'admin';
  const navigate = useNavigate();

  const [post, setPost]             = useState(null);
  const [comments, setComments]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [replyTo, setReplyTo]       = useState(null);  // comment id being replied to
  const [replyBody, setReplyBody]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [myPostVote, setMyPostVote] = useState(0);
  const [myCommentVotes, setMyCommentVotes] = useState({});
  const [commentSort, setCommentSort] = useState('best');
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const [editingComment, setEditingComment]   = useState(null); // id of comment being edited
  const [editBody, setEditBody]     = useState('');
  const commentInputRef = useRef(null);

  useEffect(() => {
    api.get(`/forum/post/${postId}`)
      .then(data => { setPost(data.post); setComments(data.comments || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  // Sort comments
  const sortedComments = [...comments].sort((a, b) => {
    if (commentSort === 'best') return b.score - a.score;
    if (commentSort === 'new')  return new Date(b.created_at) - new Date(a.created_at);
    if (commentSort === 'old')  return new Date(a.created_at) - new Date(b.created_at);
    return 0;
  });

  async function handlePostVote(value) {
    if (!user || !post) return;
    const prev = myPostVote;
    setMyPostVote(value);
    setPost(p => ({ ...p, score: p.score + (value - prev) }));
    await api.post(`/forum/post/${post.id}/vote`, { value }).catch(() => { setMyPostVote(prev); setPost(p => ({ ...p, score: p.score - (value - prev) })); });
  }

  async function handleCommentVote(commentId, value) {
    if (!user) return;
    const prev = myCommentVotes[commentId] || 0;
    setMyCommentVotes(v => ({ ...v, [commentId]: value }));
    setComments(cs => cs.map(c => c.id === commentId ? { ...c, score: c.score + (value - prev) } : c));
    await api.post(`/forum/comment/${commentId}/vote`, { value }).catch(() => {
      setMyCommentVotes(v => ({ ...v, [commentId]: prev }));
      setComments(cs => cs.map(c => c.id === commentId ? { ...c, score: c.score - (value - prev) } : c));
    });
  }

  async function handleDeletePost() {
    if (!window.confirm(isAdmin ? 'Remove this post and all its comments?' : 'Delete this post?')) return;
    try {
      if (isAdmin) await api.delete(`/forum/admin/post/${post.id}`);
      else         await api.delete(`/forum/post/${post.id}`);
      navigate(`/forum/${slug}`);
    } catch (err) { alert(err.message); }
  }

  async function handleDeleteComment(commentId) {
    if (!window.confirm(isAdmin ? 'Remove this comment?' : 'Delete this comment?')) return;
    try {
      if (isAdmin) {
        const updated = await api.patch(`/forum/admin/comment/${commentId}`, {});
        setComments(cs => cs.map(c => c.id === commentId ? { ...c, ...updated } : c));
      } else {
        await api.delete(`/forum/comment/${commentId}`);
        setComments(cs => cs.filter(c => c.id !== commentId));
        setPost(p => ({ ...p, comment_count: Math.max(0, p.comment_count - 1) }));
      }
    } catch (err) { alert(err.message); }
  }

  async function submitComment(body, parentId, onSuccess) {
    if (!body.trim()) return;
    setSubmitting(true); setError('');
    try {
      const data = await api.post(`/forum/post/${postId}/comments`, { body: body.trim(), parent_comment_id: parentId || null });
      setComments(prev => [data, ...prev]);
      setPost(p => ({ ...p, comment_count: p.comment_count + 1 }));
      onSuccess();
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  function handleTopLevelComment(e) {
    e.preventDefault();
    submitComment(commentBody, null, () => setCommentBody(''));
  }

  function buildTree(flatComments) {
    const map = {};
    const roots = [];
    flatComments.forEach(c => { map[c.id] = { ...c, replies: [] }; });
    flatComments.forEach(c => {
      if (c.parent_comment_id && map[c.parent_comment_id]) map[c.parent_comment_id].replies.push(map[c.id]);
      else roots.push(map[c.id]);
    });
    return roots;
  }

  function CommentNode({ comment, depth = 0 }) {
    const [collapsed, setCollapsed] = useState(false);
    const isOwn = user?.id === comment.user_id;
    const canDelete = user && (isAdmin || isOwn);
    const isEditing = editingComment === comment.id;

    return (
      <div className={`forum-comment depth-${Math.min(depth, 6)}`}>
        <div className="forum-comment-inner">
          <VoteButtons
            score={comment.score}
            onVote={v => handleCommentVote(comment.id, v)}
            userVote={myCommentVotes[comment.id] || 0}
            vertical
            disabled={!user || comment.is_removed}
          />
          <div className="forum-comment-content">
            {/* Comment header */}
            <div className="forum-comment-meta">
              <span className="forum-comment-author">
                {comment.profiles?.avatar_url && (
                  <img src={comment.profiles.avatar_url} alt="" className="forum-comment-avatar" />
                )}
                u/{comment.profiles?.username || 'unknown'}
                {isOwn && <span className="forum-own-badge">OP</span>}
              </span>
              <span className="forum-comment-time">{timeAgo(comment.created_at)}</span>
              <button className="forum-collapse-btn" onClick={() => setCollapsed(c => !c)} type="button">
                {collapsed ? '[+]' : '[−]'}
              </button>
            </div>

            {/* Comment body */}
            {!collapsed && (
              <>
                {comment.is_removed ? (
                  <p className="forum-comment-removed">{comment.body}</p>
                ) : isEditing ? (
                  <div className="forum-edit-form">
                    <textarea className="forum-textarea forum-textarea--sm" value={editBody} onChange={e => setEditBody(e.target.value)} rows={3} />
                    <div className="forum-modal-actions" style={{ marginTop: '0.5rem' }}>
                      <button className="btn-ghost btn-sm" onClick={() => setEditingComment(null)} type="button">Cancel</button>
                      <button className="btn-primary btn-sm" type="button" onClick={async () => {
                        // Save edit — for now just update locally (would need a PATCH /comment/:id endpoint)
                        setComments(cs => cs.map(c => c.id === comment.id ? { ...c, body: editBody } : c));
                        setEditingComment(null);
                      }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="forum-comment-body">{renderMarkdown(comment.body)}</div>
                )}

                {/* Comment actions */}
                {!comment.is_removed && (
                  <div className="forum-comment-actions">
                    {user && (
                      <button className="forum-reply-btn" onClick={() => {
                        setReplyTo(replyTo === comment.id ? null : comment.id);
                        setReplyBody('');
                      }} type="button">
                        💬 Reply
                      </button>
                    )}
                    {!isAdmin && user && <ReportButton commentId={comment.id} />}
                    {isOwn && !isEditing && (
                      <button className="forum-reply-btn" onClick={() => { setEditingComment(comment.id); setEditBody(comment.body); }} type="button">
                        ✏️ Edit
                      </button>
                    )}
                    {canDelete && (
                      <button className="forum-action-btn forum-action-btn--delete forum-action-btn--inline" onClick={() => handleDeleteComment(comment.id)} type="button">
                        {isAdmin ? '🛡️ Remove' : '🗑️ Delete'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Reply form */}
        {!collapsed && replyTo === comment.id && (
          <div className="forum-reply-form">
            <textarea
              className="forum-textarea forum-textarea--sm"
              value={replyBody}
              onChange={e => setReplyBody(e.target.value)}
              placeholder={`Reply to u/${comment.profiles?.username || 'user'}...`}
              rows={3}
              autoFocus
            />
            <div className="forum-modal-actions" style={{ marginTop: '0.5rem' }}>
              <button className="btn-ghost btn-sm" onClick={() => setReplyTo(null)} type="button">Cancel</button>
              <button className="btn-primary btn-sm" type="button"
                disabled={submitting || !replyBody.trim()}
                onClick={() => submitComment(replyBody, comment.id, () => { setReplyTo(null); setReplyBody(''); })}
              >
                {submitting ? '...' : 'Reply'}
              </button>
            </div>
          </div>
        )}

        {/* Nested replies */}
        {!collapsed && comment.replies?.length > 0 && (
          <div className="forum-replies">
            {comment.replies.map(r => <CommentNode key={r.id} comment={r} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  const flairColor = FLAIR_COLORS[post?.flair] || '#555';
  const isSpoiler = post?.flair === 'Spoiler';
  const postUrl = `${window.location.origin}/forum/${slug}/post/${postId}`;

  if (loading) return <div className="app-layout"><Navbar /><main className="page-content"><div className="loading-state">Loading...</div></main></div>;
  if (!post)   return <div className="app-layout"><Navbar /><main className="page-content"><div className="forum-empty"><p className="forum-empty-icon">🔍</p><h3>Post not found</h3><Link to={`/forum/${slug}`} className="btn-primary">Go back</Link></div></main></div>;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content forum-page">
        <div className="forum-breadcrumb">
          <Link to="/forum">Communities</Link>
          <span>›</span>
          <Link to={`/forum/${slug}`}>{post.forums?.icon} {post.forums?.name || slug}</Link>
          <span>›</span>
          <span className="forum-breadcrumb-current">Post</span>
        </div>

        <div className="forum-layout">
          <div className="forum-main-col">
            {/* Post */}
            <article className="forum-post-detail">
              <div className="forum-post-detail-vote">
                <VoteButtons score={post.score} onVote={handlePostVote} userVote={myPostVote} vertical disabled={!user} />
              </div>
              <div className="forum-post-detail-body">
                <div className="forum-post-meta">
                  <Link to={`/forum/${slug}`} className="forum-community-pill">{post.forums?.icon} {post.forums?.name}</Link>
                  <span className="forum-post-author">u/{post.profiles?.username || 'unknown'}</span>
                  <span className="forum-post-time">{timeAgo(post.created_at)}</span>
                  <FlairBadge flair={post.flair} />
                </div>
                <h1 className="forum-post-detail-title">{post.title}</h1>
                {post.tags?.length > 0 && (
                  <div className="forum-post-tags">{post.tags.map(t => <span key={t} className="forum-tag-pill">#{t}</span>)}</div>
                )}
                {post.body && (
                  isSpoiler && !spoilerRevealed ? (
                    <div className="forum-spoiler-block" onClick={() => setSpoilerRevealed(true)}>
                      <div className="forum-spoiler-overlay">
                        <span>⚠️ Spoiler — click to reveal</span>
                      </div>
                      <div className="forum-spoiler-content">{renderMarkdown(post.body)}</div>
                    </div>
                  ) : (
                    <div className="forum-post-detail-text">{renderMarkdown(post.body)}</div>
                  )
                )}
                <div className="forum-post-detail-actions">
                  <ShareButton url={postUrl} title={post.title} />
                  {user && !isAdmin && <ReportButton postId={post.id} />}
                  {(isAdmin || user?.id === post.user_id) && (
                    <button className="forum-action-btn forum-action-btn--delete" onClick={handleDeletePost} type="button">
                      {isAdmin ? '🛡️ Admin Remove' : '🗑️ Delete Post'}
                    </button>
                  )}
                </div>
              </div>
            </article>

            {/* Comment box */}
            <section className="forum-comments-section">
              <div className="forum-comments-header">
                <h2 className="forum-comments-heading">
                  {post.comment_count} {post.comment_count === 1 ? 'Comment' : 'Comments'}
                </h2>
                <div className="forum-comment-sort">
                  <span className="forum-comment-sort-label">Sort:</span>
                  {COMMENT_SORT_OPTIONS.map(s => (
                    <button key={s.value} className={`forum-sort-btn forum-sort-btn--sm ${commentSort === s.value ? 'active' : ''}`} onClick={() => setCommentSort(s.value)} type="button">{s.label}</button>
                  ))}
                </div>
              </div>

              {user ? (
                <form className="forum-comment-form" onSubmit={handleTopLevelComment}>
                  <div className="forum-comment-form-inner">
                    <textarea
                      ref={commentInputRef}
                      className="forum-textarea"
                      value={commentBody}
                      onChange={e => setCommentBody(e.target.value)}
                      placeholder="What are your thoughts? Markdown supported."
                      rows={4}
                      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleTopLevelComment(e); }}
                    />
                    {error && <div className="forum-error">{error}</div>}
                    <div className="forum-comment-form-footer">
                      <span className="forum-md-hint">**bold** *italic* `code` &gt; quote  ·  Ctrl+Enter to submit</span>
                      <button className="btn-primary btn-sm" type="submit" disabled={submitting || !commentBody.trim()}>
                        {submitting ? 'Checking...' : 'Comment'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="forum-login-prompt">
                  <Link to="/login" className="btn-primary btn-sm">Log in</Link> to join the discussion
                </div>
              )}

              <div className="forum-comment-tree">
                {buildTree(sortedComments).map(c => <CommentNode key={c.id} comment={c} />)}
                {comments.length === 0 && (
                  <div className="forum-empty" style={{ padding: '2rem 0' }}>
                    <p>No comments yet. Be the first!</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <aside className="forum-sidebar">
            <div className="forum-sidebar-card">
              <h3 className="forum-sidebar-heading">About this post</h3>
              <div className="forum-sidebar-stats">
                <div><strong>{post.score}</strong><span>Points</span></div>
                <div><strong>{post.comment_count}</strong><span>Comments</span></div>
              </div>
              <p className="forum-sidebar-text" style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#555' }}>
                Posted {timeAgo(post.created_at)} by u/{post.profiles?.username}
              </p>
              <ShareButton url={postUrl} title={post.title} />
            </div>

            {post.forums && (
              <div className="forum-sidebar-card">
                <h3 className="forum-sidebar-heading">{post.forums.icon} {post.forums.name}</h3>
                <Link to={`/forum/${slug}`} className="forum-sidebar-join-btn">View Community</Link>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

// ── Router ─────────────────────────────────────────────────────────────────────
export default function ForumRouter() {
  const { slug, postId } = useParams();
  if (slug && postId) return <PostView />;
  if (slug)           return <ForumView />;
  return                     <ForumHome />;
}

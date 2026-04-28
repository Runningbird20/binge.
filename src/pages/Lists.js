import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseLists,
  fetchSupabaseList,
  createSupabaseList,
  updateSupabaseList,
  deleteSupabaseList,
  inviteSupabaseListCollaborator,
  removeSupabaseListCollaborator,
  voteSupabaseListItem,
  moveSupabaseListItem,
  removeSupabaseListItem,
  fetchSupabasePublicLists,
  updateWatchlistProgress,
  fetchListComments,
  addListComment,
  deleteListComment,
} from '../utils/supabaseData';

function getTypeLabel(mediaType) {
  if (mediaType === 'movie') return 'Movie';
  if (mediaType === 'tv_show') return 'TV Show';
  return 'Book';
}

function getImageUrl(item) {
  const rawUrl = item.image_url || '';
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  if (rawUrl.startsWith('http://')) return rawUrl.replace(/^http:\/\//i, 'https://');
  return rawUrl;
}

function getShareUrl(shareCode) {
  if (typeof window === 'undefined') return `/lists/${shareCode}`;
  return `${window.location.origin}/lists/${shareCode}`;
}

function WatchedToggle({ item, onToggle }) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(item.my_watchlist_status);

  async function handleClick() {
    setSaving(true);
    const newStatus = (status === 'watched' || status === 'read')
      ? (item.media_type === 'book' ? 'reading' : 'watching')
      : (item.media_type === 'book' ? 'read' : 'watched');
    try {
      await updateWatchlistProgress({ mediaType: item.media_type, mediaId: item.media_id, status: newStatus });
      setStatus(newStatus);
      onToggle?.(item, newStatus);
    } catch {}
    finally { setSaving(false); }
  }

  const done = status === 'watched' || status === 'read';
  return (
    <button
      type="button"
      className={`ll-watched-btn${done ? ' done' : ''}`}
      onClick={handleClick}
      disabled={saving}
      title={done ? 'Mark as unwatched' : 'Mark as watched'}
    >
      {saving ? '…' : done ? '✓' : '○'}
    </button>
  );
}

function ListItemCard({ item, index, onVote, onMove, onRemove, canEdit, isBusy, isFirst, isLast }) {
  const imageUrl = getImageUrl(item);
  const isLeader = index === 0;

  return (
    <article className={`ll-item${isLeader ? ' ll-item--leader' : ''}`}>
      <span className="ll-item-rank">#{index + 1}</span>

      <div className="ll-item-poster">
        {imageUrl
          ? <img src={imageUrl} alt={item.title} />
          : <span className="ll-item-poster-fallback">{item.title?.charAt(0)}</span>
        }
      </div>

      <div className="ll-item-info">
        <div className="ll-item-title-row">
          <h3 className="ll-item-title">{item.title}</h3>
          <span className="ll-item-type">{getTypeLabel(item.media_type)}</span>
        </div>
        <p className="ll-item-meta">
          {[item.creator_name, item.year, item.genre].filter(Boolean).join(' · ')}
        </p>
      </div>

      <WatchedToggle item={item} />

      <div className="ll-item-votes">
        <button
          type="button"
          className={`ll-vote-btn${item.my_vote === 1 ? ' active' : ''}`}
          onClick={() => onVote(item, item.my_vote === 1 ? 0 : 1)}
          disabled={isBusy}
          aria-label="Upvote"
        >▲</button>
        <span className={`ll-vote-score${item.vibe_score > 0 ? ' pos' : item.vibe_score < 0 ? ' neg' : ''}`}>
          {item.vibe_score}
        </span>
        <button
          type="button"
          className={`ll-vote-btn ll-vote-btn--down${item.my_vote === -1 ? ' active' : ''}`}
          onClick={() => onVote(item, item.my_vote === -1 ? 0 : -1)}
          disabled={isBusy}
          aria-label="Downvote"
        >▼</button>
      </div>

      {canEdit && (
        <div className="ll-item-controls">
          <button type="button" className="ll-ctrl-btn" onClick={() => onMove(item, 'up')}
            disabled={isBusy || isFirst} title="Move up">↑</button>
          <button type="button" className="ll-ctrl-btn" onClick={() => onMove(item, 'down')}
            disabled={isBusy || isLast} title="Move down">↓</button>
          <button type="button" className="ll-ctrl-btn ll-ctrl-btn--remove" onClick={() => onRemove(item)}
            disabled={isBusy} title="Remove">✕</button>
        </div>
      )}
    </article>
  );
}

function formatAgo(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d/60)}m ago`;
  if (d < 86400) return `${Math.round(d/3600)}h ago`;
  return `${Math.round(d/86400)}d ago`;
}

function ListComments({ listId }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!listId) return;
    fetchListComments(listId).then(setComments).catch(() => {});
  }, [listId]);

  async function handlePost(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await addListComment(listId, draft);
      setDraft('');
      const updated = await fetchListComments(listId);
      setComments(updated);
    } catch {}
    finally { setPosting(false); }
  }

  async function handleDelete(id) {
    try {
      await deleteListComment(id);
      setComments(c => c.filter(x => x.id !== id));
    } catch {}
  }

  return (
    <div className="ll-comments">
      <h4 className="ll-comments-heading">Comments</h4>
      {comments.length === 0 && <p className="ll-comments-empty">No comments yet.</p>}
      <div className="ll-comments-list">
        {comments.map(c => (
          <div key={c.id} className="ll-comment">
            <div className="ll-comment-header">
              <Link to={`/profile/${c.author.username}`} className="ll-comment-author">{c.author.username}</Link>
              <span className="ll-comment-time">{formatAgo(c.created_at)}</span>
              {user?.id === c.user_id && (
                <button type="button" className="ll-comment-delete" onClick={() => handleDelete(c.id)} title="Delete">✕</button>
              )}
            </div>
            <p className="ll-comment-body">{c.body}</p>
          </div>
        ))}
      </div>
      {user && (
        <form className="ll-comment-form" onSubmit={handlePost}>
          <input
            className="ll-input"
            type="text"
            placeholder="Add a comment…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            maxLength={1000}
          />
          <button type="submit" className="btn-primary btn-sm" disabled={posting || !draft.trim()}>
            {posting ? '…' : 'Post'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function Lists() {
  const [mode, setMode]                     = useState('mine'); // 'mine' | 'discover'
  const [lists, setLists]                   = useState([]);
  const [selectedListId, setSelectedListId] = useState(null);
  const [selectedList, setSelectedList]     = useState(null);
  const [listsLoading, setListsLoading]     = useState(true);
  const [detailLoading, setDetailLoading]   = useState(false);
  const [working, setWorking]               = useState(false);
  const [showCreate, setShowCreate]         = useState(false);
  const [createName, setCreateName]         = useState('');
  const [createPublic, setCreatePublic]     = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [editName, setEditName]             = useState('');
  const [editPublic, setEditPublic]         = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [statusMessage, setStatusMessage]   = useState('');
  const [statusKind, setStatusKind]         = useState('info'); // 'info' | 'error'

  // Discover mode
  const [publicLists, setPublicLists]       = useState([]);
  const [publicLoading, setPublicLoading]   = useState(false);
  const [discoverSearch, setDiscoverSearch] = useState('');

  const flash = useCallback((msg, kind = 'info') => {
    setStatusMessage(msg);
    setStatusKind(kind);
  }, []);

  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => setStatusMessage(''), 4000);
    return () => clearTimeout(t);
  }, [statusMessage]);

  const loadLists = useCallback(async (preferredListId) => {
    setListsLoading(true);
    try {
      const nextLists = await fetchSupabaseLists();
      setLists(nextLists);
      setSelectedListId((current) => {
        const requestedId = preferredListId ?? current;
        if (requestedId && nextLists.some((l) => Number(l.id) === Number(requestedId)))
          return Number(requestedId);
        return nextLists[0] ? Number(nextLists[0].id) : null;
      });
      if (!nextLists.length) setSelectedList(null);
    } catch (err) {
      setLists([]);
      setSelectedListId(null);
      setSelectedList(null);
      flash(err.message, 'error');
    } finally {
      setListsLoading(false);
    }
  }, [flash]);

  const loadSelectedList = useCallback(async (listId, { silent = false } = {}) => {
    if (!listId) { setSelectedList(null); return; }
    if (!silent) setDetailLoading(true);
    try {
      const data = await fetchSupabaseList(listId);
      setSelectedList(data);
      setEditName(data?.name || '');
      setEditPublic(Boolean(data?.is_public));
    } catch (err) {
      setSelectedList(null);
      flash(err.message, 'error');
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, [flash]);

  useEffect(() => { loadLists(); }, [loadLists]);

  useEffect(() => {
    if (mode !== 'discover') return;
    let cancelled = false;
    setPublicLoading(true);
    fetchSupabasePublicLists({ search: discoverSearch }).then(data => {
      if (!cancelled) setPublicLists(data);
    }).catch(() => {
      if (!cancelled) setPublicLists([]);
    }).finally(() => {
      if (!cancelled) setPublicLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode, discoverSearch]);

  useEffect(() => {
    if (!selectedListId) { setSelectedList(null); return undefined; }
    let cancelled = false;
    async function refresh() { if (!cancelled) await loadSelectedList(selectedListId); }
    refresh();
    const id = window.setInterval(() => {
      if (!cancelled) loadSelectedList(selectedListId, { silent: true });
    }, 8000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [loadSelectedList, selectedListId]);

  async function handleCreateList(e) {
    e.preventDefault();
    if (!createName.trim()) { flash('Give the list a name first.', 'error'); return; }
    setWorking(true);
    try {
      const created = await createSupabaseList({ name: createName.trim(), isPublic: createPublic });
      setCreateName(''); setCreatePublic(false); setShowCreate(false);
      setSelectedList(created); setSelectedListId(created.id);
      setEditName(created.name); setEditPublic(Boolean(created.is_public));
      flash(`"${created.name}" created.`);
      await loadLists(created.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleSaveSettings() {
    if (!selectedList) return;
    setWorking(true);
    try {
      const updated = await updateSupabaseList(selectedList.id, { name: editName.trim(), isPublic: editPublic });
      setSelectedList(updated); setEditName(updated.name); setEditPublic(Boolean(updated.is_public));
      setEditingSettings(false);
      flash('Settings saved.');
      await loadLists(updated.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleDeleteList() {
    if (!selectedList || !window.confirm(`Delete "${selectedList.name}"?`)) return;
    setWorking(true);
    try {
      await deleteSupabaseList(selectedList.id);
      flash('List deleted.');
      setSelectedList(null); setSelectedListId(null);
      await loadLists();
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!selectedList || !inviteUsername.trim()) { flash('Enter a username to invite.', 'error'); return; }
    setWorking(true);
    try {
      const updated = await inviteSupabaseListCollaborator(selectedList.id, inviteUsername.trim());
      setSelectedList(updated); setInviteUsername('');
      flash(`Invited ${inviteUsername.trim()}.`);
      await loadLists(updated.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleRemoveCollaborator(collaboratorId, username) {
    if (!selectedList || !window.confirm(`Remove ${username}?`)) return;
    setWorking(true);
    try {
      const updated = await removeSupabaseListCollaborator(selectedList.id, collaboratorId);
      setSelectedList(updated); flash(`${username} removed.`);
      await loadLists(updated.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleVote(item, value) {
    if (!selectedList) return;
    setWorking(true);
    try {
      const updated = await voteSupabaseListItem(selectedList.id, item.id, value);
      setSelectedList(updated); await loadLists(updated.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleMove(item, direction) {
    if (!selectedList) return;
    setWorking(true);
    try {
      const updated = await moveSupabaseListItem(selectedList.id, item.id, direction);
      setSelectedList(updated); await loadLists(updated.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleRemoveItem(item) {
    if (!selectedList || !window.confirm(`Remove "${item.title}"?`)) return;
    setWorking(true);
    try {
      const updated = await removeSupabaseListItem(selectedList.id, item.id);
      setSelectedList(updated); flash(`"${item.title}" removed.`);
      await loadLists(updated.id);
    } catch (err) { flash(err.message, 'error'); }
    finally { setWorking(false); }
  }

  async function handleCopyShareLink() {
    if (!selectedList?.share_code) return;
    const url = getShareUrl(selectedList.share_code);
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(url);
      flash('Link copied to clipboard.');
    } catch { flash(`Share URL: ${url}`); }
  }

  return (
    <div className="app-layout">
      <Navbar />

      {statusMessage && (
        <div className={`ll-toast${statusKind === 'error' ? ' ll-toast--error' : ''}`}>
          {statusMessage}
        </div>
      )}

      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Collaborate</p>
          <h1>Lists</h1>
          <p className="page-subtitle">
            Build shared watchlists, invite friends by username, and let vibe votes surface the group's top pick.
          </p>
        </div>

        <div className="ll-mode-toggle">
          <button type="button" className={`ll-mode-btn${mode === 'mine' ? ' active' : ''}`} onClick={() => setMode('mine')}>
            My Lists
          </button>
          <button type="button" className={`ll-mode-btn${mode === 'discover' ? ' active' : ''}`} onClick={() => setMode('discover')}>
            Discover
          </button>
        </div>

        {mode === 'discover' ? (
          <div className="ll-discover">
            <div className="ll-discover-search">
              <input
                type="text"
                className="ll-input"
                placeholder="Search public lists…"
                value={discoverSearch}
                onChange={e => setDiscoverSearch(e.target.value)}
              />
            </div>
            {publicLoading ? (
              <div className="ll-empty"><p>Loading…</p></div>
            ) : publicLists.length === 0 ? (
              <div className="ll-empty"><p>No public lists found.</p></div>
            ) : (
              <div className="ll-discover-grid">
                {publicLists.map(list => (
                  <Link key={list.id} to={`/lists/${list.share_code}`} className="ll-discover-card">
                    <h3 className="ll-discover-name">{list.name}</h3>
                    <p className="ll-discover-meta">by {list.owner_username}</p>
                    <p className="ll-discover-count">{list.item_count} item{list.item_count !== 1 ? 's' : ''}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (

        <div className="ll-shell">
          {/* ── Sidebar ─────────────────────────────────────────── */}
          <aside className="ll-sidebar">
            <div className="ll-sidebar-header">
              <span className="ll-sidebar-title">Your Lists</span>
              <button
                type="button"
                className="ll-new-btn"
                onClick={() => setShowCreate(v => !v)}
              >
                {showCreate ? '✕ Cancel' : '+ New'}
              </button>
            </div>

            {showCreate && (
              <form className="ll-create-form" onSubmit={handleCreateList}>
                <input
                  type="text"
                  className="ll-input"
                  placeholder="List name…"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  autoFocus
                />
                <div className="ll-create-footer">
                  <label className="ll-toggle">
                    <input type="checkbox" checked={createPublic} onChange={e => setCreatePublic(e.target.checked)} />
                    <span>Public</span>
                  </label>
                  <button type="submit" className="btn-primary btn-sm" disabled={working || !createName.trim()}>
                    {working ? '…' : 'Create'}
                  </button>
                </div>
              </form>
            )}

            <div className="ll-list-stack">
              {listsLoading ? (
                <p className="ll-sidebar-hint">Loading…</p>
              ) : lists.length === 0 ? (
                <p className="ll-sidebar-hint">No lists yet — create one above.</p>
              ) : (
                lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    className={`ll-list-btn${Number(list.id) === Number(selectedListId) ? ' active' : ''}`}
                    onClick={() => { setSelectedListId(list.id); setEditingSettings(false); setStatusMessage(''); }}
                  >
                    <div className="ll-list-btn-top">
                      <span className="ll-list-btn-name">{list.name}</span>
                      <span className={`ll-badge${list.is_public ? ' ll-badge--public' : ''}`}>
                        {list.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                    <div className="ll-list-btn-meta">
                      <span>{list.item_count} items</span>
                      <span>·</span>
                      <span>{list.collaborator_count + 1} members</span>
                      {list.permissions?.role !== 'owner' && <span>· by {list.owner_username}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* ── Main ─────────────────────────────────────────────── */}
          <div className="ll-main">
            {!selectedListId ? (
              <div className="ll-empty">
                <p className="ll-empty-icon">📋</p>
                <h3>No list selected</h3>
                <p>Create a list or pick one from the sidebar to get started.</p>
              </div>
            ) : detailLoading && !selectedList ? (
              <div className="ll-empty"><p>Loading…</p></div>
            ) : !selectedList ? (
              <div className="ll-empty"><p>Could not load this list.</p></div>
            ) : (
              <>
                {/* ── Detail header ──────────────────────────────── */}
                <div className="ll-detail-header">
                  <div className="ll-detail-title-row">
                    <h2 className="ll-detail-name">{selectedList.name}</h2>
                    <span className={`ll-badge${selectedList.is_public ? ' ll-badge--public' : ''}`}>
                      {selectedList.is_public ? 'Public' : 'Private'}
                    </span>
                  </div>
                  <p className="ll-detail-owner">Owned by {selectedList.owner.username}</p>

                  <div className="ll-detail-actions">
                    <div className="ll-share-row">
                      <input
                        className="ll-share-input"
                        type="text"
                        readOnly
                        value={getShareUrl(selectedList.share_code)}
                        aria-label="Shareable URL"
                      />
                      <button type="button" className="btn-secondary btn-sm" onClick={handleCopyShareLink}>
                        Copy Link
                      </button>
                    </div>
                    {selectedList.permissions?.canManage && (
                      <button
                        type="button"
                        className="ll-settings-toggle"
                        onClick={() => setEditingSettings(v => !v)}
                      >
                        {editingSettings ? 'Done' : '⚙️ Settings'}
                      </button>
                    )}
                  </div>

                  {editingSettings && selectedList.permissions?.canManage && (
                    <div className="ll-settings-panel">
                      <div className="ll-settings-row">
                        <input
                          className="ll-input"
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          aria-label="List name"
                          placeholder="List name"
                        />
                        <label className="ll-toggle">
                          <input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} />
                          <span>Public</span>
                        </label>
                        <button type="button" className="btn-primary btn-sm" onClick={handleSaveSettings} disabled={working}>
                          Save
                        </button>
                        <button type="button" className="ll-delete-btn" onClick={handleDeleteList} disabled={working}>
                          Delete list
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Members ────────────────────────────────────── */}
                <div className="ll-members-card">
                  <div className="ll-members-top">
                    <span className="ll-section-label">Members</span>
                    <div className="ll-chip-row">
                      {selectedList.collaborators.map((m) => (
                        <div key={`${m.role}-${m.id}`} className="ll-chip">
                          <span className="ll-chip-name">{m.username}</span>
                          <span className="ll-chip-role">{m.role}</span>
                          {selectedList.permissions?.canManage && m.role !== 'owner' && (
                            <button
                              type="button"
                              className="ll-chip-remove"
                              onClick={() => handleRemoveCollaborator(m.id, m.username)}
                              disabled={working}
                              aria-label={`Remove ${m.username}`}
                            >✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {selectedList.permissions?.canManage && (
                    <form className="ll-invite-row" onSubmit={handleInvite}>
                      <input
                        className="ll-input"
                        type="text"
                        placeholder="Invite by username…"
                        value={inviteUsername}
                        onChange={e => setInviteUsername(e.target.value)}
                        aria-label="Invite collaborator"
                      />
                      <button type="submit" className="btn-secondary btn-sm" disabled={working || !inviteUsername.trim()}>
                        Invite
                      </button>
                    </form>
                  )}
                </div>

                {/* ── Consensus pick ─────────────────────────────── */}
                {selectedList.consensus_pick && (
                  <div className="ll-consensus">
                    <div className="ll-consensus-label">
                      <span className="ll-section-label">Consensus Pick</span>
                      <span className="ll-consensus-hint">Top-voted by the group</span>
                    </div>
                    <div className="ll-consensus-body">
                      <div>
                        <h3 className="ll-consensus-title">{selectedList.consensus_pick.title}</h3>
                        <p className="ll-consensus-meta">
                          {[
                            getTypeLabel(selectedList.consensus_pick.media_type),
                            selectedList.consensus_pick.year,
                            selectedList.consensus_pick.creator_name,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="ll-consensus-score">
                        <strong>{selectedList.consensus_pick.vibe_score > 0 ? '+' : ''}{selectedList.consensus_pick.vibe_score}</strong>
                        <span>vibe</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Queue ──────────────────────────────────────── */}
                <div className="ll-queue">
                  <div className="ll-queue-header">
                    <span className="ll-section-label">Queue</span>
                    <span className="ll-queue-count">{selectedList.items.length} titles</span>
                  </div>

                  {selectedList.items.length === 0 ? (
                    <div className="ll-empty">
                      <p className="ll-empty-icon">🎬</p>
                      <h3>Nothing here yet</h3>
                      <p>Open any movie, show, or book detail and use <strong>Add to List</strong>.</p>
                    </div>
                  ) : (
                    <div className="ll-item-stack">
                      {selectedList.items.map((item, i) => (
                        <ListItemCard
                          key={item.id}
                          item={item}
                          index={i}
                          onVote={handleVote}
                          onMove={handleMove}
                          onRemove={handleRemoveItem}
                          canEdit={selectedList.permissions?.canEdit}
                          isBusy={working}
                          isFirst={i === 0}
                          isLast={i === selectedList.items.length - 1}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <ListComments listId={selectedList.id} />
              </>
            )}
          </div>
        </div>
        )}
      </main>
    </div>
  );
}

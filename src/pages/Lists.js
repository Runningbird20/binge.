import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

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

function VibeVoteControls({ item, onVote, disabled }) {
  return (
    <div className="vibe-vote-controls" aria-label={`Vibe voting for ${item.title}`}>
      <button
        type="button"
        className={`vibe-vote-btn${item.my_vote === 1 ? ' is-active' : ''}`}
        onClick={() => onVote(item, item.my_vote === 1 ? 0 : 1)}
        disabled={disabled}
        aria-label={`Upvote ${item.title}`}
      >
        +
      </button>
      <span className="vibe-vote-score">{item.vibe_score}</span>
      <button
        type="button"
        className={`vibe-vote-btn${item.my_vote === -1 ? ' is-active is-negative' : ' is-negative'}`}
        onClick={() => onVote(item, item.my_vote === -1 ? 0 : -1)}
        disabled={disabled}
        aria-label={`Downvote ${item.title}`}
      >
        -
      </button>
    </div>
  );
}

function SharedListItemCard({ item, onVote, onMove, onRemove, canEdit, isBusy, isFirst, isLast }) {
  const imageUrl = getImageUrl(item);

  return (
    <article className="shared-list-item-card">
      <div className="shared-list-item-media">
        <div className="shared-list-item-poster">
          {imageUrl ? (
            <img src={imageUrl} alt={item.title} />
          ) : (
            <div className="watchlist-placeholder">
              <span>{item.title?.charAt(0)}</span>
            </div>
          )}
        </div>

        <div className="shared-list-item-copy">
          <div className="shared-list-item-title-row">
            <h3>{item.title}</h3>
            <span className="type-badge">{getTypeLabel(item.media_type)}</span>
          </div>
          <p className="shared-list-item-meta">
            {item.creator_name || 'Unknown creator'}
            {item.year ? ` | ${item.year}` : ''}
          </p>
          {item.genre && <p className="shared-list-item-genre">{item.genre}</p>}
          {item.synopsis && <p className="shared-list-item-synopsis">{item.synopsis}</p>}
        </div>
      </div>

      <div className="shared-list-item-actions">
        <VibeVoteControls item={item} onVote={onVote} disabled={isBusy} />
        <p className="shared-list-item-vibe-copy">
          {item.upvotes} up / {item.downvotes} down
        </p>

        {canEdit && (
          <div className="shared-list-item-buttons">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => onMove(item, 'up')}
              disabled={isBusy || isFirst}
            >
              Move Up
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => onMove(item, 'down')}
              disabled={isBusy || isLast}
            >
              Move Down
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm shared-list-remove-btn"
              onClick={() => onRemove(item)}
              disabled={isBusy}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Lists() {
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState(null);
  const [selectedList, setSelectedList] = useState(null);
  const [listsLoading, setListsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPublic, setCreatePublic] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [editName, setEditName] = useState('');
  const [editPublic, setEditPublic] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  async function loadLists(preferredListId) {
    setListsLoading(true);

    try {
      const data = await api.get('/lists');
      const nextLists = Array.isArray(data) ? data : [];
      setLists(nextLists);
      setSelectedListId((current) => {
        const requestedId = preferredListId ?? current;
        if (requestedId && nextLists.some((list) => Number(list.id) === Number(requestedId))) {
          return Number(requestedId);
        }
        return nextLists[0] ? Number(nextLists[0].id) : null;
      });
      if (!nextLists.length) {
        setSelectedList(null);
      }
    } catch (error) {
      setLists([]);
      setSelectedListId(null);
      setSelectedList(null);
      setStatusMessage(error.message);
    } finally {
      setListsLoading(false);
    }
  }

  async function loadSelectedList(listId, { silent = false } = {}) {
    if (!listId) {
      setSelectedList(null);
      return;
    }

    if (!silent) {
      setDetailLoading(true);
    }

    try {
      const data = await api.get(`/lists/${listId}`);
      setSelectedList(data);
      setEditName(data?.name || '');
      setEditPublic(Boolean(data?.is_public));
    } catch (error) {
      setSelectedList(null);
      setStatusMessage(error.message);
    } finally {
      if (!silent) {
        setDetailLoading(false);
      }
    }
  }

  useEffect(() => {
    loadLists();
  }, []);

  useEffect(() => {
    if (!selectedListId) {
      setSelectedList(null);
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      if (cancelled) return;
      await loadSelectedList(selectedListId, { silent: false });
    }

    refresh();

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        loadSelectedList(selectedListId, { silent: true });
      }
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedListId]);

  async function handleCreateList(event) {
    event.preventDefault();
    if (!createName.trim()) {
      setStatusMessage('Give the list a name first.');
      return;
    }

    setWorking(true);
    setStatusMessage('');

    try {
      const createdList = await api.post('/lists', {
        name: createName.trim(),
        is_public: createPublic,
      });
      setCreateName('');
      setCreatePublic(false);
      setSelectedList(createdList);
      setSelectedListId(createdList.id);
      setEditName(createdList.name);
      setEditPublic(Boolean(createdList.is_public));
      setStatusMessage(`Created "${createdList.name}".`);
      await loadLists(createdList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveSettings() {
    if (!selectedList) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.patch(`/lists/${selectedList.id}`, {
        name: editName.trim(),
        is_public: editPublic,
      });
      setSelectedList(updatedList);
      setEditName(updatedList.name);
      setEditPublic(Boolean(updatedList.is_public));
      setStatusMessage('List settings saved.');
      await loadLists(updatedList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteList() {
    if (!selectedList) return;
    if (!window.confirm(`Delete "${selectedList.name}"?`)) return;

    setWorking(true);
    setStatusMessage('');

    try {
      await api.delete(`/lists/${selectedList.id}`);
      setStatusMessage('List deleted.');
      setSelectedList(null);
      setSelectedListId(null);
      await loadLists();
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleInviteCollaborator(event) {
    event.preventDefault();
    if (!selectedList) return;
    if (!inviteUsername.trim()) {
      setStatusMessage('Enter a username to invite.');
      return;
    }

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.post(`/lists/${selectedList.id}/collaborators`, {
        username: inviteUsername.trim(),
      });
      setSelectedList(updatedList);
      setInviteUsername('');
      setStatusMessage(`Invited ${inviteUsername.trim()} to collaborate.`);
      await loadLists(updatedList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleRemoveCollaborator(collaboratorId, username) {
    if (!selectedList) return;
    if (!window.confirm(`Remove ${username} from this list?`)) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.delete(
        `/lists/${selectedList.id}/collaborators/${collaboratorId}`
      );
      setSelectedList(updatedList);
      setStatusMessage(`${username} was removed from the list.`);
      await loadLists(updatedList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleVote(item, value) {
    if (!selectedList) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.post(`/lists/${selectedList.id}/items/${item.id}/vote`, {
        value,
      });
      setSelectedList(updatedList);
      await loadLists(updatedList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleMove(item, direction) {
    if (!selectedList) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.patch(
        `/lists/${selectedList.id}/items/${item.id}/move`,
        { direction }
      );
      setSelectedList(updatedList);
      await loadLists(updatedList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleRemoveItem(item) {
    if (!selectedList) return;
    if (!window.confirm(`Remove "${item.title}" from this list?`)) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.delete(`/lists/${selectedList.id}/items/${item.id}`);
      setSelectedList(updatedList);
      setStatusMessage(`Removed "${item.title}" from the list.`);
      await loadLists(updatedList.id);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleCopyShareLink() {
    if (!selectedList?.share_code) return;

    const shareUrl = getShareUrl(selectedList.share_code);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setStatusMessage('Share link copied.');
    } catch {
      setStatusMessage(`Share this URL: ${shareUrl}`);
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <h1>Shared Lists</h1>
          <p className="books-page-subtitle">
            Build private watchlists, invite collaborators by username, and let vibe votes surface the consensus pick.
          </p>
        </div>

        <div className="lists-shell">
          <aside className="lists-sidebar">
            <section className="lists-card">
              <div className="lists-card-header">
                <h2>Create a List</h2>
                <p>Start a movie night shortlist, book club queue, or rainy-day watchlist.</p>
              </div>

              <form className="lists-form" onSubmit={handleCreateList}>
                <label>
                  <span>List Name</span>
                  <input
                    type="text"
                    placeholder="Rainy Day Films"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                  />
                </label>

                <label className="lists-checkbox">
                  <input
                    type="checkbox"
                    checked={createPublic}
                    onChange={(event) => setCreatePublic(event.target.checked)}
                  />
                  <span>Make this list public</span>
                </label>

                <button type="submit" className="btn-primary" disabled={working}>
                  {working ? 'Creating...' : 'Create List'}
                </button>
              </form>
            </section>

            <section className="lists-card">
              <div className="lists-card-header">
                <h2>Your Shared Spaces</h2>
                <p>Lists you own and lists you can co-edit.</p>
              </div>

              {listsLoading ? (
                <div className="loading-state">Loading lists...</div>
              ) : lists.length === 0 ? (
                <div className="empty-state">
                  <p>No lists yet.</p>
                  <p className="empty-hint">Create one above, then add books, movies, or shows from any detail popup.</p>
                </div>
              ) : (
                <div className="lists-summary-stack">
                  {lists.map((list) => (
                    <button
                      key={list.id}
                      type="button"
                      className={`lists-summary-card${Number(list.id) === Number(selectedListId) ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedListId(list.id);
                        setStatusMessage('');
                      }}
                    >
                      <div className="lists-summary-header">
                        <h3>{list.name}</h3>
                        <span className={`lists-visibility-badge${list.is_public ? ' is-public' : ''}`}>
                          {list.is_public ? 'Public' : 'Private'}
                        </span>
                      </div>
                      <p>
                        {list.permissions?.role === 'owner'
                          ? 'Owned by you'
                          : `Shared by ${list.owner_username}`}
                      </p>
                      <div className="lists-summary-meta">
                        <span>{list.item_count} items</span>
                        <span>{list.collaborator_count + 1} members</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </aside>

          <section className="lists-main">
            {!selectedListId ? (
              <div className="empty-state">
                <p>Select a list to start planning together.</p>
                <p className="empty-hint">Once you create one, your friends can collaborate from the same shared URL.</p>
              </div>
            ) : detailLoading && !selectedList ? (
              <div className="loading-state">Loading list details...</div>
            ) : !selectedList ? (
              <div className="empty-state">
                <p>This list could not be loaded.</p>
              </div>
            ) : (
              <>
                <section className="lists-card">
                  <div className="lists-detail-header">
                    <div>
                      <div className="lists-detail-title-row">
                        <h2>{selectedList.name}</h2>
                        <span className={`lists-visibility-badge${selectedList.is_public ? ' is-public' : ''}`}>
                          {selectedList.is_public ? 'Public' : 'Private'}
                        </span>
                      </div>
                      <p className="lists-detail-copy">
                        Owned by {selectedList.owner.username}. Add titles from the media pages, then let the vibe vote settle the group choice.
                      </p>
                    </div>
                  </div>

                  <div className="lists-settings-grid">
                    <div className="lists-settings-block">
                      <h3>Share</h3>
                      <div className="lists-share-row">
                        <input
                          type="text"
                          readOnly
                          value={getShareUrl(selectedList.share_code)}
                          aria-label="Shareable list URL"
                        />
                        <button type="button" className="btn-secondary" onClick={handleCopyShareLink}>
                          Copy Link
                        </button>
                      </div>
                    </div>

                    {selectedList.permissions?.canManage && (
                      <div className="lists-settings-block">
                        <h3>Settings</h3>
                        <div className="lists-form-inline">
                          <input
                            type="text"
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            aria-label="List name"
                          />
                          <label className="lists-checkbox">
                            <input
                              type="checkbox"
                              checked={editPublic}
                              onChange={(event) => setEditPublic(event.target.checked)}
                            />
                            <span>Public</span>
                          </label>
                          <button type="button" className="btn-primary" onClick={handleSaveSettings} disabled={working}>
                            Save
                          </button>
                          <button type="button" className="btn-ghost shared-list-remove-btn" onClick={handleDeleteList} disabled={working}>
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="lists-members-section">
                    <div className="lists-members-header">
                      <h3>Members</h3>
                      <p>{selectedList.collaborators.length} people can edit and vibe-vote here.</p>
                    </div>

                    <div className="lists-member-chip-row">
                      {selectedList.collaborators.map((member) => (
                        <div key={`${member.role}-${member.id}`} className="lists-member-chip">
                          <span>{member.username}</span>
                          <small>{member.role}</small>
                          {selectedList.permissions?.canManage && member.role !== 'owner' && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm shared-list-remove-btn"
                              onClick={() => handleRemoveCollaborator(member.id, member.username)}
                              disabled={working}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {selectedList.permissions?.canManage && (
                      <form className="lists-form-inline" onSubmit={handleInviteCollaborator}>
                        <input
                          type="text"
                          placeholder="Invite by username"
                          value={inviteUsername}
                          onChange={(event) => setInviteUsername(event.target.value)}
                          aria-label="Invite collaborator by username"
                        />
                        <button type="submit" className="btn-secondary" disabled={working}>
                          Invite Collaborator
                        </button>
                      </form>
                    )}
                  </div>
                </section>

                {selectedList.consensus_pick && (
                  <section className="lists-card lists-consensus-card">
                    <div className="lists-card-header">
                      <h2>Consensus Pick</h2>
                      <p>The current crowd favorite based on anonymous vibe votes.</p>
                    </div>
                    <div className="lists-consensus-body">
                      <div>
                        <h3>{selectedList.consensus_pick.title}</h3>
                        <p className="lists-consensus-meta">
                          {getTypeLabel(selectedList.consensus_pick.media_type)}
                          {selectedList.consensus_pick.year ? ` | ${selectedList.consensus_pick.year}` : ''}
                          {selectedList.consensus_pick.creator_name ? ` | ${selectedList.consensus_pick.creator_name}` : ''}
                        </p>
                      </div>
                      <div className="lists-consensus-score">
                        <strong>{selectedList.consensus_pick.vibe_score}</strong>
                        <span>vibe score</span>
                      </div>
                    </div>
                  </section>
                )}

                <section className="lists-card">
                  <div className="lists-card-header">
                    <h2>Manual Queue</h2>
                    <p>Reorder the shortlist here while votes build anonymous consensus in the background.</p>
                  </div>

                  {selectedList.items.length === 0 ? (
                    <div className="empty-state">
                      <p>No titles in this list yet.</p>
                      <p className="empty-hint">Open any movie, show, or book detail popup and use Add to List.</p>
                    </div>
                  ) : (
                    <div className="shared-list-item-stack">
                      {selectedList.items.map((item, index) => (
                        <SharedListItemCard
                          key={item.id}
                          item={item}
                          onVote={handleVote}
                          onMove={handleMove}
                          onRemove={handleRemoveItem}
                          canEdit={selectedList.permissions?.canEdit}
                          isBusy={working}
                          isFirst={index === 0}
                          isLast={index === selectedList.items.length - 1}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </div>

        {statusMessage && <p className="lists-page-status">{statusMessage}</p>}
      </main>
    </div>
  );
}
